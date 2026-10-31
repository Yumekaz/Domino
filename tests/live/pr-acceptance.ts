import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import {
  analysisSchema,
  repositorySchema,
  prCheckResponseSchema,
  importResponseSchema,
  jobSchema,
} from "../../packages/contracts/src/index.ts";

if (process.env.DOMINO_LIVE_PR_ACCEPTANCE !== "1")
  throw new Error(
    "Set DOMINO_LIVE_PR_ACCEPTANCE=1 for live public PR verification",
  );
const url = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname))
  throw new Error("This acceptance run is local-only");
const base = process.env.DOMINO_ACCEPT_API ?? "http://127.0.0.1:3000/api/v1";
const repoUrl =
  process.env.DOMINO_ACCEPT_REPO ??
  "https://github.com/sindresorhus/yocto-queue";
const prNumber = Number(process.env.DOMINO_ACCEPT_PR ?? "12");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const headers = {
  "content-type": "application/json",
  ...(process.env.DOMINO_API_TOKEN
    ? { Authorization: `Bearer ${process.env.DOMINO_API_TOKEN}` }
    : {}),
};
async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  assert(r.ok, `${method} ${path}: HTTP ${r.status}`);
  return data;
}
try {
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM repositories WHERE html_url=$1",
    [repoUrl],
  );
  let repoId = existing.rows[0]?.id;
  if (!repoId) {
    const created = importResponseSchema.parse(
      await call("POST", "/repositories", { url: repoUrl }),
    );
    repoId = created.repoId;
    const deadline = Date.now() + 600000;
    for (;;) {
      assert(Date.now() < deadline, "Public import exceeded its budget");
      const job = jobSchema.parse(
        await call("GET", `/repositories/${repoId}/jobs/${created.jobId}`),
      );
      assert(
        !["failed", "cancelled"].includes(job.status),
        "Public import failed",
      );
      if (["ready", "partial"].includes(job.status)) break;
      await delay(1500);
    }
  }
  const before = repositorySchema.parse(
    await call("GET", `/repositories/${repoId}`),
  );
  assert(before.snapshot);
  const { runId } = prCheckResponseSchema.parse(
    await call("POST", `/repositories/${repoId}/pr-check`, { prNumber }),
  );
  console.log(
    JSON.stringify({
      repository: repoUrl,
      prNumber,
      runId,
      status: "requested",
    }),
  );
  const deadline = Date.now() + 420000;
  let report;
  let status;
  for (;;) {
    assert(Date.now() < deadline, "PR analysis exceeded its acceptance budget");
    report = analysisSchema.parse(
      await call("GET", `/repositories/${repoId}/analysis/${runId}`),
    );
    if (status !== report.status) {
      status = report.status;
      console.log(JSON.stringify({ runId, status }));
    }
    if (!["queued", "running"].includes(report.status)) break;
    await delay(1000);
  }
  assert(
    ["completed", "partial"].includes(report.status),
    `PR analysis failed: ${report.warnings.join(" ")}`,
  );
  assert.equal(report.stale, false);
  assert(report.result);
  assert.equal(report.result.snapshotSha, report.headSha);
  const after = repositorySchema.parse(
    await call("GET", `/repositories/${repoId}`),
  );
  assert.equal(
    after.snapshot?.id,
    before.snapshot.id,
    "PR analysis changed the workspace's active snapshot",
  );
  const repeated = prCheckResponseSchema.parse(
    await call("POST", `/repositories/${repoId}/pr-check`, { prNumber }),
  );
  assert.equal(repeated.runId, runId, "Unchanged PR input was not idempotent");
  for (const item of report.result.affected)
    for (const proof of item.evidence)
      assert(
        proof.url?.includes(`/blob/${report.headSha}/`),
        "Evidence does not identify its exact PR head",
      );
  const result = {
    status: "PASS",
    repository: repoUrl,
    repoId,
    prNumber,
    runId,
    baseSha: report.baseSha,
    headSha: report.headSha,
    activeSnapshotPreserved: before.snapshot.id,
    activeSnapshotSha: before.snapshot.headSha,
    resultStatus: report.status,
    changedFiles: report.result.changedFiles,
    affected: report.result.affected.length,
    warnings: report.warnings,
    modelCalls: 0,
    observedAt: new Date().toISOString(),
  };
  mkdirSync(".domino/review", { recursive: true });
  writeFileSync(
    `.domino/review/pr-${prNumber}-${runId}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
