import type { CoverageReport } from "../../history/src/types.ts";
import type { HistoryStore } from "../../history/src/ports.ts";
import { HistoryError } from "../../history/src/errors.ts";

export interface RiskContributor {
  key: string;
  name: string;
  email: string;
  observedCommits: number;
  shareOfReturnedCommits: number;
  firstTouch: string | null;
  lastTouch: string | null;
  commitShas: string[];
}

export interface RiskFile {
  path: string;
  classification: "single_observed_contributor" | "multiple_observed_contributors" | "unknown";
  observedAuthors: number;
  contributors: RiskContributor[];
  commitCount: number;
  commitCountIsLowerBound: boolean;
  firstEdit: string | null;
  lastEdit: string | null;
  caveats: string[];
}

export interface KnowledgeRiskResult {
  repoId: string;
  snapshotId: string;
  snapshotSha: string;
  totalFiles: number;
  returned: number;
  limit: number;
  offset: number;
  files: RiskFile[];
  coverage: CoverageReport;
  caveats: string[];
  generatedAt: string;
}

export interface KnowledgeRiskDeps {
  store: HistoryStore;
  clock: { isoNow(): string };
}

export interface KnowledgeRiskQuery {
  repoId: string;
  snapshotId: string;
  limit?: number;
  offset?: number;
  riskExtensions?: string[];
  includeAllPaths?: boolean;
}

const DEFAULT_RISK_EXTENSIONS = [
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
];

export async function computeKnowledgeRisk(
  query: KnowledgeRiskQuery,
  deps: KnowledgeRiskDeps,
): Promise<KnowledgeRiskResult> {
  const snapshot = await deps.store.getSnapshot(query.repoId, query.snapshotId);
  if (snapshot === null) {
    throw new HistoryError("SNAPSHOT_NOT_FOUND", "Snapshot was not found", {
      details: { snapshotId: query.snapshotId },
    });
  }
  const limit = clampInt(query.limit ?? 50, 1, 200);
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const page = await deps.store.getRiskPage({
    repoId: query.repoId,
    snapshotId: query.snapshotId,
    limit,
    offset,
    riskExtensions: query.includeAllPaths === true ? [] : query.riskExtensions ?? DEFAULT_RISK_EXTENSIONS,
    includeAllPaths: query.includeAllPaths === true,
  });

  const byPath = new Map<string, typeof page.rows>();
  for (const row of page.rows) {
    const rows = byPath.get(row.path) ?? [];
    rows.push(row);
    byPath.set(row.path, rows);
  }
  const files: RiskFile[] = [];
  for (const [path, rows] of [...byPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const contributors = rows
      .map((row) => ({
        key: row.contributorKey,
        name: row.contributorName,
        email: row.contributorEmail,
        observedCommits: row.observedCommits,
        commitShas: [...new Set(row.commitShas)].sort().slice(0, 20),
        firstTouch: row.firstTouch,
        lastTouch: row.lastTouch,
      }))
      .sort(
        (left, right) =>
          right.observedCommits - left.observedCommits ||
          left.key.localeCompare(right.key),
      );
    const totalReturnedCommits = contributors.reduce(
      (sum, contributor) => sum + contributor.observedCommits,
      0,
    );
    const allShas = new Set<string>();
    let shasTruncated = false;
    for (const row of rows) {
      for (const sha of row.commitShas) {
        allShas.add(sha);
      }
      if (row.observedCommits > row.commitShas.length) {
        shasTruncated = true;
      }
    }
    const firstEdit = contributors
      .map((contributor) => contributor.firstTouch)
      .filter((value): value is string => value !== null)
      .sort()[0] ?? null;
    const lastEdit = contributors
      .map((contributor) => contributor.lastTouch)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
    const observedAuthors = contributors.length;
    const classification =
      observedAuthors === 1
        ? "single_observed_contributor"
        : observedAuthors > 1
          ? "multiple_observed_contributors"
          : "unknown";
    const fileCaveats: string[] = [];
    if (classification === "single_observed_contributor") {
      fileCaveats.push(
        "One observed contributor in the indexed history does not prove that one human knows this code.",
      );
    } else if (classification === "multiple_observed_contributors") {
      fileCaveats.push(
        "Multiple observed contributors do not by themselves establish safety or current knowledge.",
      );
    }
    if (shasTruncated) {
      fileCaveats.push(
        "Per-contributor commit samples were capped; the commit count is a lower bound.",
      );
    }
    files.push({
      path,
      classification,
      observedAuthors,
      contributors: contributors.map((contributor) => ({
        ...contributor,
        shareOfReturnedCommits:
          totalReturnedCommits === 0 ? 0 : contributor.observedCommits / totalReturnedCommits,
      })),
      commitCount: allShas.size,
      commitCountIsLowerBound: shasTruncated,
      firstEdit,
      lastEdit,
      caveats: fileCaveats,
    });
  }

  const historySource = snapshot.coverage.sources.gitHistory;
  const caveats = [
    "Observed authors cover only the indexed Git history; incomplete or shallow history can hide contributors.",
    "One observed contributor does not mean one human knows the code.",
  ];
  if (historySource !== undefined && historySource.status !== "complete") {
    caveats.push(
      `Git history coverage is ${historySource.status}; contributor counts are not all-time ownership.`,
    );
  }
  const limits = snapshot.coverage.limits;
  const aliasGroups =
    typeof limits.gitPossibleAliasGroups === "number" ? limits.gitPossibleAliasGroups : 0;
  if (aliasGroups > 0) {
    caveats.push(
      `${aliasGroups} display-name group(s) had multiple email identities; they were not merged.`,
    );
  }
  if (limits.gitMailmapPresent === true) {
    caveats.push("A .mailmap file was applied; unresolved aliases may still remain.");
  }
  const filesWithoutHistory =
    typeof limits.gitFilesWithoutObservedHistory === "number"
      ? limits.gitFilesWithoutObservedHistory
      : 0;
  if (filesWithoutHistory > 0) {
    caveats.push(
      `${filesWithoutHistory} file(s) at the indexed SHA had no observed modification in the history window and are not classified.`,
    );
  }
  if (page.totalFiles > offset + files.length) {
    caveats.push(
      `Results are paginated: ${files.length} of ${page.totalFiles} files returned.`,
    );
  }
  if (files.length === 0) {
    caveats.push("No files with observed contributor history were returned for this snapshot.");
  }

  return {
    repoId: query.repoId,
    snapshotId: query.snapshotId,
    snapshotSha: snapshot.headSha,
    totalFiles: page.totalFiles,
    returned: files.length,
    limit,
    offset,
    files,
    coverage: snapshot.coverage,
    caveats,
    generatedAt: deps.clock.isoNow(),
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
