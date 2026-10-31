import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HistoryError } from "../../core/history/src/errors.ts";

export interface GitRunOptions {
  cwd: string;
  home: string;
  configFile: string;
  timeoutMs: number;
  signal?: AbortSignal;
  gitBinary?: string;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  extraEnv?: Record<string, string>;
}

export interface GitRunResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
  durationMs: number;
}

const SAFE_ENV_KEYS = [
  "PATH",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "ComSpec",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
];

export function createControlledGitEnv(
  home: string,
  configFile: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  const parsed = path.parse(home);
  env.HOME = home;
  env.USERPROFILE = home;
  env.HOMEDRIVE = parsed.root.replace(/[\\/]+$/, "");
  env.HOMEPATH = home.slice(parsed.root.length);
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "echo";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = configFile;
  env.GIT_CONFIG_SYSTEM = configFile;
  env.GIT_ALLOW_PROTOCOL = "https";
  env.GIT_LFS_SKIP_SMUDGE = "1";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_PROTOCOL_FROM_USER = "0";
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  env.NO_COLOR = "1";
  env.GIT_CEILING_DIRECTORIES = path.dirname(home);
  for (const [key, value] of Object.entries(extra)) {
    if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY/i.test(key)) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

export function resolveGitBinary(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.DOMINO_GIT_BINARY,
    "git",
    process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : undefined,
    process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\git.exe" : undefined,
    process.platform === "win32" ? undefined : "/usr/bin/git",
    process.platform === "win32" ? undefined : "/usr/local/bin/git",
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "git";
}

async function killProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    try {
      const child = spawn(taskkill, ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
        child.once("error", () => resolve());
      });
    } catch {
      // Best effort: the main process is also signalled below.
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Fall through to the direct kill below.
  }
}

export async function runGit(
  args: readonly string[],
  options: GitRunOptions,
): Promise<GitRunResult> {
  const started = Date.now();
  const binary = resolveGitBinary(options.gitBinary);
  const maxStdoutBytes = options.maxStdoutBytes ?? 32 * 1024 * 1024;
  const maxStderrBytes = options.maxStderrBytes ?? 2 * 1024 * 1024;
  const env = createControlledGitEnv(options.home, options.configFile, options.extraEnv);
  const child = spawn(binary, [...args], {
    cwd: options.cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let aborted = false;
  let outputLimitExceeded = false;
  let settled = false;

  const terminate = (reason: "timeout" | "abort" | "output") => {
    if (reason === "timeout") {
      timedOut = true;
    } else if (reason === "abort") {
      aborted = true;
    } else {
      outputLimitExceeded = true;
    }
    void killProcessTree(child.pid);
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already be gone.
    }
  };

  const timeout = setTimeout(() => terminate("timeout"), Math.max(1, options.timeoutMs));
  const onAbort = () => terminate("abort");
  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  child.stdout.on("data", (chunk: Buffer) => {
    if (stdoutBytes >= maxStdoutBytes) {
      terminate("output");
      return;
    }
    const remaining = maxStdoutBytes - stdoutBytes;
    const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    stdoutChunks.push(slice);
    stdoutBytes += slice.length;
    if (chunk.length > remaining) {
      terminate("output");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderrBytes >= maxStderrBytes) {
      return;
    }
    const remaining = maxStderrBytes - stderrBytes;
    const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    stderrChunks.push(slice);
    stderrBytes += slice.length;
  });

  return await new Promise<GitRunResult>((resolve, reject) => {
    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (options.signal !== undefined) {
        options.signal.removeEventListener("abort", onAbort);
      }
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        timedOut,
        aborted,
        outputLimitExceeded,
        durationMs: Date.now() - started,
      });
    };
    child.once("close", (code) => finish(code));
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (options.signal !== undefined) {
        options.signal.removeEventListener("abort", onAbort);
      }
      reject(
        new HistoryError("GIT_FAILED", `Unable to execute Git (${binary}): ${error.code ?? error.message}`, {
          recoverable: true,
          cause: error,
        }),
      );
    });
  });
}

export function gitCommandFailure(
  result: GitRunResult,
  context: string,
): HistoryError {
  if (result.timedOut) {
    return new HistoryError("CHECKOUT_TIMEOUT", `${context} exceeded its time budget`, {
      recoverable: true,
      details: { durationMs: result.durationMs },
    });
  }
  if (result.aborted) {
    return new HistoryError("COLLECTION_CANCELLED", `${context} was cancelled`, {
      recoverable: true,
    });
  }
  if (result.outputLimitExceeded) {
    return new HistoryError("CHECKOUT_TOO_LARGE", `${context} produced more output than the configured limit`, {
      recoverable: false,
    });
  }
  const stderr = result.stderr.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 2000);
  return new HistoryError("GIT_FAILED", `${context} failed with exit code ${String(result.exitCode)}`, {
    recoverable: true,
    details: { stderr },
  });
}

export async function runGitOrThrow(
  args: readonly string[],
  options: GitRunOptions,
  context: string,
): Promise<GitRunResult> {
  const result = await runGit(args, options);
  if (result.timedOut || result.aborted || result.outputLimitExceeded || result.exitCode !== 0) {
    throw gitCommandFailure(result, context);
  }
  return result;
}

export function createGitHome(root: string): { home: string; configFile: string } {
  const home = path.join(root, "git-home");
  fs.mkdirSync(home, { recursive: true });
  const configFile = path.join(home, ".gitconfig-empty");
  fs.writeFileSync(configFile, "", { encoding: "utf8", mode: 0o600 });
  return { home, configFile };
}
