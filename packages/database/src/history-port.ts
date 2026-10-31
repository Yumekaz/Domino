import type pg from "pg";

interface HistoryEntity {
  id: string;
  repoId: string;
  kind: string;
  canonicalKey: string;
  title: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Adapt B's stable identity store to immutable per-snapshot entity views.
 * A snapshot is invisible until B publishes it; failed writes remain unpublished.
 */
export function scopeHistoryStore<T extends object>(
  base: T,
  pool: pg.Pool,
  scope: {
    repoId: string;
    snapshotId: string;
    githubId?: number;
    structuralUnavailable?: boolean;
  },
): T {
  async function readEntities(ids: string[]): Promise<HistoryEntity[]> {
    if (!ids.length) return [];
    const result = await pool.query(
      `SELECT v.entity_id AS id,v.repo_id,v.kind,e.canonical_key,v.title,v.source_url,v.metadata
      FROM entity_versions v JOIN entities e ON e.id=v.entity_id AND e.repo_id=v.repo_id
      WHERE v.repo_id=$1 AND v.snapshot_id=$2 AND v.entity_id=ANY($3::uuid[]) ORDER BY v.entity_id`,
      [scope.repoId, scope.snapshotId, ids],
    );
    return result.rows.map((r) => ({
      id: r.id,
      repoId: r.repo_id,
      kind: r.kind,
      canonicalKey: r.canonical_key,
      title: r.title,
      sourceUrl: r.source_url,
      metadata: r.metadata,
    }));
  }
  const assertRepo = (id: unknown) => {
    if (id !== scope.repoId)
      throw new Error("History port rejected a different repository");
  };
  return new Proxy(base, {
    get(target, key, receiver) {
      const original = Reflect.get(target, key, receiver) as unknown;
      if (typeof original !== "function") return original;
      if (key === "ensureRepository")
        return async (repo: { id: string; githubId: number }) => {
          assertRepo(repo.id);
          if (scope.githubId !== undefined && repo.githubId !== scope.githubId)
            throw new Error("GitHub repository identity changed during import");
          return await original.call(receiver, repo);
        };
      if (key === "createSnapshot")
        return async (snapshot: { id: string; repoId: string }) => {
          assertRepo(snapshot.repoId);
          if (snapshot.id !== scope.snapshotId)
            throw new Error("Unexpected snapshot ID");
          const existing = await pool.query<{ status: string }>(
            "SELECT status FROM index_snapshots WHERE id=$1 AND repo_id=$2",
            [scope.snapshotId, scope.repoId],
          );
          if (
            existing.rows[0] &&
            ["ready", "partial"].includes(existing.rows[0].status)
          )
            throw new Error("Published snapshots cannot be rewritten");
          await pool.query(
            "DELETE FROM entity_versions WHERE snapshot_id=$1 AND repo_id=$2",
            [scope.snapshotId, scope.repoId],
          );
          return await original.call(receiver, snapshot);
        };
      if (key === "finalizeSnapshot")
        return async (input: {
          repoId: string;
          snapshotId: string;
          status: string;
          coverage: { sources: Record<string, unknown>; warnings: string[] };
        }) => {
          assertRepo(input.repoId);
          if (input.snapshotId !== scope.snapshotId)
            throw new Error("Unexpected snapshot ID");
          const current = await pool.query<{ status: string }>(
            "SELECT status FROM index_snapshots WHERE id=$1 AND repo_id=$2",
            [scope.snapshotId, scope.repoId],
          );
          if (current.rows[0]?.status !== "pending")
            throw new Error("Only a pending snapshot can be finalized");
          if (
            scope.structuralUnavailable &&
            (input.status === "ready" || input.status === "partial")
          ) {
            const warning =
              "Static dependency analysis was not performed; change impact is unavailable.";
            return await original.call(receiver, {
              ...input,
              status: "partial",
              coverage: {
                ...input.coverage,
                sources: {
                  ...input.coverage.sources,
                  structural: {
                    source: "structural",
                    status: "not_attempted",
                    pagesFetched: 0,
                    items: 0,
                    capHit: false,
                    warnings: [warning],
                    window: null,
                  },
                },
                warnings: [...new Set([...input.coverage.warnings, warning])],
              },
            });
          }
          return await original.call(receiver, input);
        };
      if (key === "upsertEntities")
        return async (entities: HistoryEntity[]) => {
          if (entities.some((entity) => entity.repoId !== scope.repoId))
            throw new Error("Entity belongs to a different repository");
          await original.call(receiver, entities);
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            for (let start = 0; start < entities.length; start += 150) {
              const values: unknown[] = [],
                rows: string[] = [];
              for (const entity of entities.slice(start, start + 150)) {
                const n = values.length;
                rows.push(
                  `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7}::jsonb)`,
                );
                values.push(
                  scope.snapshotId,
                  scope.repoId,
                  entity.id,
                  entity.kind,
                  entity.title,
                  entity.sourceUrl,
                  JSON.stringify(entity.metadata),
                );
              }
              await client.query(
                `INSERT INTO entity_versions(snapshot_id,repo_id,entity_id,kind,title,source_url,metadata)
              VALUES ${rows.join(",")} ON CONFLICT(snapshot_id,entity_id) DO UPDATE SET kind=EXCLUDED.kind,title=EXCLUDED.title,source_url=EXCLUDED.source_url,metadata=EXCLUDED.metadata`,
                values,
              );
            }
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        };
      if (key === "getEntity")
        return async (repoId: string, id: string) => {
          assertRepo(repoId);
          return (await readEntities([id]))[0] ?? null;
        };
      if (key === "getEntities")
        return async (repoId: string, ids: string[]) => {
          assertRepo(repoId);
          return await readEntities(ids);
        };
      if (key === "getCommitFileObservations")
        return async (repoId: string, snapshotId: string) => {
          assertRepo(repoId);
          if (snapshotId !== scope.snapshotId)
            throw new Error("History port rejected a different snapshot");
          const result = await pool.query<{
            sha: string | null;
            authored_at: string | null;
            author_key: string | null;
            co_change_files: unknown;
            files: string[] | null;
          }>(
            `SELECT c.metadata->>'sha' AS sha,c.metadata->>'authoredAt' AS authored_at,c.metadata->>'authorKey' AS author_key,
             c.metadata->'coChangeFiles' AS co_change_files,
             array_agg(DISTINCT fr.metadata->>'currentPath') FILTER (WHERE fr.metadata->>'currentPath' IS NOT NULL) AS files
           FROM edges e JOIN entity_versions c ON c.repo_id=e.repo_id AND c.snapshot_id=e.snapshot_id AND c.entity_id=e.from_entity_id AND c.kind='Commit'
           JOIN entity_versions fr ON fr.repo_id=e.repo_id AND fr.snapshot_id=e.snapshot_id AND fr.entity_id=e.to_entity_id AND fr.kind='FileRevision'
           WHERE e.repo_id=$1 AND e.snapshot_id=$2 AND e.kind='MODIFIED' AND c.metadata->>'coChangeEligible'='true'
           GROUP BY c.entity_id,c.metadata ORDER BY sha`,
            [repoId, snapshotId],
          );
          return result.rows.flatMap((row) => {
            const eligible = new Set(
              Array.isArray(row.co_change_files)
                ? row.co_change_files.filter(
                    (v): v is string => typeof v === "string",
                  )
                : [],
            );
            const files = (row.files ?? [])
              .filter((file) => eligible.has(file))
              .sort();
            return row.sha && files.length
              ? [
                  {
                    sha: row.sha,
                    authoredAt: row.authored_at ?? "",
                    authorKey: row.author_key ?? "",
                    files,
                  },
                ]
              : [];
          });
        };
      if (key === "getNeighbors")
        return async (query: { repoId: string; snapshotId: string }) => {
          assertRepo(query.repoId);
          if (query.snapshotId !== scope.snapshotId)
            throw new Error("History port rejected a different snapshot");
          const result = (await original.call(receiver, query)) as {
            nodes: { id: string }[];
            edges: { fromEntityId: string; toEntityId: string }[];
            truncated: boolean;
            warnings: string[];
          };
          const nodes = await readEntities(result.nodes.map((node) => node.id));
          const ids = new Set(nodes.map((node) => node.id));
          const edges = result.edges.filter(
            (edge) => ids.has(edge.fromEntityId) && ids.has(edge.toEntityId),
          );
          const omitted =
            nodes.length !== result.nodes.length ||
            edges.length !== result.edges.length;
          return {
            ...result,
            nodes,
            edges,
            truncated: result.truncated || omitted,
            warnings: omitted
              ? [
                  ...result.warnings,
                  "Some records were unavailable in this snapshot.",
                ]
              : result.warnings,
          };
        };
      return (...args: unknown[]) => original.apply(receiver, args);
    },
  });
}
