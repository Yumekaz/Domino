import { createHash } from "node:crypto";
import { stableStringify } from "../../../../../packages/dependency-adapter/src/config.ts";
import type { AnalyzerGap, StructuralImport } from "../../../../../packages/dependency-adapter/src/types.ts";
import { computeStructuralImpact } from "../../../../../packages/core/impact/src/impact.ts";
import type { CoChangeResult, ImpactResult } from "../../../../../packages/core/impact/src/types.ts";
import {
  AnalysisError,
  type AnalysisProgress,
  type AnalysisRunRecord,
  type AnalysisRunStore,
  type Clock,
  type CoChangeReader,
  type IdGenerator,
  type ImpactAnalysisJob,
  type StructuralAnalyzerPort,
  type StructuralImportStore,
} from "./types.ts";

const FULL_SHA = /^[0-9a-f]{40}$/;

export type AnalysisDeps = {
  imports: StructuralImportStore;
  runs: AnalysisRunStore;
  clock: Clock;
  ids: IdGenerator;
  coChange?: CoChangeReader;
  analyzer?: StructuralAnalyzerPort;
  progress?: AnalysisProgress;
};

function requireIdentity(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new AnalysisError("INVALID_JOB", `${label} is required.`);
  }
}

function requireSnapshotSha(value: string): void {
  if (!FULL_SHA.test(value)) {
    throw new AnalysisError("INVALID_JOB", "The snapshot revision must be a full 40-character SHA.");
  }
}

export function impactRunKey(job: ImpactAnalysisJob): string {
  const diffHash = job.proposedDiff
    ? createHash("sha256").update(job.proposedDiff).digest("hex")
    : null;
  return createHash("sha256")
    .update(
      stableStringify({
        kind: "impact",
        repoId: job.repoId,
        snapshotId: job.snapshotId,
        snapshotSha: job.snapshotSha,
        changedFiles: [...(job.changedFiles ?? [])].sort(),
        diffHash,
        maxDepth: job.maxDepth ?? 3,
        renameMap: job.renameMap ?? null,
      }),
    )
    .digest("hex");
}

async function loadImports(
  job: ImpactAnalysisJob,
  deps: AnalysisDeps,
  warnings: string[],
): Promise<{ imports: StructuralImport[]; gaps: AnalyzerGap[] }> {
  if (job.checkoutSha && job.checkoutSha !== job.snapshotSha) {
    throw new AnalysisError(
      "SNAPSHOT_MISMATCH",
      "The checkout revision does not match the declared analysis snapshot.",
    );
  }
  let imports = await deps.imports.getImports({
    repoId: job.repoId,
    snapshotId: job.snapshotId,
    snapshotSha: job.snapshotSha,
  });
  let gaps: AnalyzerGap[] = [];
  if (job.refresh || imports.length === 0) {
    if (!deps.analyzer || !job.checkoutDir) {
      if (imports.length === 0) {
        throw new AnalysisError(
          "STRUCTURAL_SNAPSHOT_MISSING",
          "No stored structural observations exist for this snapshot and no analyzer checkout was supplied.",
        );
      }
      warnings.push("A structural refresh was requested without an analyzer checkout; stored observations were used.");
      return { imports, gaps };
    }
    await deps.progress?.report({
      phase: "analyzing_structure",
      message: "Analyzing structural imports at the declared snapshot.",
      warnings: [],
    });
    const normalized = await deps.analyzer.analyze({
      repositoryId: job.repositoryId,
      snapshotSha: job.snapshotSha,
      checkoutDir: job.checkoutDir,
      checkoutSha: job.checkoutSha,
    });
    if (normalized.metadata.snapshotSha !== job.snapshotSha) {
      throw new AnalysisError(
        "ANALYZER_METADATA_MISMATCH",
        "The analyzer output revision does not match the declared snapshot.",
      );
    }
    await deps.progress?.report({
      phase: "storing_structure",
      message: "Storing normalized structural observations.",
      warnings: [],
    });
    await deps.imports.replaceImports({
      repoId: job.repoId,
      snapshotId: job.snapshotId,
      snapshotSha: job.snapshotSha,
      imports: normalized.imports,
      analyzer: {
        version: normalized.metadata.version,
        configHash: normalized.metadata.configHash,
      },
    });
    imports = normalized.imports;
    gaps = normalized.gaps;
    if (normalized.excludedModules.length > 0) {
      warnings.push(
        `The analyzer excluded ${normalized.excludedModules.length} vendor, generated or declaration module(s).`,
      );
    }
  }
  return { imports, gaps };
}

/**
 * Computes an impact result from stored or freshly analyzed structural observations.
 * It also asks B's co-change port for association data; failure of that separate
 * signal does not remove structural results or create a dependency.
 */
export async function computeAnalysis(
  job: ImpactAnalysisJob,
  deps: AnalysisDeps,
  warnings: string[],
): Promise<ImpactResult> {
  requireIdentity(job.repoId, "repoId");
  requireIdentity(job.snapshotId, "snapshotId");
  requireIdentity(job.repositoryId, "repositoryId");
  requireSnapshotSha(job.snapshotSha);

  await deps.progress?.report({
    phase: "validating",
    message: "Validating analysis input and snapshot revision.",
    warnings: [],
  });
  const { imports, gaps } = await loadImports(job, deps, warnings);
  const baseOptions = {
    snapshotSha: job.snapshotSha,
    changedFiles: job.changedFiles,
    proposedDiff: job.proposedDiff,
    maxDepth: job.maxDepth,
    renameMap: job.renameMap,
    analyzerGaps: gaps,
  };
  await deps.progress?.report({
    phase: "traversing",
    message: "Traversing reverse structural dependencies.",
    warnings: [],
  });
  const preliminary = computeStructuralImpact(baseOptions, imports);
  let result = preliminary;
  if (deps.coChange && preliminary.changedFiles.length > 0) {
    const results: CoChangeResult[] = [];
    for (const targetFile of preliminary.changedFiles) {
      try {
        results.push(
          await deps.coChange.getCoChange({
            repoId: job.repoId,
            snapshotId: job.snapshotId,
            targetFile,
          }),
        );
      } catch (error) {
        warnings.push(
          `Historical co-change is unavailable for ${targetFile}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
    result = computeStructuralImpact(
      { ...baseOptions, coChange: results },
      imports,
    );
  }
  result.warnings.push(...warnings);
  return result;
}

export function createImpactAnalysisHandler(deps: AnalysisDeps) {
  return {
    queue: "analysis.impact" as const,
    async handle(job: ImpactAnalysisJob): Promise<AnalysisRunRecord> {
      const idempotencyKey = impactRunKey(job);
      const existing = await deps.runs.getByKey(idempotencyKey);
      if (existing) return existing;

      const warnings: string[] = [];
      const result = await computeAnalysis(job, deps, warnings);
      const run: AnalysisRunRecord = {
        id: deps.ids.runId(),
        repoId: job.repoId,
        snapshotId: job.snapshotId,
        snapshotSha: job.snapshotSha,
        kind: "impact",
        status: "completed",
        createdAt: deps.clock.now().toISOString(),
        stale: false,
        result,
        warnings: result.warnings,
        idempotencyKey,
        ...(job.checkoutSha ? { checkoutSha: job.checkoutSha } : {}),
      };
      await deps.progress?.report({
        phase: "persisting",
        message: "Persisting the analysis run.",
        warnings: [],
      });
      return deps.runs.save(run);
    },
  };
}
