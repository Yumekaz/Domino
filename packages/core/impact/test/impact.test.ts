import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProposedDiff } from "../src/diff.ts";
import { computeStructuralImpact } from "../src/impact.ts";
import type { CoChangeResult, StructuralImport } from "../src/types.ts";

const SHA = "a".repeat(40);

function edge(
  importer: string,
  imported: string,
  options: { dynamic?: boolean; circular?: boolean; sha?: string; line?: number } = {},
): StructuralImport {
  const specifier = `./${imported.split("/").pop()?.replace(/\.tsx?$/, "")}`;
  return {
    importer,
    imported,
    specifier,
    dependencyTypes: ["import", "local"],
    dynamic: options.dynamic ?? false,
    circular: options.circular ?? false,
    extractor: "dependency-cruiser",
    analyzerVersion: "18.7.0",
    configHash: "b".repeat(64),
    snapshotSha: options.sha ?? SHA,
    evidence: { type: "import", specifier, line: options.line ?? null },
  };
}

function coChange(): CoChangeResult {
  return {
    targetFile: "src/c.ts",
    observations: [
      {
        file: "src/history.ts",
        sharedCommits: 2,
        targetCommits: 3,
        share: 2 / 3,
        commitShas: ["b".repeat(40), "a".repeat(40)],
        window: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
      },
    ],
    coverage: {
      commitsAnalyzed: 10,
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

describe("Bounded reverse impact", () => {
  it("returns a direct and transitive dependent → changed-file path with evidence", () => {
    const edges = [
      edge("src/session.ts", "src/auth.ts", { line: 4 }),
      edge("src/dashboard.tsx", "src/session.ts", { line: 2 }),
    ];
    const result = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/auth.ts"], maxDepth: 3 },
      edges,
    );
    assert.deepEqual(result.changedFiles, ["src/auth.ts"]);
    assert.deepEqual(
      result.affected.map((item) => [item.file, item.depth, item.path]),
      [
        ["src/session.ts", 1, ["src/session.ts", "src/auth.ts"]],
        ["src/dashboard.tsx", 2, ["src/dashboard.tsx", "src/session.ts", "src/auth.ts"]],
      ],
    );
    assert.equal(result.affected[0]?.evidence[0]?.line, 4);
    assert.equal(result.affected[1]?.evidence.length, 2);
    assert.equal(result.affected[1]?.evidence[0]?.importer, "src/dashboard.tsx");
    assert.match(result.affected[0]?.explanation ?? "", /Static reverse dependency path/);
    assert.equal(result.affected[0]?.impact, "possible");
    assert.equal(result.associations.length, 0);
  });

  it("respects the depth cap and multiple roots without duplicate records", () => {
    const edges = [
      edge("src/session.ts", "src/auth.ts"),
      edge("src/dashboard.tsx", "src/session.ts"),
      edge("src/other.ts", "src/auth.ts"),
    ];
    const capped = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/auth.ts"], maxDepth: 1 },
      edges,
    );
    assert.deepEqual(
      capped.affected.map((item) => item.file),
      ["src/other.ts", "src/session.ts"],
    );

    const multiple = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/auth.ts", "src/session.ts"], maxDepth: 3 },
      edges,
    );
    const dashboard = multiple.affected.find((item) => item.file === "src/dashboard.tsx");
    assert.equal(dashboard?.depth, 1);
    assert.deepEqual(dashboard?.path, ["src/dashboard.tsx", "src/session.ts"]);
    assert.equal(
      multiple.affected.filter((item) => item.file === "src/dashboard.tsx").length,
      1,
    );
  });

  it("stops cycles and keeps traversing other branches", () => {
    const edges = [
      edge("src/x.ts", "src/y.ts", { circular: true }),
      edge("src/y.ts", "src/x.ts", { circular: true }),
      edge("src/y.ts", "src/z.ts"),
      edge("src/w.ts", "src/x.ts"),
    ];
    const result = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/z.ts"], maxDepth: 3 },
      edges,
    );
    assert.deepEqual(
      result.affected.map((item) => [item.file, item.depth]),
      [
        ["src/y.ts", 1],
        ["src/x.ts", 2],
        ["src/w.ts", 3],
      ],
    );
    assert.ok(result.coverage.cyclesSkipped >= 1);
    assert.ok(result.affected.every((item) => new Set(item.path).size === item.path.length));
  });

  it("marks dynamic paths as uncertain and keeps them distinct", () => {
    const edges = [
      edge("src/session.ts", "src/auth.ts"),
      edge("src/main.tsx", "src/session.ts", { dynamic: true }),
    ];
    const result = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/auth.ts"], maxDepth: 2 },
      edges,
    );
    const main = result.affected.find((item) => item.file === "src/main.tsx");
    assert.equal(main?.viaDynamicImport, true);
    assert.match(main?.explanation ?? "", /dynamic import/);
    assert.ok(result.warnings.some((warning) => warning.includes("dynamic import")));
    assert.equal(result.coverage.dynamicPaths, 1);
  });

  it("returns an explicit no-dependents result", () => {
    const result = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/isolated.ts"] },
      [edge("src/other.ts", "src/auth.ts")],
    );
    assert.equal(result.affected.length, 0);
    assert.ok(result.warnings.some((warning) => warning.includes("No static reverse dependents")));
  });

  it("rejects mixed inputs, unsafe paths and snapshot mismatches", () => {
    assert.throws(
      () =>
        computeStructuralImpact(
          { snapshotSha: SHA, changedFiles: ["src/a.ts"], proposedDiff: "diff --git a/a b/a" },
          [],
        ),
      { code: "MIXED_INPUT" },
    );
    assert.throws(
      () => computeStructuralImpact({ snapshotSha: SHA, changedFiles: ["/etc/passwd"] }, []),
      { code: "UNSAFE_PATH" },
    );
    assert.throws(
      () =>
        computeStructuralImpact({ snapshotSha: SHA, changedFiles: ["src/a.ts"] }, [
          edge("src/b.ts", "src/a.ts", { sha: "c".repeat(40) }),
        ]),
      { code: "SNAPSHOT_MISMATCH" },
    );
  });

  it("excludes ignored changed paths and resolves renames", () => {
    const ignored = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["vendor/lib/auth.ts"] },
      [edge("src/session.ts", "vendor/lib/auth.ts")],
    );
    assert.deepEqual(ignored.changedFiles, []);
    assert.equal(ignored.affected.length, 0);
    assert.ok(ignored.warnings.some((warning) => warning.includes("ignored")));

    const renamed = computeStructuralImpact(
      {
        snapshotSha: SHA,
        changedFiles: ["src/old-auth.ts"],
        renameMap: { "src/old-auth.ts": "src/auth.ts" },
      },
      [edge("src/session.ts", "src/auth.ts")],
    );
    assert.deepEqual(renamed.changedFiles, ["src/auth.ts"]);
    assert.deepEqual(renamed.affected.map((item) => item.file), ["src/session.ts"]);
    assert.equal(renamed.coverage.renamedChangedFiles, 1);
  });

  it("bounds affected results explicitly", () => {
    const edges = Array.from({ length: 5 }, (_, index) =>
      edge(`src/dependent${index}.ts`, "src/auth.ts"),
    );
    const result = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/auth.ts"], maxAffected: 2 },
      edges,
    );
    assert.equal(result.affected.length, 2);
    assert.equal(result.coverage.truncated, true);
    assert.throws(
      () =>
        computeStructuralImpact(
          { snapshotSha: SHA, changedFiles: ["src/auth.ts"], maxEdges: 3 },
          edges,
        ),
      { code: "EDGE_LIMIT_EXCEEDED" },
    );
  });

  it("keeps deleted files and unresolved analyzer imports explicit", () => {
    const deleted = computeStructuralImpact(
      {
        snapshotSha: SHA,
        proposedDiff:
          "diff --git a/src/removed.ts b/src/removed.ts\n--- a/src/removed.ts\n+++ /dev/null",
      },
      [edge("src/session.ts", "src/removed.ts")],
    );
    assert.deepEqual(deleted.changedFiles, ["src/removed.ts"]);
    assert.deepEqual(deleted.affected.map((item) => item.file), ["src/session.ts"]);
    assert.ok(deleted.warnings.some((warning) => warning.includes("Deleted changed file")));

    const unresolved = computeStructuralImpact(
      {
        snapshotSha: SHA,
        changedFiles: ["src/auth.ts"],
        analyzerGaps: [
          {
            importer: "src/auth.ts",
            specifier: "some-external-package",
            reason: "unresolved",
            dynamic: false,
          },
          {
            importer: "src/auth.ts",
            specifier: "./missing",
            reason: "unresolved",
            dynamic: true,
          },
        ],
      },
      [],
    );
    assert.equal(unresolved.coverage.unresolvedImports, 2);
    assert.ok(
      unresolved.warnings.some((warning) => warning.includes("unresolved, external or non-code")),
    );
  });
});

describe("Proposed diff as untrusted data", () => {
  it("extracts modified, added, deleted, renamed and binary files", () => {
    const diff = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/new.ts b/src/new.ts",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1 @@",
      "+export {};",
      "diff --git a/src/deleted.ts b/src/deleted.ts",
      "--- a/src/deleted.ts",
      "+++ /dev/null",
      "diff --git a/src/old.ts b/src/renamed.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/renamed.ts",
      "diff --git a/assets/logo.png b/assets/logo.png",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
    ].join("\n");
    const parsed = parseProposedDiff(diff);
    assert.deepEqual(parsed.changedFiles, [
      "assets/logo.png",
      "src/auth.ts",
      "src/deleted.ts",
      "src/new.ts",
      "src/renamed.ts",
    ]);
    assert.deepEqual(parsed.renames, { "src/old.ts": "src/renamed.ts" });
    assert.deepEqual(parsed.deletedFiles, ["src/deleted.ts"]);
    assert.deepEqual(parsed.binaryFiles, ["assets/logo.png"]);
  });

  it("rejects empty, oversized and unsafe diffs", () => {
    assert.throws(() => parseProposedDiff(""), { code: "NO_CHANGED_FILES" });
    assert.throws(
      () =>
        parseProposedDiff(
          "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+changed",
          { maxBytes: 10 },
        ),
      { code: "DIFF_TOO_LARGE" },
    );
    assert.throws(
      () =>
        parseProposedDiff(
          "diff --git a/../../etc/passwd b/../../etc/passwd\n--- a/../../etc/passwd\n+++ b/../../etc/passwd",
        ),
      { code: "UNSAFE_PATH" },
    );
  });
});

describe("Historical co-change separation", () => {
  it("returns associations with sample/window metadata but no structural path", () => {
    const result = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/c.ts"], coChange: [coChange()] },
      [edge("src/dependent.ts", "src/other.ts")],
    );
    assert.equal(result.affected.length, 0);
    assert.equal(result.associations.length, 1);
    const association = result.associations[0]!;
    assert.equal(association.file, "src/history.ts");
    assert.equal(association.signal, "historically_coupled");
    assert.equal(association.sharedCommits, 2);
    assert.equal(association.targetCommits, 3);
    assert.deepEqual(association.commitShas, ["a".repeat(40), "b".repeat(40)]);
    assert.ok(association.caveats.some((caveat) => caveat.includes("not an import path")));
    assert.equal(result.coverage.dynamicPaths, 0);
  });

  it("ignores co-change for a different target and inconsistent observations", () => {
    const wrongTarget = { ...coChange(), targetFile: "src/other.ts" };
    const badObservation = {
      ...coChange(),
      observations: [{ ...coChange().observations[0]!, sharedCommits: 5 }],
    };
    const result = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/c.ts"], coChange: [wrongTarget, badObservation] },
      [],
    );
    assert.equal(result.associations.length, 0);
    assert.ok(result.warnings.some((warning) => warning.includes("outside the changed set")));
    assert.ok(result.warnings.some((warning) => warning.includes("inconsistent")));
  });
});
