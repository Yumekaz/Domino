import type {
  CoChangeResult,
  EntityKind,
  EntityRecord,
  EvidenceChunkRecord,
  EvidenceSearchHit,
  FileContributorRow,
  GraphNeighborhood,
  RelationshipKind,
  RelationshipRecord,
  RepositoryRecord,
  SnapshotRecord,
} from "./types.ts";
import type { CommitFileObservation, CoChangeDataset } from "./cochange.ts";

export interface FinalizeSnapshotInput {
  repoId: string;
  snapshotId: string;
  status: SnapshotRecord["status"];
  coverage: SnapshotRecord["coverage"];
  errors: string[];
  completedAt: string;
}

export interface EvidenceSearchQuery {
  repoId: string;
  snapshotId: string;
  query: string;
  limit: number;
  entityKinds?: EntityKind[];
}

export interface NeighborQuery {
  repoId: string;
  snapshotId: string;
  entityIds: string[];
  depth: 1 | 2;
  relationshipKinds?: RelationshipKind[];
  maxNodes: number;
  maxEdges: number;
}

export interface RiskPageQuery {
  repoId: string;
  snapshotId: string;
  limit: number;
  offset: number;
  riskExtensions?: string[];
  includeAllPaths?: boolean;
}

export interface RiskPage {
  rows: FileContributorRow[];
  totalFiles: number;
}

export interface CoChangeDatasetRecord extends CoChangeDataset {
  targetFile?: never;
}

export interface HistoryStore {
  ensureRepository(repository: RepositoryRecord): Promise<void>;
  getRepository(repoId: string): Promise<RepositoryRecord | null>;
  createSnapshot(snapshot: SnapshotRecord): Promise<void>;
  finalizeSnapshot(input: FinalizeSnapshotInput): Promise<void>;
  getSnapshot(repoId: string, snapshotId: string): Promise<SnapshotRecord | null>;
  getLatestSnapshot(repoId: string): Promise<SnapshotRecord | null>;
  upsertEntities(entities: EntityRecord[]): Promise<void>;
  upsertRelationships(relationships: RelationshipRecord[]): Promise<void>;
  replaceEvidenceChunks(chunks: EvidenceChunkRecord[]): Promise<void>;
  replaceFileContributors(rows: FileContributorRow[]): Promise<void>;
  getEntity(repoId: string, entityId: string): Promise<EntityRecord | null>;
  getEntities(repoId: string, entityIds: string[]): Promise<EntityRecord[]>;
  getEvidenceChunks(
    repoId: string,
    snapshotId: string,
    chunkIds: string[],
  ): Promise<EvidenceChunkRecord[]>;
  getEvidenceForEntities(input: {
    repoId: string;
    snapshotId: string;
    entityIds: string[];
    limitPerEntity: number;
  }): Promise<EvidenceChunkRecord[]>;
  searchEvidence(query: EvidenceSearchQuery): Promise<EvidenceSearchHit[]>;
  getNeighbors(query: NeighborQuery): Promise<GraphNeighborhood>;
  getRiskPage(query: RiskPageQuery): Promise<RiskPage>;
  getCommitFileObservations(
    repoId: string,
    snapshotId: string,
  ): Promise<CommitFileObservation[]>;
  getCoChangeDataset(repoId: string, snapshotId: string): Promise<CoChangeDataset | null>;
  getCoChangeEdges(input: {
    repoId: string;
    snapshotId: string;
    filePath: string;
    limit: number;
  }): Promise<RelationshipRecord[]>;
  close(): Promise<void>;
}

export interface JobProgressPort {
  report(event: {
    phase: string;
    message: string;
    processed: number | null;
    total: number | null;
    warnings: string[];
  }): void | Promise<void>;
}

export interface ClockPort {
  now(): Date;
}

export interface StorePortTestHooks {
  readonly kind: "postgres" | "memory" | "pglite";
}

export interface CoChangeConsumerPort {
  getCoChange(
    repoId: string,
    snapshotId: string,
    targetFile: string,
    options: {
      minSupport: number;
      maxResults: number;
      maxFilesPerCommit: number;
    },
  ): Promise<CoChangeResult>;
}
