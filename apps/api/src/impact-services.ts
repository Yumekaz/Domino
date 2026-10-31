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
      const dataset = (await store.getCoChangeDataset(
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
  return {
    impact: createImpactService(source),
    close: () => client.close(),
  };
}
