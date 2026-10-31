import type pg from "pg";
import {
  entitySchema,
  edgeSchema,
  idSchema,
  type Entity,
  type Edge,
  type GraphQuery,
  type Snapshot,
} from "../../contracts/src/index.ts";

type Db = Pick<pg.Pool, "query">;
export class MissingRecord extends Error {}
type Row = Record<string, unknown>;
const record = (v: unknown): Row =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : {};
const text = (v: unknown) =>
  typeof v === "string" && v.length ? v : undefined;
const date = (v: unknown) => {
  const value =
    v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  return value && Number.isFinite(value.getTime())
    ? value.toISOString()
    : undefined;
};
const safeHttps = (v: unknown) => {
  try {
    const url = new URL(String(v));
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return;
  }
};

export function mapEntity(row: Row): Entity {
  const meta = record(row.metadata);
  const path = text(meta.path) ?? text(meta.currentPath);
  const entity: Record<string, unknown> = {
    id: row.entity_id,
    kind: row.kind,
    title: text(row.title) ?? text(row.canonical_key) ?? String(row.kind),
  };
  const url = safeHttps(row.source_url),
    when =
      date(meta.authoredAt) ?? date(meta.createdAt) ?? date(meta.updatedAt);
  if (url) entity.sourceUrl = url;
  if (when) entity.date = when;
  if (text(meta.excerpt)) entity.excerpt = meta.excerpt;
  if (
    path &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/").every((p) => p && p !== "." && p !== "..")
  )
    entity.path = path;
  return entitySchema.parse(entity);
}
export function mapEdge(row: Row, sha: string): Edge {
  const evidence = record(row.evidence);
  const edge: Record<string, unknown> = {
    id: row.id,
    source: row.from_entity_id,
    target: row.to_entity_id,
    kind: row.kind,
    verification: row.verification,
    snapshotSha: sha,
  };
  const url = safeHttps(row.source_url),
    observed = date(row.observed_at);
  if (url) edge.sourceUrl = url;
  if (text(row.source_entity_id)) edge.sourceEntityId = row.source_entity_id;
  if (text(row.extractor)) edge.extractor = row.extractor;
  if (observed) edge.observedAt = observed;
  if (text(evidence.excerpt)) edge.evidenceExcerpt = evidence.excerpt;
  if (text(evidence.locator)) edge.locator = evidence.locator;
  if (
    Array.isArray(evidence.lineRange) &&
    evidence.lineRange.length === 2 &&
    evidence.lineRange.every((v) => Number.isInteger(v) && v > 0)
  )
    edge.lineRange = evidence.lineRange;
  return edgeSchema.parse(edge);
}
export function mapSnapshot(row: Row): Snapshot {
  const coverage = record(row.coverage),
    sources = record(coverage.sources),
    git = record(sources.gitHistory),
    window = record(git.window);
  const warnings = Array.isArray(coverage.warnings)
    ? coverage.warnings.filter((v): v is string => typeof v === "string")
    : [];
  const data: Snapshot = {
    id: String(row.id),
    headSha: String(row.head_sha),
    branch: String(row.branch),
    status: row.status as Snapshot["status"],
    coverage: Object.entries(sources).map(([kind, value]) => {
      const source = record(value);
      return {
        kind,
        indexed: typeof source.items === "number" ? source.items : 0,
        status: source.status as Snapshot["coverage"][number]["status"],
        warnings: Array.isArray(source.warnings)
          ? source.warnings.filter((v): v is string => typeof v === "string")
          : [],
      };
    }),
    warnings,
  };
  const completed = date(row.completed_at),
    from = date(window.from),
    to = date(window.to);
  if (completed) data.completedAt = completed;
  if (from) data.historyFrom = from;
  if (to) data.historyTo = to;
  return data;
}

export async function publishedSnapshot(
  db: Db,
  repoId: string,
  snapshotId?: string,
): Promise<Row> {
  const result = await db.query<Row>(
    `SELECT * FROM index_snapshots WHERE repo_id=$1 AND status IN ('ready','partial') AND ($2::uuid IS NULL OR id=$2)
     AND ($2::uuid IS NOT NULL OR coalesce(tool_versions->>'purpose','repository')='repository')
     ORDER BY completed_at DESC NULLS LAST,id DESC LIMIT 1`,
    [repoId, snapshotId ?? null],
  );
  if (!result.rows[0])
    throw new MissingRecord(
      "Published snapshot was not found for this repository",
    );
  return result.rows[0];
}
async function versionRows(
  db: Db,
  repoId: string,
  snapshotId: string,
  ids: string[],
): Promise<Row[]> {
  if (!ids.length) return [];
  const result = await db.query<Row>(
    `SELECT v.*,e.canonical_key FROM entity_versions v JOIN entities e ON e.id=v.entity_id AND e.repo_id=v.repo_id
    WHERE v.repo_id=$1 AND v.snapshot_id=$2 AND v.entity_id=ANY($3::uuid[]) ORDER BY v.entity_id`,
    [repoId, snapshotId, ids],
  );
  return result.rows;
}

export async function graphNeighborhood(
  db: Db,
  repoId: string,
  query: GraphQuery,
) {
  const snapshot = await publishedSnapshot(db, repoId, query.snapshotId);
  const root = (
    await versionRows(db, repoId, query.snapshotId, [query.entityId])
  )[0];
  if (!root)
    throw new MissingRecord("Starting record was not found in this snapshot");
  const nodes = new Map<string, Entity>([[query.entityId, mapEntity(root)]]);
  const edges = new Map<string, Edge>();
  const warnings: string[] = [];
  let frontier = [query.entityId],
    truncated = false;
  for (let hop = 0; hop < query.depth && frontier.length; hop++) {
    const remaining = 400 - edges.size;
    if (!remaining) {
      truncated = true;
      break;
    }
    const rows = await db.query<Row>(
      `SELECT * FROM edges WHERE repo_id=$1 AND snapshot_id=$2
      AND (from_entity_id=ANY($3::uuid[]) OR to_entity_id=ANY($3::uuid[]))
      AND (cardinality($4::text[])=0 OR kind=ANY($4::text[]))
      AND ($5::boolean OR verification<>'inferred')
      AND (cardinality($6::text[])=0 OR verification=ANY($6::text[]))
      AND ($7::timestamptz IS NULL OR observed_at >= $7)
      AND ($8::timestamptz IS NULL OR observed_at <= $8)
      ORDER BY id LIMIT $9`,
      [
        repoId,
        query.snapshotId,
        frontier,
        query.relationshipKinds,
        query.includeInferred,
        query.verification,
        query.from ?? null,
        query.to ?? null,
        remaining + 1,
      ],
    );
    if (rows.rows.length > remaining) truncated = true;
    const candidates = rows.rows.slice(0, remaining);
    const ids = [
      ...new Set(
        candidates.flatMap((r) => [
          String(r.from_entity_id),
          String(r.to_entity_id),
        ]),
      ),
    ].filter((id) => !nodes.has(id));
    const versions = await versionRows(db, repoId, query.snapshotId, ids);
    const available = new Map(
      versions.map((row) => [String(row.entity_id), row]),
    );
    const next = new Set<string>();
    for (const row of candidates) {
      const ends = [String(row.from_entity_id), String(row.to_entity_id)];
      const missing = ends.filter((id) => !nodes.has(id));
      if (missing.some((id) => !available.has(id))) {
        truncated = true;
        continue;
      }
      if (
        missing.some(
          (id) =>
            query.nodeKinds.length > 0 &&
            !query.nodeKinds.includes(
              String(
                available.get(id)?.kind,
              ) as GraphQuery["nodeKinds"][number],
            ),
        )
      )
        continue;
      if (nodes.size + missing.length > 200) {
        truncated = true;
        continue;
      }
      for (const id of missing) {
        nodes.set(id, mapEntity(available.get(id)!));
        next.add(id);
      }
      edges.set(String(row.id), mapEdge(row, String(snapshot.head_sha)));
    }
    frontier = [...next];
  }
  if (truncated)
    warnings.push(
      "This neighborhood is bounded or contains records unavailable in this snapshot.",
    );
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    truncated,
    warnings,
    snapshotSha: String(snapshot.head_sha),
  };
}

export async function searchEntities(
  db: Db,
  repoId: string,
  query: string,
  limit: number,
  cursor?: string,
) {
  const snapshot = await publishedSnapshot(db, repoId);
  let after = "00000000-0000-0000-0000-000000000000";
  if (cursor) {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as { snapshotId?: unknown; after?: unknown; query?: unknown };
      if (
        parsed.snapshotId !== snapshot.id ||
        parsed.query !== query ||
        !idSchema.safeParse(parsed.after).success ||
        typeof parsed.after !== "string"
      )
        throw new Error();
      after = parsed.after;
    } catch {
      throw new Error("INVALID_CURSOR");
    }
  }
  const result = await db.query<Row>(
    `SELECT v.*,e.canonical_key FROM entity_versions v JOIN entities e ON e.id=v.entity_id AND e.repo_id=v.repo_id
    WHERE v.repo_id=$1 AND v.snapshot_id=$2 AND v.entity_id>$3::uuid AND (
      $4 = '' OR
      position(lower($4) in lower(coalesce(v.title,'') || ' ' || coalesce(v.metadata->>'path','') || ' ' || e.canonical_key))>0
      OR EXISTS(SELECT 1 FROM evidence_documents d WHERE d.repo_id=$1 AND d.snapshot_id=$2 AND d.entity_id=v.entity_id AND d.search_tsv @@ websearch_to_tsquery('english',$4)))
    ORDER BY v.entity_id LIMIT $5`,
    [repoId, snapshot.id, after, query, limit + 1],
  );
  const rows = result.rows.slice(0, limit);
  const nextCursor =
    result.rows.length > limit
      ? Buffer.from(
          JSON.stringify({
            snapshotId: snapshot.id,
            after: rows.at(-1)?.entity_id,
            query,
          }),
        ).toString("base64url")
      : null;
  return {
    items: rows.map(mapEntity),
    nextCursor,
    snapshotSha: String(snapshot.head_sha),
  };
}

export async function entityDetail(
  db: Db,
  repoId: string,
  entityId: string,
  snapshotId?: string,
) {
  const snapshot = await publishedSnapshot(db, repoId, snapshotId);
  const graph = await graphNeighborhood(db, repoId, {
    snapshotId: String(snapshot.id),
    entityId,
    depth: 1,
    nodeKinds: [],
    relationshipKinds: [],
    includeInferred: false,
    verification: [],
  });
  const entity = graph.nodes.find((node) => node.id === entityId)!;
  const rows = await db.query<Row>(
    `SELECT * FROM evidence_documents WHERE repo_id=$1 AND snapshot_id=$2 AND entity_id=$3 ORDER BY chunk_index,id LIMIT 30`,
    [repoId, snapshot.id, entityId],
  );
  const sources = rows.rows.map((r) => ({
    id: r.id,
    kind: r.source_kind,
    url: safeHttps(r.source_url),
    locator: r.section_locator,
    excerpt: r.excerpt,
    observedAt: date(r.source_timestamp),
    revision: r.revision,
    contentSha: r.content_sha,
  }));
  return {
    entity,
    neighbors: graph.nodes.filter((n) => n.id !== entityId),
    edges: graph.edges,
    sources,
    snapshotSha: graph.snapshotSha,
    truncated: graph.truncated,
    warnings: graph.warnings,
  };
}
