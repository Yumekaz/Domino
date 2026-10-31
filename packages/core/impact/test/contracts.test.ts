import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { impactSchema } from "../../../contracts/src/index.ts";
import { toContractImpact } from "../src/contracts.ts";
import { computeStructuralImpact } from "../src/impact.ts";
import type { CoChangeResult, ImpactResult, StructuralImport } from "../src/types.ts";
import { ImpactError } from "../src/types.ts";

const SHA = "a".repeat(40);

function edge(importer: string, imported: string): StructuralImport {
  return {
    importer,
    imported,
    specifier: `./${imported.split("/").pop()?.replace(/\.tsx?$/, "")}`,
    dependencyTypes: ["import", "local"],
    dynamic: false,
    circular: false,
    extractor: "dependency-cruiser",
    analyzerVersion: "18.7.0",
    configHash: "b".repeat(64),
    snapshotSha: SHA,
    evidence: { type: "import", specifier: "./auth", line: 4 },
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

describe("Shared impact contract mapping", () => {
  it("maps structural and historical signals into A's impactSchema", () => {
    const domain = computeStructuralImpact(
      { snapshotSha: SHA, changedFiles: ["src/auth.ts"], maxDepth: 2, coChange: [coChange()] },
      [edge("src/session.ts", "src/auth.ts")],
    );
    const contract = toContractImpact(domain);
    impactSchema.parse(contract);
    const structural = contract.affected.find(
      (item) => item.signal === "static_reverse_dependency",
    );
    assert.equal(structural?.file, "src/session.ts");
    assert.equal(structural?.depth, 1);
    assert.deepEqual(structural?.path, ["src/session.ts", "src/auth.ts"]);
    assert.equal(structural?.evidence[0]?.file, "src/session.ts");
    assert.equal(structural?.evidence[0]?.line, 4);

    const association = contract.affected.find(
      (item) => item.signal === "historically_coupled",
    );
    assert.equal(association?.file, "src/history.ts");
    assert.equal(association?.cochange?.sampleSize, 3);
    assert.equal(association?.cochange?.windowFrom, "2026-01-01T00:00:00Z");
    assert.equal(association?.depth, 0);
  });

  it("rejects a domain result that does not satisfy the shared contract", () => {
    const domain: ImpactResult = {
      changedFiles: ["src/auth.ts"],
      snapshotSha: SHA,
      affected: [
        {
          file: "src/session.ts",
          signal: "static_reverse_dependency",
          depth: 2,
          path: ["src/session.ts", "src/auth.ts"],
          impact: "possible",
          explanation: "Inconsistent test path",
          evidence: [],
          viaDynamicImport: false,
        },
      ],
      associations: [],
      warnings: [],
      coverage: {
        edgesAnalyzed: 1,
        roots: 1,
        maxDepth: 2,
        affectedReturned: 1,
        truncated: false,
        cyclesSkipped: 0,
        dynamicPaths: 0,
        unresolvedImports: 0,
        ignoredChangedFiles: 0,
        renamedChangedFiles: 0,
      },
    };
    assert.throws(() => toContractImpact(domain), ImpactError);
  });
});
