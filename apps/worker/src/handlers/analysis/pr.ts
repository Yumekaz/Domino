import { createHash } from "node:crypto";
import { stableStringify } from "../../../../../packages/dependency-adapter/src/config.ts";
import { computeAnalysis, type AnalysisDeps } from "./handler.ts";
import {
  AnalysisError,
  type AnalysisRunRecord,
  type AnalysisRunStore,
  type PullRequestAnalysisJob,
  type PullRequestEvent,
} from "./types.ts";

const FULL_SHA = /^[0-9a-f]{40}$/;
const EVENTS: ReadonlySet<PullRequestEvent> = new Set([
  "opened",
  "reopened",
  "synchronize",
]);

export function sanitizeActionsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?\/?$/.test(url.pathname))
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function validateJob(job: PullRequestAnalysisJob): void {
  if (!job.repoId.trim() || !job.snapshotId.trim() || !job.repositoryId.trim()) {
    throw new AnalysisError("INVALID_JOB", "Repository and snapshot identities are required.");
  }
  if (!FULL_SHA.test(job.snapshotSha)) {
    throw new AnalysisError("INVALID_JOB", "The snapshot revision must be a full 40-character SHA.");
  }
  if (!FULL_SHA.test(job.baseSha) || !FULL_SHA.test(job.headSha)) {
    throw new AnalysisError("INVALID_JOB", "Base and head revisions must be full 40-character SHAs.");
  }
  if (job.baseSha === job.headSha) {
    throw new AnalysisError("INVALID_JOB", "Base and head revisions must differ.");
  }
  if (!Number.isInteger(job.prNumber) || job.prNumber < 1) {
    throw new AnalysisError("INVALID_JOB", "A positive pull request number is required.");
  }
  if (!EVENTS.has(job.event)) {
    throw new AnalysisError("INVALID_JOB", "Only opened, reopened and synchronize events are accepted.");
  }
  if (job.checkoutSha && job.checkoutSha !== job.headSha) {
    throw new AnalysisError(
      "SNAPSHOT_MISMATCH",
      "The checkout revision does not match the pull request head.",
    );
  }
}

export function prRunKey(job: PullRequestAnalysisJob): string {
  const diffHash = job.proposedDiff
    ? createHash("sha256").update(job.proposedDiff).digest("hex")
    : null;
  return createHash("sha256")
    .update(
      stableStringify({
        kind: "pull_request",
        repoId: job.repoId,
        snapshotId: job.snapshotId,
        snapshotSha: job.snapshotSha,
        prNumber: job.prNumber,
        baseSha: job.baseSha,
        headSha: job.headSha,
        event: job.event,
        changedFiles: [...(job.changedFiles ?? [])].sort(),
        diffHash,
        maxDepth: job.maxDepth ?? 3,
        renameMap: job.renameMap ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Computes a PR analysis run. A head/snapshot mismatch is persisted as stale with
 * no result; it never analyses the wrong revision. Duplicate events are idempotent.
 */
export async function analyzePullRequest(
  job: PullRequestAnalysisJob,
  deps: AnalysisDeps,
): Promise<AnalysisRunRecord> {
  validateJob(job);
  const idempotencyKey = prRunKey(job);
  const existing = await deps.runs.getByKey(idempotencyKey);
  if (existing) return existing;

  const createdAt = deps.clock.now().toISOString();
  const runId = deps.ids.runId();
  const actionsUrl = sanitizeActionsUrl(job.actionsUrl);

  if (job.snapshotSha !== job.headSha) {
    const warnings = [
      `The active structural snapshot ${job.snapshotSha.slice(0, 8)} does not match the PR head ${job.headSha.slice(0, 8)}. No impact result was substituted; refresh the index or request a new run.`,
    ];
    if (job.actionsUrl && !actionsUrl) warnings.push("The supplied Actions URL was not a valid GitHub run URL and was withheld.");
    const staleRun: AnalysisRunRecord = {
      id: runId,
      repoId: job.repoId,
      snapshotId: job.snapshotId,
      snapshotSha: job.snapshotSha,
      kind: "pull_request",
      status: "completed",
      createdAt,
      stale: true,
      result: null,
      warnings,
      idempotencyKey,
      prNumber: job.prNumber,
      baseSha: job.baseSha,
      headSha: job.headSha,
      event: job.event,
      ...(actionsUrl ? { actionsUrl } : {}),
      ...(job.checkoutSha ? { checkoutSha: job.checkoutSha } : {}),
    };
    return deps.runs.save(staleRun);
  }

  const warnings: string[] = [];
  if (job.actionsUrl && !actionsUrl) {
    warnings.push("The supplied Actions URL was not a valid GitHub run URL and was withheld.");
  }
  const result = await computeAnalysis(job, deps, warnings);
  const run: AnalysisRunRecord = {
    id: runId,
    repoId: job.repoId,
    snapshotId: job.snapshotId,
    snapshotSha: job.snapshotSha,
    kind: "pull_request",
    status: "completed",
    createdAt,
    stale: false,
    result,
    warnings: result.warnings,
    idempotencyKey,
    prNumber: job.prNumber,
    baseSha: job.baseSha,
    headSha: job.headSha,
    event: job.event,
    ...(actionsUrl ? { actionsUrl } : {}),
    ...(job.checkoutSha ? { checkoutSha: job.checkoutSha } : {}),
  };
  return deps.runs.save(run);
}

export async function getAnalysisRun(
  store: AnalysisRunStore,
  repoId: string,
  runId: string,
): Promise<AnalysisRunRecord> {
  const run = await store.get(repoId, runId);
  if (!run || run.repoId !== repoId) {
    throw new AnalysisError("RUN_NOT_FOUND", "The analysis run does not exist for this repository.");
  }
  return run;
}
