import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import type { GithubRepository } from "../../../apps/api/src/github.ts";
import { historyJobSchema } from "../../contracts/src/index.ts";
import type { z } from "zod";

export const HISTORY_QUEUE = "history.import";
export type HistoryJobPayload = z.infer<typeof historyJobSchema>;

/** Reconcile a terminal queue state if a worker died before updating the app job. */
export async function reconcileImport(
  pool: pg.Pool,
  boss: PgBoss,
  repoId: string,
  jobId: string,
) {
  const result = await pool.query(
    "SELECT * FROM import_jobs WHERE repo_id=$1 AND id=$2",
    [repoId, jobId],
  );
  const job = result.rows[0];
  if (!job || !["queued", "running"].includes(job.status)) return job;
  const queued = await boss.getJobById(HISTORY_QUEUE, jobId);
  if (!queued || !["completed", "failed", "cancelled"].includes(queued.state))
    return job;
  let status: "ready" | "partial" | "failed" | "cancelled";
  if (queued.state === "cancelled") status = "cancelled";
  else if (queued.state === "failed") status = "failed";
  else {
    const snapshot = await pool.query<{ status: "ready" | "partial" }>(
      "SELECT status FROM index_snapshots WHERE id=$1 AND repo_id=$2 AND status IN ('ready','partial')",
      [job.snapshot_id, repoId],
    );
    status = snapshot.rows[0]?.status ?? "failed";
  }
  const message =
    status === "failed"
      ? "The queue stopped before a snapshot was published. Retry the import."
      : null;
  const updated = await pool.query(
    `UPDATE import_jobs SET status=$3,phase=$3,error=$4,updated_at=now()
    WHERE id=$1 AND repo_id=$2 AND status IN ('queued','running') RETURNING *`,
    [jobId, repoId, status, message],
  );
  return (
    updated.rows[0] ??
    (
      await pool.query("SELECT * FROM import_jobs WHERE repo_id=$1 AND id=$2", [
        repoId,
        jobId,
      ])
    ).rows[0]
  );
}

/** Inserts the app job and pg-boss message in the same PostgreSQL transaction. */
export async function enqueueImport(
  pool: pg.Pool,
  boss: PgBoss,
  github: GithubRepository,
): Promise<{ repoId: string; jobId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const repo = await client.query<{ id: string }>(
      `INSERT INTO repositories(id,github_id,owner,name,default_branch,visibility,html_url,created_at)
       VALUES ($1,$2,$3,$4,$5,'public',$6,now())
       ON CONFLICT (github_id) DO UPDATE SET owner=EXCLUDED.owner,name=EXCLUDED.name,default_branch=EXCLUDED.default_branch,html_url=EXCLUDED.html_url
       RETURNING id`,
      [
        randomUUID(),
        github.githubId,
        github.owner,
        github.name,
        github.branch,
        github.url,
      ],
    );
    const repoId = repo.rows[0].id,
      jobId = randomUUID(),
      snapshotId = randomUUID();
    const job = await client.query<{ id: string }>(
      `INSERT INTO import_jobs(id,repo_id,snapshot_id,url,head_sha,branch,status,phase)
       VALUES ($1,$2,$3,$4,$5,$6,'queued','queued')
       ON CONFLICT (repo_id) WHERE status IN ('queued','running') DO NOTHING RETURNING id`,
      [jobId, repoId, snapshotId, github.url, github.headSha, github.branch],
    );
    if (!job.rows.length) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM import_jobs WHERE repo_id=$1 AND status IN ('queued','running')",
        [repoId],
      );
      if (!existing.rows[0])
        throw new Error("Active import changed before it could be returned");
      await client.query("COMMIT");
      return { repoId, jobId: existing.rows[0].id };
    }
    const payload: HistoryJobPayload = historyJobSchema.parse({
      jobId,
      repoId,
      snapshotId,
      repoUrl: github.url,
      headSha: github.headSha,
      branch: github.branch,
      githubId: github.githubId,
    });
    const id = await boss.send(HISTORY_QUEUE, payload, {
      id: jobId,
      retryLimit: 1,
      expireInSeconds: 600,
      db: {
        executeSql: async (sql, values) => ({
          rows: (await client.query(sql, values)).rows,
        }),
      },
    });
    if (!id) throw new Error("Queue did not accept the import job");
    await client.query("COMMIT");
    return { repoId, jobId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
