import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import { createPool } from "../../../packages/database/src/index.ts";
import {
  HISTORY_QUEUE,
  type HistoryJobPayload,
} from "../../../packages/database/src/jobs.ts";
import { scopeHistoryStore } from "../../../packages/database/src/history-port.ts";
import { historyJobSchema } from "../../../packages/contracts/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(databaseUrl);
const boss = new PgBoss(databaseUrl);
boss.on("error", (error) => console.error("Queue error:", error.message));
await boss.start();
await boss.createQueue(HISTORY_QUEUE, { retryLimit: 1, expireInSeconds: 600 });

const load = (path: string) =>
  import(pathToFileURL(resolve(process.cwd(), path)).href);
let modules: Awaited<ReturnType<typeof getModules>>;
async function getModules() {
  try {
    const [github, postgres, pgClient, handler] = await Promise.all([
      load("packages/github-adapter/src/octokitApi.ts"),
      load("packages/retrieval/src/postgresStore.ts"),
      load("packages/retrieval/src/pgClient.ts"),
      load("apps/worker/src/handlers/history/handler.ts"),
    ]);
    return { github, postgres, pgClient, handler };
  } catch {
    throw new Error(
      "History implementation is not available. Merge and install the reviewed B package before starting the worker.",
    );
  }
}
try {
  modules = await getModules();
} catch (error) {
  await boss.stop();
  await pool.end();
  throw error;
}
const bClient = new modules.pgClient.PgSqlClient({
  connectionString: databaseUrl,
  max: 4,
});
const baseStore = new modules.postgres.PostgresHistoryStore(bClient) as Record<
  string,
  unknown
>;
const github = modules.github.createOctokitApiFromEnv();

await boss.work<HistoryJobPayload>(
  HISTORY_QUEUE,
  { batchSize: 1 },
  async (jobs) => {
    for (const queueJob of jobs) {
      const parsed = historyJobSchema.safeParse(queueJob.data);
      if (!parsed.success || parsed.data.jobId !== queueJob.id) {
        await pool.query(
          "UPDATE import_jobs SET status='failed',phase='failed',error='Invalid queue payload.',updated_at=now() WHERE id=$1 AND status IN ('queued','running')",
          [queueJob.id],
        );
        continue;
      }
      const job = parsed.data;
      const existing = await pool.query<{
        status: string;
        snapshot_id: string;
        url: string;
        head_sha: string;
        branch: string;
        github_id: string;
      }>(
        "SELECT j.status,j.snapshot_id,j.url,j.head_sha,j.branch,r.github_id FROM import_jobs j JOIN repositories r ON r.id=j.repo_id WHERE j.id=$1 AND j.repo_id=$2",
        [job.jobId, job.repoId],
      );
      if (
        !existing.rows[0] ||
        ["ready", "partial", "failed", "cancelled"].includes(
          existing.rows[0].status,
        )
      )
        continue;
      const stored = existing.rows[0];
      if (
        stored.snapshot_id !== job.snapshotId ||
        stored.url !== job.repoUrl ||
        stored.head_sha !== job.headSha ||
        stored.branch !== job.branch ||
        String(stored.github_id) !== String(job.githubId)
      ) {
        await pool.query(
          "UPDATE import_jobs SET status='failed',phase='failed',error='Queue payload did not match its persisted job.',updated_at=now() WHERE id=$1 AND repo_id=$2",
          [job.jobId, job.repoId],
        );
        continue;
      }
      const published = await pool.query<{ status: "ready" | "partial" }>(
        "SELECT status FROM index_snapshots WHERE id=$1 AND repo_id=$2 AND status IN ('ready','partial')",
        [job.snapshotId, job.repoId],
      );
      if (published.rows[0]) {
        await pool.query(
          "UPDATE import_jobs SET status=$3,phase=$3,updated_at=now() WHERE id=$1 AND repo_id=$2",
          [job.jobId, job.repoId, published.rows[0].status],
        );
        continue;
      }
      await pool.query(
        "UPDATE import_jobs SET status='running',phase='validating',updated_at=now() WHERE id=$1 AND repo_id=$2",
        [job.jobId, job.repoId],
      );
      const store = scopeHistoryStore(baseStore, pool, {
        repoId: job.repoId,
        snapshotId: job.snapshotId,
        githubId: job.githubId,
        structuralUnavailable: true,
      });
      const handler = modules.handler.createHistoryImportHandler({
        github,
        store,
        clock: {
          now: () => Date.now(),
          isoNow: () => new Date().toISOString(),
        },
      });
      try {
        await handler.handle(
          {
            repoUrl: job.repoUrl,
            headSha: job.headSha,
            branch: job.branch,
            repoId: job.repoId,
            snapshotId: job.snapshotId,
          },
          {
            signal: AbortSignal.timeout(540_000),
            progress: async (event: { phase: string; warnings: string[] }) => {
              await pool.query(
                "UPDATE import_jobs SET phase=$3,warnings=$4::jsonb,updated_at=now() WHERE id=$1 AND repo_id=$2",
                [
                  job.jobId,
                  job.repoId,
                  event.phase,
                  JSON.stringify(event.warnings),
                ],
              );
            },
          },
        );
        const finalSnapshot = await pool.query<{
          status: "ready" | "partial";
          coverage: { warnings: string[] };
        }>(
          "SELECT status,coverage FROM index_snapshots WHERE id=$1 AND repo_id=$2 AND status IN ('ready','partial')",
          [job.snapshotId, job.repoId],
        );
        if (!finalSnapshot.rows[0])
          throw new Error(
            "History handler returned without a published snapshot",
          );
        await pool.query(
          "UPDATE import_jobs SET status=$3,phase=$3,warnings=$4::jsonb,updated_at=now() WHERE id=$1 AND repo_id=$2",
          [
            job.jobId,
            job.repoId,
            finalSnapshot.rows[0].status,
            JSON.stringify(finalSnapshot.rows[0].coverage.warnings),
          ],
        );
      } catch (error) {
        // Avoid leaking source text, URLs containing credentials or provider details into job status.
        const candidate = (error as { code?: unknown })?.code;
        const code =
          typeof candidate === "string" && /^[A-Z][A-Z_]{2,63}$/.test(candidate)
            ? candidate
            : "IMPORT_FAILED";
        console.error(`History import ${job.jobId} failed: ${code}`);
        await pool.query(
          "UPDATE import_jobs SET status='failed',phase='failed',error=$3,updated_at=now() WHERE id=$1 AND repo_id=$2",
          [
            job.jobId,
            job.repoId,
            `Import failed (${code}). Check server logs and retry.`,
          ],
        );
      }
    }
  },
);
console.log("Domino history worker is listening for jobs.");
async function stop() {
  await boss.stop({ graceful: true, timeout: 30_000 });
  await bClient.close();
  await pool.end();
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
