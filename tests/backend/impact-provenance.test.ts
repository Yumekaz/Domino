import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import { expect, it } from "vitest";
import { createStoredImpactService } from "../../apps/api/src/impact-services.ts";
import type { HistoryStore } from "../../packages/core/history/src/ports.ts";

it("links actual stored importer sources at the requested SHA and withholds stale source URLs", async () => {
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
    const repo = randomUUID(),
      snapshot = randomUUID(),
      b = randomUUID(),
      c = randomUUID(),
      sha = "a".repeat(40);
    await db.query(
      "INSERT INTO repositories VALUES ($1,123,'owner','repo','main','public','https://github.com/owner/repo',now())",
      [repo],
    );
    await db.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at,completed_at) VALUES ($1,$2,$3,'main','ready',now(),now())",
      [snapshot, repo, sha],
    );
    for (const [id, path, revision] of [
      [b, "src/b.ts", sha],
      [c, "src/c.ts", "b".repeat(40)],
    ]) {
      await db.query(
        "INSERT INTO entities(id,repo_id,kind,canonical_key) VALUES ($1,$2,'File',$3)",
        [id, repo, path],
      );
      await db.query(
        "INSERT INTO entity_versions VALUES ($1,$2,$3,'File',$4,$5,$6::jsonb)",
        [
          snapshot,
          repo,
          id,
          path,
          `https://github.com/owner/repo/blob/${revision}/${path}`,
          JSON.stringify({ path }),
        ],
      );
    }
    for (const [importer, imported] of [
      ["src/b.ts", "src/a.ts"],
      ["src/c.ts", "src/b.ts"],
    ])
      await db.query(
        "INSERT INTO file_dependencies VALUES ($1,$2,$3,$4,$5,'import',4,'{}')",
        [randomUUID(), repo, snapshot, importer, imported],
      );
    const pool = {
      query: (sql: string, values?: unknown[]) => db.query(sql, values),
    } as unknown as pg.Pool;
    const store = {
      getCoChangeDataset: async () => null,
    } as unknown as HistoryStore;
    const result = await createStoredImpactService(pool, store).analyze(repo, {
      snapshotId: snapshot,
      changedFiles: ["src/a.ts"],
      maxDepth: 3,
    });
    expect(
      result.affected.find((item) => item.file === "src/b.ts")?.evidence[0]
        ?.url,
    ).toBe(`https://github.com/owner/repo/blob/${sha}/src/b.ts#L4`);
    expect(
      result.affected
        .find((item) => item.file === "src/c.ts")
        ?.evidence.find((evidence) => evidence.file === "src/c.ts")?.url,
    ).toBeUndefined();
  } finally {
    await db.close();
  }
});
