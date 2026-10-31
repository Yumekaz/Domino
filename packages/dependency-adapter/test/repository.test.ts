import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeRepositoryCheckout } from "../src/repository.ts";
import { ANALYZER_VERSION, buildDependencyCruiserConfig, hashAnalyzerConfiguration } from "../src/config.ts";

test("missing extended tsconfig recovers relative imports and discloses degraded resolution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "domino-analyzer-fixture-"));
  const files = ["tsconfig.json", "index.ts", "example.ts"];
  try {
    await writeFile(join(dir, files[0]), JSON.stringify({ extends: "@unavailable/tsconfig" }));
    await writeFile(join(dir, files[1]), 'import { example } from "./example.js"; console.log(example);');
    await writeFile(join(dir, files[2]), "export const example = 1;");
    const result = await analyzeRepositoryCheckout({
      workingDirectory: dir,
      repositoryId: "fixture",
      snapshotSha: "a".repeat(40),
    });
    assert.ok(result.imports.some((edge) => edge.importer === "index.ts" && edge.imported === "example.ts"));
    assert.match(result.limitations?.[0] ?? "", /without it.*aliases/i);
    assert.equal(result.metadata.configHash, hashAnalyzerConfiguration(ANALYZER_VERSION, buildDependencyCruiserConfig()));
  } finally {
    for (const file of files) await rm(join(dir, file), { force: true });
    await rmdir(dir);
  }
});

test("does not hide an unrelated invalid TypeScript configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "domino-analyzer-invalid-"));
  try {
    await writeFile(join(dir, "tsconfig.json"), "{ invalid json");
    await writeFile(join(dir, "index.ts"), "export const example = 1;");
    await assert.rejects(
      analyzeRepositoryCheckout({ workingDirectory: dir, repositoryId: "fixture", snapshotSha: "a".repeat(40) }),
      { code: "ANALYZER_FAILED" },
    );
  } finally {
    await rm(join(dir, "tsconfig.json"), { force: true });
    await rm(join(dir, "index.ts"), { force: true });
    await rmdir(dir);
  }
});
