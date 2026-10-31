import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDependencyCruiserOutput } from "../../../dependency-adapter/src/normalize.ts";
import type { AnalyzerMetadata } from "../../../dependency-adapter/src/types.ts";
import { computeStructuralImpact } from "../src/impact.ts";

const output = JSON.parse(
  readFileSync(
    new URL(
      "../../../dependency-adapter/test/fixtures/dependency-cruiser-domino-f628461.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const metadata = JSON.parse(
  readFileSync(
    new URL(
      "../../../dependency-adapter/test/fixtures/dependency-cruiser-domino-f628461.meta.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as AnalyzerMetadata;

describe("Real analyzer evidence feeds reverse impact", () => {
  const analysis = normalizeDependencyCruiserOutput(output, metadata);

  it("computes the real main.tsx → Workspace.tsx → investigations.tsx chain", () => {
    const result = computeStructuralImpact(
      {
        snapshotSha: metadata.snapshotSha,
        changedFiles: ["apps/web/src/pages/investigations.tsx"],
        maxDepth: 3,
        analyzerGaps: analysis.gaps,
      },
      analysis.imports,
    );
    const workspace = result.affected.find(
      (item) => item.file === "apps/web/src/pages/Workspace.tsx",
    );
    assert.equal(workspace?.depth, 1);
    assert.deepEqual(workspace?.path, [
      "apps/web/src/pages/Workspace.tsx",
      "apps/web/src/pages/investigations.tsx",
    ]);
    assert.equal(workspace?.evidence[0]?.specifier, "./investigations");
    assert.equal(workspace?.evidence[0]?.snapshotSha, metadata.snapshotSha);
    assert.equal(workspace?.evidence[0]?.line, null);

    const main = result.affected.find((item) => item.file === "apps/web/src/main.tsx");
    assert.equal(main?.depth, 2);
    assert.deepEqual(main?.path, [
      "apps/web/src/main.tsx",
      "apps/web/src/pages/Workspace.tsx",
      "apps/web/src/pages/investigations.tsx",
    ]);
    assert.equal(main?.viaDynamicImport, true);
    assert.ok(result.warnings.some((warning) => warning.includes("dynamic import")));
    assert.equal(result.snapshotSha, metadata.snapshotSha);
    assert.ok(result.affected.every((item) => item.impact === "possible"));
    assert.ok(result.associations.length === 0);
  });
});
