import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GitFileChange } from "../../core/history/src/types.ts";
import { HistoryError, errorMessage } from "../../core/history/src/errors.ts";
import {
  contentSha256,
  isBinaryPath,
  normalizeRepoPath,
  resolveWithinRepo,
} from "../../core/history/src/paths.ts";
import { assertFullSha, parseGithubRemote, type GithubRemote } from "./remote.ts";
import {
  createGitHome,
  gitCommandFailure,
  runGit,
  runGitOrThrow,
} from "./process.ts";
import { analyzeGitHistory, getCheckoutChangeSet } from "./history.ts";
import { parseNameStatusLog } from "./logParser.ts";

export interface CheckoutOptions {
  remoteUrl: string;
  sha: string;
  historyDepth?: number;
  maxFiles?: number;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  gitBinary?: string;
  tempRoot?: string;
  /** Trusted PR ref used only when the exact head is not directly fetchable. */
  fetchRef?: string;
}

export interface RepoFileInfo {
  path: string;
  mode: string;
  blobSha: string;
  size: number;
}

export interface CheckoutCommit {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  message: string;
}

export interface CheckoutHandle {
  readonly remote: GithubRemote;
  readonly sha: string;
  readonly directory: string;
  readonly readOnly: true;
  listFiles(): Promise<RepoFileInfo[]>;
  readFile(repoPath: string, maxBytes?: number): Promise<string>;
  getChangeSet(sha: string): Promise<GitFileChange[]>;
  getCommit(sha: string): Promise<CheckoutCommit>;
  getRenameMap(): Promise<Map<string, string>>;
  dispose(): Promise<void>;
}

const DEFAULT_HISTORY_DEPTH = 100;
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const WORKSPACE_PREFIX = "domino-history-";

export async function checkoutRepository(options: CheckoutOptions): Promise<CheckoutHandle> {
  if (options.fetchRef && !/^refs\/pull\/[1-9]\d{0,9}\/head$/.test(options.fetchRef)) throw new HistoryError("INVALID_REQUEST", "Unsupported checkout ref");
  const remote = parseGithubRemote(options.remoteUrl);
  const sha = assertFullSha(options.sha);
  const historyDepth = clampInt(options.historyDepth ?? DEFAULT_HISTORY_DEPTH, 1, 5_000);
  const maxFiles = clampInt(options.maxFiles ?? DEFAULT_MAX_FILES, 1, 100_000);
  const maxBytes = clampInt(options.maxBytes ?? DEFAULT_MAX_BYTES, 1, 2 * 1024 * 1024 * 1024);
  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 900_000);
  const deadline = Date.now() + timeoutMs;
  const tempRoot = path.resolve(options.tempRoot ?? os.tmpdir());
  fs.mkdirSync(tempRoot, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(tempRoot, WORKSPACE_PREFIX));
  const repoDir = path.join(workspace, "repo");
  const home = createGitHome(workspace);
  fs.mkdirSync(repoDir, { recursive: true });
  const gitBinary = options.gitBinary;
  let disposed = false;

  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) {
      throw new HistoryError("CHECKOUT_TIMEOUT", "Git checkout exceeded its time budget", {
        recoverable: true,
      });
    }
    return value;
  };

  const git = async (args: string[], context: string, maxStdoutBytes?: number) => {
    return await runGitOrThrow(
      args,
      {
        cwd: repoDir,
        home: home.home,
        configFile: home.configFile,
        timeoutMs: remaining(),
        signal: options.signal,
        gitBinary,
        maxStdoutBytes,
      },
      context,
    );
  };

  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const resolvedWorkspace = path.resolve(workspace);
    const resolvedRoot = path.resolve(tempRoot);
    const relative = path.relative(resolvedRoot, resolvedWorkspace);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !path.basename(resolvedWorkspace).startsWith(WORKSPACE_PREFIX)
    ) {
      throw new HistoryError("INVALID_PATH", "Refusing to clean a checkout outside the owned temp root");
    }
    restoreWritable(workspace);
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  try {
    await git(["init", "--quiet", "--initial-branch=domino-checkout"], "Initialise checkout");
    await git(["remote", "add", "origin", remote.cloneUrl], "Register origin");
    const fetchArgs = [
      "-c",
      "protocol.version=2",
      "-c",
      "http.lowSpeedLimit=1000",
      "-c",
      "http.lowSpeedTime=30",
      "-c",
      "fetch.fsckObjects=true",
      "-c",
      "transfer.fsckObjects=true",
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      `--depth=${historyDepth}`,
    ];
    const exactFetch = await runGit(
      [...fetchArgs, "origin", sha],
      {
        cwd: repoDir,
        home: home.home,
        configFile: home.configFile,
        timeoutMs: remaining(),
        signal: options.signal,
        gitBinary,
        maxStdoutBytes: 8 * 1024 * 1024,
        maxStderrBytes: 2 * 1024 * 1024,
      },
    );
    if (
      exactFetch.timedOut ||
      exactFetch.aborted ||
      exactFetch.outputLimitExceeded ||
      exactFetch.exitCode !== 0
    ) {
      if (exactFetch.timedOut || exactFetch.aborted || exactFetch.outputLimitExceeded) {
        throw gitCommandFailure(exactFetch, "Fetch exact SHA");
      }
      const fallback = await runGit(
        [...fetchArgs, "origin", options.fetchRef ?? "HEAD"],
        {
          cwd: repoDir,
          home: home.home,
          configFile: home.configFile,
          timeoutMs: remaining(),
          signal: options.signal,
          gitBinary,
          maxStdoutBytes: 8 * 1024 * 1024,
          maxStderrBytes: 2 * 1024 * 1024,
        },
      );
      if (
        fallback.timedOut ||
        fallback.aborted ||
        fallback.outputLimitExceeded ||
        fallback.exitCode !== 0
      ) {
        throw gitCommandFailure(fallback, "Fetch repository head");
      }
    }
    const exists = await runGit(
      ["cat-file", "-e", `${sha}^{commit}`],
      {
        cwd: repoDir,
        home: home.home,
        configFile: home.configFile,
        timeoutMs: remaining(),
        signal: options.signal,
        gitBinary,
        maxStdoutBytes: 1024 * 1024,
        maxStderrBytes: 1024 * 1024,
      },
    );
    if (exists.exitCode !== 0) {
      throw new HistoryError(
        "SHA_NOT_FOUND",
        "The requested exact commit was not available from the public repository",
        {
          recoverable: true,
          details: { sha },
        },
      );
    }
    await git(["checkout", "--quiet", "--detach", sha], "Checkout exact SHA");
    const head = await git(["rev-parse", "HEAD"], "Verify checkout HEAD");
    if (head.stdout.toString("utf8").trim().toLowerCase() !== sha) {
      throw new HistoryError("SHA_NOT_FOUND", "Checkout did not resolve to the requested exact SHA", {
        details: { sha, resolved: head.stdout.toString("utf8").trim() },
      });
    }
    const status = await git(["status", "--porcelain"], "Verify clean checkout", 4 * 1024 * 1024);
    if (status.stdout.toString("utf8").trim().length > 0) {
      throw new HistoryError("GIT_FAILED", "Checkout is not clean after exact-SHA checkout");
    }
    const tree = await git(
      ["ls-tree", "-r", "--name-only", "-z", "--full-tree", sha],
      "Inspect checkout tree",
      64 * 1024 * 1024,
    );
    const paths = tree.stdout
      .toString("utf8")
      .split("\0")
      .filter((value) => value.length > 0);
    if (paths.length > maxFiles) {
      throw new HistoryError(
        "CHECKOUT_TOO_LARGE",
        `Checkout contains ${paths.length} files, exceeding the configured limit`,
        { recoverable: false, details: { maxFiles } },
      );
    }
    let totalBytes = 0;
    for (const rawPath of paths) {
      let normalized: string;
      try {
        normalized = normalizeRepoPath(rawPath);
      } catch {
        continue;
      }
      const absolute = resolveWithinRepo(repoDir, normalized);
      const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
      if (stat === undefined) {
        continue;
      }
      totalBytes += stat.size;
      if (totalBytes > maxBytes) {
        throw new HistoryError(
          "CHECKOUT_TOO_LARGE",
          `Checkout exceeds the configured byte limit`,
          { recoverable: false, details: { maxBytes } },
        );
      }
    }

    await git(["remote", "remove", "origin"], "Remove checkout remote");
    fs.rmSync(path.join(repoDir, ".git", "hooks"), { recursive: true, force: true });
    fs.mkdirSync(path.join(repoDir, ".git", "domino-no-hooks"), { recursive: true });
    await git(["config", "core.hooksPath", ".git/domino-no-hooks"], "Disable repository hooks");
    await git(["config", "core.fsmonitor", "false"], "Disable fsmonitor");
    await git(["config", "gc.auto", "0"], "Disable automatic gc");
    await git(["config", "maintenance.auto", "false"], "Disable automatic maintenance");
    makeReadOnly(repoDir);

    const handle: CheckoutHandle = {
      remote,
      sha,
      directory: repoDir,
      readOnly: true,
      async listFiles(): Promise<RepoFileInfo[]> {
        const result = await runGitOrThrow(
          ["ls-files", "-z", "--stage"],
          {
            cwd: repoDir,
            home: home.home,
            configFile: home.configFile,
            timeoutMs: Math.max(5_000, remaining()),
            signal: options.signal,
            gitBinary,
            maxStdoutBytes: 32 * 1024 * 1024,
          },
          "List checkout files",
        );
        const entries: RepoFileInfo[] = [];
        for (const entry of result.stdout.toString("utf8").split("\0")) {
          if (entry.length === 0) {
            continue;
          }
          const tab = entry.indexOf("\t");
          if (tab < 0) {
            continue;
          }
          const meta = entry.slice(0, tab).trim().split(/\s+/);
          const rawPath = entry.slice(tab + 1);
          if (meta.length < 3) {
            continue;
          }
          let normalized: string;
          try {
            normalized = normalizeRepoPath(rawPath);
          } catch {
            continue;
          }
          const absolute = resolveWithinRepo(repoDir, normalized);
          const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
          entries.push({
            path: normalized,
            mode: meta[0],
            blobSha: meta[1],
            size: stat?.size ?? 0,
          });
          if (entries.length >= maxFiles) {
            break;
          }
        }
        return entries;
      },
      async readFile(repoPath: string, readMaxBytes = 2 * 1024 * 1024): Promise<string> {
        const normalized = normalizeRepoPath(repoPath);
        const absolute = resolveWithinRepo(repoDir, normalized);
        let real: string;
        try {
          real = fs.realpathSync(absolute);
        } catch (error) {
          throw new HistoryError("INVALID_PATH", `File does not exist: ${normalized}`, {
            cause: error,
          });
        }
        const rootReal = fs.realpathSync(repoDir);
        const relative = path.relative(rootReal, real);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new HistoryError("INVALID_PATH", "Symlink resolves outside the checkout");
        }
        const stat = fs.lstatSync(real, { throwIfNoEntry: false });
        if (stat === undefined || !stat.isFile()) {
          throw new HistoryError("INVALID_PATH", `File does not exist: ${normalized}`);
        }
        if (stat.size > readMaxBytes) {
          throw new HistoryError("CHECKOUT_TOO_LARGE", `File exceeds read limit: ${normalized}`, {
            details: { size: stat.size, maxBytes: readMaxBytes },
          });
        }
        const buffer = fs.readFileSync(real);
        if (buffer.includes(0)) {
          throw new HistoryError("INVALID_PATH", `Binary file cannot be read as text: ${normalized}`);
        }
        return buffer.toString("utf8");
      },
      async getChangeSet(targetSha: string): Promise<GitFileChange[]> {
        const normalizedSha = assertFullSha(targetSha);
        const changes = await getCheckoutChangeSet(repoDir, normalizedSha, {
          home,
          gitBinary,
          timeoutMs: Math.max(5_000, remaining()),
          signal: options.signal,
        });
        return changes.map((change) => ({
          status: change.status,
          path: change.path,
          currentPath: change.status === "deleted" ? null : change.path,
          previousPath: change.previousPath,
          similarity: change.similarity,
          isBinary: isBinaryPath(change.path),
          blobSha: null,
          size: null,
        }));
      },
      async getCommit(targetSha: string): Promise<CheckoutCommit> {
        const normalizedSha = assertFullSha(targetSha);
        const result = await runGitOrThrow(
          [
            "show",
            "-s",
            "--no-color",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%B",
            normalizedSha,
          ],
          {
            cwd: repoDir,
            home: home.home,
            configFile: home.configFile,
            timeoutMs: Math.max(5_000, remaining()),
            signal: options.signal,
            gitBinary,
            maxStdoutBytes: 8 * 1024 * 1024,
          },
          "Read commit",
        );
        const fields = result.stdout.toString("utf8").split("\x1f");
        if (fields.length < 9) {
          throw new HistoryError("GIT_FAILED", "Unexpected git show output");
        }
        return {
          sha: fields[0].trim(),
          parents: fields[1].trim().split(" ").filter((value) => value.length > 0),
          authorName: fields[2].trim(),
          authorEmail: fields[3].trim(),
          authoredAt: fields[4].trim(),
          committerName: fields[5].trim(),
          committerEmail: fields[6].trim(),
          committedAt: fields[7].trim(),
          message: fields.slice(8).join("\x1f").trim(),
        };
      },
      async getRenameMap(): Promise<Map<string, string>> {
        const analysis = await analyzeGitHistory(repoDir, {
          sha,
          maxCommits: historyDepth,
          historyDepth,
          maxFiles,
          timeoutMs: Math.max(5_000, remaining()),
          signal: options.signal,
          gitBinary,
          home,
        });
        const map = new Map<string, string>();
        for (const commit of analysis.commits) {
          for (const change of commit.changes) {
            if (change.currentPath === null) {
              continue;
            }
            map.set(change.path, change.currentPath);
            if (change.previousPath !== null) {
              map.set(change.previousPath, change.currentPath);
            }
          }
        }
        return map;
      },
      async dispose(): Promise<void> {
        await dispose();
      },
    };
    return handle;
  } catch (error) {
    try {
      await dispose();
    } catch {
      // Preserve the original checkout error.
    }
    if (error instanceof HistoryError) {
      throw error;
    }
    throw new HistoryError("GIT_FAILED", `Git checkout failed: ${errorMessage(error)}`, {
      recoverable: true,
      cause: error,
    });
  }
}

export async function cleanupCheckout(handle: CheckoutHandle): Promise<void> {
  await handle.dispose();
}

function makeReadOnly(root: string): void {
  const gitDir = path.join(root, ".git");
  const walk = (current: string) => {
    if (path.resolve(current) === path.resolve(gitDir)) {
      return;
    }
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined || stat.isSymbolicLink()) {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      fs.chmodSync(current, 0o555);
      return;
    }
    fs.chmodSync(current, 0o444);
  };
  walk(root);
}

function restoreWritable(root: string): void {
  const walk = (current: string) => {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined || stat.isSymbolicLink()) {
      return;
    }
    if (stat.isDirectory()) {
      try {
        fs.chmodSync(current, 0o755);
      } catch {
        // Best effort before removal.
      }
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }
    try {
      fs.chmodSync(current, 0o644);
    } catch {
      // Best effort before removal.
    }
  };
  walk(root);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function checkoutContentSha(handle: CheckoutHandle, repoPath: string): Promise<string> {
  return handle.readFile(repoPath).then((content) => contentSha256(content));
}

export { parseNameStatusLog };
