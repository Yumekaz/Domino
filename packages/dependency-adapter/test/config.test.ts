import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYZER_VERSION,
  buildDependencyCruiserConfig,
  hashAnalyzerConfiguration,
  stableStringify,
} from "../src/config.ts";

describe("Analyzer configuration", () => {
  it("builds the trusted TypeScript configuration", () => {
    const config = buildDependencyCruiserConfig({ tsConfigPath: "apps/web/tsconfig.json" });
    assert.equal(config.options.parser, "tsc");
    assert.equal(config.options.tsPreCompilationDeps, true);
    assert.equal(config.options.doNotFollow.path, "node_modules");
    assert.equal(config.options.tsConfig?.fileName, "apps/web/tsconfig.json");
    assert.deepEqual(config.forbidden, []);
  });

  it("hashes configuration deterministically and version-sensitively", () => {
    const config = buildDependencyCruiserConfig({ tsConfigPath: "apps/web/tsconfig.json" });
    const first = hashAnalyzerConfiguration(ANALYZER_VERSION, config);
    const reordered = {
      options: {
        tsConfig: { fileName: "apps/web/tsconfig.json" },
        exclude: config.options.exclude,
        doNotFollow: config.options.doNotFollow,
        tsPreCompilationDeps: true,
        parser: "tsc",
      },
      forbidden: [],
    };
    assert.equal(hashAnalyzerConfiguration(ANALYZER_VERSION, config), first);
    assert.equal(hashAnalyzerConfiguration(ANALYZER_VERSION, reordered), first);
    assert.notEqual(hashAnalyzerConfiguration("18.7.1", config), first);
    assert.equal(first.length, 64);
  });

  it("serializes keys stably and omits undefined values", () => {
    assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }], skip: undefined }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  });
});
