import type {
  CoverageReport,
  EntityRecord,
  EvidenceChunkRecord,
  RelationshipRecord,
  SnapshotStatus,
} from "../../history/src/types.ts";

export interface EvidencePack {
  repoId: string;
  snapshotId: string;
  snapshotSha: string;
  snapshotStatus: SnapshotStatus;
  question: string;
  focusEntityId: string | null;
  chunks: EvidenceChunkRecord[];
  entities: EntityRecord[];
  edges: RelationshipRecord[];
  coverage: CoverageReport;
  warnings: string[];
  noEvidence: boolean;
  truncated: boolean;
  generatedAt: string;
}

export interface BuildEvidencePackInput {
  repoId: string;
  snapshotId: string;
  question: string;
  focusEntityId?: string;
  maxChunks: number;
  maxNeighbors: number;
  maxNeighborChunks: number;
}

export interface EvidenceRetriever {
  buildPack(input: BuildEvidencePackInput): Promise<EvidencePack>;
}

export interface LlmGenerateRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface LlmGenerateResponse {
  text: string;
  provider: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface LlmProvider {
  readonly provider: string;
  readonly model: string;
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse>;
}

export type ClaimSupport = "documented" | "interpretation";

export interface RawLlmClaim {
  text: string;
  evidenceIds: string[];
  support: ClaimSupport;
}

export interface RawLlmAnswer {
  status: "supported" | "partial" | "not_found";
  answer: string;
  claims: RawLlmClaim[];
  unknowns: string[];
}

export interface ValidatedClaim {
  text: string;
  evidenceIds: string[];
  support: ClaimSupport;
}

export interface AskSource {
  id: string;
  entityId: string;
  kind: string;
  sourceId: string;
  url: string;
  locator: string;
  title: string;
  excerpt: string;
  timestamp: string | null;
  revision: string;
  contentSha: string;
}

export interface ClaimValidationOutcome {
  claimIndex: number;
  accepted: boolean;
  support: ClaimSupport | null;
  citedEvidenceIds: string[];
  acceptedEvidenceIds: string[];
  maxTokenCoverage: number;
  reason: string | null;
}

export interface AskValidationReport {
  modelStatus: RawLlmAnswer["status"];
  claims: ClaimValidationOutcome[];
  checkedEvidenceIds: string[];
  rejectedEvidenceIds: string[];
  acceptedClaims: number;
  rejectedClaims: number;
}

export interface AskResult {
  status: "supported" | "partial" | "not_found" | "unavailable";
  answer: string | null;
  claims: ValidatedClaim[];
  sources: AskSource[];
  unknowns: string[];
  warnings: string[];
  repoId: string;
  snapshotId: string;
  snapshotSha: string;
  searchAvailable: boolean;
  errorCode: string | null;
  recoverable: boolean;
  model: { provider: string; model: string } | null;
  retrieval: {
    chunksConsidered: number;
    chunksUsed: number;
    focusEntityId: string | null;
  };
  validation: AskValidationReport | null;
  generatedAt: string;
}

export interface AskRequest {
  repoId: string;
  snapshotId: string;
  question: string;
  focusEntityId?: string;
}

export interface AskAuditRecord {
  repoId: string;
  snapshotId: string;
  question: string;
  outcome: AskResult["status"];
  errorCode: string | null;
  promptEvidenceIds: string[];
  acceptedEvidenceIds: string[];
  rejectedEvidenceIds: string[];
  modelStatus: RawLlmAnswer["status"] | null;
  timestamp: string;
}

export interface AskLimits {
  maxQuestionChars: number;
  maxChunks: number;
  maxNeighbors: number;
  maxNeighborChunks: number;
  maxInputChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
  supportThreshold: number;
  downgradeThreshold: number;
  maxClaims: number;
}

export const DEFAULT_ASK_LIMITS: AskLimits = {
  maxQuestionChars: 2_000,
  maxChunks: 12,
  maxNeighbors: 8,
  maxNeighborChunks: 1,
  maxInputChars: 24_000,
  maxOutputTokens: 800,
  timeoutMs: 25_000,
  supportThreshold: 0.65,
  downgradeThreshold: 0.45,
  maxClaims: 10,
};

export interface AskDeps {
  retriever: EvidenceRetriever;
  store: import("../../history/src/ports.ts").HistoryStore;
  llm: LlmProvider;
  clock: { isoNow(): string };
  limits?: Partial<AskLimits>;
  onAudit?: (record: AskAuditRecord) => void | Promise<void>;
  signal?: AbortSignal;
}
