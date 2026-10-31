import type {
  CoChangeCoverage,
  CoChangeObservation,
  CoChangeResult,
  CoverageWindow,
  GitCommitRecord,
} from "./types.ts";
import { isCoChangeCandidate, isLikelyGeneratedPath } from "./paths.ts";

export interface CoChangeOptions {
  maxFilesPerCommit: number;
  minSupport: number;
  maxResults: number;
  maxSampleCommits: number;
  window: CoverageWindow | null;
  includeDocs: boolean;
}

export const DEFAULT_COCHANGE_OPTIONS: CoChangeOptions = {
  maxFilesPerCommit: 50,
  minSupport: 2,
  maxResults: 20,
  maxSampleCommits: 20,
  window: null,
  includeDocs: true,
};

export interface CommitFileObservation {
  sha: string;
  authoredAt: string;
  authorKey: string;
  files: string[];
}

export interface CoChangeDataset {
  observations: CommitFileObservation[];
  commitsAnalyzed: number;
  commitsExcludedOverCap: number;
  excludedPaths: number;
  window: CoverageWindow;
  warnings: string[];
}

export function buildCoChangeDataset(
  commits: readonly GitCommitRecord[],
  options: Partial<CoChangeOptions> = {},
): CoChangeDataset {
  const config = { ...DEFAULT_COCHANGE_OPTIONS, ...options };
  const observations: CommitFileObservation[] = [];
  let commitsExcludedOverCap = 0;
  let excludedPaths = 0;
  const warnings: string[] = [];
  let oldest: string | null = null;
  let newest: string | null = null;

  for (const commit of commits) {
    if (commit.isMerge) {
      continue;
    }
    const paths = new Set<string>();
    for (const change of commit.changes) {
      if (change.status === "deleted" || change.status === "renamed" || change.status === "copied") {
        const candidate = change.currentPath ?? change.path;
        if (candidate === null) {
          excludedPaths += 1;
          continue;
        }
        if (
          !isCoChangeCandidate(candidate, {}) ||
          isLikelyGeneratedPath(candidate) ||
          (change.isBinary && !config.includeDocs)
        ) {
          excludedPaths += 1;
          continue;
        }
        paths.add(candidate);
        continue;
      }
      if (change.isBinary) {
        excludedPaths += 1;
        continue;
      }
      if (!isCoChangeCandidate(change.path, {})) {
        excludedPaths += 1;
        continue;
      }
      if (isLikelyGeneratedPath(change.path)) {
        excludedPaths += 1;
        continue;
      }
      paths.add(change.currentPath ?? change.path);
    }

    if (paths.size === 0) {
      continue;
    }
    if (paths.size > config.maxFilesPerCommit) {
      commitsExcludedOverCap += 1;
      continue;
    }
    const files = [...paths].sort();
    observations.push({
      sha: commit.sha,
      authoredAt: commit.authoredAt,
      authorKey: commit.author.key,
      files,
    });
    if (oldest === null || commit.authoredAt < oldest) {
      oldest = commit.authoredAt;
    }
    if (newest === null || commit.authoredAt > newest) {
      newest = commit.authoredAt;
    }
  }

  if (commitsExcludedOverCap > 0) {
    warnings.push(
      `${commitsExcludedOverCap} commit(s) were excluded from co-change because they exceeded ${config.maxFilesPerCommit} eligible files.`,
    );
  }
  if (config.window !== null) {
    if (config.window.from !== null && oldest !== null && oldest < config.window.from) {
      oldest = config.window.from;
    }
    if (config.window.to !== null && newest !== null && newest > config.window.to) {
      newest = config.window.to;
    }
  }

  return {
    observations,
    commitsAnalyzed: observations.length,
    commitsExcludedOverCap,
    excludedPaths,
    window: { from: oldest, to: newest },
    warnings,
  };
}

export function computeCoChange(
  dataset: CoChangeDataset,
  targetFile: string,
  options: Partial<CoChangeOptions> = {},
): CoChangeResult {
  const config = { ...DEFAULT_COCHANGE_OPTIONS, ...options };
  const targetObservations = dataset.observations.filter((observation) =>
    observation.files.includes(targetFile),
  );
  const targetCommits = targetObservations.length;
  const pairMap = new Map<string, { shas: string[]; oldest: string | null; newest: string | null }>();

  for (const observation of targetObservations) {
    for (const file of observation.files) {
      if (file === targetFile) {
        continue;
      }
      const entry = pairMap.get(file) ?? { shas: [], oldest: null, newest: null };
      entry.shas.push(observation.sha);
      if (entry.oldest === null || observation.authoredAt < entry.oldest) {
        entry.oldest = observation.authoredAt;
      }
      if (entry.newest === null || observation.authoredAt > entry.newest) {
        entry.newest = observation.authoredAt;
      }
      pairMap.set(file, entry);
    }
  }

  const observations: CoChangeObservation[] = [];
  for (const [file, entry] of pairMap) {
    if (entry.shas.length < config.minSupport) {
      continue;
    }
    observations.push({
      file,
      sharedCommits: entry.shas.length,
      targetCommits,
      share: targetCommits === 0 ? 0 : entry.shas.length / targetCommits,
      commitShas: [...entry.shas].sort().slice(0, config.maxSampleCommits),
      window: { from: entry.oldest, to: entry.newest },
    });
  }

  observations.sort(
    (left, right) =>
      right.sharedCommits - left.sharedCommits ||
      right.share - left.share ||
      left.file.localeCompare(right.file),
  );

  const warnings = [...dataset.warnings];
  if (targetCommits === 0) {
    warnings.push(
      `No indexed commits in the observed window modified ${targetFile}; no co-change is reported.`,
    );
  } else if (observations.length === 0) {
    warnings.push(
      `No file shared at least ${config.minSupport} commit(s) with ${targetFile} in the observed window.`,
    );
  }

  const coverage: CoChangeCoverage = {
    commitsAnalyzed: dataset.commitsAnalyzed,
    commitsTouchingTarget: targetCommits,
    commitsExcludedOverCap: dataset.commitsExcludedOverCap,
    observationsTruncated: observations.length > config.maxResults ? 1 : 0,
    maxFilesPerCommit: config.maxFilesPerCommit,
    minSupport: config.minSupport,
    window: dataset.window,
    excludedPaths: dataset.excludedPaths,
    warnings,
  };

  return {
    targetFile,
    observations: observations.slice(0, config.maxResults),
    coverage,
  };
}
