import type pg from "pg";
import type { ImpactServicePort } from "../../../packages/contracts/src/index.ts";
import {
  createImpactService,
  type ImpactServiceSource,
} from "../../../packages/core/impact/src/service.ts";
import type { CoChangeResult } from "../../../packages/core/impact/src/types.ts";
import {
  computeCoChange,
  type CoChangeDataset,
} from "../../../packages/core/history/src/cochange.ts";
import { PostgresHistoryStore } from "../../../packages/retrieval/src/postgresStore.ts";
import { PgSqlClient } from "../../../packages/retrieval/src/pgClient.ts";
import { findReverseDependencies } from "../../../packages/database/src/dependencies.ts";
import { publishedSnapshot } from "../../../packages/database/src/read-model.ts";
import { scopeHistoryStore } from "../../../packages/database/src/history-port.ts";
import type { HistoryStore } from "../../../packages/core/history/src/ports.ts";

export type ImpactServices = {
  impact: ImpactServicePort;
  close(): Promise<void>;
};

/**
 * Composes C's deterministic impact service over A's snapshot-scoped storage
 * and B's observed co-change dataset. No browser computation is involved.
 */
export function createImpactServices(
  pool: pg.Pool,
  databaseUrl: string,
): ImpactServices {
  const client = new PgSqlClient({ connectionString: databaseUrl, max: 2 });
  const store = new PostgresHistoryStore(client);
  return {
    impact: createStoredImpactService(pool, store),
    close: () => client.close(),
  };
}

export function createStoredImpactService(
  pool: pg.Pool,
  store: HistoryStore,
): ImpactServicePort {
  const engine = createImpactService(createImpactSource(pool, store));
  return {
    async analyze(repoId, input) {
      const result = await engine.analyze(repoId, input);
      const files = [
        ...new Set(
          result.affected.flatMap((item) =>
            item.evidence.map((evidence) => evidence.file),
          ),
        ),
      ];
      if (!files.length) return result;
      const rows = await pool.query<{
        path: string;
        source_url: string | null;
      }>(
        `SELECT metadata->>'path' AS path,source_url FROM entity_versions
      WHERE repo_id=$1 AND snapshot_id=$2 AND kind='File' AND metadata->>'path'=ANY($3::text[])`,
        [repoId, input.snapshotId, files],
      );
      const urls = new Map<string, string>();
      for (const row of rows.rows) {
        if (!row.source_url) continue;
        try {
          const url = new URL(row.source_url);
          if (
            url.protocol === "https:" &&
            url.hostname === "github.com" &&
            !url.username &&
            !url.password &&
            url.pathname.includes(`/blob/${result.snapshotSha}/`)
          )
            urls.set(row.path, url.toString());
        } catch {
          /* Missing or invalid provenance stays unavailable. */
        }
      }
      return {
        ...result,
        affected: result.affected.map((item) => ({
          ...item,
          evidence: item.evidence.map((evidence) => {
            const source = urls.get(evidence.file);
            return source
              ? {
                  ...evidence,
                  url: source + (evidence.line ? `#L${evidence.line}` : ""),
                }
              : evidence;
          }),
        })),
      };
    },
  };
}

export function createImpactSource(
  pool: pg.Pool,
  store: HistoryStore,
): ImpactServiceSource {
  const source: ImpactServiceSource = {
    async getPublishedSnapshot(repoId, snapshotId) {
      const snapshot = await publishedSnapshot(pool, repoId, snapshotId);
      return { id: String(snapshot.id), headSha: String(snapshot.head_sha) };
    },
    async findReverseDependencies(input) {
      const result = await findReverseDependencies(
        pool,
        input.repoId,
        input.snapshotId,
        input.importedFile,
        Math.min(input.limit, 500),
      );
      return {
        rows: result.rows.map((row) => ({
          importingFile: row.importing_file,
          importedFile: row.imported_file,
          dependencyKind: row.dependency_kind,
          sourceLine: row.source_line,
          evidence: row.evidence,
        })),
        truncated: result.truncated,
      };
    },
    async getCoChange(input): Promise<CoChangeResult> {
      const scoped = scopeHistoryStore(store, pool, {
        repoId: input.repoId,
        snapshotId: input.snapshotId,
      });
      const dataset = (await scoped.getCoChangeDataset(
        input.repoId,
        input.snapshotId,
      )) as CoChangeDataset | null;
      if (!dataset) {
        throw new Error(
          "The snapshot has no observed co-change dataset; structural results remain available.",
        );
      }
      return computeCoChange(dataset, input.targetFile, {
        minSupport: 2,
        maxResults: 20,
        maxFilesPerCommit: 50,
      });
    },
  };
  return source;
}
