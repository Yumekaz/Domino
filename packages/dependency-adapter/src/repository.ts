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
  const config = buildDependencyCruiserConfig({
    ...((await hasTsconfig(input.workingDirectory))
      ? { tsConfigPath: "tsconfig.json" }
      : {}),
  });
  const configHash = hashAnalyzerConfiguration(entry.version, config);
  const configDir = await mkdtemp(join(tmpdir(), "domino-analyzer-"));
  const configPath = join(configDir, "dependency-cruiser.json");
  await writeFile(configPath, JSON.stringify(config), "utf8");
  try {
    return await analyzeCheckout({
      scriptPath: entry.scriptPath,
      workingDirectory: input.workingDirectory,
      targetDir: ".",
      configPath,
      metadata: {
        repositoryId: input.repositoryId,
        snapshotSha: input.snapshotSha,
        analyzer: EXTRACTOR,
        version: entry.version,
        configHash,
        analyzedAt: new Date().toISOString(),
      },
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.maxBufferBytes === undefined ? {} : { maxBufferBytes: input.maxBufferBytes }),
    });
  } finally {
    await rm(configDir, { recursive: true, force: true }).catch(() => {});
  }
}
