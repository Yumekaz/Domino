import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { impactSchema } from "../../../contracts/src/index.ts";
import { createImpactService, type ImpactServiceSource, type StoredDependencyRow } from "../src/service.ts";
import type { CoChangeResult } from "../src/types.ts";

const SHA = "a".repeat(40);
const REPO = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT = "00000000-0000-4000-8000-000000000002";

function row(
  importer: string,
  imported: string,
  evidence: Record<string, unknown> = {},
): StoredDependencyRow {
  return {
    importingFile: importer,
    importedFile: imported,
    dependencyKind: "import",
    sourceLine: 3,
    evidence: {
      specifier: `./${imported.split("/").pop()?.replace(/\.tsx?$/, "")}`,
      extractor: "dependency-cruiser",
      analyzerVersion: "18.7.0",
      configHash: "b".repeat(64),
      dynamic: false,
      circular: false,
      ...evidence,
    },
  };
}

function coChange(): CoChangeResult {
  return {
    targetFile: "src/auth.ts",
    observations: [
      {
        file: "src/history.ts",
        sharedCommits: 2,
        targetCommits: 3,
        share: 2 / 3,
        commitShas: ["c".repeat(40)],
        window: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
      },
    ],
    coverage: {
      commitsAnalyzed: 8,
      commitsTouchingTarget: 3,
      commitsExcludedOverCap: 0,
      observationsTruncated: 0,
      maxFilesPerCommit: 50,
      minSupport: 2,
      window: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
      excludedPaths: 0,
      warnings: [],
    },
  };
}

function source(overrides: Partial<ImpactServiceSource> = {}): ImpactServiceSource & {
  calls: string[];
} {
  const calls: string[] = [];
  const reverse: Record<string, StoredDependencyRow[]> = {
    "src/auth.ts": [row("src/session.ts", "src/auth.ts")],
    "src/session.ts": [row("src/dashboard.tsx", "src/session.ts")],
  };
  return {
    calls,
    async getPublishedSnapshot() {
      return { id: SNAPSHOT, headSha: SHA };
    },
    async findReverseDependencies(input) {
      calls.push(input.importedFile);
      return { rows: reverse[input.importedFile] ?? [], truncated: false };
    },
    ...overrides,
  };
}

describe("On-demand impact service over A's DB port", () => {
  it("returns exact structural paths through A's impact contract", async () => {
    const service = createImpactService(source());
    const result = await service.analyze(REPO, {
      snapshotId: SNAPSHOT,
      changedFiles: ["src/auth.ts"],
      maxDepth: 2,
    });
    impactSchema.parse(result);
    const session = result.affected.find((item) => item.file === "src/session.ts");
    const dashboard = result.affected.find((item) => item.file === "src/dashboard.tsx");
    assert.equal(session?.depth, 1);
    assert.equal(dashboard?.depth, 2);
    assert.deepEqual(dashboard?.path, [
      "src/dashboard.tsx",
      "src/session.ts",
      "src/auth.ts",
    ]);
    assert.equal(result.snapshotSha, SHA);
  });

  it("queries only the depth needed and surfaces source truncation", async () => {
    const base = source();
    const shallow = createImpactService(base);
    await shallow.analyze(REPO, {
      snapshotId: SNAPSHOT,
      changedFiles: ["src/auth.ts"],
      maxDepth: 1,
    });
    assert.deepEqual(base.calls, ["src/auth.ts"]);

    const truncatedSource = source({
      async findReverseDependencies() {
        return { rows: [row("src/session.ts", "src/auth.ts")], truncated: true };
      },
    });
    const truncated = await createImpactService(truncatedSource).analyze(REPO, {
      snapshotId: SNAPSHOT,
      changedFiles: ["src/auth.ts"],
      maxDepth: 1,
    });
    assert.equal(truncated.truncated, true);
    assert.ok(truncated.warnings.some((warning) => warning.includes("truncated")));
  });

  it("keeps historical co-change separate and validates A's cochange fields", async () => {
    const service = createImpactService(
      source({
        async getCoChange() {
          return coChange();
        },
      }),
    );
    const result = await service.analyze(REPO, {
      snapshotId: SNAPSHOT,
      changedFiles: ["src/auth.ts"],
      maxDepth: 1,
    });
    const association = result.affected.find(
      (item) => item.signal === "historically_coupled",
    );
    assert.equal(association?.file, "src/history.ts");
    assert.equal(association?.cochange?.sampleSize, 3);
    assert.equal(association?.cochange?.windowFrom, "2026-01-01T00:00:00Z");
    assert.equal(
      result.affected.filter((item) => item.signal === "static_reverse_dependency").length,
      1,
    );
  });

  it("parses a proposed diff as data and bounds traversal", async () => {
    const service = createImpactService(source());
    const result = await service.analyze(REPO, {
      snapshotId: SNAPSHOT,
      proposedDiff:
        "diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new",
      maxDepth: 1,
    });
    assert.deepEqual(result.changedFiles, ["src/auth.ts"]);
    assert.ok(result.affected.some((item) => item.file === "src/session.ts"));
  });

  it("marks incomplete stored evidence and survives a reverse-lookup failure", async () => {
    const incomplete = source({
      async findReverseDependencies() {
        return {
          rows: [row("src/session.ts", "src/auth.ts", { analyzerVersion: undefined, configHash: undefined })],
          truncated: false,
        };
      },
    });
    const result = await createImpactService(incomplete).analyze(REPO, {
      snapshotId: SNAPSHOT,
      changedFiles: ["src/auth.ts"],
      maxDepth: 1,
    });
    assert.ok(result.warnings.some((warning) => warning.includes("incomplete")));

    const failing = source({
      async findReverseDependencies() {
        throw new Error("database unavailable");
      },
    });
    const survived = await createImpactService(failing).analyze(REPO, {
      snapshotId: SNAPSHOT,
      changedFiles: ["src/auth.ts"],
      maxDepth: 1,
    });
    assert.ok(survived.warnings.some((warning) => warning.includes("Reverse dependency lookup failed")));
  });
});
