import type { CoChangeResult, ImpactAssociation } from "./types.ts";
import { normalizeRepoRelativePath } from "../../../dependency-adapter/src/paths.ts";

function normalizeTimestamp(value: string | null): string | null {
  if (value === null) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/**
 * Adapts B's stored co-change result into a separate association signal.
 * It never creates or extends a structural reverse-dependency path.
 */
export function adaptCoChangeResults(
  results: readonly CoChangeResult[],
  changedFiles: readonly string[],
): { associations: ImpactAssociation[]; warnings: string[] } {
  const targets = new Set(changedFiles);
  const associations = new Map<string, ImpactAssociation>();
  const warnings: string[] = [];

  for (const result of results) {
    const targetFile = normalizeRepoRelativePath(result.targetFile);
    if (!targetFile || !targets.has(targetFile)) {
      warnings.push(`Ignored a co-change result for a file outside the changed set: ${result.targetFile}.`);
      continue;
    }
    if (!Number.isInteger(result.coverage.commitsTouchingTarget) || result.coverage.commitsTouchingTarget < 0) {
      warnings.push(`Ignored a co-change result with an invalid sample size for ${targetFile}.`);
      continue;
    }
    for (const observation of result.observations) {
      const file = normalizeRepoRelativePath(observation.file);
      if (!file || file === targetFile) continue;
      if (
        !Number.isInteger(observation.sharedCommits) ||
        observation.sharedCommits <= 0 ||
        !Number.isInteger(observation.targetCommits) ||
        observation.targetCommits <= 0 ||
        observation.sharedCommits > observation.targetCommits ||
        !(observation.share >= 0 && observation.share <= 1)
      ) {
        warnings.push(`Ignored an inconsistent co-change observation for ${file}.`);
        continue;
      }
      const key = `${targetFile}\u0000${file}`;
      const existing = associations.get(key);
      if (existing && existing.sharedCommits >= observation.sharedCommits) continue;
      const caveats = [
        "Historical co-change is an association, not an import path.",
        `Sample: ${observation.targetCommits} indexed commit(s) touched ${targetFile} within the observed window.`,
        ...result.coverage.warnings,
      ];
      if (result.coverage.observationsTruncated > 0)
        caveats.push("The stored co-change result was truncated to its configured result cap.");
      associations.set(key, {
        file,
        targetFile,
        signal: "historically_coupled",
        sharedCommits: observation.sharedCommits,
        targetCommits: observation.targetCommits,
        share: observation.share,
        commitShas: [...new Set(observation.commitShas)].sort(),
        window: {
          from: normalizeTimestamp(observation.window.from),
          to: normalizeTimestamp(observation.window.to),
        },
        coverage: {
          commitsAnalyzed: result.coverage.commitsAnalyzed,
          commitsTouchingTarget: result.coverage.commitsTouchingTarget,
          commitsExcludedOverCap: result.coverage.commitsExcludedOverCap,
          window: {
            from: normalizeTimestamp(result.coverage.window.from),
            to: normalizeTimestamp(result.coverage.window.to),
          },
        },
        caveats,
      });
    }
  }

  return {
    associations: [...associations.values()].sort(
      (left, right) =>
        right.sharedCommits - left.sharedCommits ||
        left.targetFile.localeCompare(right.targetFile) ||
        left.file.localeCompare(right.file),
    ),
    warnings,
  };
}
