import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImpactAnalysisHandler } from "../handler.ts";
import type { ImpactAnalysisJob } from "../types.ts";
import {
  clock,
  FakeAnalyzer,
  FakeCoChange,
  ids,
  makeCoChange,
  makeEdge,
  MemoryImportStore,
  MemoryRunStore,
  SHA_A,
  SHA_B,
} from "./memory.ts";

function job(overrides: Partial<ImpactAnalysisJob> = {}): ImpactAnalysisJob {
  return {
    repoId: "repo-1",
    snapshotId: "snapshot-1",
    snapshotSha: SHA_A,
    repositoryId: "Yumekaz/Domino",
    changedFiles: ["src/auth.ts"],
    maxDepth: 2,
    checkoutDir: "C:/checkout",
    checkoutSha: SHA_A,
    ...overrides,
  };
}

describe("Impact analysis handler", () => {
  it("runs the trusted analyzer, stores normalized imports and persists a completed run", async () => {
    const imports = new MemoryImportStore();
    const runs = new MemoryRunStore();
    const analyzer = new FakeAnalyzer([
      makeEdge("src/session.ts", "src/auth.ts"),
      makeEdge("src/dashboard.tsx", "src/session.ts"),
    ]);
    const handler = createImpactAnalysisHandler({ imports, runs, analyzer, clock, ids });
    const run = await handler.handle(job());

    assert.equal(analyzer.calls, 1);
    assert.equal(imports.replaceCalls, 1);
    assert.equal(run.status, "completed");
    assert.equal(run.kind, "impact");
    assert.equal(run.stale, false);
    assert.equal(run.result?.affected.length, 2);
    assert.equal(run.idempotencyKey.length, 64);
    assert.equal(runs.saveCount, 1);
    const stored = await imports.getImports({
      repoId: "repo-1",
      snapshotId: "snapshot-1",
      snapshotSha: SHA_A,
    });
    assert.equal(stored.length, 2);
    assert.ok(stored.every((edge) => edge.extractor === "dependency-cruiser"));
    assert.ok(stored.every((edge) => edge.snapshotSha === SHA_A));
    assert.ok(!stored.some((edge) => edge.imported.includes("historical")));
  });

  it("returns the existing run for a duplicate input without recomputing", async () => {
    const imports = new MemoryImportStore();
    const runs = new MemoryRunStore();
    const analyzer = new FakeAnalyzer([makeEdge("src/session.ts", "src/auth.ts")]);
    const handler = createImpactAnalysisHandler({ imports, runs, analyzer, clock, ids });
    const first = await handler.handle(job());
    const second = await handler.handle(job());
    assert.equal(first.id, second.id);
    assert.equal(analyzer.calls, 1);
    assert.equal(runs.saveCount, 1);
  });

  it("refreshes structural observations idempotently for a new input", async () => {
    const imports = new MemoryImportStore();
    const runs = new MemoryRunStore();
    const analyzer = new FakeAnalyzer([
      makeEdge("src/session.ts", "src/auth.ts"),
      makeEdge("src/dashboard.tsx", "src/session.ts"),
    ]);
    const handler = createImpactAnalysisHandler({ imports, runs, analyzer, clock, ids });
    await handler.handle(job());
    const second = await handler.handle(
      job({ changedFiles: ["src/session.ts"], refresh: true }),
    );
    assert.equal(analyzer.calls, 2);
    assert.equal(imports.replaceCalls, 2);
    const stored = await imports.getImports({
      repoId: "repo-1",
      snapshotId: "snapshot-1",
      snapshotSha: SHA_A,
    });
    assert.equal(stored.length, 2);
    assert.deepEqual(second.result?.affected.map((item) => item.file), ["src/dashboard.tsx"]);
  });

  it("attaches historical co-change separately and survives its failure", async () => {
    const imports = new MemoryImportStore();
    imports.seed("repo-1", "snapshot-1", SHA_A, [makeEdge("src/session.ts", "src/auth.ts")]);
    const runs = new MemoryRunStore();
    const coChange = new FakeCoChange(makeCoChange());
    const handler = createImpactAnalysisHandler({
      imports,
      runs,
      coChange,
      clock,
      ids,
    });
    const run = await handler.handle(job());
    assert.deepEqual(run.result?.associations.map((item) => item.file), ["src/historical.ts"]);
    assert.equal(run.result?.affected.length, 1);
    assert.ok(
      run.result?.associations[0]?.caveats.some((caveat) => caveat.includes("not an import path")),
    );

    const failing = createImpactAnalysisHandler({
      imports,
      runs,
      coChange: new FakeCoChange(makeCoChange(), new Error("co-change unavailable")),
      clock,
      ids,
    });
    const failedSignal = await failing.handle(job({ changedFiles: ["src/other.ts"] }));
    assert.equal(failedSignal.result?.affected.length, 0);
    assert.ok(
      failedSignal.warnings.some((warning) =>
        warning.includes("Historical co-change is unavailable"),
      ),
    );
  });

  it("computes from a proposed diff without evaluating it", async () => {
    const imports = new MemoryImportStore();
    imports.seed("repo-1", "snapshot-1", SHA_A, [makeEdge("src/session.ts", "src/auth.ts")]);
    const handler = createImpactAnalysisHandler({
      imports,
      runs: new MemoryRunStore(),
      clock,
      ids,
    });
    const run = await handler.handle(
      job({
        changedFiles: undefined,
        proposedDiff: "diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new",
      }),
    );
    assert.deepEqual(run.result?.changedFiles, ["src/auth.ts"]);
    assert.deepEqual(run.result?.affected.map((item) => item.file), ["src/session.ts"]);
  });

  it("rejects missing snapshots, checkout mismatches and analyzer revision mismatches", async () => {
    const missing = createImpactAnalysisHandler({
      imports: new MemoryImportStore(),
      runs: new MemoryRunStore(),
      clock,
      ids,
    });
    await assert.rejects(missing.handle(job({ checkoutDir: undefined })), {
      code: "STRUCTURAL_SNAPSHOT_MISSING",
    });

    const mismatch = createImpactAnalysisHandler({
      imports: new MemoryImportStore(),
      runs: new MemoryRunStore(),
      analyzer: new FakeAnalyzer([]),
      clock,
      ids,
    });
    await assert.rejects(mismatch.handle(job({ checkoutSha: SHA_B })), {
      code: "SNAPSHOT_MISMATCH",
    });

    const analyzerMismatch = createImpactAnalysisHandler({
      imports: new MemoryImportStore(),
      runs: new MemoryRunStore(),
      analyzer: new FakeAnalyzer([], SHA_B),
      clock,
      ids,
    });
    await assert.rejects(analyzerMismatch.handle(job()), {
      code: "ANALYZER_METADATA_MISMATCH",
    });
  });
});
