import type pg from "pg";
import type { CheckoutHandle } from "../../../packages/git-adapter/src/checkout.ts";
import type { RepositoryRecord } from "../../../packages/core/history/src/types.ts";
import {
  analyzeRepositoryCheckout,
} from "../../../packages/dependency-adapter/src/repository.ts";
import {
  replacePendingStructural,
  type StructuralImportRecord,
} from "../../../packages/database/src/impact.ts";
import type {
  StructuralAnalysisHook,
  StructuralAnalysisResult,
} from "./handlers/history/pipeline.ts";

type StructuralHookInput = {
  repository: RepositoryRecord;
  snapshotId: string;
  headSha: string;
  checkout: CheckoutHandle;
};

/**
 * Runs C's pinned static analyzer inside the exact-SHA checkout, then persists
 * snapshot-scoped dependencies and IMPORT edges before B publishes the snapshot.
 */
export function createStructuralAnalysis(
  pool: pg.Pool,
  context: { repoId: string; githubId: number },
): StructuralAnalysisHook {
  return async (input: StructuralHookInput): Promise<StructuralAnalysisResult> => {
    const normalized = await analyzeRepositoryCheckout({
      workingDirectory: input.checkout.directory,
      repositoryId: String(context.githubId),
      snapshotSha: input.headSha,
      timeoutMs: 120_000,
    });
    const imports: StructuralImportRecord[] = normalized.imports.map((item) => ({
      importer: item.importer,
      imported: item.imported,
      specifier: item.specifier,
      dependencyTypes: item.dependencyTypes,
      dynamic: item.dynamic,
      circular: item.circular,
      extractor: item.extractor,
      analyzerVersion: item.analyzerVersion,
      configHash: item.configHash,
      snapshotSha: item.snapshotSha,
      evidence: {
        type: "import",
        specifier: item.specifier,
        line: item.evidence.line,
      },
    }));
    const stored = await replacePendingStructural(
      pool,
      context.repoId,
      input.snapshotId,
      imports,
      { owner: input.repository.owner, name: input.repository.name },
      input.headSha,
    );
    const warnings: string[] = [...(normalized.limitations ?? [])];
    if (stored.missingEntities > 0) {
      warnings.push(
        `${stored.missingEntities} analyzed path(s) are not represented as File records in this snapshot; their IMPORT edges were not created. Change impact still uses the stored dependencies.`,
      );
    }
    if (normalized.gaps.length > 0) {
      warnings.push(
        `${normalized.gaps.length} import(s) remain unresolved, external, non-code or excluded; they are not stored as structural dependencies.`,
      );
    }
    if (normalized.excludedModules.length > 0) {
      warnings.push(
        `${normalized.excludedModules.length} vendor, generated or declaration module(s) were excluded from analysis.`,
      );
    }
    if (normalized.summary.dynamicImports > 0) {
      warnings.push(
        `${normalized.summary.dynamicImports} dynamic import(s) are recorded as structural observations; runtime resolution remains a limitation.`,
      );
    }
    if (normalized.summary.circularImports > 0) {
      warnings.push(
        `${normalized.summary.circularImports} circular import(s) were observed; traversal stops on repeated files.`,
      );
    }
    if (stored.dependencies === 0) {
      warnings.push(
        "No resolvable JavaScript or TypeScript structural imports were observed at the indexed revision.",
      );
    }
    return {
      status: normalized.limitations?.length ? "partial" : "complete",
      items: stored.dependencies,
      gaps: normalized.gaps.length,
      excludedModules: normalized.excludedModules.length,
      warnings,
    };
  };
}
