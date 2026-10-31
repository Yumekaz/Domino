import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDependencyCruiserOutput } from "../src/normalize.ts";
import type { AnalyzerMetadata } from "../src/types.ts";

const output = JSON.parse(
  readFileSync(new URL("./fixtures/dependency-cruiser-domino-f628461.json", import.meta.url), "utf8"),
);
const metadata = JSON.parse(
  readFileSync(
    new URL("./fixtures/dependency-cruiser-domino-f628461.meta.json", import.meta.url),
    "utf8",
  ),
) as AnalyzerMetadata;

describe("Real dependency-cruiser normalization", () => {
  const analysis = normalizeDependencyCruiserOutput(output, metadata);

  it("preserves the exact revision, extractor metadata and structural count", () => {
    assert.equal(analysis.metadata.snapshotSha, "f62846192575672c4f1b7b2fe424e853218c9a15");
    assert.equal(analysis.summary.modulesCruised, 53);
    assert.equal(analysis.summary.modules, 41);
    assert.equal(analysis.summary.excludedModules, 12);
    assert.equal(analysis.summary.dependencies, 123);
    assert.ok(analysis.imports.length > 100);
    assert.ok(analysis.imports.every((item) => item.snapshotSha === metadata.snapshotSha));
    assert.ok(analysis.imports.every((item) => item.evidence.line === null));
  });

  it("retains the real importer -> imported direction for the inspection chain", () => {
    const workspaceToInvestigations = analysis.imports.find(
      (item) =>
        item.importer === "apps/web/src/pages/Workspace.tsx" &&
        item.imported === "apps/web/src/pages/investigations.tsx",
    );
    assert.ok(workspaceToInvestigations);
    assert.equal(workspaceToInvestigations.specifier, "./investigations");
    assert.equal(workspaceToInvestigations.circular, true);

    const mainToWorkspace = analysis.imports.find(
      (item) =>
        item.importer === "apps/web/src/main.tsx" &&
        item.imported === "apps/web/src/pages/Workspace.tsx",
    );
    assert.ok(mainToWorkspace);
    assert.equal(mainToWorkspace.dynamic, true);
  });

  it("keeps external, unresolved and non-code imports out of structural edges", () => {
    assert.ok(analysis.gaps.length > 0);
    assert.ok(analysis.gaps.some((item) => item.reason === "unresolved"));
    assert.ok(
      analysis.imports.every(
        (item) =>
          !item.imported.includes("node_modules/") &&
          !item.imported.endsWith(".css") &&
          !item.imported.endsWith(".json"),
      ),
    );
  });

  it("deduplicates edges and reports dynamic/circular observations separately", () => {
    const keys = analysis.imports.map((item) =>
      JSON.stringify([item.importer, item.imported, item.specifier, item.dynamic]),
    );
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(analysis.summary.dynamicImports > 0);
    assert.ok(analysis.summary.circularImports > 0);
  });

  it("rejects unsafe module paths and invalid metadata", () => {
    assert.throws(
      () =>
        normalizeDependencyCruiserOutput(
          { modules: [{ source: "../outside.ts", dependencies: [] }] },
          metadata,
        ),
      { code: "INVALID_ANALYZER_OUTPUT" },
    );
    assert.throws(
      () =>
        normalizeDependencyCruiserOutput(output, {
          ...metadata,
          snapshotSha: "main",
        }),
      { code: "INVALID_ANALYZER_METADATA" },
    );
  });
});
