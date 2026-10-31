import { ImpactError } from "./types.ts";
import { normalizeRepoRelativePath } from "../../../dependency-adapter/src/paths.ts";

export type DiffLimits = {
  maxBytes?: number;
  maxFiles?: number;
  maxLines?: number;
};

export type ParsedProposedDiff = {
  changedFiles: string[];
  renames: Record<string, string>;
  deletedFiles: string[];
  binaryFiles: string[];
  warnings: string[];
};

const DEFAULT_LIMITS: Required<DiffLimits> = {
  maxBytes: 100_000,
  maxFiles: 100,
  maxLines: 20_000,
};

function cleanDiffPath(raw: string): string | null {
  let value = raw.trim();
  if (!value || value === "/dev/null") return null;
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  value = value.split("\t")[0] ?? value;
  if (value.startsWith("a/") || value.startsWith("b/")) value = value.slice(2);
  const normalized = normalizeRepoRelativePath(value);
  if (!normalized) {
    throw new ImpactError("UNSAFE_PATH", `The proposed diff contains an unsafe path: ${raw.slice(0, 120)}`);
  }
  return normalized;
}

/**
 * Reads changed paths from a unified diff as data. It does not parse or execute code.
 * Rename metadata comes from git's `rename from`/`rename to` lines; other renames
 * remain ordinary changed paths.
 */
export function parseProposedDiff(
  diff: string,
  limits: DiffLimits = {},
): ParsedProposedDiff {
  const config = { ...DEFAULT_LIMITS, ...limits };
  if (typeof diff !== "string" || !diff.trim()) {
    throw new ImpactError("NO_CHANGED_FILES", "The proposed diff is empty.");
  }
  if (Buffer.byteLength(diff, "utf8") > config.maxBytes) {
    throw new ImpactError(
      "DIFF_TOO_LARGE",
      `The proposed diff exceeds the ${config.maxBytes}-byte input budget.`,
    );
  }
  const lines = diff.split(/\r?\n/);
  if (lines.length > config.maxLines) {
    throw new ImpactError(
      "DIFF_TOO_LARGE",
      `The proposed diff exceeds the ${config.maxLines}-line input budget.`,
    );
  }

  const changed = new Set<string>();
  const deleted = new Set<string>();
  const binary = new Set<string>();
  const renames: Record<string, string> = {};
  const warnings: string[] = [];
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;

  const flush = () => {
    if (renameFrom && renameTo) {
      renames[renameFrom] = renameTo;
      changed.add(renameTo);
      warnings.push(`Rename detected: ${renameFrom} → ${renameTo}.`);
    } else {
      if (oldPath) changed.add(oldPath);
      if (newPath) changed.add(newPath);
      if (oldPath && !newPath) deleted.add(oldPath);
      if (newPath && !oldPath) warnings.push(`Added file: ${newPath}.`);
    }
    if (binary.has(oldPath ?? "") || binary.has(newPath ?? "")) {
      const file = newPath ?? oldPath;
      if (file) warnings.push(`Binary change: ${file} has no structural import analysis.`);
    }
    oldPath = null;
    newPath = null;
    renameFrom = null;
    renameTo = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const header = /^diff --git (a\/.+?) (b\/.+)$/.exec(line);
      if (header?.[1] && header[2]) {
        oldPath = cleanDiffPath(header[1]);
        newPath = cleanDiffPath(header[2]);
      }
      continue;
    }
    if (line.startsWith("rename from ")) {
      renameFrom = cleanDiffPath(line.slice("rename from ".length));
      continue;
    }
    if (line.startsWith("rename to ")) {
      renameTo = cleanDiffPath(line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = cleanDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      newPath = cleanDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      const path = newPath ?? oldPath;
      if (path) binary.add(path);
    }
  }
  flush();

  if (changed.size === 0) {
    throw new ImpactError("NO_CHANGED_FILES", "The proposed diff did not contain changed file paths.");
  }
  if (changed.size > config.maxFiles) {
    throw new ImpactError(
      "DIFF_TOO_LARGE",
      `The proposed diff changes more than ${config.maxFiles} files. Narrow the proposed change.`,
    );
  }

  return {
    changedFiles: [...changed].sort(),
    renames,
    deletedFiles: [...deleted].sort(),
    binaryFiles: [...binary].sort(),
    warnings,
  };
}
