import {
  analysisInputSchema,
  analysisSchema,
} from "../../../../../packages/contracts/src/index.ts";
import type { z } from "zod";
import { toContractImpact } from "../../../../../packages/core/impact/src/contracts.ts";
import { AnalysisError, type AnalysisRunRecord } from "./types.ts";

type ContractAnalysis = z.infer<typeof analysisSchema>;

function requirePullRequestRun(run: AnalysisRunRecord): asserts run is AnalysisRunRecord & {
  prNumber: number;
  baseSha: string;
  headSha: string;
  event: "opened" | "reopened" | "synchronize";
} {
  if (
    run.kind !== "pull_request" ||
    run.prNumber === undefined ||
    !run.baseSha ||
    !run.headSha ||
    !run.event
  ) {
    throw new AnalysisError(
      "CONTRACT_MISMATCH",
      "Only a pull-request run with exact base/head revisions maps to the shared analysis contract.",
    );
  }
}

/** Maps C's domain run to A's accepted analysis response schema. */
export function toContractAnalysis(run: AnalysisRunRecord): ContractAnalysis {
  requirePullRequestRun(run);
  const parsed = analysisSchema.safeParse({
    id: run.id,
    status: run.status,
    prNumber: run.prNumber,
    baseSha: run.baseSha,
    headSha: run.headSha,
    event: run.event,
    createdAt: run.createdAt,
    stale: run.stale,
    result: run.result ? toContractImpact(run.result) : null,
    warnings: run.warnings,
    ...(run.actionsUrl ? { actionsUrl: run.actionsUrl } : {}),
  });
  if (!parsed.success) {
    throw new AnalysisError(
      "CONTRACT_MISMATCH",
      `The analysis run does not match the shared contract: ${parsed.error.issues[0]?.message ?? "unknown issue"}`,
    );
  }
  return parsed.data;
}

/** Maps C's domain run to A's accepted analysis-run input envelope. */
export function toContractAnalysisInput(run: AnalysisRunRecord) {
  requirePullRequestRun(run);
  const parsed = analysisInputSchema.safeParse({
    prNumber: run.prNumber,
    baseSha: run.baseSha,
    headSha: run.headSha,
    event: run.event,
    stale: run.stale,
    idempotencyKey: run.idempotencyKey,
    ...(run.actionsUrl ? { actionsUrl: run.actionsUrl } : {}),
  });
  if (!parsed.success) {
    throw new AnalysisError(
      "CONTRACT_MISMATCH",
      "The analysis run input does not match the shared contract.",
    );
  }
  return parsed.data;
}
