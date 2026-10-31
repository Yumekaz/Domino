import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const repoUrl =
  process.env.DOMINO_ACCEPT_REPO ??
  "https://github.com/sindresorhus/yocto-queue";
const base = "http://127.0.0.1:3000/api/v1";
const children: ChildProcess[] = [];

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

function start(file: string): ChildProcess {
  const child = spawn("node_modules/.bin/tsx", [file], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "3000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (data) => process.stdout.write(data));
  child.stderr?.on("data", (data) => process.stderr.write(data));
  children.push(child);
  return child;
}

async function call(method: string, path: string, body?: unknown): Promise<Json> {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response from ${method} ${path}: ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return data as Json;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function health(): Promise<void> {
  const deadline = Date.now() + 90_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "connection error";
    }
    await delay(1_000);
  }
  throw new Error(`The API/worker did not become healthy: ${last}`);
}

async function run(): Promise<void> {
  start("apps/api/src/main.ts");
  start("apps/worker/src/main.ts");
  await health();

  const imported = (await call("POST", "/repositories", { url: repoUrl })) as {
    repoId: string;
    jobId: string;
  };
  const { repoId, jobId } = imported;
  assert(repoId && jobId, "Import did not return repository and job identifiers");
  console.log(`Queued ${repoUrl}: repo=${repoId} job=${jobId}`);

  let job: { status: string; error?: string; warnings?: string[] } | undefined;
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    job = (await call("GET", `/repositories/${repoId}/jobs/${jobId}`)) as typeof job;
    if (["ready", "partial"].includes(job!.status)) break;
    if (["failed", "cancelled"].includes(job!.status))
      throw new Error(`Import ${jobId} ended as ${job.status}: ${job.error ?? "no detail"}`);
    await delay(2_000);
  }
  const finalStatus = job?.status;
  if (finalStatus !== "ready" && finalStatus !== "partial")
    throw new Error("The import did not reach a published snapshot within its budget");

  const repository = (await call("GET", `/repositories/${repoId}`)) as {
    snapshot: {
      id: string;
      headSha: string;
      branch: string;
      status: string;
      coverage: { kind: string; indexed: number; status: string }[];
    } | null;
  };
  const snapshot = repository.snapshot;
  assert(snapshot, "No published snapshot was returned after import");
  const structural = snapshot.coverage.find((item) => item.kind === "structural");
  assert(
    structural && structural.indexed > 0 && structural.status === "complete",
    `Structural analysis was not complete: ${JSON.stringify(snapshot.coverage)}`,
  );
  console.log(`Snapshot ${snapshot.id} at ${snapshot.headSha} (${snapshot.status})`);

  const search = (await call(
    "GET",
    `/repositories/${repoId}/search?q=&limit=50`,
  )) as { items: { id: string; kind: string; path?: string }[] };
  assert(search.items.length > 0, "Search returned no indexed records");
  const file = search.items.find((item) => item.kind === "File" && item.path);
  assert(file, "No File entity was returned for graph/impact inspection");

  const graph = (await call(
    "GET",
    `/repositories/${repoId}/graph?snapshotId=${snapshot.id}&entityId=${file.id}&depth=2`,
  )) as {
    nodes: { id: string; path?: string }[];
    edges: { source: string; target: string; kind: string }[];
  };
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges)
    assert(ids.has(edge.source) && ids.has(edge.target), "Graph contains a dangling endpoint");
  const importEdge = graph.edges.find((edge) => edge.kind === "IMPORTS");
  assert(
    importEdge,
    `No source-backed IMPORT edge was returned for ${file.path ?? file.id}`,
  );
  const affectedFile = graph.nodes.find((node) => node.id === importEdge.target)?.path;
  assert(affectedFile, "The imported file has no repository-relative path");

  const impact = (await call("POST", `/repositories/${repoId}/impact`, {
    snapshotId: snapshot.id,
    changedFiles: [affectedFile],
    maxDepth: 3,
  })) as {
    snapshotSha: string;
    affected: { file: string; signal: string; depth: number; path: string[] }[];
  };
  assert(impact.snapshotSha === snapshot.headSha, "Impact used a different snapshot revision");
  assert(
    impact.affected.some(
      (item) => item.signal === "static_reverse_dependency" && item.depth >= 1,
    ),
    `No reverse structural dependent was returned for ${affectedFile}`,
  );

  const risk = (await call(
    "GET",
    `/repositories/${repoId}/knowledge-risk?snapshotId=${snapshot.id}&limit=50`,
  )) as {
    files: { path: string; observedAuthors: number; caveats: string[] }[];
    warnings: string[];
  };
  assert(risk.files.length > 0, "Knowledge risk returned no observed contributor rows");

  const answer = (await call("POST", `/repositories/${repoId}/ask`, {
    question: "Why does this queue preserve insertion order?",
    snapshotId: snapshot.id,
  })) as {
    status: string;
    answer: string | null;
    claims: unknown[];
    errorCode: string | null;
    searchAvailable: boolean;
  };
  if (answer.status === "unavailable") {
    assert(answer.answer === null, "Unavailable synthesis produced an answer");
    assert(answer.claims.length === 0, "Unavailable synthesis produced claims");
    assert(answer.errorCode, "Unavailable synthesis has no provider error code");
  } else {
    assert(answer.status === "not_found", `Unexpected Q&A status ${answer.status}`);
    assert(answer.claims.length === 0, "Not-found Q&A produced claims");
  }

  const pr = (await call("POST", `/repositories/${repoId}/pr-check`, { prNumber: 12 })) as {
    runId: string;
  };
  const analysis = (await call("GET", `/repositories/${repoId}/analysis/${pr.runId}`)) as {
    prNumber: number;
    baseSha: string;
    headSha: string;
    stale: boolean;
    result: unknown;
    warnings: string[];
  };
  assert(analysis.prNumber === 12, "The analysis run is not for the requested PR");
  assert(analysis.baseSha.length === 40 && analysis.headSha.length === 40, "PR revisions are not full SHAs");
  if (analysis.stale) {
    assert(analysis.result === null, "A stale PR run substituted an impact result");
    assert(analysis.warnings.length > 0, "A stale PR run has no warning");
  } else {
    assert(analysis.result !== null, "A current PR run returned no impact result");
  }

  console.log(
    JSON.stringify(
      {
        repoId,
        jobId,
        snapshotId: snapshot.id,
        headSha: snapshot.headSha,
        status: snapshot.status,
        structural,
        graph: { nodes: graph.nodes.length, edges: graph.edges.length },
        impact: { candidate: affectedFile, affected: impact.affected.length },
        riskFiles: risk.files.length,
        qaStatus: answer.status,
        prRunId: pr.runId,
        prStale: analysis.stale,
      },
      null,
      2,
    ),
  );
}

try {
  await run();
} finally {
  for (const child of children) child.kill("SIGTERM");
}
