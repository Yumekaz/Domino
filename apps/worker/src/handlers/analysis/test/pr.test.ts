import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzePullRequest, getAnalysisRun, sanitizeActionsUrl } from "../pr.ts";
import type { PullRequestAnalysisJob } from "../types.ts";
import {
  clock,
  ids,
  makeEdge,
  MemoryImportStore,
  MemoryRunStore,
  SHA_A,
  SHA_B,
  SHA_C,
} from "./memory.ts";

function prJob(overrides: Partial<PullRequestAnalysisJob> = {}): PullRequestAnalysisJob {
  return {
    repoId: "repo-1",
    snapshotId: "snapshot-a",
    snapshotSha: SHA_A,
    repositoryId: "Yumekaz/Domino",
    changedFiles: ["src/auth.ts"],
    maxDepth: 2,
    prNumber: 12,
    baseSha: SHA_C,
    headSha: SHA_A,
    event: "opened",
    ...overrides,
  };
}

function deps() {
  const imports = new MemoryImportStore();
  imports.seed("repo-1", "snapshot-a", SHA_A, [
    makeEdge("src/session.ts", "src/auth.ts", SHA_A),
  ]);
  imports.seed("repo-1", "snapshot-b", SHA_B, [
    makeEdge("src/new-session.ts", "src/auth.ts", SHA_B),
  ]);
  const runs = new MemoryRunStore();
  return { imports, runs, clock, ids };
}

describe("Pull request analysis service", () => {
  it("computes exact base/head results and keeps a genuine Actions URL", async () => {
    const d = deps();
    const actionsUrl = "https://github.com/Yumekaz/Domino/actions/runs/123456/attempts/1";
    const run = await analyzePullRequest(prJob({ actionsUrl }), d);
    assert.equal(run.status, "completed");
    assert.equal(run.stale, false);
    assert.equal(run.prNumber, 12);
    assert.equal(run.baseSha, SHA_C);
    assert.equal(run.headSha, SHA_A);
    assert.equal(run.actionsUrl, actionsUrl);
    assert.deepEqual(run.result?.affected.map((item) => item.file), ["src/session.ts"]);
  });

  it("is idempotent for a duplicate event and does not read storage again", async () => {
    const d = deps();
    const first = await analyzePullRequest(prJob(), d);
    const reads = d.imports.getCalls;
    const second = await analyzePullRequest(prJob(), d);
    assert.equal(second.id, first.id);
    assert.equal(d.imports.getCalls, reads);
    assert.equal(d.runs.saveCount, 1);
  });

  it("recomputes a new run for a different head and matching snapshot", async () => {
    const d = deps();
    const first = await analyzePullRequest(prJob(), d);
    const second = await analyzePullRequest(
      prJob({
        snapshotId: "snapshot-b",
        snapshotSha: SHA_B,
        headSha: SHA_B,
        event: "synchronize",
      }),
      d,
    );
    assert.notEqual(second.id, first.id);
    assert.deepEqual(second.result?.affected.map((item) => item.file), ["src/new-session.ts"]);
    assert.equal(d.runs.saveCount, 2);
  });

  it("flags a snapshot/head mismatch as stale without substituting a result", async () => {
    const d = deps();
    const run = await analyzePullRequest(
      prJob({ snapshotSha: SHA_A, headSha: SHA_B, snapshotId: "snapshot-a" }),
      d,
    );
    assert.equal(run.status, "stale");
    assert.equal(run.stale, true);
    assert.equal(run.result, null);
    assert.ok(run.warnings.some((warning) => warning.includes("does not match the PR head")));
    assert.equal(d.imports.getCalls, 0);
  });

  it("withholds invalid Actions URLs and preserves valid run links", () => {
    assert.equal(
      sanitizeActionsUrl("https://github.com/Yumekaz/Domino/actions/runs/42"),
      "https://github.com/Yumekaz/Domino/actions/runs/42",
    );
    assert.equal(sanitizeActionsUrl("https://evil.test/Yumekaz/Domino/actions/runs/42"), undefined);
    assert.equal(
      sanitizeActionsUrl("https://github.com/Yumekaz/Domino/pull/12"),
      undefined,
    );
    assert.equal(
      sanitizeActionsUrl("http://github.com/Yumekaz/Domino/actions/runs/42"),
      undefined,
    );
  });

  it("rejects malformed event input and checkout mismatches", async () => {
    const d = deps();
    await assert.rejects(analyzePullRequest(prJob({ event: "edited" as never }), d), {
      code: "INVALID_JOB",
    });
    await assert.rejects(analyzePullRequest(prJob({ baseSha: SHA_A }), d), {
      code: "INVALID_JOB",
    });
    await assert.rejects(analyzePullRequest(prJob({ prNumber: 0 }), d), {
      code: "INVALID_JOB",
    });
    await assert.rejects(analyzePullRequest(prJob({ checkoutSha: SHA_B }), d), {
      code: "SNAPSHOT_MISMATCH",
    });
  });

  it("scopes run retrieval to the repository", async () => {
    const d = deps();
    const run = await analyzePullRequest(prJob(), d);
    const loaded = await getAnalysisRun(d.runs, "repo-1", run.id);
    assert.equal(loaded.id, run.id);
    await assert.rejects(getAnalysisRun(d.runs, "repo-2", run.id), {
      code: "RUN_NOT_FOUND",
    });
    await assert.rejects(getAnalysisRun(d.runs, "repo-1", "missing"), {
      code: "RUN_NOT_FOUND",
    });
  });
});
