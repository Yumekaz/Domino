import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { scopeHistoryStore } from "../../packages/database/src/history-port.ts";

describe("snapshot-scoped HTTP APIs", () => {
  const ids = Array.from({ length: 8 }, () => randomUUID());
  const [repo, other, oldSnap, newSnap, file, issue, commit, job] = ids;
  const oldSha = "a".repeat(40),
    newSha = "b".repeat(40);
  let db: PGlite;
  let app: ReturnType<typeof createApp>;
  let pool: pg.Pool;
  const resolveRepo = vi.fn(async () => ({
    githubId: 7,
    owner: "owner",
    name: "repo",
    url: "https://github.com/owner/repo",
    branch: "main",
    headSha: oldSha,
  }));
  const enqueue = vi.fn(async () => ({ repoId: repo, jobId: job }));
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      await readFile(
        new URL(
          "../../packages/database/migrations/001_initial.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    pool = {
      query: (sql: string, values: unknown[]) => db.query(sql, values),
    } as unknown as pg.Pool;
    const boss = {
      getQueue: async () => ({ name: "history.import" }),
      getJobById: async () => ({ state: "failed" }),
    } as unknown as PgBoss;
    app = createApp({
      pool,
      boss,
      history: null,
      token: "test-secret",
      resolveRepo,
      enqueue: enqueue as never,
      logger: false,
    });
    await db.query(
      "INSERT INTO repositories VALUES ($1,7,'owner','repo','main','public','https://github.com/owner/repo',now()),($2,8,'other','repo','main','public','https://github.com/other/repo',now())",
      [repo, other],
    );
    await db.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at,completed_at) VALUES ($1,$3,$4,'main','ready',now(),now()-interval '1 second'),($2,$3,$5,'main','ready',now(),now())",
      [oldSnap, newSnap, repo, oldSha, newSha],
    );
    for (const [id, kind, key] of [
      [file, "File", "file:auth"],
      [issue, "Issue", "issue:1"],
      [commit, "Commit", "commit:1"],
    ])
      await db.query(
        "INSERT INTO entities(id,repo_id,kind,canonical_key,title,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
        [id, repo, kind, key, "NEW GLOBAL TITLE", "{}"],
      );
    for (const [id, kind, title, metadata] of [
      [file, "File", "Old auth", '{"path":"src/auth.ts"}'],
      [issue, "Issue", "Old auth issue", "{}"],
      [commit, "Commit", "Old commit", "{}"],
    ])
      await db.query(
        "INSERT INTO entity_versions VALUES ($1,$2,$3,$4,$5,NULL,$6::jsonb)",
        [oldSnap, repo, id, kind, title, metadata],
      );
    await db.query(
      "INSERT INTO entity_versions VALUES ($1,$2,$3,'File','New auth',NULL,'{\"path\":\"src/auth.ts\"}')",
      [newSnap, repo, file],
    );
    await db.query(
      "INSERT INTO entity_versions VALUES ($1,$2,$3,'Issue','New auth issue',NULL,'{}')",
      [newSnap, repo, issue],
    );
    await db.query(
      "INSERT INTO edges(id,repo_id,snapshot_id,from_entity_id,to_entity_id,kind,verification) VALUES ($1,$2,$3,$4,$5,'REFERENCES','observed'),($6,$2,$3,$5,$7,'REFERENCES','inferred')",
      [randomUUID(), repo, oldSnap, file, issue, randomUUID(), commit],
    );
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  const auth = { authorization: "Bearer test-secret" };
  it("enforces authentication, origin and bounded validated input", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/health" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/health",
          headers: { ...auth, origin: "https://untrusted.example" },
        })
      ).statusCode,
    ).toBe(403);
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/repositories",
      headers: auth,
      payload: { url: "https://github.com.evil.example/owner/repo" },
    });
    expect(bad.statusCode).toBe(400);
    expect(resolveRepo).not.toHaveBeenCalled();
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/repositories",
      headers: auth,
      payload: { url: "https://github.com/owner/repo" },
    });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toEqual({ repoId: repo, jobId: job });
  });
  it("returns only the requested snapshot versions and excludes inferred edges by default", async () => {
    const base = `/api/v1/repositories/${repo}/graph?snapshotId=${oldSnap}&entityId=${file}&depth=2`;
    const response = await app.inject({
      method: "GET",
      url: base,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .nodes.map((n: { title: string }) => n.title)
        .sort(),
    ).toEqual(["Old auth", "Old auth issue"]);
    expect(response.json().snapshotSha).toBe(oldSha);
    expect(response.json().edges).toHaveLength(1);
    const expanded = await app.inject({
      method: "GET",
      url: `${base}&includeInferred=true`,
      headers: auth,
    });
    expect(expanded.statusCode).toBe(200);
    expect(expanded.json().nodes).toHaveLength(3);
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repo}/entities/${file}?snapshotId=${oldSnap}`,
      headers: auth,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      entity: { title: "Old auth" },
      snapshotSha: oldSha,
    });
    const outside = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${other}/graph?snapshotId=${oldSnap}&entityId=${file}`,
      headers: auth,
    });
    expect(outside.statusCode).toBe(404);
  });
  it("paginates against a stable snapshot and fails explicitly when C is unavailable", async () => {
    const first = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repo}/search?q=auth&limit=1`,
      headers: auth,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(1);
    expect(first.json().nextCursor).toBeTruthy();
    const next = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repo}/search?q=auth&limit=1&cursor=${first.json().nextCursor}`,
      headers: auth,
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().items[0].id).not.toBe(first.json().items[0].id);
    const wrongQuery = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repo}/search?q=other&limit=1&cursor=${first.json().nextCursor}`,
      headers: auth,
    });
    expect(wrongQuery.statusCode).toBe(400);
    const impact = await app.inject({
      method: "POST",
      url: `/api/v1/repositories/${repo}/impact`,
      headers: auth,
      payload: { snapshotId: newSnap, changedFiles: ["src/auth.ts"] },
    });
    expect(impact.statusCode).toBe(503);
    expect(impact.json().code).toBe("ANALYZER_UNSUPPORTED");
  });
  it("shows an actual pending run without inventing a report", async () => {
    const run = randomUUID();
    const input = {
      prNumber: 12,
      baseSha: oldSha,
      headSha: newSha,
      event: "opened",
      stale: false,
      idempotencyKey: "12:" + newSha,
    };
    await db.query(
      "INSERT INTO analysis_runs(id,repo_id,snapshot_id,kind,status,input,warnings) VALUES ($1,$2,$3,'pr','queued',$4::jsonb,'[]')",
      [run, repo, newSnap, JSON.stringify(input)],
    );
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repo}/analysis/${run}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: run,
      status: "queued",
      headSha: newSha,
      result: null,
    });
  });
  it("reconciles a failed queue job that never published a snapshot", async () => {
    const failedJob = randomUUID();
    await db.query(
      "INSERT INTO import_jobs(id,repo_id,snapshot_id,url,head_sha,branch,status,phase) VALUES ($1,$2,$3,'https://github.com/owner/repo',$4,'main','running','linking')",
      [failedJob, repo, randomUUID(), newSha],
    );
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repo}/jobs/${failedJob}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: failedJob,
      status: "failed",
      phase: "failed",
    });
  });
  it("adapts B entity lookups to the requested immutable snapshot", async () => {
    const base = {
      getEntity: async () => {
        throw new Error("global identity read must not run");
      },
    };
    const scoped = scopeHistoryStore(base, pool, {
      repoId: repo,
      snapshotId: oldSnap,
    });
    const getEntity = scoped.getEntity as (
      repo: string,
      id: string,
    ) => Promise<{ title: string } | null>;
    expect((await getEntity(repo, file))?.title).toBe("Old auth");
    await expect(getEntity(other, file)).rejects.toThrow(
      "different repository",
    );
  });
  it("marks history partial when structural analysis was not performed", async () => {
    const finalize = vi.fn(async (input: unknown) => input);
    const pendingSnapshot = randomUUID();
    await db.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at) VALUES ($1,$2,$3,'main','pending',now())",
      [pendingSnapshot, repo, oldSha],
    );
    const scoped = scopeHistoryStore({ finalizeSnapshot: finalize }, pool, {
      repoId: repo,
      snapshotId: pendingSnapshot,
      structuralUnavailable: true,
    });
    const publish = scoped.finalizeSnapshot as (
      input: unknown,
    ) => Promise<unknown>;
    await publish({
      repoId: repo,
      snapshotId: pendingSnapshot,
      status: "ready",
      coverage: { sources: {}, warnings: [], limits: {} },
    });
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "partial",
        coverage: expect.objectContaining({
          warnings: expect.arrayContaining([
            expect.stringContaining(
              "Static dependency analysis was not performed",
            ),
          ]),
        }),
      }),
    );
  });
});
