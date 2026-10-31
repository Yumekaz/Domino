import type { AnalyzerGap, StructuralImport } from "../../../dependency-adapter/src/types.ts";

export type { AnalyzerGap, StructuralImport } from "../../../dependency-adapter/src/types.ts";

export type ImpactSignal = "static_reverse_dependency";
export type AssociationSignal = "historically_coupled";

export type ImpactPathEvidence = {
  type: "import";
  importer: string;
  imported: string;
  specifier: string;
  line: number | null;
  dynamic: boolean;
  circular: boolean;
  extractor: string;
  analyzerVersion: string;
  configHash: string;
  snapshotSha: string;
};

export type ImpactAffected = {
  file: string;
  signal: ImpactSignal;
  depth: number;
  path: string[];
  impact: "possible";
  explanation: string;
  evidence: ImpactPathEvidence[];
  viaDynamicImport: boolean;
};

export type CoChangeWindow = { from: string | null; to: string | null };

export type CoChangeObservation = {
  file: string;
  sharedCommits: number;
  targetCommits: number;
  share: number;
  commitShas: string[];
  window: CoChangeWindow;
};

export type CoChangeCoverage = {
  commitsAnalyzed: number;
  commitsTouchingTarget: number;
  commitsExcludedOverCap: number;
  observationsTruncated: number;
  maxFilesPerCommit: number;
  minSupport: number;
  window: CoChangeWindow;
  excludedPaths: number;
  warnings: string[];
};

export type CoChangeResult = {
  targetFile: string;
  observations: CoChangeObservation[];
  coverage: CoChangeCoverage;
};

export type ImpactAssociation = {
  file: string;
  targetFile: string;
  signal: AssociationSignal;
  sharedCommits: number;
  targetCommits: number;
  share: number;
  commitShas: string[];
  window: CoChangeWindow;
  coverage: {
    commitsAnalyzed: number;
    commitsTouchingTarget: number;
    commitsExcludedOverCap: number;
    window: CoChangeWindow;
  };
  caveats: string[];
};

export type ImpactCoverage = {
  edgesAnalyzed: number;
  roots: number;
  maxDepth: number;
  affectedReturned: number;
  truncated: boolean;
  cyclesSkipped: number;
  dynamicPaths: number;
  unresolvedImports: number;
  ignoredChangedFiles: number;
  renamedChangedFiles: number;
};

export type ImpactResult = {
  changedFiles: string[];
  snapshotSha: string;
  affected: ImpactAffected[];
  associations: ImpactAssociation[];
  warnings: string[];
  coverage: ImpactCoverage;
};

export type ImpactOptions = {
  snapshotSha: string;
  changedFiles?: readonly string[];
  proposedDiff?: string;
  maxDepth?: 1 | 2 | 3;
  maxAffected?: number;
  maxEdges?: number;
  renameMap?: Readonly<Record<string, string>>;
  coChange?: readonly CoChangeResult[];
  analyzerGaps?: readonly AnalyzerGap[];
};

export type ImpactErrorCode =
  | "INVALID_INPUT"
  | "MIXED_INPUT"
  | "NO_CHANGED_FILES"
  | "DIFF_TOO_LARGE"
  | "DEPTH_OUT_OF_RANGE"
  | "SNAPSHOT_MISMATCH"
  | "EDGE_LIMIT_EXCEEDED"
  | "UNSAFE_PATH";

export class ImpactError extends Error {
  readonly code: ImpactErrorCode;

  constructor(code: ImpactErrorCode, message: string) {
    super(message);
    this.name = "ImpactError";
    this.code = code;
  }
}

export type StructuralEdge = StructuralImport;
export type StructuralGap = AnalyzerGap;

export type CoChangeSource = {
  getCoChange(targetFile: string): CoChangeResult | Promise<CoChangeResult>;
};
