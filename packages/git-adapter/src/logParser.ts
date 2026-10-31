import type { GitChangeStatus, GitFileChange, GitIdentity } from "../../core/history/src/types.ts";
import { gitContributorKey } from "../../core/history/src/ids.ts";
import { isBinaryPath, normalizeRepoPath } from "../../core/history/src/paths.ts";

export interface ParsedCommitMetadata {
  sha: string;
  parents: string[];
  rawAuthorName: string;
  rawAuthorEmail: string;
  canonicalAuthorName: string;
  canonicalAuthorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  subject: string;
  message: string;
}

export interface ParsedNameStatus {
  status: GitChangeStatus;
  path: string;
  previousPath: string | null;
  similarity: number | null;
}

export function parseCommitMetadataLog(output: Buffer): ParsedCommitMetadata[] {
  const text = output.toString("utf8");
  const records = text.split("\x1e");
  const commits: ParsedCommitMetadata[] = [];
  for (const record of records) {
    if (record.trim().length === 0) {
      continue;
    }
    const fields = record.split("\x1f");
    if (fields.length < 11) {
      continue;
    }
    const sha = fields[0].trim().replace(/^\r?\n/, "");
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      continue;
    }
    const message = fields.slice(11).join("\x1f").replace(/^\r?\n/, "").replace(/\s+$/, "");
    commits.push({
      sha: sha.toLowerCase(),
      parents: fields[1]
        .trim()
        .split(" ")
        .map((parent) => parent.trim().toLowerCase())
        .filter((parent) => /^[0-9a-f]{40}$/.test(parent)),
      rawAuthorName: fields[2].trim(),
      rawAuthorEmail: fields[3].trim(),
      canonicalAuthorName: fields[4].trim(),
      canonicalAuthorEmail: fields[5].trim(),
      authoredAt: fields[6].trim(),
      committerName: fields[7].trim(),
      committerEmail: fields[8].trim(),
      committedAt: fields[9].trim(),
      subject: fields[10].trim(),
      message,
    });
  }
  return commits;
}

export function parseNameStatusLog(output: Buffer): Map<string, ParsedNameStatus[]> {
  const text = output.toString("utf8");
  const records = text.split("\x1e");
  const bySha = new Map<string, ParsedNameStatus[]>();
  for (const record of records) {
    if (record.length === 0) {
      continue;
    }
    const parts = record.split("\0");
    const sha = parts[0].trim().replace(/^\r?\n/, "");
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      continue;
    }
    const changes: ParsedNameStatus[] = [];
    let index = 1;
    while (index < parts.length) {
      const rawStatus = parts[index].replace(/^\r?\n/, "").trim();
      index += 1;
      if (rawStatus.length === 0) {
        continue;
      }
      const code = rawStatus[0].toUpperCase();
      if (code === "R" || code === "C") {
        const oldPath = parts[index];
        const newPath = parts[index + 1];
        index += 2;
        if (oldPath === undefined || newPath === undefined) {
          break;
        }
        let normalizedOld: string;
        let normalizedNew: string;
        try {
          normalizedOld = normalizeRepoPath(oldPath);
          normalizedNew = normalizeRepoPath(newPath);
        } catch {
          continue;
        }
        const similarity = Number.parseInt(rawStatus.slice(1), 10);
        changes.push({
          status: code === "R" ? "renamed" : "copied",
          path: normalizedNew,
          previousPath: normalizedOld,
          similarity: Number.isFinite(similarity) ? similarity : null,
        });
        continue;
      }
      const filePath = parts[index];
      index += 1;
      if (filePath === undefined) {
        break;
      }
      let normalized: string;
      try {
        normalized = normalizeRepoPath(filePath);
      } catch {
        continue;
      }
      changes.push({
        status: mapStatus(code),
        path: normalized,
        previousPath: null,
        similarity: null,
      });
    }
    bySha.set(sha.toLowerCase(), changes);
  }
  return bySha;
}

function mapStatus(code: string): GitChangeStatus {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type_changed";
    default:
      return "unknown";
  }
}

export function toGitFileChange(
  change: ParsedNameStatus,
  currentPath: string | null,
): GitFileChange {
  return {
    status: change.status,
    path: change.path,
    previousPath: change.previousPath,
    currentPath,
    similarity: change.similarity,
    isBinary: isBinaryPath(change.path),
    blobSha: null,
    size: null,
  };
}

export function identityFromMetadata(
  name: string,
  email: string,
  rawName: string,
  rawEmail: string,
  mailmapped: boolean,
  rawNames: Set<string>,
  rawEmails: Set<string>,
): GitIdentity {
  return {
    key: gitContributorKey({ name, email }),
    name,
    email,
    rawNames: [rawName, ...rawNames].filter((value, index, array) => array.indexOf(value) === index),
    rawEmails: [rawEmail, ...rawEmails].filter((value, index, array) => array.indexOf(value) === index),
    mailmapped,
  };
}
