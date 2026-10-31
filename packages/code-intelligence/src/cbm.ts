import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, rmdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute, relative } from "node:path";
import { z } from "zod";
import type { CheckoutHandle } from "../../git-adapter/src/checkout.ts";
import type {
  EntityRecord,
  EvidenceChunkRecord,
  RepositoryRecord,
} from "../../core/history/src/types.ts";
import { uuidV5, NAMESPACES } from "../../core/history/src/ids.ts";
import {
  contentSha256,
  clip,
  normalizeRepoPath,
} from "../../core/history/src/paths.ts";
import { githubBlobUrl } from "../../core/history/src/graph.ts";

export const CBM_VERSION = "0.12.1";
const MAX_SYMBOLS = 250;
const lineNumber = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^[1-9][0-9]{0,6}$/)
      .transform(Number),
  ])
  .pipe(z.number().int().positive().max(1_000_000));
const QUERY = (label: "Function" | "Method") =>
  `MATCH (n:${label}) RETURN n.qualified_name, n.file_path, n.start_line, n.end_line ORDER BY n.file_path, n.start_line LIMIT 251`;

const envelopeSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});
const tableSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(251),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export interface SymbolLocation {
  name: string;
  path: string;
  start: number;
  end: number;
}
export function parseSymbolTable(payload: unknown): SymbolLocation[] {
  const table = tableSchema.parse(payload);
  if (
    JSON.stringify(table.columns) !==
    JSON.stringify([
      "n.qualified_name",
      "n.file_path",
      "n.start_line",
      "n.end_line",
    ])
  )
    throw new Error("CBM_SCHEMA_MISMATCH");
  if (table.returned !== table.rows.length)
    throw new Error("CBM_SCHEMA_MISMATCH");
  return table.rows
    .map((row) => {
      const [name, file, start, end] = z
        .tuple([
          z.string().min(1).max(1000),
          z.string().min(1).max(1000),
          lineNumber,
          lineNumber,
        ])
        .parse(row);
      const path = normalizeRepoPath(file);
      if (end < start || end > 1_000_000)
        throw new Error("CBM_INVALID_LOCATION");
      return { name, path, start, end };
    })
    .filter((symbol) => symbol.end - symbol.start <= 400);
}

type Run = (
  binary: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    signal?: AbortSignal;
  },
) => Promise<string>;
const runProcess: Run = (binary, args, options) =>
  new Promise((accept, reject) => {
    execFile(
      binary,
      args,
      {
        ...options,
        shell: false,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) reject(new Error("CBM_PROCESS_FAILED"));
        else accept(String(stdout));
      },
    );
  });

export async function symbolEvidence(input: {
  locations: SymbolLocation[];
  repository: RepositoryRecord;
  snapshotId: string;
  headSha: string;
  entities: readonly EntityRecord[];
  checkout: CheckoutHandle;
}): Promise<EvidenceChunkRecord[]> {
  const files = new Map(
    input.entities
      .filter(
        (entity) =>
          entity.kind === "File" && typeof entity.metadata.path === "string",
      )
      .map((entity) => [String(entity.metadata.path), entity]),
  );
  const result: EvidenceChunkRecord[] = [];
  const seen = new Set<string>();
  const eligible = new Set((await input.checkout.listFiles()).filter(file =>
    ['100644', '100755'].includes(file.mode) && file.size <= 128 * 1024,
  ).map(file => file.path));
  for (const symbol of input.locations.filter(symbol => eligible.has(symbol.path)).slice(0, MAX_SYMBOLS)) {
    const entity = files.get(symbol.path);
    if (!entity || seen.has(`${symbol.path}:${symbol.start}:${symbol.end}`))
      continue;
    seen.add(`${symbol.path}:${symbol.start}:${symbol.end}`);
    const text = await input.checkout.readFile(symbol.path, 128 * 1024);
    const lines = text.split(/\r?\n/);
    if (symbol.end > lines.length) throw new Error("CBM_INVALID_LOCATION");
    const body = lines.slice(symbol.start - 1, symbol.end).join("\n");
    if (!body.trim() || body.length > 8000) continue;
    const hash = contentSha256(body);
    result.push({
      id: uuidV5(
        `cbm:${entity.id}:${symbol.name}:${symbol.start}:${hash}`,
        NAMESPACES.evidence,
      ),
      repoId: input.repository.id,
      snapshotId: input.snapshotId,
      entityId: entity.id,
      entityKind: "File",
      sourceKind: "code_symbol",
      sourceId: `${symbol.path}@${input.headSha}#${symbol.name}`,
      sourceUrl: `${githubBlobUrl(input.repository.owner, input.repository.name, input.headSha, symbol.path)}#L${symbol.start}-L${symbol.end}`,
      locator: `${symbol.path} — ${symbol.name} lines ${symbol.start}-${symbol.end}`,
      body,
      excerpt: clip(body, 800),
      contentSha: hash,
      lineStart: symbol.start,
      lineEnd: symbol.end,
      sourceTimestamp: null,
      revision: input.headSha,
      chunkIndex: result.length,
      metadata: {
        title: symbol.name,
        extractor: "codebase-memory-mcp",
        version: CBM_VERSION,
        charStart:
          symbol.start === 1
            ? 0
            : lines.slice(0, symbol.start - 1).join("\n").length + 1,
      },
    });
  }
  return result;
}

export async function analyzeCodeSymbols(input: {
  binary: string;
  cacheDir: string;
  repository: RepositoryRecord;
  snapshotId: string;
  headSha: string;
  checkout: CheckoutHandle;
  entities: readonly EntityRecord[];
  signal?: AbortSignal;
  run?: Run;
}): Promise<{
  chunks: EvidenceChunkRecord[];
  warnings: string[];
  capHit: boolean;
}> {
  if (
    !isAbsolute(input.binary) ||
    !isAbsolute(input.cacheDir) ||
    input.checkout.sha !== input.headSha ||
    !/^[a-f0-9]{40}$/.test(input.headSha) ||
    !/^[a-f0-9-]{36}$/i.test(input.snapshotId)
  )
    throw new Error("CBM_INVALID_INPUT");
  const binary = await realpath(input.binary);
  const root = await realpath(input.checkout.directory);
  const cacheDir = resolve(input.cacheDir);
  const cacheRelative = relative(root, cacheDir);
  if (
    !cacheRelative ||
    (!cacheRelative.startsWith("..") && !isAbsolute(cacheRelative))
  )
    throw new Error("CBM_CACHE_INSIDE_CHECKOUT");
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME",
    "LOCALAPPDATA",
    "APPDATA",
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.CBM_CACHE_DIR = cacheDir;
  env.CBM_ALLOWED_ROOT = root;
  env.CBM_MAX_THREADS = "2";
  const run = input.run ?? runProcess;
  const deadline = Date.now() + 120_000;
  const invoke = async (args: string[], cleanup = false) => {
    const timeout = cleanup ? 5000 : deadline - Date.now();
    if (timeout <= 0) throw new Error("CBM_TIMEOUT");
    return run(binary, args, {
      cwd: root,
      env,
      timeout,
      ...(cleanup ? {} : { signal: input.signal }),
    });
  };
  const version = await invoke(["--version"]);
  if (version.trim() !== `codebase-memory-mcp ${CBM_VERSION}`)
    throw new Error("CBM_VERSION_MISMATCH");
  const dir = await mkdtemp(join(tmpdir(), "domino-cbm-"));
  const argsPath = join(dir, "args.json");
  const project = `domino-${input.snapshotId}`;
  const warnings: string[] = [];
  const tool = async (name: string, args: object, cleanup = false) => {
    await writeFile(argsPath, JSON.stringify(args), "utf8");
    const envelope = envelopeSchema.parse(
      JSON.parse(
        await invoke(["cli", "--json", name, "--args-file", argsPath], cleanup),
      ),
    );
    if (envelope.isError) throw new Error("CBM_TOOL_FAILED");
    return JSON.parse(
      envelope.content.map((item) => item.text).join("\n"),
    ) as unknown;
  };
  try {
    const indexed = z
      .object({ status: z.enum(["indexed", "degraded"]) })
      .parse(
        await tool("index_repository", {
          repo_path: root,
          name: project,
          mode: "fast",
          persistence: false,
          doc_candidates: false,
        }),
      );
    if (indexed.status !== "indexed") throw new Error("CBM_DEGRADED_INDEX");
    const locations: SymbolLocation[] = [];
    for (const label of ["Function", "Method"] as const) {
      locations.push(
        ...parseSymbolTable(
          await tool("query_graph", {
            project,
            query: QUERY(label),
            format: "json",
            max_rows: 251,
            max_output_tokens: 100000,
          }),
        ),
      );
    }
    const chunks = await symbolEvidence({
      ...input,
      locations: locations.map((location) => ({
        ...location,
        name: location.name.startsWith(`${project}.`)
          ? location.name.slice(project.length + 1)
          : location.name,
      })),
    });
    const capHit = locations.length > MAX_SYMBOLS;
    warnings.push(
      `Optional CBM ${CBM_VERSION}: ${chunks.length} function/method source excerpts exported from ${locations.length} bounded candidate locations (export limit ${MAX_SYMBOLS}). Coverage is partial: only existing file entities up to 128 KiB and excerpts up to 401 lines / 8000 characters are included. Oversized files are skipped. This enriches retrieval only and does not create verified dependency edges.`,
    );
    return { chunks, capHit, warnings };
  } finally {
    // This project name is generated from our snapshot UUID in our isolated cache.
    await tool("delete_project", { project }, true).catch(() => {
      warnings.push(
        "Optional CBM cache cleanup did not finish; its isolated temporary project may remain in the dedicated cache.",
      );
    });
    await rm(argsPath, { force: true });
    await rmdir(dir).catch(() => {});
  }
}
