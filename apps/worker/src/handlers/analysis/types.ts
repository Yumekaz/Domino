import type {
  NormalizedStructuralAnalysis,
  StructuralImport,
} from "../../../../../packages/dependency-adapter/src/types.ts";
import type {
  CoChangeResult,
  ImpactResult,
} from "../../../../../packages/core/impact/src/types.ts";

export type AnalysisRunKind = "impact" | "pull_request";
export type AnalysisRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
export type PullRequestEvent = "opened" | "reopened" | "synchronize";

export type AnalysisRunRecord = {
  id: string;
  repoId: string;
  snapshotId: string;
  snapshotSha: string;
  kind: AnalysisRunKind;
  status: AnalysisRunStatus;
  createdAt: string;
  stale: boolean;
  result: ImpactResult | null;
  warnings: string[];
  idempotencyKey: string;
  prNumber?: number;
  baseSha?: string;
  headSha?: string;
  event?: PullRequestEvent;
  actionsUrl?: string;
  checkoutSha?: string;
};

export type StructuralImportStore = {
  replaceImports(input: {
    repoId: string;
    snapshotId: string;
    snapshotSha: string;
    imports: readonly StructuralImport[];
    analyzer: { version: string; configHash: string };
  }): Promise<{ stored: number }>;
  getImports(input: {
    repoId: string;
    snapshotId: string;
    snapshotSha: string;
  }): Promise<StructuralImport[]>;
};

export type CoChangeReader = {
  getCoChange(input: {
    repoId: string;
    snapshotId: string;
    targetFile: string;
  }): Promise<CoChangeResult>;
};

export type AnalysisRunStore = {
  getByKey(idempotencyKey: string): Promise<AnalysisRunRecord | null>;
  get(repoId: string, runId: string): Promise<AnalysisRunRecord | null>;
  save(run: AnalysisRunRecord): Promise<AnalysisRunRecord>;
};

export type Clock = { now(): Date };
export type IdGenerator = { runId(): string };

export type StructuralAnalyzerPort = {
  analyze(input: {
    repositoryId: string;
    snapshotSha: string;
    checkoutDir: string;
    checkoutSha?: string;
  }): Promise<NormalizedStructuralAnalysis>;
};

export type AnalysisProgress = {
  report(event: {
    phase: "validating" | "analyzing_structure" | "storing_structure" | "traversing" | "persisting";
    message: string;
    warnings: string[];
  }): void | Promise<void>;
};

export type ImpactAnalysisJob = {
  repoId: string;
  snapshotId: string;
  snapshotSha: string;
  repositoryId: string;
  changedFiles?: readonly string[];
  proposedDiff?: string;
  maxDepth?: 1 | 2 | 3;
  renameMap?: Record<string, string>;
  refresh?: boolean;
  checkoutDir?: string;
  checkoutSha?: string;
};

export type PullRequestAnalysisJob = ImpactAnalysisJob & {
  prNumber: number;
  baseSha: string;
  headSha: string;
  event: PullRequestEvent;
  actionsUrl?: string;
};

export type AnalysisErrorCode =
  | "INVALID_JOB"
  | "SNAPSHOT_MISMATCH"
  | "STRUCTURAL_SNAPSHOT_MISSING"
  | "RUN_NOT_FOUND"
  | "ANALYZER_METADATA_MISMATCH"
  | "CONTRACT_MISMATCH";

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;

  constructor(code: AnalysisErrorCode, message: string) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
  }
}
