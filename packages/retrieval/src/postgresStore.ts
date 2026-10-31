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
  RelationshipEvidence,
  RelationshipRecord,
  RepositoryRecord,
  SnapshotRecord,
} from "../../core/history/src/types.ts";
import type {
  CoChangeDatasetRecord,
  FinalizeSnapshotInput,
  HistoryStore,
  NeighborQuery,
  RiskPageQuery,
  RiskPage,
} from "../../core/history/src/ports.ts";
import { canonicalFileKey } from "../../core/history/src/ids.ts";
import { contentTokens } from "../../core/evidence/src/text.ts";
import type { SqlClient } from "./sqlClient.ts";

interface RepositoryRow {
  id: string;
  github_id: string | number;
  owner: string;
  name: string;
  default_branch: string | null;
  visibility: string;
  html_url: string;
  created_at: Date | string;
}

interface SnapshotRow {
  id: string;
  repo_id: string;
  head_sha: string;
  branch: string;
  status: string;
  coverage: unknown;
  tool_versions: unknown;
  started_at: Date | string;
  completed_at: Date | string | null;
  errors: unknown;
}

interface EntityRow {
  id: string;
  repo_id: string;
  kind: string;
  canonical_key: string;
  title: string | null;
  source_url: string | null;
  metadata: unknown;
}

interface EdgeRow {
  id: string;
  repo_id: string;
  snapshot_id: string;
  from_entity_id: string;
  to_entity_id: string;
  kind: string;
  verification: string;
  source_url: string | null;
  source_entity_id: string | null;
  extractor: string | null;
  observed_at: Date | string | null;
  verification_detail: string | null;
  evidence: unknown;
}

interface EvidenceRow {
  id: string;
  repo_id: string;
  snapshot_id: string;
  entity_id: string;
  entity_kind: string;
  source_url: string;
  source_kind: string;
  source_id: string;
  content_sha: string;
  section_locator: string;
  body: string;
  excerpt: string;
  line_start: number | null;
  line_end: number | null;
  source_timestamp: Date | string | null;
  revision: string;
  chunk_index: number;
  metadata: unknown;
  score?: string | number;
}

interface ContributorRow {
  repo_id: string;
  snapshot_id: string;
  file_path: string;
  contributor_key: string;
  contributor_name: string;
  contributor_email: string;
  observed_commits: number;
  first_touch: Date | string | null;
  last_touch: Date | string | null;
  commit_shas: unknown;
}

interface CommitObservationRow {
  sha: string | null;
  authored_at: Date | string | null;
  author_key: string | null;
  co_change_files: unknown;
  files: string[] | null;
}

export class PostgresHistoryStore implements HistoryStore {
  private readonly client: SqlClient;

  constructor(client: SqlClient) {
    this.client = client;
  }

  async ensureRepository(repository: RepositoryRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO repositories (id, github_id, owner, name, default_branch, visibility, html_url, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         github_id = EXCLUDED.github_id,
         owner = EXCLUDED.owner,
         name = EXCLUDED.name,
         default_branch = EXCLUDED.default_branch,
         visibility = EXCLUDED.visibility,
         html_url = EXCLUDED.html_url`,
      [
        repository.id,
        repository.githubId,
        repository.owner,
        repository.name,
        repository.defaultBranch,
        repository.visibility,
        repository.htmlUrl,
        repository.createdAt,
      ],
    );
  }

  async getRepository(repoId: string): Promise<RepositoryRecord | null> {
    const result = await this.client.query<RepositoryRow>(
      `SELECT * FROM repositories WHERE id = $1`,
      [repoId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRepository(row);
  }

  async createSnapshot(snapshot: SnapshotRecord): Promise<void> {
    await this.client.transaction(async (tx) => {
      await tx.query(`DELETE FROM evidence_documents WHERE snapshot_id = $1`, [snapshot.id]);
      await tx.query(`DELETE FROM edges WHERE snapshot_id = $1`, [snapshot.id]);
      await tx.query(`DELETE FROM file_contributors WHERE snapshot_id = $1`, [snapshot.id]);
      await tx.query(
        `INSERT INTO index_snapshots
          (id, repo_id, head_sha, branch, status, coverage, tool_versions, started_at, completed_at, errors)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           head_sha = EXCLUDED.head_sha,
           branch = EXCLUDED.branch,
           status = EXCLUDED.status,
           coverage = EXCLUDED.coverage,
           tool_versions = EXCLUDED.tool_versions,
           started_at = EXCLUDED.started_at,
           completed_at = EXCLUDED.completed_at,
           errors = EXCLUDED.errors`,
        [
          snapshot.id,
          snapshot.repoId,
          snapshot.headSha,
          snapshot.branch,
          snapshot.status,
          JSON.stringify(snapshot.coverage),
          JSON.stringify(snapshot.toolVersions),
          snapshot.startedAt,
          snapshot.completedAt,
          JSON.stringify(snapshot.errors),
        ],
      );
    });
  }

  async finalizeSnapshot(input: FinalizeSnapshotInput): Promise<void> {
    await this.client.query(
      `UPDATE index_snapshots
       SET status = $3, coverage = $4, errors = $5, completed_at = $6
       WHERE id = $1 AND repo_id = $2`,
      [
        input.snapshotId,
        input.repoId,
        input.status,
        JSON.stringify(input.coverage),
        JSON.stringify(input.errors),
        input.completedAt,
      ],
    );
  }

  async getSnapshot(repoId: string, snapshotId: string): Promise<SnapshotRecord | null> {
    const result = await this.client.query<SnapshotRow>(
      `SELECT * FROM index_snapshots WHERE repo_id = $1 AND id = $2`,
      [repoId, snapshotId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSnapshot(row);
  }

  async getLatestSnapshot(repoId: string): Promise<SnapshotRecord | null> {
    const result = await this.client.query<SnapshotRow>(
      `SELECT * FROM index_snapshots
       WHERE repo_id = $1 AND status IN ('ready', 'partial')
         AND coalesce(tool_versions->>'purpose','repository') = 'repository'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
      [repoId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSnapshot(row);
  }

  async upsertEntities(entities: EntityRecord[]): Promise<void> {
    if (entities.length === 0) {
      return;
    }
    await this.client.transaction(async (tx) => {
      for (const batch of chunk(entities, 150)) {
        const params: unknown[] = [];
        const values: string[] = [];
        for (const entity of batch) {
          const offset = params.length;
          values.push(
            `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7})`,
          );
          params.push(
            entity.id,
            entity.repoId,
            entity.kind,
            entity.canonicalKey,
            entity.title,
            entity.sourceUrl,
            JSON.stringify(entity.metadata),
          );
        }
        await tx.query(
          `INSERT INTO entities (id, repo_id, kind, canonical_key, title, source_url, metadata)
           VALUES ${values.join(",")}
           ON CONFLICT (id) DO UPDATE SET
             kind = EXCLUDED.kind,
             canonical_key = EXCLUDED.canonical_key,
             title = EXCLUDED.title,
             source_url = EXCLUDED.source_url,
             metadata = EXCLUDED.metadata`,
          params,
        );
      }
    });
  }

  async upsertRelationships(relationships: RelationshipRecord[]): Promise<void> {
    if (relationships.length === 0) {
      return;
    }
    await this.client.transaction(async (tx) => {
      for (const batch of chunk(relationships, 100)) {
        const params: unknown[] = [];
        const values: string[] = [];
        for (const edge of batch) {
          const offset = params.length;
          values.push(
            `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13})`,
          );
          params.push(
            edge.id,
            edge.repoId,
            edge.snapshotId,
            edge.fromEntityId,
            edge.toEntityId,
            edge.kind,
            edge.verification,
            edge.sourceUrl,
            edge.sourceEntityId,
            edge.extractor,
            edge.observedAt,
            edge.verificationDetail,
            JSON.stringify(edge.evidence),
          );
        }
        await tx.query(
          `INSERT INTO edges
            (id, repo_id, snapshot_id, from_entity_id, to_entity_id, kind, verification,
             source_url, source_entity_id, extractor, observed_at, verification_detail, evidence)
           VALUES ${values.join(",")}
           ON CONFLICT (id) DO UPDATE SET
             verification = EXCLUDED.verification,
             source_url = EXCLUDED.source_url,
             source_entity_id = EXCLUDED.source_entity_id,
             extractor = EXCLUDED.extractor,
             observed_at = EXCLUDED.observed_at,
             verification_detail = EXCLUDED.verification_detail,
             evidence = EXCLUDED.evidence`,
          params,
        );
      }
    });
  }

  async replaceEvidenceChunks(chunks: EvidenceChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    const snapshotIds = [...new Set(chunks.map((chunk) => chunk.snapshotId))];
    await this.client.transaction(async (tx) => {
      await tx.query(`DELETE FROM evidence_documents WHERE snapshot_id = ANY($1::uuid[])`, [
        snapshotIds,
      ]);
      for (const batch of chunk(chunks, 80)) {
        const params: unknown[] = [];
        const values: string[] = [];
        for (const source of batch) {
          const offset = params.length;
          values.push(
            `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13},$${offset + 14},$${offset + 15},$${offset + 16},to_tsvector('english', $${offset + 10}),$${offset + 17})`,
          );
          params.push(
            source.id,
            source.repoId,
            source.snapshotId,
            source.entityId,
            source.sourceUrl,
            source.sourceKind,
            source.sourceId,
            source.contentSha,
            source.locator,
            source.body,
            source.excerpt,
            source.lineStart,
            source.lineEnd,
            source.sourceTimestamp,
            source.revision,
            source.chunkIndex,
            JSON.stringify(source.metadata),
          );
        }
        await tx.query(
          `INSERT INTO evidence_documents
            (id, repo_id, snapshot_id, entity_id, source_url, source_kind, source_id,
             content_sha, section_locator, body, excerpt, line_start, line_end,
             source_timestamp, revision, chunk_index, search_tsv, metadata)
           VALUES ${values.join(",")}`,
          params,
        );
      }
    });
  }

  async replaceFileContributors(rows: FileContributorRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const snapshotId = rows[0]?.snapshotId;
    if (snapshotId === undefined) {
      return;
    }
    const snapshot = await this.client.query<{ repo_id: string }>(
      `SELECT repo_id FROM index_snapshots WHERE id = $1`,
      [snapshotId],
    );
    const repoId = snapshot.rows[0]?.repo_id;
    if (repoId === undefined) {
      throw new Error(`Snapshot ${snapshotId} does not exist`);
    }
    await this.client.transaction(async (tx) => {
      await tx.query(`DELETE FROM file_contributors WHERE snapshot_id = $1`, [snapshotId]);
      for (const batch of chunk(rows, 150)) {
        const params: unknown[] = [];
        const values: string[] = [];
        for (const row of batch) {
          const offset = params.length;
          values.push(
            `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10})`,
          );
          params.push(
            repoId,
            row.snapshotId,
            row.path,
            row.contributorKey,
            row.contributorName,
            row.contributorEmail,
            row.observedCommits,
            row.firstTouch,
            row.lastTouch,
            JSON.stringify(row.commitShas),
          );
        }
        await tx.query(
          `INSERT INTO file_contributors
            (repo_id, snapshot_id, file_path, contributor_key, contributor_name, contributor_email,
             observed_commits, first_touch, last_touch, commit_shas)
           VALUES ${values.join(",")}`,
          params,
        );
      }
    });
  }

  async getEntity(repoId: string, entityId: string): Promise<EntityRecord | null> {
    const result = await this.client.query<EntityRow>(
      `SELECT * FROM entities WHERE repo_id = $1 AND id = $2`,
      [repoId, entityId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapEntity(row);
  }

  async getEntities(repoId: string, entityIds: string[]): Promise<EntityRecord[]> {
    if (entityIds.length === 0) {
      return [];
    }
    const result = await this.client.query<EntityRow>(
      `SELECT * FROM entities WHERE repo_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
      [repoId, entityIds],
    );
    return result.rows.map(mapEntity);
  }

  async getEvidenceChunks(
    repoId: string,
    snapshotId: string,
    chunkIds: string[],
  ): Promise<EvidenceChunkRecord[]> {
    if (chunkIds.length === 0) {
      return [];
    }
    const result = await this.client.query<EvidenceRow>(
      `SELECT d.*, e.kind AS entity_kind
       FROM evidence_documents d
       JOIN entities e ON e.id = d.entity_id
       WHERE d.repo_id = $1 AND d.snapshot_id = $2 AND d.id = ANY($3::uuid[])`,
      [repoId, snapshotId, chunkIds],
    );
    return result.rows.map(mapEvidence);
  }

  async getEvidenceForEntities(input: {
    repoId: string;
    snapshotId: string;
    entityIds: string[];
    limitPerEntity: number;
  }): Promise<EvidenceChunkRecord[]> {
    if (input.entityIds.length === 0 || input.limitPerEntity <= 0) {
      return [];
    }
    const result = await this.client.query<EvidenceRow>(
      `SELECT d.*, e.kind AS entity_kind
       FROM evidence_documents d
       JOIN entities e ON e.id = d.entity_id
       WHERE d.repo_id = $1 AND d.snapshot_id = $2 AND d.entity_id = ANY($3::uuid[])
       ORDER BY d.entity_id, d.chunk_index, d.id`,
      [input.repoId, input.snapshotId, input.entityIds],
    );
    const counts = new Map<string, number>();
    const chunks: EvidenceChunkRecord[] = [];
    for (const row of result.rows) {
      const count = counts.get(row.entity_id) ?? 0;
      if (count >= input.limitPerEntity) {
        continue;
      }
      counts.set(row.entity_id, count + 1);
      chunks.push(mapEvidence(row));
    }
    return chunks;
  }

  async searchEvidence(query: {
    repoId: string;
    snapshotId: string;
    query: string;
    limit: number;
    entityKinds?: string[];
  }): Promise<EvidenceSearchHit[]> {
    const text = query.query.trim();
    if (text.length === 0) {
      return [];
    }
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit)));
    const params = [query.repoId, query.snapshotId, text, query.entityKinds ?? null, limit];
    const primary = await this.client.query<EvidenceRow>(
      `WITH q AS (SELECT websearch_to_tsquery('english', $3) AS tsq)
       SELECT d.*, e.kind AS entity_kind, ts_rank_cd(d.search_tsv, q.tsq) AS score
       FROM evidence_documents d
       JOIN entities e ON e.id = d.entity_id
       CROSS JOIN q
       WHERE d.repo_id = $1 AND d.snapshot_id = $2
         AND d.search_tsv @@ q.tsq
         AND ($4::text[] IS NULL OR e.kind = ANY($4::text[]))
       ORDER BY score DESC, d.source_timestamp DESC NULLS LAST, d.id
       LIMIT $5`,
      params,
    );
    if (primary.rows.length > 0) {
      return primary.rows.map((row) => ({
        ...mapEvidence(row),
        score: Number(row.score ?? 0),
      }));
    }
    const fallbackTerms = [...new Set(contentTokens(text))]
      .filter((term) => /^[a-z0-9][a-z0-9_+-]*$/.test(term) && term.length > 1)
      .slice(0, 12);
    if (fallbackTerms.length === 0) {
      return [];
    }
    const orQuery = fallbackTerms.map((term) => `${term}:*`).join(" | ");
    const fallback = await this.client.query<EvidenceRow>(
      `WITH q AS (SELECT to_tsquery('english', $3) AS tsq)
       SELECT d.*, e.kind AS entity_kind, ts_rank_cd(d.search_tsv, q.tsq) AS score
       FROM evidence_documents d
       JOIN entities e ON e.id = d.entity_id
       CROSS JOIN q
       WHERE d.repo_id = $1 AND d.snapshot_id = $2
         AND d.search_tsv @@ q.tsq
         AND ($4::text[] IS NULL OR e.kind = ANY($4::text[]))
       ORDER BY score DESC, d.source_timestamp DESC NULLS LAST, d.id
       LIMIT $5`,
      [query.repoId, query.snapshotId, orQuery, query.entityKinds ?? null, limit],
    );
    return fallback.rows.map((row) => ({
      ...mapEvidence(row),
      score: Number(row.score ?? 0),
    }));
  }

  async getNeighbors(query: NeighborQuery): Promise<GraphNeighborhood> {
    if (query.entityIds.length === 0) {
      return { nodes: [], edges: [], truncated: false, warnings: [] };
    }
    const nodeMap = new Map<string, EntityRecord>();
    const edgeMap = new Map<string, RelationshipRecord>();
    const seedNodes = await this.getEntities(query.repoId, query.entityIds);
    for (const node of seedNodes) {
      nodeMap.set(node.id, node);
    }
    let frontier = [...query.entityIds];
    const visited = new Set(query.entityIds);
    let truncated = false;
    for (let depth = 0; depth < query.depth; depth += 1) {
      if (frontier.length === 0) {
        break;
      }
      const remainingEdges = query.maxEdges - edgeMap.size;
      if (remainingEdges <= 0) {
        truncated = true;
        break;
      }
      const result = await this.client.query<EdgeRow>(
        `SELECT * FROM edges
         WHERE repo_id = $1 AND snapshot_id = $2
           AND (from_entity_id = ANY($3::uuid[]) OR to_entity_id = ANY($3::uuid[]))
           AND ($4::text[] IS NULL OR kind = ANY($4::text[]))
         ORDER BY id
         LIMIT $5`,
        [
          query.repoId,
          query.snapshotId,
          frontier,
          query.relationshipKinds ?? null,
          remainingEdges + 1,
        ],
      );
      if (result.rows.length > remainingEdges) {
        truncated = true;
      }
      const nextFrontier = new Set<string>();
      const newNodeIds = new Set<string>();
      for (const row of result.rows.slice(0, remainingEdges)) {
        edgeMap.set(row.id, mapRelationship(row));
        for (const entityId of [row.from_entity_id, row.to_entity_id]) {
          if (!nodeMap.has(entityId)) {
            newNodeIds.add(entityId);
          }
          if (!visited.has(entityId)) {
            nextFrontier.add(entityId);
          }
        }
      }
      if (newNodeIds.size > 0) {
        const nodes = await this.getEntities(query.repoId, [...newNodeIds]);
        for (const node of nodes) {
          if (nodeMap.size >= query.maxNodes) {
            truncated = true;
            break;
          }
          nodeMap.set(node.id, node);
        }
      }
      if (nodeMap.size >= query.maxNodes) {
        truncated = true;
        break;
      }
      for (const entityId of nextFrontier) {
        visited.add(entityId);
      }
      frontier = [...nextFrontier];
    }
    const edges = [...edgeMap.values()].filter(
      (edge) => nodeMap.has(edge.fromEntityId) && nodeMap.has(edge.toEntityId),
    );
    return {
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
      edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
      truncated,
      warnings: truncated
        ? ["The graph neighborhood was truncated at the configured node or edge limit."]
        : [],
    };
  }

  async getRiskPage(query: RiskPageQuery): Promise<RiskPage> {
    const limit = Math.min(500, Math.max(1, Math.trunc(query.limit)));
    const offset = Math.max(0, Math.trunc(query.offset));
    const patterns =
      query.includeAllPaths === true
        ? null
        : (query.riskExtensions ?? [])
            .map((extension) => extension.toLowerCase())
            .filter((extension) => extension.startsWith("."))
            .map((extension) => `%${extension}`);
    const filterSql =
      patterns !== null && patterns.length > 0
        ? `AND lower(file_path) LIKE ANY($3::text[])`
        : "";
    const countParams: unknown[] = [query.repoId, query.snapshotId];
    if (patterns !== null && patterns.length > 0) {
      countParams.push(patterns);
    }
    const countResult = await this.client.query<{ total: string | number }>(
      `SELECT count(DISTINCT file_path) AS total
       FROM file_contributors
       WHERE repo_id = $1 AND snapshot_id = $2 ${filterSql}`,
      countParams,
    );
    const totalFiles = Number(countResult.rows[0]?.total ?? 0);
    const pageParams: unknown[] = [query.repoId, query.snapshotId];
    if (patterns !== null && patterns.length > 0) {
      pageParams.push(patterns);
    }
    pageParams.push(limit, offset);
    const pageResult = await this.client.query<{ file_path: string }>(
      `SELECT DISTINCT file_path
       FROM file_contributors
       WHERE repo_id = $1 AND snapshot_id = $2 ${filterSql}
       ORDER BY file_path
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );
    const paths = pageResult.rows.map((row) => row.file_path);
    if (paths.length === 0) {
      return { rows: [], totalFiles };
    }
    const rowsResult = await this.client.query<ContributorRow>(
      `SELECT * FROM file_contributors
       WHERE repo_id = $1 AND snapshot_id = $2 AND file_path = ANY($3::text[])
       ORDER BY file_path, observed_commits DESC, contributor_key`,
      [query.repoId, query.snapshotId, paths],
    );
    return {
      rows: rowsResult.rows.map(mapContributor),
      totalFiles,
    };
  }

  async getCommitFileObservations(
    repoId: string,
    snapshotId: string,
  ): Promise<CommitFileObservation[]> {
    const result = await this.client.query<CommitObservationRow>(
      `SELECT c.metadata->>'sha' AS sha,
              c.metadata->>'authoredAt' AS authored_at,
              c.metadata->>'authorKey' AS author_key,
              c.metadata->'coChangeFiles' AS co_change_files,
              array_agg(DISTINCT fr.metadata->>'currentPath')
                FILTER (WHERE fr.metadata->>'currentPath' IS NOT NULL) AS files
       FROM edges e
       JOIN entities c ON c.id = e.from_entity_id AND c.kind = 'Commit'
       JOIN entities fr ON fr.id = e.to_entity_id AND fr.kind = 'FileRevision'
       WHERE e.repo_id = $1 AND e.snapshot_id = $2
         AND e.kind = 'MODIFIED'
         AND c.metadata->>'coChangeEligible' = 'true'
       GROUP BY c.id, c.metadata
       ORDER BY sha`,
      [repoId, snapshotId],
    );
    return result.rows
      .filter((row) => row.sha !== null && row.files !== null && row.files.length > 0)
      .map((row) => {
        const eligible = new Set(
          toArray(row.co_change_files).filter(
            (value): value is string => typeof value === "string",
          ),
        );
        const files = (row.files ?? []).filter((file) => eligible.has(file)).sort();
        return {
          sha: row.sha ?? "",
          authoredAt: toIso(row.authored_at) ?? "",
          authorKey: row.author_key ?? "",
          files,
        };
      })
      .filter((row) => row.files.length > 0);
  }

  async getCoChangeDataset(repoId: string, snapshotId: string): Promise<CoChangeDataset | null> {
    const snapshot = await this.getSnapshot(repoId, snapshotId);
    if (snapshot === null) {
      return null;
    }
    const observations = await this.getCommitFileObservations(repoId, snapshotId);
    const limits = snapshot.coverage.limits;
    const windowFrom = readString(limits.coChangeWindowFrom);
    const windowTo = readString(limits.coChangeWindowTo);
    return {
      observations,
      commitsAnalyzed: readNumber(limits.coChangeCommitsAnalyzed) ?? observations.length,
      commitsExcludedOverCap: readNumber(limits.coChangeCommitsExcludedOverCap) ?? 0,
      excludedPaths: readNumber(limits.coChangeExcludedPaths) ?? 0,
      window: { from: windowFrom, to: windowTo },
      warnings: snapshot.coverage.warnings.filter((warning) => /co-change/i.test(warning)),
    };
  }

  async getCoChangeEdges(input: {
    repoId: string;
    snapshotId: string;
    filePath: string;
    limit: number;
  }): Promise<RelationshipRecord[]> {
    const target = await this.client.query<{ id: string }>(
      `SELECT id FROM entities WHERE repo_id = $1 AND kind = 'File' AND canonical_key = $2`,
      [input.repoId, canonicalFileKey(input.filePath)],
    );
    const targetId = target.rows[0]?.id;
    if (targetId === undefined) {
      return [];
    }
    const result = await this.client.query<EdgeRow>(
      `SELECT * FROM edges
       WHERE repo_id = $1 AND snapshot_id = $2 AND kind = 'CO_CHANGED_WITH'
         AND (from_entity_id = $3 OR to_entity_id = $3)
       ORDER BY id LIMIT $4`,
      [input.repoId, input.snapshotId, targetId, Math.min(100, Math.max(1, input.limit))],
    );
    return result.rows.map(mapRelationship);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function mapRepository(row: RepositoryRow): RepositoryRecord {
  return {
    id: row.id,
    githubId: Number(row.github_id),
    owner: row.owner,
    name: row.name,
    defaultBranch: row.default_branch,
    visibility: "public",
    htmlUrl: row.html_url,
    createdAt: toIso(row.created_at) ?? "",
  };
}

function mapSnapshot(row: SnapshotRow): SnapshotRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    headSha: row.head_sha,
    branch: row.branch,
    status: row.status as SnapshotRecord["status"],
    coverage: toObject(row.coverage) as unknown as SnapshotRecord["coverage"],
    toolVersions: toObject(row.tool_versions) as Record<string, string>,
    startedAt: toIso(row.started_at) ?? "",
    completedAt: toIso(row.completed_at),
    errors: toArray(row.errors) as string[],
  };
}

function mapEntity(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    kind: row.kind as EntityRecord["kind"],
    canonicalKey: row.canonical_key,
    title: row.title,
    sourceUrl: row.source_url,
    metadata: toObject(row.metadata),
  };
}

function mapRelationship(row: EdgeRow): RelationshipRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    snapshotId: row.snapshot_id,
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    kind: row.kind as RelationshipRecord["kind"],
    verification: row.verification as RelationshipRecord["verification"],
    sourceUrl: row.source_url,
    sourceEntityId: row.source_entity_id,
    extractor: row.extractor ?? "",
    observedAt: toIso(row.observed_at) ?? "",
    verificationDetail: row.verification_detail,
    evidence: toObject(row.evidence) as RelationshipEvidence,
  };
}

function mapEvidence(row: EvidenceRow): EvidenceChunkRecord {
  return {
    id: row.id,
    repoId: row.repo_id,
    snapshotId: row.snapshot_id,
    entityId: row.entity_id,
    entityKind: row.entity_kind as EvidenceChunkRecord["entityKind"],
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    locator: row.section_locator,
    body: row.body,
    excerpt: row.excerpt,
    contentSha: row.content_sha,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    sourceTimestamp: toIso(row.source_timestamp),
    revision: row.revision,
    chunkIndex: row.chunk_index,
    metadata: toObject(row.metadata),
  };
}

function mapContributor(row: ContributorRow): FileContributorRow {
  return {
    snapshotId: row.snapshot_id,
    path: row.file_path,
    contributorKey: row.contributor_key,
    contributorName: row.contributor_name,
    contributorEmail: row.contributor_email,
    observedCommits: Number(row.observed_commits),
    firstTouch: toIso(row.first_touch),
    lastTouch: toIso(row.last_touch),
    commitShas: toArray(row.commit_shas).filter((value): value is string => typeof value === "string"),
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const text = String(value);
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
