import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  analysisSchema,
  type Impact,
} from "../../packages/contracts/src/index.ts";

const head = "a".repeat(40);
const base = "b".repeat(40);
const repoId = randomUUID();
const actionsUrl = "https://github.com/owner/repo/actions/runs/123";
const prUrl = "https://github.com/owner/repo/pull/12";
const impact: Impact = {
  changedFiles: ["src/auth.ts"],
  snapshotSha: head,
  affected: [
    {
      file: "src/session.ts",
      signal: "static_reverse_dependency",
      depth: 1,
      path: ["src/session.ts", "src/auth.ts"],
      impact: "possible",
      explanation: "Static reverse dependency path.",
      evidence: [{ type: "import", file: "src/session.ts", line: 4 }],
    },
  ],
  warnings: [],
  truncated: false,
};

describe("automatic PR analysis ingestion", () => {
  let db: PGlite;
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  const resolvePull = vi.fn(async (_url: string, prNumber: number) => ({
    number: prNumber,
    baseSha: base,
    headSha: head,
    prUrl,
    changedFiles: ["src/auth.ts"],
    truncated: false,
  }));
  const auth = { authorization: "Bearer test-secret" };
  const payload = {
    repositoryUrl: "https://github.com/owner/repo",
    prNumber: 12,
    baseSha: base,
    headSha: head,
    event: "synchronize",
    actionsUrl,
    changedFiles: ["src/auth.ts"],
    result: impact,
  };
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
      query: (sql: string, values?: unknown[]) => db.query(sql, values),
    } as unknown as pg.Pool;
    app = createApp({
      pool,
      boss: {
        getQueue: async () => ({ name: "history.import" }),
        getJobById: async () => null,
      } as unknown as PgBoss,
      history: null,
      token: "test-secret",
      resolvePull,
      logger: false,
    });
    await db.query(
      "INSERT INTO repositories VALUES ($1,123,'owner','repo','main','public','https://github.com/owner/repo',now())",
      [repoId],
    );
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  it("persists a validated Actions run and exposes the latest run", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/pr-analysis",
      headers: auth,
      payload,
    });
    expect(response.statusCode).toBe(202);
    const body = response.json() as { repoId: string; runId: string };
    expect(body.repoId).toBe(repoId);
    const stored = await db.query<{ output: unknown }>(
      "SELECT output FROM analysis_runs WHERE id=$1",
      [body.runId],
    );
    const output = analysisSchema.parse(stored.rows[0]!.output);
    expect(output).toMatchObject({
      id: body.runId,
      prNumber: 12,
      baseSha: base,
      headSha: head,
      event: "synchronize",
      stale: false,
      actionsUrl,
      prUrl,
    });
    const latest = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repoId}/analyses/latest?prNumber=12`,
      headers: auth,
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ id: body.runId, actionsUrl });
  });
  it("returns the same run for a duplicate workflow event", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/pr-analysis",
      headers: auth,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/pr-analysis",
      headers: auth,
      payload,
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().runId).toBe(first.json().runId);
    const count = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM analysis_runs WHERE repo_id=$1 AND kind='pull_request' AND input->>'prNumber'='12'",
      [repoId],
    );
    expect(count.rows[0]?.count).toBe(1);
  });
  it("rejects a result for a different revision, an unknown repository and a foreign Actions URL", async () => {
    const mismatch = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/pr-analysis",
      headers: auth,
      payload: {
        ...payload,
        baseSha: "c".repeat(40),
        actionsUrl: "https://github.com/owner/repo/actions/runs/124",
        result: { ...impact, snapshotSha: head },
      },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe("PR_REVISION_MISMATCH");
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/pr-analysis",
      headers: auth,
      payload: {
        ...payload,
        repositoryUrl: "https://github.com/other/repo",
        actionsUrl: "https://github.com/other/repo/actions/runs/123",
      },
    });
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json().code).toBe("REPOSITORY_NOT_INDEXED");
    const foreign = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/pr-analysis",
      headers: auth,
      payload: {
        ...payload,
        actionsUrl: "https://evil.example/owner/repo/actions/runs/123",
      },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().code).toBe("INVALID_ACTIONS_URL");
  });
  it("rejects a result that does not describe the declared head and changed files", async () => {
    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/pr-analysis",
      headers: auth,
      payload: {
        ...payload,
        actionsUrl: "https://github.com/owner/repo/actions/runs/125",
        result: { ...impact, snapshotSha: "c".repeat(40) },
      },
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().code).toBe("INVALID_REQUEST");
    const undeclared = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/pr-analysis",
      headers: auth,
      payload: {
        ...payload,
        actionsUrl: "https://github.com/owner/repo/actions/runs/126",
        result: { ...impact, changedFiles: ["src/other.ts"] },
      },
    });
    expect(undeclared.statusCode).toBe(400);
    expect(undeclared.json().code).toBe("INVALID_REQUEST");
  });
  it("ignores newer manual runs when looking up the automatic run", async () => {
    await db.query(
      `INSERT INTO analysis_runs(id,repo_id,snapshot_id,kind,status,input,output,warnings,created_at)
       VALUES($1,$2,NULL,'pull_request','partial',$3::jsonb,NULL,'[]'::jsonb,now()+interval '1 minute')`,
      [
        randomUUID(),
        repoId,
        JSON.stringify({
          prNumber: 12,
          baseSha: base,
          headSha: head,
          event: "synchronize",
          stale: true,
          idempotencyKey: "manual-run-for-latest-lookup",
        }),
      ],
    );
    const latest = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repoId}/analyses/latest?prNumber=12`,
      headers: auth,
    });
    expect(latest.statusCode).toBe(200);
    const ingested = await db.query<{ id: string }>(
      "SELECT id FROM analysis_runs WHERE repo_id=$1 AND input->>'source'='github_actions' LIMIT 1",
      [repoId],
    );
    expect(latest.json().id).toBe(ingested.rows[0]?.id);
  });
  it("returns not-found when no automatic run exists for the PR", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/repositories/${repoId}/analyses/latest?prNumber=99`,
      headers: auth,
    });
    expect(response.statusCode).toBe(404);
  });
});
