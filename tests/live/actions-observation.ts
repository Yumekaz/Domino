import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { listDominoWorkflowRuns } from "../../apps/api/src/github.ts";
import {
  analysisSchema,
  repositorySchema,
} from "../../packages/contracts/src/index.ts";

if (process.env.DOMINO_LIVE_ACTIONS_ACCEPTANCE !== "1")
  throw new Error(
    "Set DOMINO_LIVE_ACTIONS_ACCEPTANCE=1 for read-only public Actions verification",
  );
const repoUrl =
  process.env.DOMINO_ACTIONS_ACCEPT_REPO ??
  "https://github.com/rcm-on/tsql-lineage-toolkit";
const repoId = process.env.DOMINO_ACTIONS_ACCEPT_REPO_ID;
const runId = process.env.DOMINO_ACTIONS_ACCEPT_RUN_ID;
const actionId = Number(
  process.env.DOMINO_ACTIONS_ACCEPT_ACTION_ID ?? "28790477749",
);
assert(repoId && runId, "Supply real local repository and observed-run IDs");
const token =
  process.env.DOMINO_GITHUB_TOKEN ||
  execFileSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const observed = await listDominoWorkflowRuns(repoUrl, token);
const action = observed.runs.find((run) => run.id === actionId);
assert(
  action,
  "The public workflow run is not among the bounded observed runs",
);
const base = `http://127.0.0.1:3000/api/v1/repositories/${repoId}`;
const headers = process.env.DOMINO_API_TOKEN
  ? { Authorization: `Bearer ${process.env.DOMINO_API_TOKEN}` }
  : undefined;
const report = analysisSchema.parse(
  await (await fetch(`${base}/analysis/${runId}`, { headers })).json(),
);
const repo = repositorySchema.parse(
  await (await fetch(base, { headers })).json(),
);
assert.equal(report.event, "actions_observed");
assert.equal(report.headSha, action.head_sha);
assert.equal(report.result?.snapshotSha, action.head_sha);
assert.equal(report.actionsUrl, action.html_url);
assert(action.pull_requests.some((pr) => pr.number === report.prNumber));
assert(repo.recentAnalyses?.some((run) => run.id === report.id));
const result = {
  status: "PASS",
  repoUrl,
  repoId,
  localRunId: runId,
  workflow: action.html_url,
  headSha: action.head_sha,
  prNumber: report.prNumber,
  localStatus: report.status,
  activeWorkspaceSnapshot: repo.snapshot?.id,
  recentRunDiscoverable: true,
  scope: "Local JS/TS structural recomputation; other languages not analyzed",
  affected: report.result?.affected.length,
  modelCalls: 0,
  observedAt: new Date().toISOString(),
};
mkdirSync(".domino/review", { recursive: true });
writeFileSync(
  ".domino/review/actions-observed-live.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
