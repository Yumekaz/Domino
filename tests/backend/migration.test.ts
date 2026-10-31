import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("supports isolated reindexes and rejects cross-repository edges and concurrent active jobs", async () => {
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
    const [repo, other, snap1, snap2, entity, otherEntity, evidence] =
      Array.from({ length: 7 }, () => randomUUID());
    const sha = "a".repeat(40);
    await db.query(
      "INSERT INTO repositories VALUES ($1,1,'one','repo','main','public','https://github.com/one/repo',now()),($2,2,'two','repo','main','public','https://github.com/two/repo',now())",
      [repo, other],
    );
    await db.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at) VALUES ($1,$3,$4,'main','ready',now()),($2,$3,$4,'main','pending',now())",
      [snap1, snap2, repo, sha],
    );
    await db.query(
      "INSERT INTO entities(id,repo_id,kind,canonical_key) VALUES ($1,$2,'File','a'),($3,$4,'File','b')",
      [entity, repo, otherEntity, other],
    );
    await expect(
      db.query(
        "INSERT INTO edges(id,repo_id,snapshot_id,from_entity_id,to_entity_id,kind,verification) VALUES ($1,$2,$3,$4,$5,'IMPORTS','observed')",
        [randomUUID(), repo, snap1, entity, otherEntity],
      ),
    ).rejects.toThrow();
    const insertEvidence =
      "INSERT INTO evidence_documents(id,repo_id,snapshot_id,entity_id,source_url,source_kind,source_id,content_sha,section_locator,body,excerpt,revision,chunk_index,search_tsv) VALUES ($1,$2,$3,$4,'https://github.com/one/repo','commit','source','hash','locator','body','body',$5,0,to_tsvector('english','body'))";
    await db.query(insertEvidence, [evidence, repo, snap1, entity, sha]);
    await db.query(insertEvidence, [evidence, repo, snap2, entity, sha]);
    const stored = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM evidence_documents WHERE id=$1",
      [evidence],
    );
    expect(stored.rows[0].count).toBe(2);
    const insertJob =
      "INSERT INTO import_jobs(id,repo_id,snapshot_id,url,head_sha,branch,status,phase) VALUES ($1,$2,$3,'https://github.com/one/repo',$4,'main','queued','queued')";
    await db.query(insertJob, [randomUUID(), repo, randomUUID(), sha]);
    await expect(
      db.query(insertJob, [randomUUID(), repo, randomUUID(), sha]),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
