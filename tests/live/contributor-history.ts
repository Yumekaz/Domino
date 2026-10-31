/** Replay genuine public commits through the running merged worker; no model calls. */
import { setTimeout as delay } from "node:timers/promises";
import { PgBoss } from "pg-boss";
import { createPool } from "../../packages/database/src/index.ts";
import {
  enqueueImport,
  HISTORY_QUEUE,
} from "../../packages/database/src/jobs.ts";
import { resolvePublicRepository } from "../../apps/api/src/github.ts";
import { jobSchema, riskSchema } from "../../packages/contracts/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;
if (
  process.env.DOMINO_ALLOW_CONTRIBUTOR_REPLAY !== "1" ||
  !databaseUrl ||
  new URL(databaseUrl).pathname !== "/domino_live_validation"
)
  throw new Error(
    "This replay requires the isolated domino_live_validation database and DOMINO_ALLOW_CONTRIBUTOR_REPLAY=1.",
  );
const base = "http://127.0.0.1:3000/api/v1";
const pool = createPool(databaseUrl),
  boss = new PgBoss(databaseUrl);
boss.on("error", () => {});
await boss.start();
await boss.createQueue(HISTORY_QUEUE);
const repository = await resolvePublicRepository(
  "https://github.com/sindresorhus/yocto-queue",
  process.env.DOMINO_GITHUB_TOKEN,
).catch(async (error) => {
  await boss.stop();
  await pool.end();
  throw error;
});
async function replay(headSha: string) {
  const queued = await enqueueImport(pool, boss, { ...repository, headSha });
  const deadline = Date.now() + 9 * 60_000;
  for (;;) {
    const response = await fetch(
      `${base}/repositories/${queued.repoId}/jobs/${queued.jobId}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok)
      throw new Error(`Job status failed: HTTP ${response.status}`);
    const job = jobSchema.parse(await response.json());
    if (job.status === "failed" || job.status === "cancelled")
      throw new Error(job.error ?? `Import ${job.status}`);
    if (job.status === "ready" || job.status === "partial") break;
    if (Date.now() > deadline)
      throw new Error("Public history replay exceeded its time budget.");
    await delay(2000);
  }
  const stored = await pool.query<{ snapshot_id: string; head_sha: string }>(
    "SELECT snapshot_id,head_sha FROM import_jobs WHERE id=$1",
    [queued.jobId],
  );
  const snapshotId = stored.rows[0].snapshot_id;
  if (stored.rows[0].head_sha !== headSha)
    throw new Error("An unexpected active import was returned.");
  const response = await fetch(
    `${base}/repositories/${queued.repoId}/knowledge-risk?snapshotId=${snapshotId}&limit=100`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new Error(`Risk request failed: HTTP ${response.status}`);
  const risk = riskSchema.parse(await response.json());
  const file = risk.files.find((file) => file.path === "index.d.ts");
  if (!file) throw new Error("Expected public history file was not indexed.");
  const result = {
    repoId: queued.repoId,
    snapshotId,
    headSha,
    observedAuthors: file.observedAuthors,
    contributors: file.contributors.map((item) => item.name),
    sources: file.sources.map((source) => source.url),
  };
  console.log(JSON.stringify(result));
  return result;
}
try {
  const before = await replay("0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b");
  const after = await replay("d631ea87f49443c4c8dbf84fd79bf600d11a5fac");
  if (before.observedAuthors !== 1 || after.observedAuthors !== 2)
    throw new Error(
      "The genuine contributor-change acceptance did not match the public Git history.",
    );
  console.log(
    "PASS: genuine public commits change index.d.ts from one to two observed contributors. This is a historical replay, not a newly authored demo commit.",
  );
} finally {
  try {
    await replay(repository.headSha);
    console.log("Restored the current default-branch snapshot.");
  } finally {
    await boss.stop();
    await pool.end();
  }
}
