import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import {
  importResponseSchema,
  jobSchema,
  repositorySchema,
} from "../../packages/contracts/src/index.ts";

// Explicitly opted-in fault injection into this launcher's own local worker.
// No database rows or analysis results are manufactured for the test.
assert.equal(
  process.env.DOMINO_LIVE_RECOVERY_ACCEPTANCE,
  "1",
  "Set DOMINO_LIVE_RECOVERY_ACCEPTANCE=1 to interrupt the managed local worker",
);
const db = new URL(process.env.DATABASE_URL!);
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(db.hostname),
  "Local database required",
);
const state = async () =>
  JSON.parse(await readFile(".domino/runtime.json", "utf8"));
const managed = await state();
assert.equal(managed.root, resolve("."));
assert.equal(managed.status, "ready");
assert(managed.roles.worker.ready && managed.roles.worker.pid > 0);
const workerPid = managed.roles.worker.pid;
const repoId = process.env.DOMINO_ACCEPT_REPO_ID;
assert(repoId, "Supply an already imported public repository ID");
const base = `http://127.0.0.1:${Number(process.env.PORT || 3000)}/api/v1/repositories/${repoId}`;
const headers = {
  "content-type": "application/json",
  ...(process.env.DOMINO_API_TOKEN
    ? { Authorization: `Bearer ${process.env.DOMINO_API_TOKEN}` }
    : {}),
};
async function call(path = "", post = false) {
  const response = await fetch(base + path, {
    method: post ? "POST" : "GET",
    headers,
    ...(post ? { body: "{}" } : {}),
    signal: AbortSignal.timeout(20000),
  });
  assert(response.ok, `HTTP ${response.status} for ${path}`);
  return response.json();
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const before = repositorySchema.parse(await call());
  assert(
    before.snapshot,
    "A published snapshot must exist before fault injection",
  );
  const request = importResponseSchema.parse(await call("/reindex", true));
  let job = jobSchema.parse(await call(`/jobs/${request.jobId}`));
  const deadline = Date.now() + 60000;
  while (job.status === "queued" && Date.now() < deadline) {
    await delay(100);
    job = jobSchema.parse(await call(`/jobs/${request.jobId}`));
  }
  assert.equal(
    job.status,
    "running",
    "The test requires an actively running real reindex",
  );
  const owned = await pool.query(
    "SELECT worker_instance FROM import_jobs WHERE id=$1 AND status='running'",
    [request.jobId],
  );
  assert(owned.rows[0]?.worker_instance);
  assert.equal(
    (await state()).roles.worker.pid,
    workerPid,
    "Worker changed before the interruption",
  );
  process.kill(workerPid, "SIGKILL");
  do {
    await delay(200);
    job = jobSchema.parse(await call(`/jobs/${request.jobId}`));
  } while (["queued", "running"].includes(job.status) && Date.now() < deadline);
  assert.equal(job.status, "failed");
  assert.match(job.error || "", /worker stopped|interrupted/i);
  const recovered = repositorySchema.parse(await call());
  assert.equal(
    recovered.snapshot?.id,
    before.snapshot.id,
    "Interrupted import replaced the last good index",
  );
  while (!(await state()).roles.worker.ready && Date.now() < deadline)
    await delay(200);
  const restarted = await state();
  assert(
    restarted.roles.worker.ready && restarted.roles.worker.pid !== workerPid,
  );
  const retry = importResponseSchema.parse(await call("/reindex", true));
  const retryDeadline = Date.now() + 600000;
  do {
    await delay(1000);
    job = jobSchema.parse(await call(`/jobs/${retry.jobId}`));
  } while (
    ["queued", "running"].includes(job.status) &&
    Date.now() < retryDeadline
  );
  assert(
    ["ready", "partial"].includes(job.status),
    `Retry ended as ${job.status}`,
  );
  const after = repositorySchema.parse(await call());
  assert.notEqual(after.snapshot?.id, before.snapshot.id);
  const result = {
    status: "PASS",
    repoId,
    interruptedJob: request.jobId,
    retryJob: retry.jobId,
    preservedSnapshot: before.snapshot.id,
    publishedSnapshot: after.snapshot?.id,
    headSha: after.snapshot?.headSha,
    retryStatus: job.status,
    restartedWorker: true,
    modelCalls: 0,
    observedAt: new Date().toISOString(),
  };
  await mkdir(".domino/review", { recursive: true });
  await writeFile(
    ".domino/review/local-recovery.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
