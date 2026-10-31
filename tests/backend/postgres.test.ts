import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgBoss } from "pg-boss";
import type pg from "pg";
import {
  createPool,
  findReverseDependencies,
  replacePendingDependencies,
} from "../../packages/database/src/index.ts";
import { migrate } from "../../packages/database/src/migrate.ts";
import {
  enqueueImport,
  HISTORY_QUEUE,
} from "../../packages/database/src/jobs.ts";

const connection = process.env.DOMINO_TEST_DATABASE_URL;
const enabled = Boolean(
  connection && process.env.DOMINO_ALLOW_POSTGRES_TESTS === "1",
);
describe.skipIf(!enabled)("real PostgreSQL and pg-boss", () => {
  let pool: pg.Pool, boss: PgBoss;
  beforeAll(async () => {
    const url = new URL(connection!);
    if (url.pathname !== "/domino_a_test")
      throw new Error(
        "Live tests require the explicitly isolated domino_a_test database",
      );
    await migrate(connection!);
    pool = createPool(connection!);
    boss = new PgBoss(connection!);
    boss.on("error", () => {});
    await boss.start();
    await boss.createQueue(HISTORY_QUEUE, { retryLimit: 0 });
  });
  afterAll(async () => {
    if (boss) await boss.stop();
    if (pool) await pool.end();
  });
  it("atomically inserts a queue message and returns the same active job for concurrent imports", async () => {
    const suffix = randomBytes(5).toString("hex");
    const data = {
      githubId: randomBytes(6).readUIntBE(0, 6),
      owner: `test-${suffix}`,
      name: "public",
      url: `https://github.com/test-${suffix}/public`,
      branch: "main",
      headSha: "a".repeat(40),
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => enqueueImport(pool, boss, data)),
    );
    const first = results[0]!;
    expect(
      results.every(
        (result) =>
          result.repoId === first.repoId && result.jobId === first.jobId,
      ),
    ).toBe(true);
    const jobs = await pool.query(
      "SELECT id,status FROM import_jobs WHERE repo_id=$1",
      [first.repoId],
    );
    expect(jobs.rows).toEqual([{ id: first.jobId, status: "queued" }]);
    const queued = await boss.getJobById(HISTORY_QUEUE, first.jobId);
    expect(queued?.id).toBe(first.jobId);
  });
  it("rolls back the repository and app job when the queue write fails", async () => {
    const suffix = randomBytes(5).toString("hex");
    const githubId = randomBytes(6).readUIntBE(0, 6);
    const data = {
      githubId,
      owner: `test-${suffix}`,
      name: "public",
      url: `https://github.com/test-${suffix}/public`,
      branch: "main",
      headSha: "b".repeat(40),
    };
    const failing = {
      send: async () => {
        throw new Error("injected queue failure");
      },
    } as unknown as PgBoss;
    await expect(enqueueImport(pool, failing, data)).rejects.toThrow(
      "injected queue failure",
    );
    expect(
      (
        await pool.query("SELECT id FROM repositories WHERE github_id=$1", [
          githubId,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("keeps dependency replacement transactional and prevents edits to published snapshots", async () => {
    const repo = randomUUID(),
      snapshot = randomUUID(),
      githubId = Math.floor(Date.now() * 1000 + Math.random() * 1000);
    const owner = `test-${randomBytes(5).toString("hex")}`;
    await pool.query(
      "INSERT INTO repositories VALUES ($1,$2,$3,'public','main','public',$4,now())",
      [repo, githubId, owner, `https://github.com/${owner}/public`],
    );
    await pool.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at) VALUES ($1,$2,$3,'main','pending',now())",
      [snapshot, repo, "c".repeat(40)],
    );
    const dependency = {
      id: randomUUID(),
      importingFile: "src/b.ts",
      importedFile: "src/a.ts",
      dependencyKind: "import",
      sourceLine: 4,
      evidence: { extractor: "test" },
    };
    await replacePendingDependencies(pool, repo, snapshot, [dependency]);
    await expect(
      replacePendingDependencies(pool, repo, snapshot, [
        dependency,
        { ...dependency, id: randomUUID() },
      ]),
    ).rejects.toThrow();
    await pool.query(
      "UPDATE index_snapshots SET status='ready',completed_at=now() WHERE id=$1",
      [snapshot],
    );
    const result = await findReverseDependencies(
      pool,
      repo,
      snapshot,
      "src/a.ts",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      importing_file: "src/b.ts",
      imported_file: "src/a.ts",
    });
    await expect(
      replacePendingDependencies(pool, repo, snapshot, []),
    ).rejects.toThrow("pending snapshot");
  });
});
