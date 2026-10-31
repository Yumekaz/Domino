import { existsSync, readFileSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANALYZER_VERSION, EXTRACTOR, buildDependencyCruiserConfig, hashAnalyzerConfiguration } from "./config.ts";
import { DependencyAdapterError } from "./errors.ts";
import { analyzeCheckout } from "./runner.ts";
import type { NormalizedStructuralAnalysis } from "./types.ts";

type DependencyCruiserPackage = {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
};

function resolveAnalyzerEntry(): { scriptPath: string; version: string } {
  let directory = dirname(fileURLToPath(import.meta.resolve("dependency-cruiser")));
  for (;;) {
    const packageJsonPath = join(directory, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, "utf8"),
      ) as DependencyCruiserPackage;
      if (packageJson.name === "dependency-cruiser") {
        if (typeof packageJson.version !== "string")
          throw new DependencyAdapterError(
            "ANALYZER_NOT_FOUND",
            "dependency-cruiser has no readable version.",
          );
        const bin =
          typeof packageJson.bin === "string"
            ? packageJson.bin
            : packageJson.bin !== null && typeof packageJson.bin === "object"
              ? (packageJson.bin as Record<string, unknown>)["dependency-cruiser"]
              : undefined;
        if (typeof bin !== "string" || !bin.trim())
          throw new DependencyAdapterError(
            "ANALYZER_NOT_FOUND",
            "dependency-cruiser has no CLI entry.",
          );
        return {
          scriptPath: join(directory, bin),
          version: packageJson.version,
        };
      }
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new DependencyAdapterError(
        "ANALYZER_NOT_FOUND",
        "The dependency-cruiser package root could not be located.",
      );
    directory = parent;
  }
}

async function hasTsconfig(directory: string): Promise<boolean> {
  try {
    await access(join(directory, "tsconfig.json"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the pinned dependency-cruiser entry against a read-only exact-SHA checkout.
 * Configuration is generated outside the checkout and only allowlisted environment
 * values reach the analyzer process.
 */
export async function analyzeRepositoryCheckout(input: {
  signal?: AbortSignal;
  workingDirectory: string;
  repositoryId: string;
  snapshotSha: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}): Promise<NormalizedStructuralAnalysis> {
  if (!input.workingDirectory.trim()) {
    throw new DependencyAdapterError("INVALID_ANALYZER_INPUT", "A checkout directory is required.");
  }
  const entry = resolveAnalyzerEntry();
  if (entry.version !== ANALYZER_VERSION) {
    throw new DependencyAdapterError(
      "ANALYZER_VERSION_MISMATCH",
      `The installed dependency-cruiser version ${entry.version} does not match the pinned ${ANALYZER_VERSION}.`,
    );
  }
  const hasConfig = await hasTsconfig(input.workingDirectory);
  const config = buildDependencyCruiserConfig({
    ...(hasConfig
      ? { tsConfigPath: "tsconfig.json" }
      : {}),
  });
  const configDir = await mkdtemp(join(tmpdir(), "domino-analyzer-"));
  const configPath = join(configDir, "dependency-cruiser.json");
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? 120_000;
  const run = async (selectedConfig: typeof config) => {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new DependencyAdapterError("ANALYZER_TIMEOUT", "The structural analysis budget was exhausted.");
    }
    await writeFile(configPath, JSON.stringify(selectedConfig), "utf8");
    return analyzeCheckout({
      scriptPath: entry.scriptPath,
      workingDirectory: input.workingDirectory,
      targetDir: ".",
      configPath,
      metadata: {
        repositoryId: input.repositoryId,
        snapshotSha: input.snapshotSha,
        analyzer: EXTRACTOR,
        version: entry.version,
        configHash: hashAnalyzerConfiguration(entry.version, selectedConfig),
        analyzedAt: new Date().toISOString(),
      },
      timeoutMs: remainingMs,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.maxBufferBytes === undefined ? {} : { maxBufferBytes: input.maxBufferBytes }),
    });
  };
  try {
    try {
      return await run(config);
    } catch (error) {
      if (!hasConfig || !(error instanceof DependencyAdapterError) || error.code !== "ANALYZER_FAILED" ||
          !/\bTS6053: File [^\r\n]+ not found\./.test(error.message)) throw error;
      const fallback = await run(buildDependencyCruiserConfig());
      return {
        ...fallback,
        limitations: ["The repository TypeScript configuration could not be resolved. Analysis ran without it; aliases and other configuration-dependent imports may be missing."],
      };
    }
  } finally {
    await rm(configDir, { recursive: true, force: true }).catch(() => {});
  }
}
