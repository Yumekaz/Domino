// Explicit opt-in. Uses real GitHub, native CBM, PostgreSQL, pg-boss and HTTP; no model calls.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdirSync, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { migrate } from "../../packages/database/src/migrate.ts";

if (process.env.DOMINO_CBM_ACCEPTANCE !== "1")
  throw new Error("Set DOMINO_CBM_ACCEPTANCE=1 for this live test");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/domino_cbm_test")
  throw new Error(
    "Requires the isolated domino_cbm_test database; never resets data",
  );
if (!process.env.DOMINO_CBM_BINARY || !process.env.DOMINO_CBM_CACHE_DIR)
  throw new Error("Configure the pinned binary and dedicated private cache");
const port = 5395;
const base = `http://127.0.0.1:${port}/api/v1`;
const children: ChildProcess[] = [];
mkdirSync("node_modules/.domino-engines/acceptance", { recursive: true });
const log = createWriteStream(
  "node_modules/.domino-engines/acceptance/runtime.log",
  { flags: "a" },
);
const pool = new pg.Pool({ connectionString: databaseUrl });
const started = Date.now();
const controller = new AbortController();
const budget = setTimeout(() => controller.abort(), 600_000);

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
  });
  assert(response.ok, `${method} ${path} failed with HTTP ${response.status}`);
  return response.json();
}

function start(file: string) {
  const child = spawn(
    process.execPath,
    [
      ...process.execArgv.filter((arg) => arg === "--use-system-ca"),
      "--import",
      "tsx",
      resolve(file),
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        HOST: "127.0.0.1",
        PORT: String(port),
        DOMINO_API_TOKEN: "",
        DOMINO_CODE_INTELLIGENCE: "cbm",
        DOMINO_OPENAI_API_KEY: "",
        OPENAI_API_KEY: "",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  children.push(child);
}

try {
  // Refuse to interact with a server owned by another session.
  const occupied = await fetch(`${base}/health`, {
    signal: AbortSignal.timeout(1000),
  }).then(
    () => true,
    () => false,
  );
  assert(!occupied, `Acceptance port ${port} is already occupied`);
  await migrate(databaseUrl);
  start("apps/api/src/main.ts");
  start("apps/worker/src/main.ts");
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    healthy = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(1000),
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (healthy) break;
    assert(
      !children.some((child) => child.exitCode !== null),
      "Acceptance child exited; inspect the ignored runtime log",
    );
    await delay(1000, undefined, { signal: controller.signal });
  }
  assert(healthy, "Acceptance API did not start");
  const repoUrl =
    process.env.DOMINO_CBM_REPO ?? "https://github.com/sindresorhus/p-limit";
  const imported = (await call("POST", "/repositories", { url: repoUrl })) as {
    repoId: string;
    jobId: string;
  };
  let job: { status: string };
  do {
    await delay(1500, undefined, { signal: controller.signal });
    job = (await call(
      "GET",
      `/repositories/${imported.repoId}/jobs/${imported.jobId}`,
    )) as typeof job;
    assert(
      !["failed", "cancelled"].includes(job.status),
      "Live import failed; inspect the ignored runtime log",
    );
  } while (!["ready", "partial"].includes(job.status));
  const repo = (await call("GET", `/repositories/${imported.repoId}`)) as {
    snapshot: {
      id: string;
      headSha: string;
      status: string;
      coverage: { kind: string; status: string; indexed: number }[];
    };
  };
  const snapshot = repo.snapshot;
  const coverage = snapshot.coverage.find(
    (row) => row.kind === "codeIntelligence",
  );
  assert(
    coverage && coverage.status === "partial" && coverage.indexed > 0,
    "CBM did not export bounded symbol evidence",
  );
  const symbols = await pool.query<{
    id: string;
    entity_id: string;
    revision: string;
    source_url: string;
    body: string;
    section_locator: string;
    metadata: Record<string, unknown>;
  }>(
    "SELECT id,entity_id,revision,source_url,body,section_locator,metadata FROM evidence_documents WHERE repo_id=$1 AND snapshot_id=$2 AND source_kind='code_symbol' ORDER BY id",
    [imported.repoId, snapshot.id],
  );
  assert.equal(symbols.rows.length, coverage.indexed);
  for (const row of symbols.rows) {
    assert.equal(row.revision, snapshot.headSha);
    assert(
      row.source_url.includes(`/blob/${snapshot.headSha}/`) &&
        /#L\d+-L\d+$/.test(row.source_url),
    );
    assert(row.body.trim());
    assert.equal(row.metadata.extractor, "codebase-memory-mcp");
  }
  const first = symbols.rows[0];
  const detail = (await call(
    "GET",
    `/repositories/${imported.repoId}/entities/${first.entity_id}?snapshotId=${snapshot.id}`,
  )) as { sources: { id: string; kind: string; url: string }[] };
  assert(
    detail.sources.some(
      (source) =>
        source.kind === "code_symbol" && source.url.includes(snapshot.headSha),
    ),
    "Source inspector API omitted the symbol evidence",
  );
  const symbolName = String(first.metadata.title).split(".").at(-1)!;
  const search = (await call(
    "GET",
    `/repositories/${imported.repoId}/search?q=${encodeURIComponent(symbolName)}&limit=50`,
  )) as { items: { id: string }[]; snapshotSha: string };
  assert.equal(search.snapshotSha, snapshot.headSha);
  assert(
    search.items.some((entity) => entity.id === first.entity_id),
    "Symbol search did not return its actual file",
  );
  const baseline = await pool.query<{ count: string }>(
    "SELECT count(*) AS count FROM evidence_documents WHERE repo_id=$1 AND snapshot_id=$2 AND source_kind<>'code_symbol'",
    [imported.repoId, snapshot.id],
  );
  assert(
    Number(baseline.rows[0].count) > 0,
    "Symbol enrichment replaced baseline evidence",
  );
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        repoUrl,
        ...imported,
        snapshotId: snapshot.id,
        headSha: snapshot.headSha,
        snapshotStatus: snapshot.status,
        symbols: symbols.rows.length,
        baselineChunks: Number(baseline.rows[0].count),
        coverage,
        source: {
          entityId: first.entity_id,
          locator: first.section_locator,
          url: first.source_url,
        },
        symbolSearch: symbolName,
        elapsedMs: Date.now() - started,
        modelCalls: 0,
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(budget);
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  await pool.end();
  log.end();
}
