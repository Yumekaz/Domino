import {
  isBinaryFile,
  isCodeFile,
  isExcludedStructuralPath,
  normalizeRepoRelativePath,
} from "../../../dependency-adapter/src/paths.ts";
import type { AnalyzerGap, StructuralImport } from "../../../dependency-adapter/src/types.ts";
import { adaptCoChangeResults } from "./cochange.ts";
import { parseProposedDiff } from "./diff.ts";
import {
  ImpactError,
  type CoChangeResult,
  type ImpactAffected,
  type ImpactCoverage,
  type ImpactOptions,
  type ImpactPathEvidence,
  type ImpactResult,
} from "./types.ts";

const FULL_SHA = /^[0-9a-f]{40}$/;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_AFFECTED = 200;
const DEFAULT_MAX_EDGES = 200_000;

type QueueItem = {
  file: string;
  depth: number;
  path: string[];
  hops: ImpactPathEvidence[];
  dynamic: boolean;
};

function toEvidence(edge: StructuralImport): ImpactPathEvidence {
  return {
    type: "import",
    importer: edge.importer,
    imported: edge.imported,
    specifier: edge.specifier,
    line: edge.evidence?.line ?? null,
    dynamic: edge.dynamic,
    circular: edge.circular,
    extractor: edge.extractor,
    analyzerVersion: edge.analyzerVersion,
    configHash: edge.configHash,
    snapshotSha: edge.snapshotSha,
  };
}

function explanation(path: readonly string[], dynamic: boolean): string {
  const dynamicNote = dynamic
    ? " The path includes a dynamic import; runtime execution is not guaranteed."
    : "";
  return `Static reverse dependency path: ${path.join(" → ")}. Possible impact only; this is not proof of a runtime failure.${dynamicNote}`;
}

function normalizeRenameMap(
  parsed: Readonly<Record<string, string>>,
  requested: Readonly<Record<string, string>> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [rawFrom, rawTo] of [
    ...Object.entries(parsed),
    ...Object.entries(requested ?? {}),
  ]) {
    const from = normalizeRepoRelativePath(rawFrom);
    const to = normalizeRepoRelativePath(rawTo);
    if (!from || !to) {
      throw new ImpactError("UNSAFE_PATH", "A rename mapping contains an unsafe repository path.");
    }
    const existing = map.get(from);
    if (existing && existing !== to) {
      throw new ImpactError(
        "INVALID_INPUT",
        `The rename mapping for ${from} resolves to more than one current path.`,
      );
    }
    map.set(from, to);
  }
  return map;
}

/**
 * Computes reverse structural impact from normalized analyzer observations.
 * It never runs an analyzer, reads source text or creates an edge without evidence.
 */
export function computeStructuralImpact(
  options: ImpactOptions,
  edges: readonly StructuralImport[],
): ImpactResult {
  if (!FULL_SHA.test(options.snapshotSha)) {
    throw new ImpactError("INVALID_INPUT", "The impact snapshot revision must be a full 40-character SHA.");
  }
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (![1, 2, 3].includes(maxDepth)) {
    throw new ImpactError("DEPTH_OUT_OF_RANGE", "Impact depth must be 1, 2 or 3.");
  }
  const maxAffected = options.maxAffected ?? DEFAULT_MAX_AFFECTED;
  const maxEdges = options.maxEdges ?? DEFAULT_MAX_EDGES;
  if (!Number.isInteger(maxAffected) || maxAffected < 1 || maxAffected > 2_000) {
    throw new ImpactError("INVALID_INPUT", "maxAffected must be an integer between 1 and 2000.");
  }
  if (!Number.isInteger(maxEdges) || maxEdges < 1) {
    throw new ImpactError("INVALID_INPUT", "maxEdges must be a positive integer.");
  }
  if (options.changedFiles && options.proposedDiff !== undefined) {
    throw new ImpactError(
      "MIXED_INPUT",
      "Supply changed files or a proposed diff, not both inputs to the same analysis.",
    );
  }
  if (edges.length > maxEdges) {
    throw new ImpactError(
      "EDGE_LIMIT_EXCEEDED",
      `The snapshot has more than ${maxEdges} structural observations. Narrow the analysis snapshot.`,
    );
  }
  for (const edge of edges) {
    if (edge.snapshotSha !== options.snapshotSha) {
      throw new ImpactError(
        "SNAPSHOT_MISMATCH",
        "A structural observation belongs to a different snapshot revision.",
      );
    }
  }

  const warnings: string[] = [];
  let inputPaths: string[] = [];
  let parsedRenames: Record<string, string> = {};
  let deletedFiles: string[] = [];
  let binaryFiles: string[] = [];

  if (options.proposedDiff !== undefined) {
    const parsed = parseProposedDiff(options.proposedDiff);
    inputPaths = parsed.changedFiles;
    parsedRenames = parsed.renames;
    deletedFiles = parsed.deletedFiles;
    binaryFiles = parsed.binaryFiles;
    warnings.push(...parsed.warnings);
  } else if (options.changedFiles?.length) {
    inputPaths = [...options.changedFiles];
  } else {
    throw new ImpactError("NO_CHANGED_FILES", "A changed file or proposed diff is required.");
  }

  const renameMap = normalizeRenameMap(parsedRenames, options.renameMap);
  const ignoredChangedFiles: string[] = [];
  const changedSet = new Set<string>();
  let renamedChangedFiles = 0;

  for (const rawPath of inputPaths) {
    const normalized = normalizeRepoRelativePath(rawPath);
    if (!normalized) {
      throw new ImpactError("UNSAFE_PATH", `The changed path is not repository-relative: ${rawPath}`);
    }
    if (isExcludedStructuralPath(normalized)) {
      ignoredChangedFiles.push(normalized);
      continue;
    }
    const mapped = renameMap.get(normalized) ?? normalized;
    if (mapped !== normalized) renamedChangedFiles += 1;
    changedSet.add(mapped);
  }
  const changedFiles = [...changedSet].sort();

  if (ignoredChangedFiles.length > 0) {
    warnings.push(
      `${ignoredChangedFiles.length} changed file(s) are ignored, vendor or generated paths and were not traversed.`,
    );
  }
  if (renamedChangedFiles > 0) {
    warnings.push(`${renamedChangedFiles} renamed changed file(s) were resolved to their current path.`);
  }
  if (deletedFiles.length > 0) {
    warnings.push(
      `Deleted changed file(s): ${deletedFiles.join(", ")}. No file exists at the analyzed revision; dependents may appear as unresolved analyzer gaps.`,
    );
  }
  if (binaryFiles.length > 0) {
    warnings.push(
      `Binary changed file(s): ${binaryFiles.join(", ")}. They have no structural import analysis.`,
    );
  }
  if (changedFiles.length === 0) {
    warnings.push("Every changed path was excluded from structural analysis.");
    return {
      changedFiles,
      snapshotSha: options.snapshotSha,
      affected: [],
      associations: [],
      warnings,
      coverage: {
        edgesAnalyzed: edges.length,
        roots: 0,
        maxDepth,
        affectedReturned: 0,
        truncated: false,
        cyclesSkipped: 0,
        dynamicPaths: 0,
        unresolvedImports: options.analyzerGaps?.length ?? 0,
        ignoredChangedFiles: ignoredChangedFiles.length,
        renamedChangedFiles,
      },
    };
  }

  const reverse = new Map<string, StructuralImport[]>();
  let invalidEdges = 0;
  for (const edge of edges) {
    const importer = normalizeRepoRelativePath(edge.importer);
    const imported = normalizeRepoRelativePath(edge.imported);
    if (!importer || !imported) {
      throw new ImpactError("INVALID_INPUT", "A structural observation contains an unsafe path.");
    }
    if (importer === imported) continue;
    if (
      isExcludedStructuralPath(importer) ||
      isExcludedStructuralPath(imported) ||
      !isCodeFile(importer) ||
      !isCodeFile(imported)
    ) {
      invalidEdges += 1;
      continue;
    }
    const list = reverse.get(imported) ?? [];
    list.push(edge);
    reverse.set(imported, list);
  }
  for (const list of reverse.values()) {
    list.sort(
      (left, right) =>
        left.importer.localeCompare(right.importer) ||
        left.specifier.localeCompare(right.specifier) ||
        Number(left.dynamic) - Number(right.dynamic),
    );
  }
  if (invalidEdges > 0) {
    warnings.push(
      `${invalidEdges} structural observation(s) pointed at ignored or non-code files and were excluded.`,
    );
  }

  const changedRoots = new Set(changedFiles);
  const queue: QueueItem[] = changedFiles.map((file) => ({
    file,
    depth: 0,
    path: [file],
    hops: [],
    dynamic: false,
  }));
  const seen = new Set<string>(changedFiles);
  const affected: ImpactAffected[] = [];
  let cyclesSkipped = 0;
  let truncated = false;
  let head = 0;

  while (head < queue.length) {
    const node = queue[head++];
    if (node.depth >= maxDepth) continue;
    const incoming = reverse.get(node.file) ?? [];
    for (const edge of incoming) {
      const importer = normalizeRepoRelativePath(edge.importer)!;
      if (changedRoots.has(importer)) continue;
      if (node.path.includes(importer)) {
        cyclesSkipped += 1;
        continue;
      }
      if (seen.has(importer)) continue;
      const depth = node.depth + 1;
      if (depth > maxDepth) continue;
      const path = [importer, ...node.path];
      const hops = [toEvidence(edge), ...node.hops];
      const viaDynamicImport = node.dynamic || edge.dynamic;
      if (affected.length >= maxAffected) {
        truncated = true;
        head = queue.length;
        break;
      }
      seen.add(importer);
      affected.push({
        file: importer,
        signal: "static_reverse_dependency",
        depth,
        path,
        impact: "possible",
        explanation: explanation(path, viaDynamicImport),
        evidence: hops,
        viaDynamicImport,
      });
      queue.push({ file: importer, depth, path, hops, dynamic: viaDynamicImport });
    }
  }

  affected.sort((left, right) => left.depth - right.depth || left.file.localeCompare(right.file));
  const dynamicPaths = affected.filter((item) => item.viaDynamicImport).length;
  const gaps: readonly AnalyzerGap[] = options.analyzerGaps ?? [];
  const unresolvedImports = gaps.filter((item) => item.reason === "unresolved").length;

  if (cyclesSkipped > 0) {
    warnings.push(`${cyclesSkipped} cycle traversal(s) were stopped at a repeated file.`);
  }
  if (dynamicPaths > 0) {
    warnings.push(
      `${dynamicPaths} affected path(s) include a dynamic import; runtime execution is not guaranteed.`,
    );
  }
  if (truncated) {
    warnings.push(`Affected results were truncated at the ${maxAffected}-file bound.`);
  }
  if (gaps.length > 0) {
    warnings.push(
      `${gaps.length} analyzer observation(s) were unresolved, external or non-code and are not structural paths.`,
    );
  }
  warnings.push("Feature, test and decision mappings are not included without stored mappings.");
  if (affected.length === 0) {
    warnings.push(
      "No static reverse dependents were returned. This does not establish that runtime behavior is unaffected.",
    );
  }

  const coChange: readonly CoChangeResult[] | undefined = options.coChange;
  const adapted = coChange
    ? adaptCoChangeResults(coChange, changedFiles)
    : { associations: [], warnings: [] };
  warnings.push(...adapted.warnings);
  if (coChange) {
    warnings.push("Historical co-change associations are listed separately and never create structural paths.");
  } else {
    warnings.push("No historical co-change dataset was supplied; associations are unavailable.");
  }

  const coverage: ImpactCoverage = {
    edgesAnalyzed: edges.length,
    roots: changedFiles.length,
    maxDepth,
    affectedReturned: affected.length,
    truncated,
    cyclesSkipped,
    dynamicPaths,
    unresolvedImports,
    ignoredChangedFiles: ignoredChangedFiles.length,
    renamedChangedFiles,
  };

  return {
    changedFiles,
    snapshotSha: options.snapshotSha,
    affected,
    associations: adapted.associations,
    warnings,
    coverage,
  };
}

export function binaryChangedFiles(files: readonly string[]): string[] {
  return files.filter((file) => isBinaryFile(file));
}
