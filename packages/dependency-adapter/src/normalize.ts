import { DependencyAdapterError } from "./errors.ts";
import type {
  AnalyzerGap,
  AnalyzerMetadata,
  DependencyCruiserDependency,
  DependencyCruiserOutput,
  NormalizedStructuralAnalysis,
  StructuralImport,
} from "./types.ts";
import {
  isCodeFile,
  isExcludedStructuralPath,
  normalizeRepoRelativePath,
} from "./paths.ts";

const FULL_SHA = /^[0-9a-f]{40}$/;
const CONFIG_HASH = /^[0-9a-f]{64}$/;

function validateMetadata(metadata: AnalyzerMetadata): void {
  if (!metadata.repositoryId.trim()) {
    throw new DependencyAdapterError("INVALID_ANALYZER_METADATA", "A repository identity is required.");
  }
  if (!FULL_SHA.test(metadata.snapshotSha)) {
    throw new DependencyAdapterError(
      "INVALID_ANALYZER_METADATA",
      "The analyzer snapshot revision must be a full 40-character SHA.",
    );
  }
  if (!metadata.version.trim()) {
    throw new DependencyAdapterError("INVALID_ANALYZER_METADATA", "The analyzer version is required.");
  }
  if (!CONFIG_HASH.test(metadata.configHash)) {
    throw new DependencyAdapterError(
      "INVALID_ANALYZER_METADATA",
      "The analyzer configuration hash must be a SHA-256 hex digest.",
    );
  }
  if (Number.isNaN(Date.parse(metadata.analyzedAt))) {
    throw new DependencyAdapterError(
      "INVALID_ANALYZER_METADATA",
      "The analyzer timestamp must be an ISO date.",
    );
  }
}

function gap(
  importer: string,
  dependency: DependencyCruiserDependency,
  reason: AnalyzerGap["reason"],
): AnalyzerGap {
  return {
    importer,
    specifier: typeof dependency.module === "string" ? dependency.module : "",
    reason,
    dynamic: dependency.dynamic === true,
  };
}

/**
 * Converts dependency-cruiser JSON into repository-relative structural imports.
 * It never creates an edge for an external, unresolved or non-code dependency.
 * dependency-cruiser's JSON does not expose source line numbers, so line is null.
 */
export function normalizeDependencyCruiserOutput(
  output: DependencyCruiserOutput,
  metadata: AnalyzerMetadata,
): NormalizedStructuralAnalysis {
  validateMetadata(metadata);
  if (!Array.isArray(output?.modules)) {
    throw new DependencyAdapterError(
      "INVALID_ANALYZER_OUTPUT",
      "dependency-cruiser output did not contain a modules array.",
    );
  }

  const importsByKey = new Map<string, StructuralImport>();
  const gaps: AnalyzerGap[] = [];
  const excludedModules = new Set<string>();
  let dependencies = 0;
  let normalizedModules = 0;

  for (const module of output.modules) {
    const importer = normalizeRepoRelativePath(module.source);
    if (!importer) {
      throw new DependencyAdapterError(
        "INVALID_ANALYZER_OUTPUT",
        "dependency-cruiser returned an unsafe module path.",
      );
    }
    if (isExcludedStructuralPath(importer) || !isCodeFile(importer)) {
      excludedModules.add(importer);
      continue;
    }
    normalizedModules += 1;
    const moduleDependencies = Array.isArray(module.dependencies) ? module.dependencies : [];
    dependencies += moduleDependencies.length;

    for (const dependency of moduleDependencies) {
      const specifier = typeof dependency.module === "string" ? dependency.module.slice(0, 2048) : "";
      if (dependency.couldNotResolve === true || !dependency.resolved) {
        gaps.push(gap(importer, dependency, "unresolved"));
        continue;
      }
      const imported = normalizeRepoRelativePath(dependency.resolved);
      if (!imported) {
        gaps.push(gap(importer, dependency, "unresolved"));
        continue;
      }
      if (dependency.coreModule === true || imported.includes("node_modules/")) {
        gaps.push(gap(importer, dependency, "external"));
        continue;
      }
      if (dependency.matchesDoNotFollow === true || dependency.followable === false) {
        gaps.push(gap(importer, dependency, "excluded"));
        continue;
      }
      if (isExcludedStructuralPath(imported)) {
        gaps.push(gap(importer, dependency, "excluded"));
        continue;
      }
      if (!isCodeFile(imported) || imported === importer) {
        gaps.push(gap(importer, dependency, "non-code"));
        continue;
      }

      const dynamic = dependency.dynamic === true;
      const circular = dependency.circular === true;
      const dependencyTypes = [...new Set(dependency.dependencyTypes ?? [])].sort();
      const key = JSON.stringify([importer, imported, specifier, dynamic]);
      const existing = importsByKey.get(key);
      if (existing) {
        existing.circular ||= circular;
        existing.dependencyTypes = [
          ...new Set([...existing.dependencyTypes, ...dependencyTypes]),
        ].sort();
        continue;
      }
      importsByKey.set(key, {
        importer,
        imported,
        specifier,
        dependencyTypes,
        dynamic,
        circular,
        extractor: "dependency-cruiser",
        analyzerVersion: metadata.version,
        configHash: metadata.configHash,
        snapshotSha: metadata.snapshotSha,
        evidence: { type: "import", specifier, line: null },
      });
    }
  }

  const imports = [...importsByKey.values()].sort(
    (left, right) =>
      left.importer.localeCompare(right.importer) ||
      left.imported.localeCompare(right.imported) ||
      left.specifier.localeCompare(right.specifier) ||
      Number(left.dynamic) - Number(right.dynamic),
  );
  gaps.sort(
    (left, right) =>
      left.importer.localeCompare(right.importer) ||
      left.specifier.localeCompare(right.specifier) ||
      left.reason.localeCompare(right.reason),
  );

  return {
    metadata,
    imports,
    gaps,
    excludedModules: [...excludedModules].sort(),
    summary: {
      modulesCruised: output.modules.length,
      modules: normalizedModules,
      dependencies,
      structuralImports: imports.length,
      dynamicImports: imports.filter((item) => item.dynamic).length,
      circularImports: imports.filter((item) => item.circular).length,
      unresolvedImports: gaps.filter((item) => item.reason === "unresolved").length,
      externalImports: gaps.filter((item) => item.reason === "external").length,
      nonCodeImports: gaps.filter((item) => item.reason === "non-code").length,
      excludedModules: excludedModules.size,
    },
  };
}

export function parseDependencyCruiserJson(raw: string): DependencyCruiserOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DependencyAdapterError(
      "INVALID_ANALYZER_OUTPUT",
      "dependency-cruiser returned non-JSON output.",
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { modules?: unknown }).modules)
  ) {
    throw new DependencyAdapterError(
      "INVALID_ANALYZER_OUTPUT",
      "dependency-cruiser output did not contain a modules array.",
    );
  }
  return parsed as DependencyCruiserOutput;
}
