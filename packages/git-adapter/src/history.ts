import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  FileContributorRow,
  GitCommitRecord,
  GitHistoryAnalysis,
  GitHistoryCoverage,
  GitIdentity,
} from "../../core/history/src/types.ts";
import { HistoryError, errorMessage } from "../../core/history/src/errors.ts";
import { gitContributorKey, normalizeIdentityEmail, normalizeIdentityName } from "../../core/history/src/ids.ts";
import { isBinaryPath, normalizeRepoPath } from "../../core/history/src/paths.ts";
import {
  createControlledGitEnv,
  createGitHome,
  resolveGitBinary,
  runGit,
  runGitOrThrow,
} from "./process.ts";
import {
  parseCommitMetadataLog,
  parseNameStatusLog,
  type ParsedCommitMetadata,
  type ParsedNameStatus,
} from "./logParser.ts";

export interface AnalyzeGitHistoryOptions {
  sha?: string;
  maxCommits?: number;
  historyDepth?: number;
  maxFiles?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  gitBinary?: string;
  home?: { home: string; configFile: string };
}

const DEFAULT_MAX_COMMITS = 200;
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_TIMEOUT_MS = 120_000;

interface ContributorAccumulator {
  commitShas: Set<string>;
  firstTouch: string | null;
  lastTouch: string | null;
}

export async function analyzeGitHistory(
  directory: string,
  options: AnalyzeGitHistoryOptions = {},
): Promise<GitHistoryAnalysis> {
  const repoDir = path.resolve(directory);
  const stat = fs.statSync(repoDir, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) {
    throw new HistoryError("INVALID_PATH", "Git analysis directory does not exist", {
      details: { directory: repoDir },
    });
  }
  const maxCommits = clampInt(options.maxCommits ?? DEFAULT_MAX_COMMITS, 1, 50_000);
  const maxFiles = clampInt(options.maxFiles ?? DEFAULT_MAX_FILES, 1, 100_000);
  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 600_000);
  const historyDepthRequested = options.historyDepth ?? maxCommits;
  const deadline = Date.now() + timeoutMs;
  const gitBinary = resolveGitBinary(options.gitBinary);
  let tempHome: string | null = null;
  let home: { home: string; configFile: string };
  if (options.home !== undefined) {
    home = options.home;
  } else {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "domino-git-home-"));
    home = createGitHome(tempHome);
  }
  const base = {
    cwd: repoDir,
    home: home.home,
    configFile: home.configFile,
    gitBinary,
    signal: options.signal,
  };

  const git = async (args: string[], context: string, maxStdoutBytes?: number) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new HistoryError("CHECKOUT_TIMEOUT", "Git history analysis exceeded its time budget", {
        recoverable: true,
      });
    }
    return await runGitOrThrow(
      args,
      { ...base, timeoutMs: Math.min(remaining, timeoutMs), maxStdoutBytes },
      context,
    );
  };

  try {
    const inside = await git(["rev-parse", "--is-inside-work-tree"], "Git repository check");
    if (inside.stdout.toString("utf8").trim() !== "true") {
      throw new HistoryError("INVALID_PATH", "Directory is not a Git work tree");
    }
    const resolved = await git(["rev-parse", "HEAD"], "Resolve HEAD");
    const resolvedSha = resolved.stdout.toString("utf8").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(resolvedSha)) {
      throw new HistoryError("GIT_FAILED", "Git did not return a full HEAD SHA");
    }
    const requestedSha = (options.sha ?? resolvedSha).toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(requestedSha)) {
      throw new HistoryError("INVALID_REQUEST", "Requested Git SHA must be full 40-hex");
    }
    if (requestedSha !== resolvedSha) {
      throw new HistoryError("SHA_NOT_FOUND", "Checkout HEAD does not match the requested exact SHA", {
        details: { requestedSha, resolvedSha },
      });
    }

    const shallowResult = await git(
      ["rev-parse", "--is-shallow-repository"],
      "Shallow repository check",
    );
    const shallow = shallowResult.stdout.toString("utf8").trim() === "true";
    const mailmapPresent = fs.existsSync(path.join(repoDir, ".mailmap"));

    const metadataResult = await git(
      [
        "log",
        `--max-count=${maxCommits + 1}`,
        "--use-mailmap",
        "--no-color",
        "--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aN%x1f%aE%x1f%aI%x1f%cN%x1f%cE%x1f%cI%x1f%s%x1f%B",
        requestedSha,
      ],
      "Read commit metadata",
      64 * 1024 * 1024,
    );
    let metadata = parseCommitMetadataLog(metadataResult.stdout);
    let maxCommitsReached = false;
    if (metadata.length > maxCommits) {
      metadata = metadata.slice(0, maxCommits);
      maxCommitsReached = true;
    }

    const nameStatusResult = await git(
      [
        "log",
        `--max-count=${maxCommits}`,
        "--no-merges",
        "--name-status",
        "-z",
        "-M",
        "--no-color",
        "--format=%x1e%H",
        requestedSha,
      ],
      "Read commit file changes",
      64 * 1024 * 1024,
    );
    const nameStatusBySha = parseNameStatusLog(nameStatusResult.stdout);

    const orderResult = await git(
      ["rev-list", "--reverse", "--topo-order", "--max-count=10000", requestedSha],
      "Read topological commit order",
      8 * 1024 * 1024,
    );
    const topologicalOrder = new Map<string, number>();
    const orderedShas = orderResult.stdout
      .toString("utf8")
      .split("\n")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[0-9a-f]{40}$/.test(value));
    for (let index = 0; index < orderedShas.length; index += 1) {
      topologicalOrder.set(orderedShas[index], index);
    }

    const treeResult = await git(
      ["ls-tree", "-r", "--name-only", "-z", "--full-tree", requestedSha],
      "List files at exact SHA",
      64 * 1024 * 1024,
    );
    const treePaths = treeResult.stdout
      .toString("utf8")
      .split("\0")
      .filter((value) => value.length > 0);
    let filesAtHead = 0;
    const currentFiles: string[] = [];
    for (const rawPath of treePaths) {
      let normalized: string;
      try {
        normalized = normalizeRepoPath(rawPath);
      } catch {
        continue;
      }
      filesAtHead += 1;
      if (currentFiles.length < maxFiles) {
        currentFiles.push(normalized);
      }
    }
    const filesTruncated = filesAtHead > currentFiles.length;
    const currentFileSet = new Set(currentFiles);

    const renameResolution = buildRenameResolution(
      metadata,
      nameStatusBySha,
      currentFileSet,
      topologicalOrder,
    );
    const identities = new Map<string, GitIdentity>();
    const authorIdentityForCommit = new Map<string, GitIdentity>();
    const committerIdentityForCommit = new Map<string, GitIdentity>();

    const getAuthorIdentity = (commit: ParsedCommitMetadata): GitIdentity => {
      const existing = authorIdentityForCommit.get(commit.sha);
      if (existing !== undefined) {
        return existing;
      }
      const key = gitContributorKey({
        name: commit.canonicalAuthorName,
        email: commit.canonicalAuthorEmail,
      });
      const mailmapped =
        commit.rawAuthorName !== commit.canonicalAuthorName ||
        normalizeIdentityEmail(commit.rawAuthorEmail) !==
          normalizeIdentityEmail(commit.canonicalAuthorEmail);
      let identity = identities.get(key);
      if (identity === undefined) {
        identity = {
          key,
          name: commit.canonicalAuthorName,
          email: commit.canonicalAuthorEmail,
          rawNames: [],
          rawEmails: [],
          mailmapped: false,
        };
        identities.set(key, identity);
      }
      if (!identity.rawNames.includes(commit.rawAuthorName) && commit.rawAuthorName.length > 0) {
        identity.rawNames.push(commit.rawAuthorName);
      }
      if (!identity.rawEmails.includes(commit.rawAuthorEmail) && commit.rawAuthorEmail.length > 0) {
        identity.rawEmails.push(commit.rawAuthorEmail);
      }
      identity.mailmapped = identity.mailmapped || mailmapped;
      authorIdentityForCommit.set(commit.sha, identity);
      return identity;
    };

    const getCommitterIdentity = (commit: ParsedCommitMetadata): GitIdentity => {
      const existing = committerIdentityForCommit.get(commit.sha);
      if (existing !== undefined) {
        return existing;
      }
      const identity: GitIdentity = {
        key: gitContributorKey({
          name: commit.committerName,
          email: commit.committerEmail,
        }),
        name: commit.committerName,
        email: commit.committerEmail,
        rawNames: [commit.committerName],
        rawEmails: [commit.committerEmail],
        mailmapped: false,
      };
      committerIdentityForCommit.set(commit.sha, identity);
      return identity;
    };

    const commits: GitCommitRecord[] = [];
    let deletedFilesExcluded = 0;
    let unresolvedNonDeleted = 0;
    for (const commit of metadata) {
      const parsedChanges = nameStatusBySha.get(commit.sha) ?? [];
      const changes = parsedChanges.map((change) => {
        const currentPath =
          change.status === "deleted"
            ? null
            : renameResolution.resolve(change.path);
        if (change.status === "deleted") {
          deletedFilesExcluded += 1;
        } else if (currentPath === null) {
          unresolvedNonDeleted += 1;
        }
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
      });
      commits.push({
        sha: commit.sha,
        parents: commit.parents,
        author: getAuthorIdentity(commit),
        committer: getCommitterIdentity(commit),
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        message: commit.message,
        subject: commit.subject,
        changes,
        isMerge: commit.parents.length > 1,
      });
    }

    const contributorRows = buildContributorRows(commits);
    const possibleAliasGroups = buildAliasGroups(
      [...identities.values()].filter((identity) => identity.email.length > 0),
    );
    const window = computeWindow(commits);
    const warnings: string[] = [];
    if (shallow) {
      warnings.push(
        "The checkout is shallow; contributor and co-change counts cover only the fetched history.",
      );
    }
    if (maxCommitsReached) {
      warnings.push(
        `History analysis stopped at the configured ${maxCommits}-commit limit; older commits were not observed.`,
      );
    }
    if (shallow || maxCommitsReached) {
      warnings.push(
        "Per-file author counts describe only the indexed history and must not be presented as all-time ownership.",
      );
    }
    if (filesTruncated) {
      warnings.push(
        `File listing stopped at the configured ${maxFiles}-file limit; ${filesAtHead - currentFiles.length} file(s) were not analysed.`,
      );
    }
    if (renameResolution.conflicts > 0) {
      warnings.push(
        `${renameResolution.conflicts} path(s) had ambiguous rename history and were not projected to the current path.`,
      );
    }
    if (unresolvedNonDeleted > 0) {
      warnings.push(
        `${unresolvedNonDeleted} change record(s) referred to paths no longer present at the indexed SHA and were excluded from current-file ownership.`,
      );
    }
    if (possibleAliasGroups.length > 0) {
      warnings.push(
        `${possibleAliasGroups.length} display-name group(s) contain multiple email identities; they were not merged.`,
      );
    }
    if (commits.length === 0) {
      warnings.push("No commits were available in the observed history window.");
    }

    const coverage: GitHistoryCoverage = {
      requestedSha,
      resolvedSha,
      shallow,
      historyDepthRequested,
      commitsAnalyzed: commits.length,
      commitsTruncated: shallow || maxCommitsReached,
      maxCommitsReached,
      filesAtHead,
      filesTruncated,
      renamesObserved: renameResolution.renamesObserved,
      renameConflicts: renameResolution.conflicts,
      deletedFilesExcluded,
      mailmapPresent,
      window,
      warnings,
    };

    return {
      coverage,
      commits,
      contributors: [...identities.values()].sort(
        (left, right) =>
          left.name.localeCompare(right.name) || left.email.localeCompare(right.email),
      ),
      fileContributions: contributorRows,
      currentFiles,
      possibleAliasGroups,
    };
  } catch (error) {
    if (error instanceof HistoryError) {
      throw error;
    }
    throw new HistoryError("GIT_FAILED", `Git history analysis failed: ${errorMessage(error)}`, {
      recoverable: true,
      cause: error,
    });
  } finally {
    if (tempHome !== null) {
      fs.rmSync(tempHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
}

export interface RenameResolution {
  resolve(path: string): string | null;
  renamesObserved: number;
  conflicts: number;
  ambiguousPaths: string[];
}

export function buildRenameResolution(
  metadata: ParsedCommitMetadata[],
  nameStatusBySha: Map<string, ParsedNameStatus[]>,
  currentFiles: Set<string>,
  topologicalOrder: Map<string, number> = new Map(),
): RenameResolution {
  const chronological = [...metadata].sort((left, right) => {
    const leftOrder = topologicalOrder.get(left.sha);
    const rightOrder = topologicalOrder.get(right.sha);
    if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.committedAt.localeCompare(right.committedAt);
  });
  const edges = new Map<string, string>();
  const ambiguous = new Set<string>();
  const disappeared = new Set<string>();
  let renamesObserved = 0;

  for (const commit of chronological) {
    const changes = nameStatusBySha.get(commit.sha) ?? [];
    for (const change of changes) {
      if (change.status === "added") {
        if (disappeared.has(change.path)) {
          ambiguous.add(change.path);
        }
        continue;
      }
      if (change.status === "deleted") {
        disappeared.add(change.path);
        continue;
      }
      if (change.status !== "renamed") {
        continue;
      }
      if (change.previousPath === null) {
        continue;
      }
      renamesObserved += 1;
      disappeared.add(change.previousPath);
      const existing = edges.get(change.previousPath);
      if (existing !== undefined && existing !== change.path) {
        ambiguous.add(change.previousPath);
        continue;
      }
      if (edges.has(change.path)) {
        ambiguous.add(change.path);
      }
      edges.set(change.previousPath, change.path);
    }
  }

  const resolve = (input: string): string | null => {
    if (ambiguous.has(input)) {
      return null;
    }
    if (currentFiles.has(input)) {
      return input;
    }
    let current = input;
    const seen = new Set<string>();
    for (let hop = 0; hop < 20; hop += 1) {
      if (seen.has(current)) {
        ambiguous.add(input);
        return null;
      }
      seen.add(current);
      const next = edges.get(current);
      if (next === undefined) {
        return currentFiles.has(current) ? current : null;
      }
      if (ambiguous.has(next)) {
        return null;
      }
      current = next;
      if (currentFiles.has(current)) {
        return current;
      }
    }
    ambiguous.add(input);
    return null;
  };

  return {
    resolve,
    renamesObserved,
    get conflicts() {
      return ambiguous.size;
    },
    get ambiguousPaths() {
      return [...ambiguous].sort();
    },
  };
}

function buildContributorRows(commits: GitCommitRecord[]): FileContributorRow[] {
  const perFile = new Map<string, Map<string, ContributorAccumulator>>();
  for (const commit of commits) {
    if (commit.isMerge) {
      continue;
    }
    const seenPaths = new Set<string>();
    for (const change of commit.changes) {
      if (change.currentPath === null || change.status === "deleted") {
        continue;
      }
      if (seenPaths.has(change.currentPath)) {
        continue;
      }
      seenPaths.add(change.currentPath);
      let contributors = perFile.get(change.currentPath);
      if (contributors === undefined) {
        contributors = new Map<string, ContributorAccumulator>();
        perFile.set(change.currentPath, contributors);
      }
      const key = commit.author.key;
      const accumulator = contributors.get(key) ?? {
        commitShas: new Set<string>(),
        firstTouch: null,
        lastTouch: null,
      };
      accumulator.commitShas.add(commit.sha);
      if (accumulator.firstTouch === null || commit.authoredAt < accumulator.firstTouch) {
        accumulator.firstTouch = commit.authoredAt;
      }
      if (accumulator.lastTouch === null || commit.authoredAt > accumulator.lastTouch) {
        accumulator.lastTouch = commit.authoredAt;
      }
      contributors.set(key, accumulator);
    }
  }

  const rows: FileContributorRow[] = [];
  for (const [filePath, contributors] of perFile) {
    for (const [key, accumulator] of contributors) {
      const identity = findIdentity(commits, key);
      if (identity === null) {
        continue;
      }
      rows.push({
        snapshotId: "",
        path: filePath,
        contributorKey: key,
        contributorName: identity.name,
        contributorEmail: identity.email,
        observedCommits: accumulator.commitShas.size,
        firstTouch: accumulator.firstTouch,
        lastTouch: accumulator.lastTouch,
        commitShas: [...accumulator.commitShas],
      });
    }
  }
  rows.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      right.observedCommits - left.observedCommits ||
      left.contributorKey.localeCompare(right.contributorKey),
  );
  return rows;
}

function findIdentity(commits: GitCommitRecord[], key: string): GitIdentity | null {
  for (const commit of commits) {
    if (commit.author.key === key) {
      return commit.author;
    }
  }
  return null;
}

function buildAliasGroups(identities: GitIdentity[]): Array<{
  normalizedName: string;
  emails: string[];
}> {
  const groups = new Map<string, Set<string>>();
  for (const identity of identities) {
    const name = normalizeIdentityName(identity.name);
    if (name.length === 0) {
      continue;
    }
    const emails = groups.get(name) ?? new Set<string>();
    const email = normalizeIdentityEmail(identity.email);
    if (email.length > 0) {
      emails.add(email);
    }
    groups.set(name, emails);
  }
  return [...groups.entries()]
    .filter(([, emails]) => emails.size > 1)
    .map(([normalizedName, emails]) => ({
      normalizedName,
      emails: [...emails].sort(),
    }))
    .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName));
}

function computeWindow(commits: GitCommitRecord[]): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  for (const commit of commits) {
    if (from === null || commit.authoredAt < from) {
      from = commit.authoredAt;
    }
    if (to === null || commit.authoredAt > to) {
      to = commit.authoredAt;
    }
  }
  return { from, to };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export async function getCheckoutChangeSet(
  directory: string,
  sha: string,
  options: AnalyzeGitHistoryOptions = {},
): Promise<ParsedNameStatus[]> {
  const repoDir = path.resolve(directory);
  const home = options.home ?? (() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-git-home-"));
    return createGitHome(tempDir);
  })();
  const gitBinary = resolveGitBinary(options.gitBinary);
  const timeoutMs = options.timeoutMs ?? 30_000;
  try {
    const result = await runGitOrThrow(
      [
        "log",
        "-1",
        "--name-status",
        "-z",
        "-M",
        "--no-color",
        "--format=%x1e%H",
        sha,
      ],
      {
        cwd: repoDir,
        home: home.home,
        configFile: home.configFile,
        gitBinary,
        timeoutMs,
        signal: options.signal,
        maxStdoutBytes: 16 * 1024 * 1024,
      },
      "Read commit change set",
    );
    const parsed = parseNameStatusLog(result.stdout);
    return parsed.get(sha.toLowerCase()) ?? [];
  } finally {
    if (options.home === undefined) {
      fs.rmSync(path.dirname(home.home), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
}

export function controlledGitEnvForTests(home: string, configFile: string): NodeJS.ProcessEnv {
  return createControlledGitEnv(home, configFile);
}

export async function runGitForTests(
  args: string[],
  directory: string,
  home: { home: string; configFile: string },
): Promise<{ exitCode: number | null; stdout: Buffer; stderr: Buffer }> {
  return await runGit(args, {
    cwd: directory,
    home: home.home,
    configFile: home.configFile,
    timeoutMs: 30_000,
  });
}
