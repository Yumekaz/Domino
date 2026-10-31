import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeGitHistory,
  buildRenameResolution,
  getCheckoutChangeSet,
} from "../src/history.ts";
import { buildCoChangeDataset, computeCoChange } from "../../core/history/src/cochange.ts";
import { createControlledGitEnv, createGitHome, runGit } from "../src/process.ts";
import {
  createHistoryFixture,
  createShallowClone,
  createWorktree,
} from "./support/repoFixture.ts";

const fixture = createHistoryFixture();
after(() => {
  fixture.cleanup();
});

function rowsFor(
  analysis: Awaited<ReturnType<typeof analyzeGitHistory>>,
  filePath: string,
) {
  return analysis.fileContributions.filter((row) => row.path === filePath);
}

test("analyzes real Git history with renames, deletion and mailmap identities", async () => {
  const analysis = await analyzeGitHistory(fixture.dir, {
    sha: fixture.shas.c7,
    maxCommits: 100,
    historyDepth: 100,
  });

  assert.equal(analysis.coverage.resolvedSha, fixture.shas.c7);
  assert.equal(analysis.commits.length, 7);
  assert.equal(analysis.coverage.renamesObserved, 1);
  assert.equal(analysis.coverage.renameConflicts, 0);
  assert.ok(analysis.coverage.deletedFilesExcluded >= 1);
  assert.equal(analysis.coverage.mailmapPresent, true);
  assert.equal(analysis.coverage.window.from, "2025-01-01T00:00:00Z");
  assert.equal(analysis.coverage.window.to, "2025-01-07T00:00:00Z");
  assert.ok(analysis.currentFiles.includes("src/auth/index.ts"));
  assert.ok(analysis.currentFiles.includes("src/session.ts"));
  assert.ok(!analysis.currentFiles.includes("src/auth.ts"));
  assert.ok(!analysis.currentFiles.includes("README.md"));

  const rows = rowsFor(analysis, "src/auth/index.ts");
  const alice = rows.find((row) => row.contributorEmail === "alice@example.com");
  const bob = rows.find((row) => row.contributorEmail === "bob@example.com");
  assert.ok(alice);
  assert.ok(bob);
  assert.equal(alice.observedCommits, 2);
  assert.equal(bob.observedCommits, 2);
  assert.deepEqual(new Set(bob.commitShas), new Set([fixture.shas.c2, fixture.shas.c5]));

  const bobIdentity = analysis.contributors.find((identity) => identity.key === bob.contributorKey);
  assert.ok(bobIdentity);
  assert.equal(bobIdentity.mailmapped, true);
  assert.ok(bobIdentity.rawEmails.includes("robert@example.com"));
  assert.equal(analysis.possibleAliasGroups.length, 1);
  assert.equal(analysis.possibleAliasGroups[0]?.normalizedName, "alice example");
  assert.deepEqual(
    new Set(analysis.possibleAliasGroups[0]?.emails),
    new Set(["alice@example.com", "alice+alt@example.com"]),
  );

  const single = rowsFor(analysis, "src/only-alice.ts");
  assert.equal(single.length, 1);
  assert.equal(single[0]?.contributorEmail, "alice@example.com");
});

test("computes rename-aware observed co-change with an explicit denominator", async () => {
  const analysis = await analyzeGitHistory(fixture.dir, {
    sha: fixture.shas.c7,
    maxCommits: 100,
  });
  const dataset = buildCoChangeDataset(analysis.commits, {
    maxFilesPerCommit: 50,
    minSupport: 2,
  });
  const result = computeCoChange(dataset, "src/auth/index.ts", { minSupport: 2 });
  assert.equal(result.coverage.commitsTouchingTarget, 4);
  assert.equal(result.coverage.minSupport, 2);
  const session = result.observations.find((item) => item.file === "src/session.ts");
  assert.ok(session);
  assert.equal(session.sharedCommits, 2);
  assert.equal(session.targetCommits, 4);
  assert.equal(session.share, 0.5);
  assert.deepEqual(
    new Set(session.commitShas),
    new Set([fixture.shas.c1, fixture.shas.c5]),
  );
  assert.equal(result.observations.some((item) => item.file === "src/dashboard.ts"), false);
  assert.equal(result.observations.some((item) => item.file === "README.md"), false);
  assert.ok(result.coverage.window.from);
  assert.ok(result.coverage.window.to);
});

test("a second real contributor changes the observed-author result when the revision advances", async () => {
  const early = createWorktree(fixture, fixture.shas.c1);
  const earlyAnalysis = await analyzeGitHistory(early.dir, {
    sha: fixture.shas.c1,
    maxCommits: 100,
  });
  early.cleanup();
  const earlyRows = earlyAnalysis.fileContributions.filter((row) => row.path === "src/auth.ts");
  assert.equal(earlyRows.length, 1);
  assert.equal(earlyRows[0]?.contributorEmail, "alice@example.com");

  const current = await analyzeGitHistory(fixture.dir, {
    sha: fixture.shas.c7,
    maxCommits: 100,
  });
  const currentRows = current.fileContributions.filter(
    (row) => row.path === "src/auth/index.ts",
  );
  assert.equal(new Set(currentRows.map((row) => row.contributorEmail)).size, 2);
});

test("history truncation and shallow clones are disclosed, never treated as complete", async () => {
  const truncated = await analyzeGitHistory(fixture.dir, {
    sha: fixture.shas.c7,
    maxCommits: 2,
  });
  assert.equal(truncated.coverage.maxCommitsReached, true);
  assert.equal(truncated.coverage.commitsTruncated, true);
  assert.equal(truncated.commits.length, 2);
  assert.ok(truncated.coverage.warnings.some((warning) => warning.includes("limit")));

  const shallow = createShallowClone(fixture);
  try {
    const shallowAnalysis = await analyzeGitHistory(shallow.dir, {
      sha: fixture.shas.c7,
      maxCommits: 100,
    });
    assert.equal(shallowAnalysis.coverage.shallow, true);
    assert.equal(shallowAnalysis.coverage.commitsTruncated, true);
    assert.equal(shallowAnalysis.commits.length, 1);
    assert.ok(
      shallowAnalysis.coverage.warnings.some((warning) => warning.includes("shallow")),
    );
  } finally {
    shallow.cleanup();
  }
});

test("rejects an exact-SHA mismatch and a non-Git directory", async () => {
  await assert.rejects(
    analyzeGitHistory(fixture.dir, { sha: fixture.shas.c1, maxCommits: 10 }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "SHA_NOT_FOUND",
  );
  await assert.rejects(
    analyzeGitHistory(path.join(os.tmpdir(), "domino-does-not-exist"), {}),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "INVALID_PATH",
  );
});

test("reads a single commit change set including rename and deletion statuses", async () => {
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domino-git-home-test-"));
  const home = createGitHome(homeRoot);
  try {
    const rename = await getCheckoutChangeSet(fixture.dir, fixture.shas.c3, {
      home,
      timeoutMs: 30_000,
    });
    const renamed = rename.find((change) => change.status === "renamed");
    assert.ok(renamed);
    assert.equal(renamed.previousPath, "src/auth.ts");
    assert.equal(renamed.path, "src/auth/index.ts");

    const deletion = await getCheckoutChangeSet(fixture.dir, fixture.shas.c4, {
      home,
      timeoutMs: 30_000,
    });
    assert.ok(deletion.some((change) => change.status === "deleted" && change.path === "README.md"));
  } finally {
    fs.rmSync(homeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("does not project a deleted-then-recreated path through ambiguous history", () => {
  const commits = [
    { sha: "1".repeat(40), committedAt: "2025-01-01T00:00:00Z" },
    { sha: "2".repeat(40), committedAt: "2025-01-02T00:00:00Z" },
    { sha: "3".repeat(40), committedAt: "2025-01-03T00:00:00Z" },
  ];
  const changes = new Map([
    [
      commits[0].sha,
      [{ status: "added" as const, path: "src/reused.ts", previousPath: null, similarity: null }],
    ],
    [
      commits[1].sha,
      [{ status: "deleted" as const, path: "src/reused.ts", previousPath: null, similarity: null }],
    ],
    [
      commits[2].sha,
      [{ status: "added" as const, path: "src/reused.ts", previousPath: null, similarity: null }],
    ],
  ]);
  const resolution = buildRenameResolution(
    commits.map((commit) => ({
      sha: commit.sha,
      parents: [],
      rawAuthorName: "A",
      rawAuthorEmail: "a@example.com",
      canonicalAuthorName: "A",
      canonicalAuthorEmail: "a@example.com",
      authoredAt: commit.committedAt,
      committerName: "A",
      committerEmail: "a@example.com",
      committedAt: commit.committedAt,
      subject: "change",
      message: "change",
    })),
    changes,
    new Set(["src/reused.ts"]),
  );
  assert.equal(resolution.resolve("src/reused.ts"), null);
  assert.ok(resolution.ambiguousPaths.includes("src/reused.ts"));
});

test("enforces process timeouts and cancellation", async () => {
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domino-git-home-test-"));
  const home = createGitHome(homeRoot);
  try {
    const timeout = await runGit(["log", "--all"], {
      cwd: fixture.dir,
      home: home.home,
      configFile: home.configFile,
      timeoutMs: 1,
    });
    assert.equal(timeout.timedOut, true);

    const controller = new AbortController();
    controller.abort();
    const aborted = await runGit(["log", "--all"], {
      cwd: fixture.dir,
      home: home.home,
      configFile: home.configFile,
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    assert.equal(aborted.aborted, true);
  } finally {
    fs.rmSync(homeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("constructs a Git environment without inherited credentials", () => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "should-not-leak";
  try {
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domino-git-home-test-"));
    const home = createGitHome(homeRoot);
    const env = createControlledGitEnv(home.home, home.configFile);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
    fs.rmSync(homeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } finally {
    if (previous === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previous;
    }
  }
});
