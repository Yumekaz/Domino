import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import { expect, it } from "vitest";
import { PostgresHistoryStore } from "../../packages/retrieval/src/postgresStore.ts";
import { PgliteSqlClient } from "../../packages/retrieval/test/support/pgliteClient.ts";
import { scopeHistoryStore } from "../../packages/database/src/history-port.ts";
import { createImpactSource } from "../../apps/api/src/impact-services.ts";
import type { EntityRecord } from "../../packages/core/history/src/types.ts";

it("keeps API co-change at its original revision after a later rename reindex", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL(
          "../../packages/database/migrations/001_initial.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const client = new PgliteSqlClient(db),
      store = new PostgresHistoryStore(client);
    const pool = {
      query: (sql: string, values?: unknown[]) => db.query(sql, values),
      connect: async () => ({
        query: (sql: string, values?: unknown[]) => db.query(sql, values),
        release() {},
      }),
    } as unknown as pg.Pool;
    const repoId = randomUUID(),
      oldId = randomUUID(),
      newId = randomUUID();
    const date = "2026-10-31T00:00:00Z";
    await store.ensureRepository({
      id: repoId,
      githubId: 123,
      owner: "audit",
      name: "fixture",
      defaultBranch: "main",
      visibility: "public",
      htmlUrl: "https://github.com/audit/fixture",
      createdAt: date,
    });
    const entities: EntityRecord[] = [],
      links: { commit: string; revision: string }[] = [];
    for (let n = 0; n < 2; n++) {
      const commit = randomUUID();
      entities.push({
        id: commit,
        repoId,
        kind: "Commit",
        canonicalKey: `commit:${n}`,
        title: "Synthetic audit commit",
        sourceUrl: null,
        metadata: {
          sha: String(n).repeat(40),
          authoredAt: date,
          authorKey: "audit",
          coChangeEligible: true,
          coChangeFiles: ["src/a.ts", "src/b.ts"],
        },
      });
      for (const path of ["src/a.ts", "src/b.ts"]) {
        const revision = randomUUID();
        entities.push({
          id: revision,
          repoId,
          kind: "FileRevision",
          canonicalKey: `${n}:${path}`,
          title: path,
          sourceUrl: null,
          metadata: { currentPath: path },
        });
        links.push({ commit, revision });
      }
    }
    async function index(id: string, sha: string, records: EntityRecord[]) {
      const scoped = scopeHistoryStore(store, pool, { repoId, snapshotId: id });
      await scoped.createSnapshot({
        id,
        repoId,
        headSha: sha,
        branch: "main",
        status: "pending",
        coverage: { sources: {}, warnings: [], limits: {} },
        toolVersions: {},
        startedAt: date,
        completedAt: null,
        errors: [],
      });
      await scoped.upsertEntities(records);
      await scoped.upsertRelationships(
        links.map(({ commit, revision }) => ({
          id: randomUUID(),
          repoId,
          snapshotId: id,
          fromEntityId: commit,
          toEntityId: revision,
          kind: "MODIFIED",
          verification: "observed",
          sourceUrl: null,
          sourceEntityId: commit,
          extractor: "audit-fixture",
          observedAt: date,
          verificationDetail: null,
          evidence: {},
        })),
      );
      await scoped.finalizeSnapshot({
        repoId,
        snapshotId: id,
        status: "ready",
        coverage: { sources: {}, warnings: [], limits: {} },
        errors: [],
        completedAt: date,
      });
    }
    await index(oldId, "a".repeat(40), entities);
    const source = createImpactSource(pool, store);
    const query = { repoId, snapshotId: oldId, targetFile: "src/a.ts" };
    const before = await source.getCoChange!(query);
    expect(before.observations.map((item) => item.file)).toEqual(["src/b.ts"]);
    const renamed = entities.map((entity) => ({
      ...entity,
      metadata:
        entity.kind === "Commit"
          ? {
              ...entity.metadata,
              coChangeFiles: ["src/renamed.ts", "src/b.ts"],
            }
          : {
              ...entity.metadata,
              currentPath:
                entity.metadata.currentPath === "src/a.ts"
                  ? "src/renamed.ts"
                  : entity.metadata.currentPath,
            },
    }));
    await index(newId, "b".repeat(40), renamed);
    expect(await source.getCoChange!(query)).toEqual(before);
    const current = await source.getCoChange!({
      ...query,
      snapshotId: newId,
      targetFile: "src/renamed.ts",
    });
    expect(current.observations.map((item) => item.file)).toEqual(["src/b.ts"]);
  } finally {
    await db.close();
  }
});
