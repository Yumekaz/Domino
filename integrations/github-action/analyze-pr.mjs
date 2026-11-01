import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  ANALYZER_VERSION,
  buildDependencyCruiserConfig,
  hashAnalyzerConfiguration,
  isBinaryFile,
  isCodeFile,
  normalizeRepoRelativePath,
} from "../../packages/dependency-adapter/src/index.ts";
import { analyzeCheckout } from "../../packages/dependency-adapter/src/runner.ts";
import { computeStructuralImpact } from "../../packages/core/impact/src/impact.ts";
import { toContractImpact } from "../../packages/core/impact/src/contracts.ts";

const FULL_SHA = /^[0-9a-f]{40}$/;
const EVENTS = new Set(["opened", "reopened", "synchronize"]);
const STATUSES = new Set([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);
const MAX_CHANGED_FILES = 300;
const MAX_PAGES = 3;
const MAX_DEPTH = 3;

export class PrImpactError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrImpactError";
    this.code = code;
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new PrImpactError("INVALID_INPUT", `${label} is required.`);
  }
  return value.trim();
}

export function validatePullRequestEvent(input) {
  const event = input.event;
  if (event !== "pull_request") {
    throw new PrImpactError("INVALID_EVENT", "Only pull_request events are accepted.");
  }
  const repository = requireString(input.repository, "repository");
  const repositoryParts = repository.split("/");
  if (
    repositoryParts.length !== 2 ||
    repositoryParts.some(
      (part) =>
        !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === ".." || part.startsWith("."),
    )
  ) {
    throw new PrImpactError("INVALID_INPUT", "The repository identity is invalid.");
  }
  const baseSha = requireString(input.baseSha, "base SHA");
  const headSha = requireString(input.headSha, "head SHA");
  if (!FULL_SHA.test(baseSha) || !FULL_SHA.test(headSha)) {
    throw new PrImpactError("INVALID_INPUT", "Base and head revisions must be full 40-character SHAs.");
  }
  if (!Number.isInteger(input.prNumber) || input.prNumber < 1) {
    throw new PrImpactError("INVALID_INPUT", "A positive pull request number is required.");
  }
  if (!EVENTS.has(input.action)) {
    throw new PrImpactError("INVALID_EVENT", "Only opened, reopened and synchronize actions are accepted.");
  }
  return { repository, baseSha, headSha, prNumber: input.prNumber, action: input.action };
}

export function parseChangedFileRecords(records) {
  if (!Array.isArray(records)) {
    throw new PrImpactError("INVALID_GITHUB_RESPONSE", "The changed-files response must be an array.");
  }
  const files = [];
  const renames = {};
  const warnings = [];
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record.filename !== "string") {
      throw new PrImpactError("INVALID_GITHUB_RESPONSE", "A changed-file record is missing its filename.");
    }
    const filename = normalizeRepoRelativePath(record.filename);
    if (!filename) {
      throw new PrImpactError("UNSAFE_PATH", "The changed-file response contains an unsafe path.");
    }
    if (!STATUSES.has(record.status)) {
      warnings.push(`Ignored an unknown GitHub file status for ${filename}.`);
      continue;
    }
    if (seen.has(filename)) continue;
    seen.add(filename);
    const previous = record.previous_filename
      ? normalizeRepoRelativePath(record.previous_filename)
      : null;
    if (record.previous_filename && !previous) {
      throw new PrImpactError("UNSAFE_PATH", "A renamed file contains an unsafe previous path.");
    }
    if (record.status === "renamed" && previous) renames[previous] = filename;
    files.push({ filename, previousFilename: previous, status: record.status });
  }
  if (files.length > MAX_CHANGED_FILES) {
    throw new PrImpactError(
      "CHANGED_FILES_LIMIT",
      `The pull request changes more than ${MAX_CHANGED_FILES} files; narrow the check.`,
    );
  }
  return { files, renames, warnings };
}

export async function fetchChangedFiles(input) {
  const token = requireString(input.token, "GitHub token");
  const apiUrl = requireString(input.apiUrl, "GitHub API URL");
  let parsedApi;
  try {
    parsedApi = new URL(apiUrl);
  } catch {
    throw new PrImpactError("INVALID_INPUT", "The GitHub API URL is invalid.");
  }
  if (parsedApi.protocol !== "https:") {
    throw new PrImpactError("INVALID_INPUT", "The GitHub API URL must use HTTPS.");
  }
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(
      `/repos/${input.repository}/pulls/${input.prNumber}/files?per_page=100&page=${page}`,
      parsedApi,
    );
    const response = await input.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "domino-pr-impact",
      },
    });
    if (!response.ok) {
      throw new PrImpactError(
        "GITHUB_REQUEST_FAILED",
        `GitHub changed-file lookup failed with HTTP ${response.status}.`,
      );
    }
    const body = await response.json();
    if (!Array.isArray(body)) {
      throw new PrImpactError("INVALID_GITHUB_RESPONSE", "GitHub returned an invalid changed-file list.");
    }
    all.push(...body);
    if (body.length < 100) break;
    if (page === MAX_PAGES && body.length === 100) {
      throw new PrImpactError(
        "CHANGED_FILES_LIMIT",
        `The pull request changes more than ${MAX_PAGES * 100} files; narrow the check.`,
      );
    }
  }
  return parseChangedFileRecords(all);
}

function codePoint(value) {
  return String(value).replace(/`/g, "'").replace(/\r?\n/g, " ");
}

export function renderSummary(input) {
  const lines = [];
  lines.push("# Domino PR impact check", "");
  lines.push(
    "This summary is generated from structural imports at the exact PR head revision. It is a read-only check; no target repository install, build, script or hook was executed.",
    "",
  );
  lines.push("| Field | Value |", "| --- | --- |");
  lines.push(`| Repository | ${codePoint(input.repository)} |`);
  lines.push(`| Pull request | #${input.prNumber} |`);
  lines.push(`| Event | ${codePoint(input.action)} |`);
  lines.push(`| Base revision | \`${input.baseSha}\` |`);
  lines.push(`| Head revision | \`${input.headSha}\` |`);
  lines.push(`| Analyzer | dependency-cruiser ${codePoint(input.analyzerVersion)} |`);
  lines.push(`| Config hash | \`${input.configHash}\` |`);
  if (input.analyzerSummary) {
    const summary = input.analyzerSummary;
    lines.push(
      `| Analyzer coverage | ${summary.modulesCruised} cruised / ${summary.modules} modules / ${summary.structuralImports} structural / ${summary.unresolvedImports} unresolved / ${summary.excludedModules} excluded |`,
    );
  }
  lines.push(`| Changed files | ${input.changedFiles.length} |`);
  lines.push("");
  lines.push("## Changed files", "");
  if (input.changedFiles.length === 0) {
    lines.push("No changed files were returned.", "");
  } else {
    for (const file of input.changedFiles.slice(0, 50))
      lines.push(`- \`${codePoint(file)}\``);
    if (input.changedFiles.length > 50)
      lines.push(`- … ${input.changedFiles.length - 50} more changed file(s) not displayed.`);
    lines.push("");
  }
  if (input.binaryFiles.length > 0) {
    lines.push(
      `Binary or non-code changed files are not structurally analyzed: ${input.binaryFiles
        .map((file) => `\`${codePoint(file)}\``)
        .join(", ")}.`,
      "",
    );
  }
  lines.push("## Static reverse impact", "");
  if (!input.result.affected.length) {
    lines.push(
      "No static reverse dependents were returned for the analyzed code root. This does not establish that runtime behavior is unaffected.",
      "",
    );
  } else {
    for (const affected of input.result.affected.slice(0, 40)) {
      lines.push(
        `- **${codePoint(affected.file)}** — ${affected.depth === 1 ? "direct" : `${affected.depth}-hop transitive`} possible impact${affected.viaDynamicImport ? " · path includes a dynamic import" : ""}`,
      );
      lines.push(`  - Path: \`${codePoint(affected.path.join(" → "))}\``);
      const evidence = affected.evidence
        .map(
          (hop) =>
            `\`${codePoint(hop.importer)} → ${codePoint(hop.imported)}\` (${codePoint(hop.specifier)}${hop.dynamic ? ", dynamic" : ""})`,
        )
        .join("; ");
      if (evidence) lines.push(`  - Evidence: ${evidence}`);
    }
    if (input.result.affected.length > 40)
      lines.push(`- … ${input.result.affected.length - 40} more affected file(s) not displayed.`);
    lines.push("");
  }
  lines.push("## Historical co-change", "");
  lines.push(
    "Not available in this read-only workflow. Co-change requires the indexed historical dataset and is never inferred from import paths.",
    "",
  );
  if (input.domino?.runUrl) {
    lines.push("## Domino workspace", "");
    lines.push(`[Open this automatic run in Domino](${input.domino.runUrl})`, "");
  } else if (input.domino?.warning) {
    lines.push("## Domino workspace", "");
    lines.push(`The workspace was not updated: ${codePoint(input.domino.warning)}`, "");
  }
  lines.push("## Warnings and limitations", "");
  const warnings = [
    ...input.workflowWarnings,
    ...input.result.warnings,
    "Static imports describe possible impact, not guaranteed runtime failure.",
    "Dynamic imports, unresolved external modules, runtime dependency injection and generated code remain limitations.",
    "Fork PRs receive a read-only token; the workflow never checks out untrusted code with privileged permissions and never runs repository code.",
    "This workflow writes a GitHub Actions step summary and, when a Domino API is configured, ingests the run and its Actions URL into Domino. It does not post a PR comment.",
  ];
  for (const warning of [...new Set(warnings)]) lines.push(`- ${codePoint(warning)}`);
  lines.push("");
  lines.push(
    "_Generated by the trusted Domino pull_request workflow from the base-revision analyzer checkout. Target files are treated as data._",
  );
  return lines.join("\n");
}

function autoDetectTsConfig(targetRoot, targetPath) {
  for (const candidate of [
    join(targetRoot, targetPath, "tsconfig.json"),
    join(targetRoot, "tsconfig.json"),
    join(targetRoot, "apps", "web", "tsconfig.json"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveAnalyzerScript(analyzerRoot) {
  const candidates = [
    join(
      analyzerRoot,
      "packages/dependency-adapter/node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
    ),
    join(analyzerRoot, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs"),
  ];
  for (const scriptPath of candidates) {
    if (!existsSync(scriptPath)) continue;
    const packageJsonPath = join(dirname(dirname(scriptPath)), "package.json");
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (packageJson.version !== ANALYZER_VERSION) {
        throw new PrImpactError(
          "ANALYZER_VERSION_MISMATCH",
          `The installed dependency-cruiser version does not match the pinned ${ANALYZER_VERSION}.`,
        );
      }
    } catch (error) {
      if (error instanceof PrImpactError) throw error;
      throw new PrImpactError(
        "ANALYZER_NOT_FOUND",
        "The dependency-cruiser package metadata could not be read.",
      );
    }
    return scriptPath;
  }
  throw new PrImpactError(
    "ANALYZER_NOT_FOUND",
    "The pinned dependency-cruiser analyzer is not installed.",
  );
}

export async function ingestDomino(input, fetchImpl = fetch) {
  const apiUrl = (process.env.DOMINO_API_URL ?? "").replace(/\/+$/, "");
  if (!apiUrl)
    return {
      warning:
        "DOMINO_API_URL is not configured; this run remains in the GitHub summary only.",
    };
  const token = process.env.DOMINO_API_TOKEN ?? "";
  if (!token)
    return {
      warning:
        "DOMINO_API_TOKEN is not configured; automatic Domino ingestion was skipped.",
    };
  if (!input.actionsUrl)
    return {
      warning:
        "The GitHub Actions run URL is unavailable; automatic Domino ingestion was skipped.",
    };
  let result;
  try {
    result = toContractImpact(input.result);
  } catch {
    return {
      warning:
        "The impact result could not be mapped to the shared contract; automatic Domino ingestion was skipped.",
    };
  }
  try {
    const response = await fetchImpl(`${apiUrl}/api/v1/integrations/pr-analysis`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        repositoryUrl: `https://github.com/${input.repository}`,
        prNumber: input.prNumber,
        baseSha: input.baseSha,
        headSha: input.headSha,
        event: input.action,
        actionsUrl: input.actionsUrl,
        changedFiles: input.changedFiles,
        result,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* handled below */
    }
    if (!response.ok) {
      const code =
        body && typeof body.code === "string" ? body.code : undefined;
      return {
        warning: `Domino ingestion failed (${response.status}${code ? ` ${code}` : ""}). The GitHub summary remains authoritative.`,
      };
    }
    if (
      !body ||
      typeof body.repoId !== "string" ||
      typeof body.runId !== "string"
    )
      return {
        warning:
          "Domino ingestion returned an invalid response; no workspace link is available.",
      };
    const webUrl = (process.env.DOMINO_WEB_URL ?? "").replace(/\/+$/, "");
    if (!webUrl)
      return {
        warning: `Domino run ${body.runId} was ingested; set DOMINO_WEB_URL for a workspace link.`,
      };
    return {
      runUrl: `${webUrl}/app/repositories/${encodeURIComponent(body.repoId)}/pr?run=${encodeURIComponent(body.runId)}`,
    };
  } catch {
    return {
      warning:
        "Domino ingestion failed; the GitHub summary remains authoritative.",
    };
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  let tempConfig;
  try {
    const targetRoot = resolve(requireString(process.env.DOMINO_TARGET_ROOT, "DOMINO_TARGET_ROOT"));
    const targetPath = process.env.DOMINO_TARGET_PATH?.trim() || ".";
    const analyzerRoot = resolve(requireString(process.env.DOMINO_ANALYZER_ROOT, "DOMINO_ANALYZER_ROOT"));
    const eventPath = requireString(process.env.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH");
    const payload = JSON.parse(readFileSync(eventPath, "utf8"));
    const validated = validatePullRequestEvent({
      event: process.env.GITHUB_EVENT_NAME,
      action: payload.action,
      repository: payload.repository?.full_name,
      prNumber: payload.pull_request?.number,
      baseSha: payload.pull_request?.base?.sha,
      headSha: payload.pull_request?.head?.sha,
    });

    let changed;
    if (process.env.DOMINO_CHANGED_FILES_FILE) {
      const local = JSON.parse(readFileSync(process.env.DOMINO_CHANGED_FILES_FILE, "utf8"));
      changed = parseChangedFileRecords(local);
    } else {
      changed = await fetchChangedFiles({
        token: process.env.GITHUB_TOKEN,
        apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
        repository: validated.repository,
        prNumber: validated.prNumber,
        fetchImpl: fetch,
      });
    }

    const codeFiles = changed.files
      .map((file) => file.filename)
      .filter((file) => isCodeFile(file));
    const binaryFiles = changed.files
      .map((file) => file.filename)
      .filter((file) => isBinaryFile(file));
    const nonCodeFiles = changed.files
      .map((file) => file.filename)
      .filter((file) => !isCodeFile(file) && !isBinaryFile(file));

    const targetDirectory = resolve(targetRoot, targetPath);
    if (!existsSync(targetDirectory)) {
      throw new PrImpactError(
        "TARGET_NOT_FOUND",
        "The configured target directory does not exist in the PR checkout.",
      );
    }
    const tsConfigPath = process.env.DOMINO_TSCONFIG
      ? resolve(targetRoot, process.env.DOMINO_TSCONFIG)
      : autoDetectTsConfig(targetRoot, targetPath);
    console.log(
      `[domino] target=${targetDirectory} entries=${readdirSync(targetDirectory).length} tsconfig=${tsConfigPath ?? "none"}`,
    );
    const config = buildDependencyCruiserConfig(
      tsConfigPath ? { tsConfigPath } : {},
    );
    tempConfig = join(tmpdir(), `domino-pr-${randomUUID()}.json`);
    writeFileSync(tempConfig, JSON.stringify(config), "utf8");
    const configHash = hashAnalyzerConfiguration(ANALYZER_VERSION, config);
    const metadata = {
      repositoryId: validated.repository,
      snapshotSha: validated.headSha,
      analyzer: "dependency-cruiser",
      version: ANALYZER_VERSION,
      configHash,
      analyzedAt: startedAt,
    };
    const scriptPath = resolveAnalyzerScript(analyzerRoot);
    const analysis = await analyzeCheckout({
      scriptPath,
      workingDirectory: targetRoot,
      targetDir: targetPath,
      configPath: tempConfig,
      metadata,
      timeoutMs: 120_000,
      maxBufferBytes: 64 * 1024 * 1024,
    });
    console.log(`[domino] analyzer summary=${JSON.stringify(analysis.summary)}`);
    const workflowWarnings = [
      ...changed.warnings,
      ...(nonCodeFiles.length > 0
        ? [`${nonCodeFiles.length} non-code changed file(s) were not structurally analyzed: ${nonCodeFiles.join(", ")}.`]
        : []),
      ...(tsConfigPath ? [] : ["No target tsconfig was found; path aliases may remain unresolved."]),
    ];
    const result = computeStructuralImpact(
      {
        snapshotSha: validated.headSha,
        changedFiles: changed.files.map((file) => file.filename),
        renameMap: changed.renames,
        maxDepth: MAX_DEPTH,
        analyzerGaps: analysis.gaps,
      },
      analysis.imports,
    );
    const runId = process.env.GITHUB_RUN_ID;
    const serverUrl = (
      process.env.GITHUB_SERVER_URL ?? "https://github.com"
    ).replace(/\/+$/, "");
    const actionsUrl =
      runId && /^\d+$/.test(runId)
        ? `${serverUrl}/${validated.repository}/actions/runs/${runId}`
        : undefined;
    const domino = await ingestDomino({
      repository: validated.repository,
      prNumber: validated.prNumber,
      baseSha: validated.baseSha,
      headSha: validated.headSha,
      action: validated.action,
      actionsUrl,
      changedFiles: changed.files.map((file) => file.filename),
      result,
    });
    const summary = renderSummary({
      repository: validated.repository,
      prNumber: validated.prNumber,
      action: validated.action,
      baseSha: validated.baseSha,
      headSha: validated.headSha,
      analyzerVersion: ANALYZER_VERSION,
      configHash,
      changedFiles: changed.files.map((file) => file.filename),
      binaryFiles,
      result,
      workflowWarnings,
      analyzerSummary: analysis.summary,
      domino,
    });
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) writeFileSync(summaryPath, summary + "\n", { flag: "a" });
    console.log(summary);
  } catch (error) {
    const message =
      error instanceof PrImpactError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Unknown failure";
    const summary = [
      "# Domino PR impact check failed",
      "",
      "The check did not produce an impact result. No analysis has been substituted.",
      "",
      `- ${message.replace(/[`\r\n]/g, " ")}`,
      "",
    ].join("\n");
    if (process.env.GITHUB_STEP_SUMMARY)
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n", { flag: "a" });
    console.error(summary);
    process.exitCode = 1;
  } finally {
    if (tempConfig) {
      try {
        unlinkSync(tempConfig);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
