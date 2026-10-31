import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSymbolTable,
  symbolEvidence,
  analyzeCodeSymbols,
  CBM_VERSION,
} from "../../packages/code-intelligence/src/cbm.ts";
import type { CheckoutHandle } from "../../packages/git-adapter/src/checkout.ts";
import type {
  RepositoryRecord,
  EntityRecord,
} from "../../packages/core/history/src/types.ts";

const repository: RepositoryRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  githubId: 1,
  owner: "public",
  name: "fixture",
  visibility: "public",
  defaultBranch: "main",
  htmlUrl: "https://github.com/public/fixture",
  createdAt: "2026-10-31T00:00:00Z",
};
const sha = "a".repeat(40);
const snapshotId = "33333333-3333-4333-8333-333333333333";
const table = (file = "source.ts") => ({
  columns: ["n.qualified_name", "n.file_path", "n.start_line", "n.end_line"],
  rows: [["fixture.lateSymbol", file, 3, 5]],
  returned: 1,
  total: 1,
});
const entities: EntityRecord[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    repoId: repository.id,
    kind: "File",
    canonicalKey: "file:source.ts",
    title: "source.ts",
    sourceUrl: null,
    metadata: { path: "source.ts" },
  },
];
const checkout = {
  sha,
  directory: process.cwd(),
  readFile: async () =>
    "// first\n// second\nexport function lateSymbol() {\n  return 42;\n}\n",
} as unknown as CheckoutHandle;

describe("optional code intelligence boundary", () => {
  it("rejects paths escaping the repository and malformed result schemas", () => {
    expect(() => parseSymbolTable(table("../secret"))).toThrow();
    expect(() =>
      parseSymbolTable({ ...table(), columns: ["invented"] }),
    ).toThrow();
    expect(() => parseSymbolTable({ ...table(), returned: 2 })).toThrow();
  });
  it("reads actual checkout text and preserves its source revision and lines", async () => {
    const rows = await symbolEvidence({
      locations: parseSymbolTable({
        ...table(),
        rows: [["fixture.lateSymbol", "source.ts", "3", "5"]],
      }),
      repository,
      snapshotId,
      headSha: sha,
      entities,
      checkout,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe(
      "export function lateSymbol() {\n  return 42;\n}",
    );
    expect(rows[0].sourceUrl).toBe(
      `https://github.com/public/fixture/blob/${sha}/source.ts#L3-L5`,
    );
    expect(rows[0].sourceKind).toBe("code_symbol");
    expect(rows[0].revision).toBe(sha);
    expect(rows[0].lineStart).toBe(3);
  });
  it("does not invent file entities or accept out-of-range source locations", async () => {
    expect(
      await symbolEvidence({
        locations: parseSymbolTable(table("missing.ts")),
        repository,
        snapshotId: "snapshot",
        headSha: sha,
        entities,
        checkout,
      }),
    ).toEqual([]);
    await expect(
      symbolEvidence({
        locations: [{ name: "bad", path: "source.ts", start: 1, end: 100 }],
        repository,
        snapshotId: "snapshot",
        headSha: sha,
        entities,
        checkout,
      }),
    ).rejects.toThrow("CBM_INVALID_LOCATION");
  });
  it("fails closed on version mismatch and strips credentials from the engine environment", async () => {
    let captured: NodeJS.ProcessEnv = {};
    vi.stubEnv("OPENAI_API_KEY", "test-sentinel-do-not-forward");
    vi.stubEnv("DOMINO_GITHUB_TOKEN", "test-sentinel-do-not-forward");
    try {
      await expect(
        analyzeCodeSymbols({
          binary: process.execPath,
          cacheDir: resolve(tmpdir(), "cbm-unit-cache"),
          repository,
          snapshotId,
          headSha: sha,
          checkout,
          entities,
          run: async (_binary, _args, options) => {
            captured = options.env;
            return "codebase-memory-mcp 99.0.0";
          },
        }),
      ).rejects.toThrow("CBM_VERSION_MISMATCH");
      expect(captured.OPENAI_API_KEY).toBeUndefined();
      expect(captured.DOMINO_GITHUB_TOKEN).toBeUndefined();
      expect(captured.CBM_ALLOWED_ROOT).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("exports native-shaped results and cleans up only its own project", async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const result = await analyzeCodeSymbols({
      binary: process.execPath,
      cacheDir: resolve(tmpdir(), "cbm-unit-cache"),
      repository,
      snapshotId,
      headSha: sha,
      checkout,
      entities,
      run: async (_binary, args) => {
        if (args[0] === "--version")
          return `codebase-memory-mcp ${CBM_VERSION}\n`;
        const input = JSON.parse(await readFile(args[args.length - 1], "utf8"));
        calls.push({ name: args[2], input });
        const payload =
          args[2] === "index_repository"
            ? { status: "indexed" }
            : args[2] === "query_graph"
              ? {
                  ...table(),
                  rows: [["fixture.lateSymbol", "source.ts", "3", "5"]],
                }
              : { deleted: true };
        return JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        });
      },
    });
    expect(result.chunks).toHaveLength(1); // Duplicate locations from two queries are collapsed.
    expect(result.capHit).toBe(false);
    expect(calls.map((call) => call.name)).toEqual([
      "index_repository",
      "query_graph",
      "query_graph",
      "delete_project",
    ]);
    expect(calls[0].input.persistence).toBe(false);
    expect(calls[0].input.mode).toBe("fast");
    expect(calls[3].input.project).toBe(`domino-${snapshotId}`);
  });
  it("rejects caches inside imported code and revision mismatches before running", async () => {
    const run = vi.fn();
    await expect(
      analyzeCodeSymbols({
        binary: process.execPath,
        cacheDir: resolve(checkout.directory, "engine-cache"),
        repository,
        snapshotId,
        headSha: sha,
        checkout,
        entities,
        run,
      }),
    ).rejects.toThrow("CBM_CACHE_INSIDE_CHECKOUT");
    await expect(
      analyzeCodeSymbols({
        binary: process.execPath,
        cacheDir: resolve(tmpdir(), "cbm-unit-cache"),
        repository,
        snapshotId,
        headSha: "b".repeat(40),
        checkout,
        entities,
        run,
      }),
    ).rejects.toThrow("CBM_INVALID_INPUT");
    expect(run).not.toHaveBeenCalled();
  });
});
