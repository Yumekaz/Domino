import { z } from "zod";
import type pg from "pg";
import { idSchema, repositoryPathSchema } from "../../contracts/src/index.ts";

export const dependencyObservationSchema = z
  .object({
    id: idSchema,
    importingFile: repositoryPathSchema,
    importedFile: repositoryPathSchema,
    dependencyKind: z.string().min(1).max(100),
    sourceLine: z.number().int().positive().nullable(),
    evidence: z.record(z.string(), z.unknown()),
  })
  .strict();
export type DependencyObservation = z.infer<typeof dependencyObservationSchema>;
export interface StoredDependency {
  id: string;
  repo_id: string;
  snapshot_id: string;
  importing_file: string;
  imported_file: string;
  dependency_kind: string;
  source_line: number | null;
  evidence: Record<string, unknown>;
}

/** C can replace structural observations only while the matching snapshot is pending. */
export async function replacePendingDependencies(
  pool: pg.Pool,
  repoId: string,
  snapshotId: string,
  observations: readonly DependencyObservation[],
) {
  idSchema.parse(repoId);
  idSchema.parse(snapshotId);
  if (observations.length > 100_000)
    throw new Error("Dependency batch exceeds the configured limit");
  const data = z.array(dependencyObservationSchema).parse(observations);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const snapshot = await client.query<{ status: string }>(
      "SELECT status FROM index_snapshots WHERE id=$1 AND repo_id=$2 FOR UPDATE",
      [snapshotId, repoId],
    );
    if (snapshot.rows[0]?.status !== "pending")
      throw new Error(
        "Dependencies require a pending snapshot in this repository",
      );
    await client.query(
      "DELETE FROM file_dependencies WHERE repo_id=$1 AND snapshot_id=$2",
      [repoId, snapshotId],
    );
    for (let start = 0; start < data.length; start += 100) {
      const values: unknown[] = [],
        rows: string[] = [];
      for (const item of data.slice(start, start + 100)) {
        const n = values.length;
        rows.push(
          `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},$${n + 8}::jsonb)`,
        );
        values.push(
          item.id,
          repoId,
          snapshotId,
          item.importingFile,
          item.importedFile,
          item.dependencyKind,
          item.sourceLine,
          JSON.stringify(item.evidence),
        );
      }
      await client.query(
        `INSERT INTO file_dependencies(id,repo_id,snapshot_id,importing_file,imported_file,dependency_kind,source_line,evidence) VALUES ${rows.join(",")}`,
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
}

/** Source-to-importer lookups remain scoped to a published revision and bounded. */
export async function findReverseDependencies(
  pool: pg.Pool,
  repoId: string,
  snapshotId: string,
  importedFile: string,
  limit = 500,
) {
  idSchema.parse(repoId);
  idSchema.parse(snapshotId);
  repositoryPathSchema.parse(importedFile);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Invalid dependency result limit");
  const result = await pool.query<StoredDependency>(
    `SELECT d.* FROM file_dependencies d JOIN index_snapshots s ON s.id=d.snapshot_id AND s.repo_id=d.repo_id
    WHERE d.repo_id=$1 AND d.snapshot_id=$2 AND d.imported_file=$3 AND s.status IN ('ready','partial') ORDER BY d.importing_file,d.id LIMIT $4`,
    [repoId, snapshotId, importedFile, limit + 1],
  );
  return {
    rows: result.rows.slice(0, limit),
    truncated: result.rows.length > limit,
  };
}
