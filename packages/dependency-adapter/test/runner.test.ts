import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeCheckout,
  buildAnalyzerEnvironment,
  buildDependencyCruiserArgs,
  createNodeAnalyzerProcessRunner,
} from "../src/runner.ts";
import type { AnalyzerMetadata } from "../src/types.ts";

const output = readFileSync(
  new URL("./fixtures/dependency-cruiser-domino-f628461.json", import.meta.url),
  "utf8",
);
const metadata = JSON.parse(
  readFileSync(
    new URL("./fixtures/dependency-cruiser-domino-f628461.meta.json", import.meta.url),
    "utf8",
  ),
) as AnalyzerMetadata;

describe("Analyzer invocation", () => {
  it("uses explicit argument arrays with absolute target and config paths", () => {
    const args = buildDependencyCruiserArgs({
      targetDir: "apps/web/src",
      configPath: "../config.json",
    });
    assert.ok(args[0]?.endsWith("apps\\web\\src") || args[0]?.endsWith("apps/web/src"));
    assert.ok(args.includes("--config"));
    assert.ok(args.includes("--output-type"));
    assert.equal(args.includes("sh"), false);
    assert.throws(
      () => buildDependencyCruiserArgs({ targetDir: "", configPath: "x" }),
      { code: "INVALID_ANALYZER_INPUT" },
    );
  });

  it("only passes non-secret environment values to the analyzer", () => {
    const env = buildAnalyzerEnvironment({
      PATH: "bin",
      HOME: "home",
      GITHUB_TOKEN: "secret",
      OPENAI_API_KEY: "secret",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(env, { PATH: "bin", HOME: "home" });
  });

  it("runs without a shell and normalizes real analyzer output", async () => {
    const calls: { file: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
    const exec = (
      file: string,
      args: readonly string[],
      options: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      calls.push({ file, args, options });
      callback(null, output, "");
    };
    const runner = createNodeAnalyzerProcessRunner(
      exec as unknown as Parameters<typeof createNodeAnalyzerProcessRunner>[0],
    );
    const result = await analyzeCheckout({
      binaryPath: "node_modules/.bin/depcruise",
      workingDirectory: ".",
      targetDir: "apps/web/src",
      configPath: "config.json",
      metadata,
      processRunner: runner,
    });
    assert.equal(result.summary.modulesCruised, 53);
    assert.equal(result.summary.modules, 41);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.options.shell, false);
    assert.deepEqual(Object.keys(calls[0]?.options.env as object).includes("GITHUB_TOKEN"), false);
  });

  it("maps analyzer timeouts and failures to typed errors", async () => {
    const timeoutRunner = createNodeAnalyzerProcessRunner(
      ((_file: string, _args: readonly string[], _options: unknown, callback: Function) =>
        callback(
          Object.assign(new Error("killed"), { killed: true, code: "ETIMEDOUT" }),
          "",
          "",
        )) as unknown as Parameters<typeof createNodeAnalyzerProcessRunner>[0],
    );
    await assert.rejects(
      analyzeCheckout({
        binaryPath: "depcruise",
        workingDirectory: ".",
        targetDir: ".",
        configPath: "config.json",
        metadata,
        processRunner: timeoutRunner,
      }),
      { code: "ANALYZER_TIMEOUT" },
    );

    const failureRunner = createNodeAnalyzerProcessRunner(
      ((_file: string, _args: readonly string[], _options: unknown, callback: Function) =>
        callback(Object.assign(new Error("exit 1"), { code: 1 }), "", "bad input")) as unknown as Parameters<
        typeof createNodeAnalyzerProcessRunner
      >[0],
    );
    await assert.rejects(
      analyzeCheckout({
        binaryPath: "depcruise",
        workingDirectory: ".",
        targetDir: ".",
        configPath: "config.json",
        metadata,
        processRunner: failureRunner,
      }),
      { code: "ANALYZER_FAILED" },
    );
  });

  it("rejects malformed analyzer JSON", async () => {
    const runner = createNodeAnalyzerProcessRunner(
      ((_file: string, _args: readonly string[], _options: unknown, callback: Function) =>
        callback(null, "not json", "")) as unknown as Parameters<
        typeof createNodeAnalyzerProcessRunner
      >[0],
    );
    await assert.rejects(
      analyzeCheckout({
        binaryPath: "depcruise",
        workingDirectory: ".",
        targetDir: ".",
        configPath: "config.json",
        metadata,
        processRunner: runner,
      }),
      { code: "INVALID_ANALYZER_OUTPUT" },
    );
  });
});
