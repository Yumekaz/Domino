import type {
  CoChangeDataset,
  CommitFileObservation,
} from "../../core/history/src/cochange.ts";
import type {
  EntityRecord,
  EvidenceChunkRecord,
  EvidenceSearchHit,
  FileContributorRow,
  GraphNeighborhood,
  RelationshipRecord,
  RepositoryRecord,
  SnapshotRecord,
} from "../../core/history/src/types.ts";
import type {
  FinalizeSnapshotInput,
  HistoryStore,
  NeighborQuery,
  RiskPage,
  RiskPageQuery,
} from "../../core/history/src/ports.ts";
import { canonicalFileKey } from "../../core/history/src/ids.ts";

export class MemoryHistoryStore implements HistoryStore {
  private readonly repositories = new Map<string, RepositoryRecord>();
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private readonly entities = new Map<string, EntityRecord>();
  private readonly edges = new Map<string, RelationshipRecord>();
  private readonly chunks = new Map<string, EvidenceChunkRecord>();
  private readonly contributorRows: FileContributorRow[] = [];

  async ensureRepository(repository: RepositoryRecord): Promise<void> {
    this.repositories.set(repository.id, { ...repository });
  }

  async getRepository(repoId: string): Promise<RepositoryRecord | null> {
    const repository = this.repositories.get(repoId);
    return repository === undefined ? null : { ...repository };
  }

  async createSnapshot(snapshot: SnapshotRecord): Promise<void> {
    for (const [id, edge] of this.edges) {
      if (edge.snapshotId === snapshot.id) {
        this.edges.delete(id);
      }
    }
    for (const [id, chunk] of this.chunks) {
      if (chunk.snapshotId === snapshot.id) {
        this.chunks.delete(id);
      }
    }
    for (let index = this.contributorRows.length - 1; index >= 0; index -= 1) {
      if (this.contributorRows[index].snapshotId === snapshot.id) {
        this.contributorRows.splice(index, 1);
      }
    }
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
  }

  async finalizeSnapshot(input: FinalizeSnapshotInput): Promise<void> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (snapshot === undefined) {
      return;
    }
    snapshot.status = input.status;
    snapshot.coverage = structuredClone(input.coverage);
    snapshot.errors = [...input.errors];
    snapshot.completedAt = input.completedAt;
  }

  async getSnapshot(repoId: string, snapshotId: string): Promise<SnapshotRecord | null> {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot === undefined || snapshot.repoId !== repoId
      ? null
      : structuredClone(snapshot);
  }

  async getLatestSnapshot(repoId: string): Promise<SnapshotRecord | null> {
    const candidates = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.repoId === repoId && ["ready", "partial"].includes(snapshot.status))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return candidates[0] === undefined ? null : structuredClone(candidates[0]);
  }

  async upsertEntities(entities: EntityRecord[]): Promise<void> {
    for (const entity of entities) {
      this.entities.set(entity.id, structuredClone(entity));
    }
  }

  async upsertRelationships(relationships: RelationshipRecord[]): Promise<void> {
    for (const edge of relationships) {
      this.edges.set(edge.id, structuredClone(edge));
    }
  }

  async replaceEvidenceChunks(chunks: EvidenceChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    const snapshotIds = new Set(chunks.map((chunk) => chunk.snapshotId));
    for (const [id, chunk] of this.chunks) {
      if (snapshotIds.has(chunk.snapshotId)) {
        this.chunks.delete(id);
      }
    }
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, structuredClone(chunk));
    }
  }

  async replaceFileContributors(rows: FileContributorRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const snapshotId = rows[0].snapshotId;
    for (let index = this.contributorRows.length - 1; index >= 0; index -= 1) {
      if (this.contributorRows[index].snapshotId === snapshotId) {
        this.contributorRows.splice(index, 1);
      }
    }
    this.contributorRows.push(...rows.map((row) => structuredClone(row)));
  }

  async getEntity(repoId: string, entityId: string): Promise<EntityRecord | null> {
    const entity = this.entities.get(entityId);
    return entity === undefined || entity.repoId !== repoId ? null : structuredClone(entity);
  }

  async getEntities(repoId: string, entityIds: string[]): Promise<EntityRecord[]> {
    return entityIds
      .map((id) => this.entities.get(id))
      .filter((entity): entity is EntityRecord => entity !== undefined && entity.repoId === repoId)
      .map((entity) => structuredClone(entity))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async getEvidenceChunks(
    repoId: string,
    snapshotId: string,
    chunkIds: string[],
  ): Promise<EvidenceChunkRecord[]> {
    return chunkIds
      .map((id) => this.chunks.get(id))
      .filter(
        (chunk): chunk is EvidenceChunkRecord =>
          chunk !== undefined && chunk.repoId === repoId && chunk.snapshotId === snapshotId,
      )
      .map((chunk) => structuredClone(chunk));
  }

  async getEvidenceForEntities(input: {
    repoId: string;
    snapshotId: string;
    entityIds: string[];
    limitPerEntity: number;
  }): Promise<EvidenceChunkRecord[]> {
    const counts = new Map<string, number>();
    const result: EvidenceChunkRecord[] = [];
    const chunks = [...this.chunks.values()]
      .filter(
        (chunk) =>
          chunk.repoId === input.repoId &&
          chunk.snapshotId === input.snapshotId &&
          input.entityIds.includes(chunk.entityId),
      )
      .sort(
        (left, right) =>
          left.entityId.localeCompare(right.entityId) ||
          left.chunkIndex - right.chunkIndex ||
          left.id.localeCompare(right.id),
      );
    for (const chunk of chunks) {
      const count = counts.get(chunk.entityId) ?? 0;
      if (count >= input.limitPerEntity) {
        continue;
      }
      counts.set(chunk.entityId, count + 1);
      result.push(structuredClone(chunk));
    }
    return result;
  }

  async searchEvidence(query: {
    repoId: string;
    snapshotId: string;
    query: string;
    limit: number;
    entityKinds?: string[];
  }): Promise<EvidenceSearchHit[]> {
    const terms = query.query
      .toLowerCase()
      .split(/[^a-z0-9_+#.-]+/i)
      .filter((term) => term.length > 1);
    if (terms.length === 0) {
      return [];
    }
    const hits: EvidenceSearchHit[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.repoId !== query.repoId || chunk.snapshotId !== query.snapshotId) {
        continue;
      }
      if (
        query.entityKinds !== undefined &&
        query.entityKinds.length > 0 &&
        !query.entityKinds.includes(chunk.entityKind)
      ) {
        continue;
      }
      const body = chunk.body.toLowerCase();
      let score = 0;
      for (const term of new Set(terms)) {
        if (body.includes(term)) {
          score += 1;
        }
      }
      if (score > 0) {
        hits.push({ ...structuredClone(chunk), score });
      }
    }
    hits.sort(
      (left, right) =>
        right.score - left.score ||
        (right.sourceTimestamp ?? "").localeCompare(left.sourceTimestamp ?? "") ||
        left.id.localeCompare(right.id),
    );
    return hits.slice(0, Math.max(1, Math.min(100, query.limit)));
  }

  async getNeighbors(query: NeighborQuery): Promise<GraphNeighborhood> {
    const nodeMap = new Map<string, EntityRecord>();
    for (const entity of await this.getEntities(query.repoId, query.entityIds)) {
      nodeMap.set(entity.id, entity);
    }
    const edgeMap = new Map<string, RelationshipRecord>();
    let frontier = [...query.entityIds];
    const visited = new Set(query.entityIds);
    let truncated = false;
    for (let depth = 0; depth < query.depth; depth += 1) {
      if (frontier.length === 0) {
        break;
      }
      const next = new Set<string>();
      for (const edge of this.edges.values()) {
        if (
          edge.repoId !== query.repoId ||
          edge.snapshotId !== query.snapshotId ||
          (query.relationshipKinds !== undefined &&
            query.relationshipKinds.length > 0 &&
            !query.relationshipKinds.includes(edge.kind))
        ) {
          continue;
        }
        if (!frontier.includes(edge.fromEntityId) && !frontier.includes(edge.toEntityId)) {
          continue;
        }
        if (edgeMap.size >= query.maxEdges) {
          truncated = true;
          break;
        }
        edgeMap.set(edge.id, structuredClone(edge));
        for (const entityId of [edge.fromEntityId, edge.toEntityId]) {
          if (!nodeMap.has(entityId)) {
            if (nodeMap.size >= query.maxNodes && !nodeMap.has(entityId)) {
              truncated = true;
              continue;
            }
            const entity = this.entities.get(entityId);
            if (entity !== undefined) {
              nodeMap.set(entity.id, structuredClone(entity));
            }
          }
          if (!visited.has(entityId)) {
            next.add(entityId);
          }
        }
      }
      for (const entityId of next) {
        visited.add(entityId);
      }
      frontier = [...next];
    }
    const edges = [...edgeMap.values()].filter(
      (edge) => nodeMap.has(edge.fromEntityId) && nodeMap.has(edge.toEntityId),
    );
    return {
      nodes: [...nodeMap.values()],
      edges,
      truncated,
      warnings: truncated ? ["The graph neighborhood was truncated."] : [],
    };
  }

  async getRiskPage(query: RiskPageQuery): Promise<RiskPage> {
    const extensionFilter =
      query.includeAllPaths === true
        ? null
        : (query.riskExtensions ?? []).map((extension) => extension.toLowerCase());
    const allPaths = [...new Set(this.contributorRows
      .filter((row) => row.snapshotId === query.snapshotId)
      .map((row) => row.path))]
      .filter((path) => extensionFilter === null || extensionFilter.some((extension) => path.toLowerCase().endsWith(extension)))
      .sort();
    const paths = allPaths.slice(
      Math.max(0, query.offset),
      Math.max(0, query.offset) + Math.max(1, query.limit),
    );
    return {
      totalFiles: allPaths.length,
      rows: this.contributorRows
        .filter((row) => row.snapshotId === query.snapshotId && paths.includes(row.path))
        .map((row) => structuredClone(row))
        .sort(
          (left, right) =>
            left.path.localeCompare(right.path) ||
            right.observedCommits - left.observedCommits ||
            left.contributorKey.localeCompare(right.contributorKey),
        ),
    };
  }

  async getCommitFileObservations(
    repoId: string,
    snapshotId: string,
  ): Promise<CommitFileObservation[]> {
    const grouped = new Map<
      string,
      { authoredAt: string; authorKey: string; files: Set<string> }
    >();
    for (const edge of this.edges.values()) {
      if (
        edge.repoId !== repoId ||
        edge.snapshotId !== snapshotId ||
        edge.kind !== "MODIFIED"
      ) {
        continue;
      }
      const commit = this.entities.get(edge.fromEntityId);
      const revision = this.entities.get(edge.toEntityId);
      if (commit?.metadata.coChangeEligible !== true || revision === undefined) {
        continue;
      }
      const currentPath = revision.metadata.currentPath;
      if (typeof currentPath !== "string") {
        continue;
      }
      const eligibleFiles = Array.isArray(commit.metadata.coChangeFiles)
        ? commit.metadata.coChangeFiles.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      if (!eligibleFiles.includes(currentPath)) {
        continue;
      }
      const sha = typeof commit.metadata.sha === "string" ? commit.metadata.sha : commit.canonicalKey;
      const entry = grouped.get(sha) ?? {
        authoredAt: typeof commit.metadata.authoredAt === "string" ? commit.metadata.authoredAt : "",
        authorKey: typeof commit.metadata.authorKey === "string" ? commit.metadata.authorKey : "",
        files: new Set<string>(),
      };
      entry.files.add(currentPath);
      grouped.set(sha, entry);
    }
    return [...grouped.entries()]
      .map(([sha, entry]) => ({
        sha,
        authoredAt: entry.authoredAt,
        authorKey: entry.authorKey,
        files: [...entry.files].sort(),
      }))
      .sort((left, right) => left.sha.localeCompare(right.sha));
  }

  async getCoChangeDataset(repoId: string, snapshotId: string): Promise<CoChangeDataset | null> {
    const snapshot = await this.getSnapshot(repoId, snapshotId);
    if (snapshot === null) {
      return null;
    }
    const observations = await this.getCommitFileObservations(repoId, snapshotId);
    const limits = snapshot.coverage.limits;
    return {
      observations,
      commitsAnalyzed:
        typeof limits.coChangeCommitsAnalyzed === "number"
          ? limits.coChangeCommitsAnalyzed
          : observations.length,
      commitsExcludedOverCap:
        typeof limits.coChangeCommitsExcludedOverCap === "number"
          ? limits.coChangeCommitsExcludedOverCap
          : 0,
      excludedPaths:
        typeof limits.coChangeExcludedPaths === "number" ? limits.coChangeExcludedPaths : 0,
      window: {
        from: typeof limits.coChangeWindowFrom === "string" ? limits.coChangeWindowFrom : null,
        to: typeof limits.coChangeWindowTo === "string" ? limits.coChangeWindowTo : null,
      },
      warnings: snapshot.coverage.warnings.filter((warning) => /co-change/i.test(warning)),
    };
  }

  async getCoChangeEdges(input: {
    repoId: string;
    snapshotId: string;
    filePath: string;
    limit: number;
  }): Promise<RelationshipRecord[]> {
    const target = [...this.entities.values()].find(
      (entity) =>
        entity.repoId === input.repoId &&
        entity.kind === "File" &&
        entity.canonicalKey === canonicalFileKey(input.filePath),
    );
    if (target === undefined) {
      return [];
    }
    return [...this.edges.values()]
      .filter(
        (edge) =>
          edge.repoId === input.repoId &&
          edge.snapshotId === input.snapshotId &&
          edge.kind === "CO_CHANGED_WITH" &&
          (edge.fromEntityId === target.id || edge.toEntityId === target.id),
      )
      .slice(0, Math.max(1, input.limit))
      .map((edge) => structuredClone(edge));
  }

  async close(): Promise<void> {
    // In-memory store has nothing to close.
  }
}
