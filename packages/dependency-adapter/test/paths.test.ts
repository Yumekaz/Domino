import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBinaryFile,
  isCodeFile,
  isExcludedStructuralPath,
  normalizeRepoRelativePath,
} from "../src/paths.ts";

describe("Structural path rules", () => {
  it("normalizes repository-relative POSIX and Windows paths", () => {
    assert.equal(normalizeRepoRelativePath("./src/auth.ts"), "src/auth.ts");
    assert.equal(normalizeRepoRelativePath("src\\pages\\Workspace.tsx"), "src/pages/Workspace.tsx");
    assert.equal(normalizeRepoRelativePath("src/auth.ts"), "src/auth.ts");
  });

  it("rejects absolute, traversal and NUL paths", () => {
    assert.equal(normalizeRepoRelativePath("/etc/passwd"), null);
    assert.equal(normalizeRepoRelativePath("C:\\repo\\file.ts"), null);
    assert.equal(normalizeRepoRelativePath("../outside.ts"), null);
    assert.equal(normalizeRepoRelativePath("src/../../outside.ts"), null);
    assert.equal(normalizeRepoRelativePath("src/\0file.ts"), null);
    assert.equal(normalizeRepoRelativePath(""), null);
  });

  it("excludes vendor, generated and declaration files consistently", () => {
    for (const path of [
      "node_modules/react/index.js",
      "vendor/lib/index.ts",
      "dist/bundle.js",
      "src/__generated__/api.ts",
      "src/schema.generated.ts",
      "src/api.d.ts",
      "src/app.min.js",
    ])
      assert.equal(isExcludedStructuralPath(path), true, path);
    assert.equal(isExcludedStructuralPath("src/pages/Workspace.tsx"), false);
  });

  it("recognizes supported code and binary inputs", () => {
    assert.equal(isCodeFile("src/index.ts"), true);
    assert.equal(isCodeFile("src/view.tsx"), true);
    assert.equal(isCodeFile("src/styles.css"), false);
    assert.equal(isCodeFile("README.md"), false);
    assert.equal(isBinaryFile("assets/hero.webp"), true);
    assert.equal(isBinaryFile("src/index.ts"), false);
  });
});
