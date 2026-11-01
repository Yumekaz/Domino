import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  readStructuralImports,
  replacePendingStructural,
  type StructuralImportRecord,
} from "../../packages/database/src/impact.ts";
import { createImpactService } from "../../packages/core/impact/src/service.ts";
import { findReverseDependencies } from "../../packages/database/src/dependencies.ts";
import { createStructuralAnalysis } from "../../apps/worker/src/structural.ts";
import type { CheckoutHandle } from "../../packages/git-adapter/src/checkout.ts";
import type { RepositoryRecord } from "../../packages/core/history/src/types.ts";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const repo = randomUUID();
const snapshot = randomUUID();
const otherSnapshot = randomUUID();
const auth = randomUUID();
const session = randomUUID();
const dashboard = randomUUID();

function pglitePool(db: PGlite): pg.Pool {
  const client = {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    release: () => {},
  };
  return {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    connect: async () => client,
  } as unknown as pg.Pool;
}

const imports: StructuralImportRecord[] = [
  {
    importer: "src/session.ts",
    imported: "src/auth.ts",
    specifier: "./auth",
    dependencyTypes: ["import", "local"],
    dynamic: false,
    circular: false,
    extractor: "dependency-cruiser",
    analyzerVersion: "18.7.0",
    configHash: "config",
    snapshotSha: sha,
    evidence: { type: "import", specifier: "./auth", line: 4 },
  },
  {
    importer: "src/dashboard.tsx",
    imported: "src/session.ts",
    specifier: "./session",
    dependencyTypes: ["import", "local"],
    dynamic: false,
    circular: false,
    extractor: "dependency-cruiser",
    analyzerVersion: "18.7.0",
    configHash: "config",
    snapshotSha: sha,
    evidence: { type: "import", specifier: "./session", line: 2 },
  },
];

describe("snapshot-scoped structural storage", () => {
  let db: PGlite;
  let pool: pg.Pool;
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
    pool = pglitePool(db);
    await db.query(
      "INSERT INTO repositories VALUES ($1,1,'owner','repo','main','public','https://github.com/owner/repo',now())",
      [repo],
    );
    await db.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at) VALUES ($1,$2,$3,'main','pending',now()),($4,$2,$3,'main','pending',now())",
      [snapshot, repo, sha, otherSnapshot],
    );
    for (const [id, path] of [
      [auth, "src/auth.ts"],
      [session, "src/session.ts"],
      [dashboard, "src/dashboard.tsx"],
    ]) {
      await db.query(
        "INSERT INTO entities(id,repo_id,kind,canonical_key,title) VALUES ($1,$2,'File',$3,$3)",
        [id, repo, `file:${path}`],
      );
      await db.query(
        "INSERT INTO entity_versions VALUES ($1,$2,$3,'File',$4,NULL,$5::jsonb)",
        [snapshot, repo, id, path, JSON.stringify({ path })],
      );
    }
  });
  afterAll(async () => {
    await db.close();
  });
  it("stores dependencies and source-backed IMPORT edges while pending", async () => {
    const result = await replacePendingStructural(
      pool,
      repo,
      snapshot,
      imports,
      { owner: "owner", name: "repo" },
      sha,
    );
    expect(result).toEqual({ dependencies: 2, edges: 2, missingEntities: 0 });
    const stored = await readStructuralImports(pool, repo, snapshot, sha);
    expect(stored.map((item) => item.imported)).toEqual([
      "src/session.ts",
      "src/auth.ts",
    ]);
    const edges = await db.query<{
      kind: string;
      from_entity_id: string;
      to_entity_id: string;
    }>(
      "SELECT kind,from_entity_id,to_entity_id FROM edges WHERE snapshot_id=$1 ORDER BY kind",
      [snapshot],
    );
    expect(edges.rows).toHaveLength(2);
    expect(edges.rows.every((edge) => edge.kind === "IMPORTS")).toBe(true);
    expect(edges.rows.some((edge) => edge.from_entity_id === session)).toBe(
      true,
    );
  });
  it("stores repeated file pairs once while retaining distinct import observations and graph provenance", async () => {
    const base = imports[0]!;
    const variants: StructuralImportRecord[] = [
      base,
      { ...base, specifier: "@app/auth", evidence: { type: "import", specifier: "@app/auth", line: 11 } },
      { ...base, dynamic: true, dependencyTypes: ["dynamic"], evidence: { ...base.evidence, line: 18 } },
      { ...base, evidence: { ...base.evidence, line: 25 } },
    ];
    // Scatter same-pair imports across batches to ensure grouping is global.
    const filler = Array.from({ length: 105 }, (_, index) => ({
      ...base,
      importer: `extra/source${index}.ts`,
      imported: `extra/target${index}.ts`,
    }));
    const input = [variants[0]!, ...filler, imports[1]!, ...variants.slice(1), variants[0]!];
    const first = await replacePendingStructural(pool, repo, snapshot, input, { owner: "owner", name: "repo" }, sha);
    expect(first.dependencies).toBe(107);
    expect(first.edges).toBe(5);
    const rows = await db.query<{ evidence: { observations: unknown[] } }>(
      "SELECT evidence FROM file_dependencies WHERE snapshot_id=$1 AND importing_file=$2 AND imported_file=$3",
      [snapshot, base.importer, base.imported],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.evidence.observations).toHaveLength(4);
    const observed = (await readStructuralImports(pool, repo, snapshot, sha))
      .filter((item) => item.importer === base.importer && item.imported === base.imported)
      .map((item) => ({ specifier: item.specifier, dynamic: item.dynamic, line: item.evidence.line }));
    expect(observed).toEqual([
      { specifier: "./auth", dynamic: false, line: 4 },
      { specifier: "./auth", dynamic: false, line: 25 },
      { specifier: "./auth", dynamic: true, line: 18 },
      { specifier: "@app/auth", dynamic: false, line: 11 },
    ]);
    const graph = await db.query<{ evidence: { specifier: string; dynamic: boolean; locator: string } }>(
      "SELECT evidence FROM edges WHERE snapshot_id=$1 AND from_entity_id=$2 AND to_entity_id=$3",
      [snapshot, session, auth],
    );
    expect(graph.rows).toHaveLength(4);
    expect(graph.rows.map((row) => row.evidence.locator).sort()).toEqual([
      "src/session.ts:11", "src/session.ts:18", "src/session.ts:25", "src/session.ts:4",
    ]);
    await replacePendingStructural(pool, repo, snapshot, [...input].reverse(), { owner: "owner", name: "repo" }, sha);
    const reversed = (await readStructuralImports(pool, repo, snapshot, sha))
      .filter((item) => item.importer === base.importer && item.imported === base.imported)
      .map((item) => ({ specifier: item.specifier, dynamic: item.dynamic, line: item.evidence.line }));
    expect(reversed).toEqual(observed);
    await replacePendingStructural(pool, repo, snapshot, imports, { owner: "owner", name: "repo" }, sha);
  });
  it("rejects writes to published snapshots and reports missing File records", async () => {
    await db.query(
      "UPDATE index_snapshots SET status='ready',completed_at=now() WHERE id=$1",
      [snapshot],
    );
    await expect(
      replacePendingStructural(
        pool,
        repo,
        snapshot,
        imports,
        { owner: "owner", name: "repo" },
        sha,
      ),
    ).rejects.toThrow("pending snapshot");
    const missing = await replacePendingStructural(
      pool,
      repo,
      otherSnapshot,
      [
        ...imports,
        {
          ...imports[0]!,
          importer: "src/other.ts",
          imported: "src/missing.ts",
        },
      ],
      { owner: "owner", name: "repo" },
      sha,
    );
    expect(missing.dependencies).toBe(3);
    expect(missing.edges).toBe(0);
    expect(missing.missingEntities).toBe(5);
  });
});

describe("deterministic API impact over stored imports", () => {
  let db: PGlite;
  let pool: pg.Pool;
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
    pool = pglitePool(db);
    await db.query(
      "INSERT INTO repositories VALUES ($1,7,'owner','repo','main','public','https://github.com/owner/repo',now())",
      [repo],
    );
    await db.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at,completed_at) VALUES ($1,$2,$3,'main','ready',now(),now())",
      [snapshot, repo, sha],
    );
    await db.query(
      `INSERT INTO file_dependencies(id,repo_id,snapshot_id,importing_file,imported_file,dependency_kind,source_line,evidence)
       VALUES ($1,$2,$3,'src/session.ts','src/auth.ts','import',4,$4::jsonb),
              ($5,$2,$3,'src/dashboard.tsx','src/session.ts','import',2,$4::jsonb)`,
      [
        randomUUID(),
        repo,
        snapshot,
        JSON.stringify({
          specifier: "./auth",
          analyzerVersion: "18.7.0",
          configHash: "config",
        }),
        randomUUID(),
      ],
    );
  });
  afterAll(async () => {
    await db.close();
  });
  it("returns direct and transitive reverse paths from persisted observations", async () => {
    const service = createImpactService({
      async getPublishedSnapshot() {
        return { id: snapshot, headSha: sha };
      },
      async findReverseDependencies(input) {
        const result = await findReverseDependencies(
          pool,
          input.repoId,
          input.snapshotId,
          input.importedFile,
          input.limit,
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
      async getCoChange() {
        throw new Error("co-change intentionally unavailable in this fixture");
      },
    });
    const result = await service.analyze(repo, {
      snapshotId: snapshot,
      changedFiles: ["src/auth.ts"],
      maxDepth: 3,
    });
    expect(result.snapshotSha).toBe(sha);
    expect(result.affected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "src/session.ts",
          signal: "static_reverse_dependency",
          depth: 1,
          path: ["src/session.ts", "src/auth.ts"],
        }),
        expect.objectContaining({
          file: "src/dashboard.tsx",
          signal: "static_reverse_dependency",
          depth: 2,
          path: ["src/dashboard.tsx", "src/session.ts", "src/auth.ts"],
        }),
      ]),
    );
    expect(result.warnings.join(" ")).toMatch(/co-change is unavailable/i);
  });
});

describe("worker structural analysis", () => {
  let db: PGlite;
  let pool: pg.Pool;
  let directory: string;
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
    pool = pglitePool(db);
    directory = await mkdtemp(join(tmpdir(), "domino-structural-"));
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
        },
      }),
    );
    await writeFile(
      join(directory, "src", "auth.ts"),
      "export const token = 1;\n",
    );
    await writeFile(
      join(directory, "src", "session.ts"),
      "import { token } from './auth';\nexport const session = token;\n",
    );
    await db.query(
      "INSERT INTO repositories VALUES ($1,42,'owner','repo','main','public','https://github.com/owner/repo',now())",
      [repo],
    );
    await db.query(
      "INSERT INTO index_snapshots(id,repo_id,head_sha,branch,status,started_at) VALUES ($1,$2,$3,'main','pending',now())",
      [snapshot, repo, sha],
    );
    for (const [id, path] of [
      [auth, "src/auth.ts"],
      [session, "src/session.ts"],
    ]) {
      await db.query(
        "INSERT INTO entities(id,repo_id,kind,canonical_key,title) VALUES ($1,$2,'File',$3,$3)",
        [id, repo, `file:${path}`],
      );
      await db.query(
        "INSERT INTO entity_versions VALUES ($1,$2,$3,'File',$4,NULL,$5::jsonb)",
        [snapshot, repo, id, path, JSON.stringify({ path })],
      );
    }
  });
  afterAll(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  it("analyzes an exact checkout and stores dependencies plus IMPORT edges", async () => {
    const hook = createStructuralAnalysis(pool, { repoId: repo, githubId: 42 });
    const result = await hook({
      repository: {
        id: repo,
        githubId: 42,
        owner: "owner",
        name: "repo",
        defaultBranch: "main",
        visibility: "public",
        htmlUrl: "https://github.com/owner/repo",
        createdAt: new Date().toISOString(),
      } as RepositoryRecord,
      snapshotId: snapshot,
      headSha: sha,
      checkout: { directory } as unknown as CheckoutHandle,
    });
    expect(result.status).toBe("complete");
    expect(result.items).toBeGreaterThan(0);
    const stored = await readStructuralImports(pool, repo, snapshot, sha);
    expect(
      stored.some(
        (item) =>
          item.importer === "src/session.ts" && item.imported === "src/auth.ts",
      ),
    ).toBe(true);
    const edges = await db.query<{ kind: string }>(
      "SELECT kind FROM edges WHERE snapshot_id=$1",
      [snapshot],
    );
    expect(edges.rows.some((edge) => edge.kind === "IMPORTS")).toBe(true);
  });
  it("marks structural coverage partial when a missing extended tsconfig requires fallback", async () => {
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({ extends: "@unavailable/tsconfig" }),
    );
    const result = await createStructuralAnalysis(pool, {
      repoId: repo,
      githubId: 42,
    })({
      repository: {
        id: repo,
        githubId: 42,
        owner: "owner",
        name: "repo",
        defaultBranch: "main",
        visibility: "public",
        htmlUrl: "https://github.com/owner/repo",
        createdAt: new Date().toISOString(),
      } as RepositoryRecord,
      snapshotId: snapshot,
      headSha: sha,
      checkout: { directory } as unknown as CheckoutHandle,
    });
    expect(result.status).toBe("partial");
    expect(
      result.warnings.some((warning) =>
        /aliases.*may be missing/.test(warning),
      ),
    ).toBe(true);
    const stored = await readStructuralImports(pool, repo, snapshot, sha);
    expect(
      stored.some(
        (item) =>
          item.importer === "src/session.ts" && item.imported === "src/auth.ts",
      ),
    ).toBe(true);
  });
});
