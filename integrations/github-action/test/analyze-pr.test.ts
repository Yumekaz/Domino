import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  fetchChangedFiles,
  parseChangedFileRecords,
  renderSummary,
  validatePullRequestEvent,
} from "../analyze-pr.mjs";
import type { ImpactResult } from "../../../packages/core/impact/src/types.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const result: ImpactResult = {
  changedFiles: ["src/auth.ts"],
  snapshotSha: SHA_B,
  affected: [
    {
      file: "src/session.ts",
      signal: "static_reverse_dependency",
      depth: 1,
      path: ["src/session.ts", "src/auth.ts"],
      impact: "possible",
      explanation: "Static reverse dependency path.",
      evidence: [
        {
          type: "import",
          importer: "src/session.ts",
          imported: "src/auth.ts",
          specifier: "./auth",
          line: null,
          dynamic: false,
          circular: false,
          extractor: "dependency-cruiser",
          analyzerVersion: "18.7.0",
          configHash: "c".repeat(64),
          snapshotSha: SHA_B,
        },
      ],
      viaDynamicImport: false,
    },
  ],
  associations: [],
  warnings: ["Historical co-change associations are unavailable."],
  coverage: {
    edgesAnalyzed: 1,
    roots: 1,
    maxDepth: 3,
    affectedReturned: 1,
    truncated: false,
    cyclesSkipped: 0,
    dynamicPaths: 0,
    unresolvedImports: 0,
    ignoredChangedFiles: 0,
    renamedChangedFiles: 0,
  },
};

describe("PR workflow event boundary", () => {
  it("accepts only pull_request opened/reopened/synchronize with full SHAs", () => {
    const valid = validatePullRequestEvent({
      event: "pull_request",
      action: "synchronize",
      repository: "Yumekaz/Domino",
      prNumber: 12,
      baseSha: SHA_A,
      headSha: SHA_B,
    });
    assert.equal(valid.action, "synchronize");
    assert.throws(
      () =>
        validatePullRequestEvent({
          event: "push",
          action: "opened",
          repository: "Yumekaz/Domino",
          prNumber: 12,
          baseSha: SHA_A,
          headSha: SHA_B,
        }),
      { code: "INVALID_EVENT" },
    );
    assert.throws(
      () =>
        validatePullRequestEvent({
          event: "pull_request",
          action: "edited",
          repository: "Yumekaz/Domino",
          prNumber: 12,
          baseSha: SHA_A,
          headSha: SHA_B,
        }),
      { code: "INVALID_EVENT" },
    );
    assert.throws(
      () =>
        validatePullRequestEvent({
          event: "pull_request",
          action: "opened",
          repository: "../outside",
          prNumber: 12,
          baseSha: SHA_A,
          headSha: SHA_B,
        }),
      { code: "INVALID_INPUT" },
    );
    assert.throws(
      () =>
        validatePullRequestEvent({
          event: "pull_request",
          action: "opened",
          repository: "Yumekaz/Domino",
          prNumber: 12,
          baseSha: "main",
          headSha: SHA_B,
        }),
      { code: "INVALID_INPUT" },
    );
  });

  it("parses renames, removals, duplicates and unknown statuses", () => {
    const parsed = parseChangedFileRecords([
      { filename: "src/auth.ts", status: "modified" },
      { filename: "src/new.ts", previous_filename: "src/old.ts", status: "renamed" },
      { filename: "src/removed.ts", status: "removed" },
      { filename: "src/auth.ts", status: "modified" },
      { filename: "src/odd.ts", status: "mystery" },
    ]);
    assert.deepEqual(
      parsed.files.map((file) => file.filename),
      ["src/auth.ts", "src/new.ts", "src/removed.ts"],
    );
    assert.deepEqual(parsed.renames, { "src/old.ts": "src/new.ts" });
    assert.ok(parsed.warnings.some((warning) => warning.includes("unknown GitHub file status")));
    assert.throws(() => parseChangedFileRecords([{ filename: "../escape.ts", status: "added" }]), {
      code: "UNSAFE_PATH",
    });
  });

  it("fetches bounded changed-file pages with a read-only token", async () => {
    const calls: { url: string; authorization: string }[] = [];
    const fetchImpl = async (url: URL, init: { headers: Record<string, string> }) => {
      calls.push({ url: url.toString(), authorization: init.headers.Authorization });
      return new Response(JSON.stringify([{ filename: "src/auth.ts", status: "modified" }]), {
        status: 200,
      });
    };
    const parsed = await fetchChangedFiles({
      token: "read-only-token",
      apiUrl: "https://api.github.com",
      repository: "Yumekaz/Domino",
      prNumber: 12,
      fetchImpl,
    });
    assert.equal(parsed.files.length, 1);
    assert.match(calls[0]?.url ?? "", /\/repos\/Yumekaz\/Domino\/pulls\/12\/files\?per_page=100&page=1$/);
    assert.equal(calls[0]?.authorization, "Bearer read-only-token");
  });

  it("rejects HTTP failures, non-HTTPS API URLs and oversized result sets", async () => {
    const failed = async () => new Response("nope", { status: 403 });
    await assert.rejects(
      fetchChangedFiles({
        token: "token",
        apiUrl: "https://api.github.com",
        repository: "Yumekaz/Domino",
        prNumber: 12,
        fetchImpl: failed,
      }),
      { code: "GITHUB_REQUEST_FAILED" },
    );
    await assert.rejects(
      fetchChangedFiles({
        token: "token",
        apiUrl: "http://api.github.com",
        repository: "Yumekaz/Domino",
        prNumber: 12,
        fetchImpl: failed,
      }),
      { code: "INVALID_INPUT" },
    );
    const hundred = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/file${index}.ts`,
      status: "modified",
    }));
    let pages = 0;
    const oversized = async () => {
      pages += 1;
      return new Response(JSON.stringify(hundred), { status: 200 });
    };
    await assert.rejects(
      fetchChangedFiles({
        token: "token",
        apiUrl: "https://api.github.com",
        repository: "Yumekaz/Domino",
        prNumber: 12,
        fetchImpl: oversized,
      }),
      { code: "CHANGED_FILES_LIMIT" },
    );
    assert.equal(pages, 3);
  });
});

describe("Summary truthfulness", () => {
  it("includes exact revisions, paths and limitations without inventing links", () => {
    const summary = renderSummary({
      repository: "Yumekaz/Domino",
      prNumber: 12,
      action: "synchronize",
      baseSha: SHA_A,
      headSha: SHA_B,
      analyzerVersion: "18.7.0",
      configHash: "d".repeat(64),
      changedFiles: ["src/auth.ts"],
      binaryFiles: [],
      result,
      workflowWarnings: [],
    });
    assert.match(summary, new RegExp(SHA_A));
    assert.match(summary, new RegExp(SHA_B));
    assert.match(summary, /src\/session\.ts/);
    assert.match(summary, /Historical co-change/);
    assert.match(summary, /does not post a PR comment or persist an analysis run/);
    assert.doesNotMatch(summary, /actions\/runs\/\d+/);
    assert.match(summary, /runtime dependency injection/);
  });

  it("states absence explicitly instead of claiming no impact", () => {
    const summary = renderSummary({
      repository: "Yumekaz/Domino",
      prNumber: 12,
      action: "opened",
      baseSha: SHA_A,
      headSha: SHA_B,
      analyzerVersion: "18.7.0",
      configHash: "d".repeat(64),
      changedFiles: ["src/isolated.ts"],
      binaryFiles: [],
      result: { ...result, affected: [], warnings: [] },
      workflowWarnings: [],
    });
    assert.match(summary, /No static reverse dependents were returned/);
    assert.match(summary, /does not establish that runtime behavior is unaffected/);
  });
});

describe("Workflow security properties", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/pr-impact.yml", import.meta.url),
    "utf8",
  );

  it("uses pull_request only with minimal read permissions", () => {
    assert.match(workflow, /on:\s*\n\s*pull_request:/);
    assert.match(workflow, /types: \[opened, reopened, synchronize\]/);
    assert.doesNotMatch(workflow, /pull_request_target/);
    assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: read/);
    assert.doesNotMatch(workflow, /write/);
    assert.match(workflow, /persist-credentials: false[\s\S]*persist-credentials: false/);
    assert.doesNotMatch(workflow, /secrets\./);
  });

  it("pins actions and installs only the analyzer with ignored scripts", () => {
    const uses = [...workflow.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
    assert.ok(uses.length >= 3);
    for (const use of uses) {
      assert.match(use, /^actions\/(?:checkout|setup-node)@[0-9a-f]{40}$/, use);
    }
    assert.match(workflow, /npm ci --ignore-scripts/);
    assert.doesNotMatch(workflow, /working-directory: target/);
    assert.doesNotMatch(workflow, /run:[\s\S]*npm (?:install|run|test)/);
    assert.match(workflow, /timeout-minutes: 15/);
  });
});
