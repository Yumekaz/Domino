import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { DependencyAdapterError } from "./errors.ts";
import { normalizeDependencyCruiserOutput, parseDependencyCruiserJson } from "./normalize.ts";
import type { AnalyzerMetadata, NormalizedStructuralAnalysis } from "./types.ts";

export const DEFAULT_ANALYZER_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_ANALYZER_OUTPUT_BYTES = 64 * 1024 * 1024;

export type AnalyzerProcessOptions = {
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
  env: Record<string, string>;
};

export type AnalyzerProcessRunner = (
  file: string,
  args: readonly string[],
  options: AnalyzerProcessOptions,
) => Promise<{ stdout: string; stderr: string }>;

type ExecFileCallback = (
  error: (Error & { code?: string | number; killed?: boolean }) | null,
  stdout: string,
  stderr: string,
) => void;

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>,
  callback: ExecFileCallback,
) => unknown;

const ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
];

/** Only non-secret runtime variables reach the analyzer subprocess. */
export function buildAnalyzerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export function buildDependencyCruiserArgs(input: {
  targetDir: string;
  configPath: string;
}): string[] {
  if (!input.targetDir.trim() || input.targetDir.includes("\0")) {
    throw new DependencyAdapterError("INVALID_ANALYZER_INPUT", "A target directory is required.");
  }
  if (!input.configPath.trim() || input.configPath.includes("\0")) {
    throw new DependencyAdapterError("INVALID_ANALYZER_INPUT", "An analyzer config path is required.");
  }
  const targetDir = resolve(input.targetDir);
  const configPath = resolve(input.configPath);
  return [
    targetDir,
    "--config",
    configPath,
    "--output-type",
    "json",
    "--progress",
    "none",
  ];
}

export function createNodeAnalyzerProcessRunner(
  exec: ExecFileLike = execFile as unknown as ExecFileLike,
): AnalyzerProcessRunner {
  return (file, args, options) =>
    new Promise((resolvePromise, rejectPromise) => {
      exec(
        file,
        [...args],
        {
          cwd: options.cwd,
          timeout: options.timeoutMs,
          maxBuffer: options.maxBufferBytes,
          shell: false,
          windowsHide: true,
          env: options.env,
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed === true || error.code === "ETIMEDOUT") {
              rejectPromise(
                new DependencyAdapterError(
                  "ANALYZER_TIMEOUT",
                  `dependency-cruiser exceeded the ${options.timeoutMs} ms analysis budget.`,
                ),
              );
              return;
            }
            rejectPromise(
              new DependencyAdapterError(
                "ANALYZER_FAILED",
                `dependency-cruiser failed: ${String(stderr).slice(0, 500)}`,
              ),
            );
            return;
          }
          resolvePromise({ stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

export async function analyzeCheckout(input: {
  binaryPath?: string;
  scriptPath?: string;
  workingDirectory: string;
  targetDir: string;
  configPath: string;
  metadata: AnalyzerMetadata;
  timeoutMs?: number;
  maxBufferBytes?: number;
  processRunner?: AnalyzerProcessRunner;
  nodePath?: string;
}): Promise<NormalizedStructuralAnalysis> {
  const hasBinary = typeof input.binaryPath === "string" && input.binaryPath.trim().length > 0;
  const hasScript = typeof input.scriptPath === "string" && input.scriptPath.trim().length > 0;
  if (hasBinary === hasScript) {
    throw new DependencyAdapterError(
      "INVALID_ANALYZER_INPUT",
      "Provide exactly one analyzer binary path or JavaScript entry path.",
    );
  }
  if (!input.workingDirectory.trim() || input.workingDirectory.includes("\0")) {
    throw new DependencyAdapterError(
      "INVALID_ANALYZER_INPUT",
      "A repository working directory is required so paths stay repository-relative.",
    );
  }
  for (const value of [input.binaryPath, input.scriptPath]) {
    if (value !== undefined && (value.includes("\0") || !value.trim())) {
      throw new DependencyAdapterError("INVALID_ANALYZER_INPUT", "An invalid analyzer path was supplied.");
    }
  }
  const workingDirectory = resolve(input.workingDirectory);
  const targetDir = resolve(workingDirectory, input.targetDir);
  const configPath = resolve(workingDirectory, input.configPath);
  const cliArgs = buildDependencyCruiserArgs({ targetDir, configPath });
  const command = hasScript ? resolve(input.nodePath ?? process.execPath) : resolve(input.binaryPath!);
  const commandArgs = hasScript ? [resolve(input.scriptPath!), ...cliArgs] : cliArgs;
  const runner = input.processRunner ?? createNodeAnalyzerProcessRunner();
  const { stdout } = await runner(command, commandArgs, {
    cwd: workingDirectory,
    timeoutMs: input.timeoutMs ?? DEFAULT_ANALYZER_TIMEOUT_MS,
    maxBufferBytes: input.maxBufferBytes ?? DEFAULT_MAX_ANALYZER_OUTPUT_BYTES,
    env: buildAnalyzerEnvironment(),
  });
  return normalizeDependencyCruiserOutput(parseDependencyCruiserJson(stdout), input.metadata);
}
