import { randomUUID } from "node:crypto";
import type pg from "pg";
import { idSchema, repositoryPathSchema } from "../../contracts/src/index.ts";

export type StructuralImportRecord = {
  importer: string;
  imported: string;
  specifier: string;
  dependencyTypes: string[];
  dynamic: boolean;
  circular: boolean;
  extractor: string;
  analyzerVersion: string;
  configHash: string;
  snapshotSha: string;
  evidence: { type: "import"; specifier: string; line: number | null };
};

type RepositoryIdentity = {
  owner: string;
  name: string;
};

type EdgeRow = {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  source_url: string;
  evidence: Record<string, unknown>;
};

const stringValue = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const booleanValue = (value: unknown): boolean => value === true;

function normalizedImports(
  imports: readonly StructuralImportRecord[],
): StructuralImportRecord[] {
  const unique = new Map<string, StructuralImportRecord>();
  for (const item of imports) {
    const importer = repositoryPathSchema.parse(item.importer);
    const imported = repositoryPathSchema.parse(item.imported);
    if (importer === imported) continue;
    const key = JSON.stringify([importer, imported, item.specifier, item.dynamic]);
    if (!unique.has(key)) {
      unique.set(key, {
        ...item,
        importer,
        imported,
        dependencyTypes: [...new Set(item.dependencyTypes)],
      });
    }
  }
  return [...unique.values()];
}

function blobUrl(
  repository: RepositoryIdentity,
  headSha: string,
  path: string,
): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/blob/${headSha}/${encoded}`;
}

function dependencyEvidence(item: StructuralImportRecord): Record<string, unknown> {
  return {
    specifier: item.specifier,
    dependencyTypes: item.dependencyTypes,
    dynamic: item.dynamic,
    circular: item.circular,
    extractor: item.extractor,
    analyzerVersion: item.analyzerVersion,
    configHash: item.configHash,
  };
}

/**
 * Replaces snapshot-scoped structural observations while the snapshot is still
 * pending. File dependencies feed the impact engine; IMPORTS edges feed the
 * graph. Missing File records are reported, never invented.
 */
export async function replacePendingStructural(
  pool: pg.Pool,
  repoId: string,
  snapshotId: string,
  imports: readonly StructuralImportRecord[],
  repository: RepositoryIdentity,
  headSha: string,
): Promise<{ dependencies: number; edges: number; missingEntities: number }> {
  idSchema.parse(repoId);
  idSchema.parse(snapshotId);
  if (!/^[a-f0-9]{40}$/.test(headSha))
    throw new Error("A full indexed revision is required for structural imports");
  if (imports.length > 100_000)
    throw new Error("Structural import batch exceeds the configured limit");
  const data = normalizedImports(imports);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const snapshot = await client.query<{ status: string }>(
      "SELECT status FROM index_snapshots WHERE id=$1 AND repo_id=$2 FOR UPDATE",
      [snapshotId, repoId],
    );
    if (snapshot.rows[0]?.status !== "pending")
      throw new Error(
        "Structural imports require a pending snapshot in this repository",
      );
    await client.query(
      "DELETE FROM file_dependencies WHERE repo_id=$1 AND snapshot_id=$2",
      [repoId, snapshotId],
    );
    await client.query(
      "DELETE FROM edges WHERE repo_id=$1 AND snapshot_id=$2 AND kind='IMPORTS'",
      [repoId, snapshotId],
    );
    const paths = [
      ...new Set(data.flatMap((item) => [item.importer, item.imported])),
    ].sort();
    const entities = await client.query<{ entity_id: string; path: string }>(
      `SELECT entity_id,metadata->>'path' AS path FROM entity_versions
       WHERE repo_id=$1 AND snapshot_id=$2 AND kind='File'
       AND metadata->>'path' = ANY($3::text[])`,
      [repoId, snapshotId, paths],
    );
    const entityByPath = new Map(
      entities.rows.map((row) => [row.path, row.entity_id]),
    );
    const missing = new Set(
      paths.filter((path) => !entityByPath.has(path)),
    );
    for (let start = 0; start < data.length; start += 100) {
      const batch = data.slice(start, start + 100);
      const values: unknown[] = [];
      const rows: string[] = [];
      for (const item of batch) {
        const n = values.length;
        rows.push(
          `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},$${n + 8}::jsonb)`,
        );
        values.push(
          randomUUID(),
          repoId,
          snapshotId,
          item.importer,
          item.imported,
          "import",
          item.evidence.line,
          JSON.stringify(dependencyEvidence(item)),
        );
      }
      await client.query(
        `INSERT INTO file_dependencies(id,repo_id,snapshot_id,importing_file,imported_file,dependency_kind,source_line,evidence)
         VALUES ${rows.join(",")}`,
        values,
      );
    }
    const edgeRows: EdgeRow[] = data.flatMap((item) => {
      const from = entityByPath.get(item.importer);
      const to = entityByPath.get(item.imported);
      if (!from || !to) return [];
      const locator = `${item.importer}${item.evidence.line ? `:${item.evidence.line}` : ""}`;
      return [
        {
          id: randomUUID(),
          from_entity_id: from,
          to_entity_id: to,
          source_url: blobUrl(repository, headSha, item.importer),
          evidence: {
            excerpt: `${locator} imports ${item.specifier}`,
            locator,
            specifier: item.specifier,
            dynamic: item.dynamic,
            circular: item.circular,
            dependencyTypes: item.dependencyTypes,
            analyzerVersion: item.analyzerVersion,
            configHash: item.configHash,
          },
        },
      ];
    });
    for (let start = 0; start < edgeRows.length; start += 100) {
      const batch = edgeRows.slice(start, start + 100);
      const values: unknown[] = [];
      const rows: string[] = [];
      for (const item of batch) {
        const n = values.length;
        rows.push(
          `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},'IMPORTS','observed',$${n + 6},'dependency-cruiser','static import at the indexed revision',now(),$${n + 7}::jsonb)`,
        );
        values.push(
          item.id,
          repoId,
          snapshotId,
          item.from_entity_id,
          item.to_entity_id,
          item.source_url,
          JSON.stringify(item.evidence),
        );
      }
      await client.query(
        `INSERT INTO edges(id,repo_id,snapshot_id,from_entity_id,to_entity_id,kind,verification,source_url,extractor,verification_detail,observed_at,evidence)
         VALUES ${rows.join(",")}`,
        values,
      );
    }
    await client.query("COMMIT");
    return {
      dependencies: data.length,
      edges: edgeRows.length,
      missingEntities: missing.size,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Reads stored structural observations for C's impact/PR services. */
export async function readStructuralImports(
  pool: Pick<pg.Pool, "query">,
  repoId: string,
  snapshotId: string,
  snapshotSha: string,
): Promise<StructuralImportRecord[]> {
  idSchema.parse(repoId);
  idSchema.parse(snapshotId);
  const result = await pool.query<{
    importing_file: string;
    imported_file: string;
    dependency_kind: string;
    source_line: number | null;
    evidence: Record<string, unknown> | null;
  }>(
    `SELECT importing_file,imported_file,dependency_kind,source_line,evidence
     FROM file_dependencies WHERE repo_id=$1 AND snapshot_id=$2
     ORDER BY importing_file,imported_file,id`,
    [repoId, snapshotId],
  );
  return result.rows.map((row) => {
    const evidence = row.evidence ?? {};
    const specifier = stringValue(evidence.specifier, row.dependency_kind);
    return {
      importer: row.importing_file,
      imported: row.imported_file,
      specifier,
      dependencyTypes: Array.isArray(evidence.dependencyTypes)
        ? evidence.dependencyTypes.filter(
            (value): value is string => typeof value === "string",
          )
        : [row.dependency_kind],
      dynamic: booleanValue(evidence.dynamic),
      circular: booleanValue(evidence.circular),
      extractor: stringValue(evidence.extractor, "dependency-cruiser"),
      analyzerVersion: stringValue(evidence.analyzerVersion, "unknown"),
      configHash: stringValue(evidence.configHash, "unknown"),
      snapshotSha,
      evidence: {
        type: "import",
        specifier,
        line: row.source_line,
      },
    };
  });
}
