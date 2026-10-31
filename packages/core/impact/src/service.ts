import {
  type ImpactServicePort,
} from "../../../contracts/src/index.ts";
import {
  isCodeFile,
  normalizeRepoRelativePath,
} from "../../../dependency-adapter/src/paths.ts";
import type { StructuralImport } from "../../../dependency-adapter/src/types.ts";
import { toContractImpact } from "./contracts.ts";
import { computeStructuralImpact } from "./impact.ts";
import { ImpactError, type CoChangeResult } from "./types.ts";

const MAX_REVERSE_LIMIT = 500;
const MAX_TRAVERSAL_NODES = 2_000;
const MAX_EDGES = 200_000;

function requireDepth(value: number): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) return value;
  throw new ImpactError("DEPTH_OUT_OF_RANGE", "Impact depth must be 1, 2 or 3.");
}

export type StoredDependencyRow = {
  importingFile: string;
  importedFile: string;
  dependencyKind: string;
  sourceLine: number | null;
  evidence: Record<string, unknown>;
};

/**
 * A's database adapter supplies this source. C never owns SQL; the port keeps
 * snapshot-scoped row access and co-change in A/B's implementation.
 */
export type ImpactServiceSource = {
  getPublishedSnapshot(
    repoId: string,
    snapshotId: string,
  ): Promise<{ id: string; headSha: string }>;
  findReverseDependencies(input: {
    repoId: string;
    snapshotId: string;
    importedFile: string;
    limit: number;
  }): Promise<{ rows: StoredDependencyRow[]; truncated: boolean }>;
  getCoChange?(input: {
    repoId: string;
    snapshotId: string;
    targetFile: string;
  }): Promise<CoChangeResult>;
};

function stringEvidence(
  evidence: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = evidence[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function rowToImport(
  row: StoredDependencyRow,
  snapshotSha: string,
): StructuralImport | null {
  const importer = normalizeRepoRelativePath(row.importingFile);
  const imported = normalizeRepoRelativePath(row.importedFile);
  if (!importer || !imported || importer === imported) return null;
  if (!isCodeFile(importer) || !isCodeFile(imported)) return null;
  const evidence = row.evidence ?? {};
  const specifier = stringEvidence(evidence, "specifier", row.dependencyKind);
  return {
    importer,
    imported,
    specifier,
    dependencyTypes: [row.dependencyKind],
    dynamic: evidence.dynamic === true,
    circular: evidence.circular === true,
    extractor: stringEvidence(evidence, "extractor", "unknown"),
    analyzerVersion: stringEvidence(evidence, "analyzerVersion", "unknown"),
    configHash: stringEvidence(evidence, "configHash", "unknown"),
    snapshotSha,
    evidence: { type: "import", specifier, line: row.sourceLine ?? null },
  };
}

/**
 * On-demand API service over A's published-snapshot structural rows and B's
 * co-change port. The browser sends only changed files or a proposed diff; all
 * traversal, evidence and limitations are computed here.
 */
export function createImpactService(source: ImpactServiceSource): ImpactServicePort {
  return {
    async analyze(repoId, input) {
      const snapshot = await source.getPublishedSnapshot(repoId, input.snapshotId);
      const maxDepth = requireDepth(input.maxDepth);
      const preliminary = computeStructuralImpact(
        {
          snapshotSha: snapshot.headSha,
          changedFiles: input.changedFiles,
          proposedDiff: input.proposedDiff,
          maxDepth,
        },
        [],
      );
      if (preliminary.changedFiles.length === 0) return toContractImpact(preliminary);

      const warnings: string[] = [];
      const queue = preliminary.changedFiles.map((file) => ({ file, depth: 0 }));
      const visited = new Set(preliminary.changedFiles);
      const edges = new Map<string, StructuralImport>();
      let reverseTruncated = false;
      let traversalTruncated = false;
      let missingEvidenceMetadata = false;
      let head = 0;

      while (head < queue.length) {
        const node = queue[head++];
        if (node.depth >= maxDepth) continue;
        let reverse;
        try {
          reverse = await source.findReverseDependencies({
            repoId,
            snapshotId: input.snapshotId,
            importedFile: node.file,
            limit: MAX_REVERSE_LIMIT,
          });
        } catch (error) {
          warnings.push(
            `Reverse dependency lookup failed for ${node.file}: ${error instanceof Error ? error.message : "unknown error"}`,
          );
          continue;
        }
        if (reverse.truncated) {
          reverseTruncated = true;
          warnings.push(
            `Reverse dependency lookup for ${node.file} was truncated at ${MAX_REVERSE_LIMIT} rows.`,
          );
        }
        for (const row of reverse.rows) {
          if (typeof row.evidence?.analyzerVersion !== "string" || typeof row.evidence?.configHash !== "string")
            missingEvidenceMetadata = true;
          const edge = rowToImport(row, snapshot.headSha);
          if (!edge) continue;
          const key = JSON.stringify([
            edge.importer,
            edge.imported,
            edge.specifier,
            edge.dynamic,
          ]);
          if (edges.has(key)) continue;
          if (edges.size >= MAX_EDGES) {
            traversalTruncated = true;
            break;
          }
          edges.set(key, edge);
          if (!visited.has(edge.importer)) {
            visited.add(edge.importer);
            if (visited.size > MAX_TRAVERSAL_NODES) {
              traversalTruncated = true;
              break;
            }
            if (node.depth + 1 < maxDepth)
              queue.push({ file: edge.importer, depth: node.depth + 1 });
          }
        }
        if (traversalTruncated) break;
      }
      if (traversalTruncated) {
        warnings.push(
          `Traversal was bounded at ${MAX_TRAVERSAL_NODES} files or ${MAX_EDGES} edges; inspect the returned paths and limitations.`,
        );
      }
      if (missingEvidenceMetadata) {
        warnings.push(
          "Some stored dependency rows are missing analyzer version or config-hash provenance; their evidence is incomplete.",
        );
      }

      let coChange: CoChangeResult[] | undefined;
      if (source.getCoChange) {
        coChange = [];
        for (const targetFile of preliminary.changedFiles) {
          try {
            coChange.push(
              await source.getCoChange({
                repoId,
                snapshotId: input.snapshotId,
                targetFile,
              }),
            );
          } catch (error) {
            warnings.push(
              `Historical co-change is unavailable for ${targetFile}: ${error instanceof Error ? error.message : "unknown error"}`,
            );
          }
        }
      }

      const result = computeStructuralImpact(
        {
          snapshotSha: snapshot.headSha,
          changedFiles: input.changedFiles,
          proposedDiff: input.proposedDiff,
          maxDepth,
          coChange,
        },
        [...edges.values()],
      );
      if (reverseTruncated || traversalTruncated) result.coverage.truncated = true;
      result.warnings.push(...warnings);
      return toContractImpact(result);
    },
  };
}
