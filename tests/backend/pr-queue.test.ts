import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PgliteSqlClient } from "../../packages/retrieval/test/support/pgliteClient.ts";
import { PostgresHistoryStore } from "../../packages/retrieval/src/postgresStore.ts";
import { publishedSnapshot } from "../../packages/database/src/read-model.ts";
import {
  enqueuePrAnalysis,
  reconcilePrAnalysis,
  queuedPrInputSchema,
} from "../../packages/database/src/analysis-jobs.ts";
import { createPrCheckService } from "../../apps/api/src/pr-services.ts";
import { createPrAnalysisProcessor } from "../../apps/worker/src/pr-analysis.ts";
import { recoverOwnedWork } from "../../packages/database/src/worker-recovery.ts";
import { syncObservedActions } from "../../apps/worker/src/actions-sync.ts";
import { analysisSchema } from "../../packages/contracts/src/index.ts";
import type { CheckoutHandle } from "../../packages/git-adapter/src/checkout.ts";
import type { NormalizedStructuralAnalysis } from "../../packages/dependency-adapter/src/types.ts";

const base = "a".repeat(40),
  head = "b".repeat(40),
  next = "c".repeat(40);
const repoId = randomUUID(),
  workspaceId = randomUUID();
const pull = {
  number: 12,
  baseSha: base,
  headSha: head,
  prUrl: "https://github.com/owner/repo/pull/12",
  changedFiles: ["src/auth.ts"],
  truncated: false,
};
const normalized: NormalizedStructuralAnalysis = {
  metadata: {
    repositoryId: "42",
    snapshotSha: head,
    analyzer: "dependency-cruiser",
    version: "18.7.0",
    configHash: "test-config",
    analyzedAt: new Date().toISOString(),
  },
  imports: [
    ["src/session.ts", "src/auth.ts"],
    ["src/dashboard.ts", "src/session.ts"],
  ].map(([importer, imported]) => ({
    importer,
    imported,
    specifier: "./auth",
    dependencyTypes: ["import"],
    dynamic: false,
    circular: false,
    extractor: "dependency-cruiser",
    analyzerVersion: "18.7.0",
    configHash: "test-config",
    snapshotSha: head,
    evidence: { type: "import", specifier: "./auth", line: 1 },
  })),
  gaps: [],
  excludedModules: [],
  summary: {
    modulesCruised: 3,
    modules: 3,
    dependencies: 2,
    structuralImports: 2,
    dynamicImports: 0,
    circularImports: 0,
    unresolvedImports: 0,
    externalImports: 0,
    nonCodeImports: 0,
    excludedModules: 0,
  },
};

describe("fresh queued PR analysis", () => {
  let client: PgliteSqlClient,
    pool: pg.Pool,
    store: PostgresHistoryStore,
    boss: PgBoss;
  let send: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    client = await PgliteSqlClient.create();
    await client.exec(
      await readFile(
        new URL(
          "../../packages/database/migrations/001_initial.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await client.exec(
      await readFile(
        new URL(
          "../../packages/database/migrations/002_worker_ownership.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    pool = {
      query: (sql: string, values?: unknown[]) => client.query(sql, values),
      connect: async () => ({
        query: (sql: string, values?: unknown[]) => client.query(sql, values),
        release() {},
      }),
    } as unknown as pg.Pool;
    store = new PostgresHistoryStore(client);
    await client.query(
      "INSERT INTO repositories VALUES($1,42,'owner','repo','main','public','https://github.com/owner/repo',now())",
      [repoId],
    );
    await client.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at,completed_at) VALUES($1,$2,$3,'main','ready',now(),now())",
      [workspaceId, repoId, base],
    );
    send = vi.fn(async (_queue, _data, options) => options.id);
    boss = {
      send,
      getJobById: vi.fn(async () => ({ state: "active" })),
    } as unknown as PgBoss;
  });
  afterEach(async () => {
    await client.close();
  });
  const checkout = () =>
    ({
      sha: head,
      directory: process.cwd(),
      listFiles: async () =>
        ["src/auth.ts", "src/session.ts", "src/dashboard.ts"].map((path) => ({
          path,
          mode: "100644",
          blobSha: head,
          size: 10,
        })),
      dispose: vi.fn(async () => {}),
    }) as unknown as CheckoutHandle;
  async function queue(resolved = pull) {
    return createPrCheckService({
      pool,
      resolve: async () => resolved,
      enqueue: (id, input) => enqueuePrAnalysis(pool, boss, id, input),
    }).start(repoId, { prNumber: 12 });
  }
  async function stored(runId: string) {
    return (
      await client.query<{
        input: unknown;
        status: string;
        snapshot_id: string;
        output: unknown;
        warnings: string[];
      }>("SELECT * FROM analysis_runs WHERE id=$1", [runId])
    ).rows[0];
  }
  it("queues a mismatching PR head once and does not replace the workspace index", async () => {
    const first = await queue();
    expect((await queue()).runId).toBe(first.runId);
    expect(send).toHaveBeenCalledTimes(1);
    const row = await stored(first.runId);
    const input = queuedPrInputSchema.parse(row.input);
    expect(row.status).toBe("queued");
    expect(input.headSha).toBe(head);
    expect(input.workspaceSnapshotId).toBe(workspaceId);
    expect(input.snapshotId).not.toBe(workspaceId);
    expect((await publishedSnapshot(pool, repoId)).id).toBe(workspaceId);
  });
  it("persists new head imports, direct/transitive results and exact evidence without moving the main index", async () => {
    const { runId } = await queue();
    const input = queuedPrInputSchema.parse((await stored(runId)).input);
    const handle = checkout();
    const process = createPrAnalysisProcessor({
      pool,
      store,
      resolve: async () => pull,
      checkout: async (options) => {
        expect(options.sha).toBe(head);
        expect(options.fetchRef).toBe("refs/pull/12/head");
        return handle;
      },
      analyze: async (options) => {
        expect(options.snapshotSha).toBe(head);
        return normalized;
      },
    });
    await process({ runId, repoId }, input.queueJobId);
    const row = await stored(runId);
    const result = analysisSchema.parse(row.output);
    expect(result.status).toBe("completed");
    expect(result.stale).toBe(false);
    expect(result.result?.snapshotSha).toBe(head);
    expect(result.result?.affected.map((item) => item.file).sort()).toEqual([
      "src/dashboard.ts",
      "src/session.ts",
    ]);
    expect(
      result.result?.affected.every((item) =>
        item.evidence.every((e) => e.url?.includes(`/blob/${head}/`)),
      ),
    ).toBe(true);
    expect((await publishedSnapshot(pool, repoId)).id).toBe(workspaceId);
    expect((await store.getLatestSnapshot(repoId))?.id).toBe(workspaceId);
    expect(
      (
        await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM file_dependencies WHERE snapshot_id=$1",
          [input.snapshotId],
        )
      ).rows[0].count,
    ).toBe(2);
    expect(handle.dispose).toHaveBeenCalled();
    await process({ runId, repoId }, input.queueJobId);
    expect((await stored(runId)).output).toEqual(row.output);
  });
  it("withholds an old-head result when the PR advances during analysis", async () => {
    const { runId } = await queue();
    const input = queuedPrInputSchema.parse((await stored(runId)).input);
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(pull)
      .mockResolvedValueOnce({ ...pull, headSha: next });
    await createPrAnalysisProcessor({
      pool,
      store,
      resolve,
      checkout: async () => checkout(),
      analyze: async () => normalized,
    })({ runId, repoId }, input.queueJobId);
    const output = analysisSchema.parse((await stored(runId)).output);
    expect(output.stale).toBe(true);
    expect(output.result).toBeNull();
    expect(output.warnings.join(" ")).toMatch(/advanced while analysis/);
  });
  it("keeps failures retryable and isolates a new queue attempt from late old jobs", async () => {
    const { runId } = await queue();
    const old = queuedPrInputSchema.parse((await stored(runId)).input);
    await createPrAnalysisProcessor({
      pool,
      store,
      resolve: async () => pull,
      checkout: async () => {
        throw Object.assign(new Error("private diagnostic omitted"), {
          code: "CHECKOUT_TIMEOUT",
        });
      },
    })({ runId, repoId }, old.queueJobId);
    expect((await stored(runId)).status).toBe("failed");
    expect(JSON.stringify((await stored(runId)).output)).not.toContain(
      "private diagnostic",
    );
    expect((await queue()).runId).toBe(runId);
    const retry = queuedPrInputSchema.parse((await stored(runId)).input);
    expect(retry.attempt).toBe(2);
    expect(retry.queueJobId).not.toBe(old.queueJobId);
    expect(retry.snapshotId).not.toBe(old.snapshotId);
    const process = createPrAnalysisProcessor({
      pool,
      store,
      resolve: async () => pull,
      checkout: async () => checkout(),
      analyze: async () => normalized,
    });
    await process({ runId, repoId }, old.queueJobId);
    expect((await stored(runId)).status).toBe("queued");
    await process({ runId, repoId }, retry.queueJobId);
    expect((await stored(runId)).status).toBe("completed");
  });
  it("reconciles an expired worker into a failure and rolls back a rejected enqueue", async () => {
    const { runId } = await queue();
    vi.mocked(boss.getJobById).mockResolvedValue({ state: "failed" } as never);
    expect((await reconcilePrAnalysis(pool, boss, repoId, runId)).status).toBe(
      "failed",
    );
    send.mockRejectedValue(new Error("queue outage"));
    await expect(queue({ ...pull, headSha: next })).rejects.toThrow(
      "queue outage",
    );
    expect(
      (
        await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM analysis_runs",
        )
      ).rows[0].count,
    ).toBe(1);
    expect((await publishedSnapshot(pool, repoId)).id).toBe(workspaceId);
  });
  it("recovers only the supervisor's own interrupted work and preserves published data", async () => {
    const { runId } = await queue();
    const input = queuedPrInputSchema.parse((await stored(runId)).input);
    const owned = randomUUID(),
      other = randomUUID();
    await client.query(
      "UPDATE analysis_runs SET status='running',input=input || $2::jsonb WHERE id=$1",
      [runId, JSON.stringify({ workerInstance: owned })],
    );
    const snapshot = randomUUID(),
      job = randomUUID();
    await client.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at) VALUES($1,$2,$3,'main','pending',now())",
      [snapshot, repoId, base],
    );
    await client.query(
      "INSERT INTO import_jobs(id,repo_id,snapshot_id,url,head_sha,branch,status,phase,worker_instance) VALUES($1,$2,$3,'https://github.com/owner/repo',$4,'main','running','validating',$5)",
      [job, repoId, snapshot, base, other],
    );
    expect(await recoverOwnedWork(pool, owned)).toEqual({
      imports: 0,
      analyses: 1,
    });
    expect((await stored(runId)).status).toBe("failed");
    expect(
      (
        await client.query<{ status: string }>(
          "SELECT status FROM import_jobs WHERE id=$1",
          [job],
        )
      ).rows[0].status,
    ).toBe("running");
    expect((await publishedSnapshot(pool, repoId)).id).toBe(workspaceId);
    expect(await recoverOwnedWork(pool, other)).toEqual({
      imports: 1,
      analyses: 0,
    });
    expect(
      (
        await client.query<{ status: string }>(
          "SELECT status FROM index_snapshots WHERE id=$1",
          [snapshot],
        )
      ).rows[0].status,
    ).toBe("failed");
    expect(
      (
        await client.query<{ status: string }>(
          "SELECT status FROM index_snapshots WHERE id=$1",
          [input.snapshotId],
        )
      ).rows[0].status,
    ).toBe("failed");
  });
  it("observes associated Actions runs idempotently and retains their genuine metadata", async () => {
    const list = vi.fn(async () => ({
      repositoryId: 42,
      runs: [
        {
          id: 123,
          html_url: "https://github.com/owner/repo/actions/runs/123",
          head_sha: head,
          event: "pull_request",
          path: ".github/workflows/pr-impact.yml",
          conclusion: "success",
          run_attempt: 1,
          pull_requests: [{ number: 12 }],
        },
      ],
    }));
    const resolve = vi.fn(async () => pull);
    expect(
      await syncObservedActions({
        pool,
        boss,
        token: "fixture-token",
        list,
        resolve,
      }),
    ).toEqual({ queued: 1 });
    expect(
      await syncObservedActions({
        pool,
        boss,
        token: "fixture-token",
        list,
        resolve,
      }),
    ).toEqual({ queued: 0 });
    expect(resolve).toHaveBeenCalledTimes(1);
    const row = (
      await client.query<{ input: unknown }>("SELECT input FROM analysis_runs")
    ).rows[0];
    const input = queuedPrInputSchema.parse(row.input);
    expect(input.event).toBe("actions_observed");
    expect(input.actionsUrl).toBe(
      "https://github.com/owner/repo/actions/runs/123",
    );
    expect(input.headSha).toBe(head);
    expect((await publishedSnapshot(pool, repoId)).id).toBe(workspaceId);
  });
  it("does not guess a PR association or substitute a different head for an observed run", async () => {
    const run = {
      id: 123,
      html_url: "https://github.com/owner/repo/actions/runs/123",
      head_sha: head,
      event: "pull_request",
      path: ".github/workflows/pr-impact.yml",
      conclusion: "success",
      run_attempt: 1,
      pull_requests: [] as { number: number }[],
    };
    const list = async () => ({ repositoryId: 42, runs: [run] });
    const resolve = vi.fn(async () => ({ ...pull, headSha: next }));
    expect(
      await syncObservedActions({
        pool,
        boss,
        token: "fixture-token",
        list,
        resolve,
      }),
    ).toEqual({ queued: 0 });
    expect(resolve).not.toHaveBeenCalled();
    run.pull_requests.push({ number: 12 });
    expect(
      await syncObservedActions({
        pool,
        boss,
        token: "fixture-token",
        list,
        resolve,
      }),
    ).toEqual({ queued: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
