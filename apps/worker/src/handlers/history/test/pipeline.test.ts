import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runHistoryImport } from "../pipeline.ts";
import {
  createTestStore,
  openTestStore,
} from "../../../../../../packages/retrieval/test/support/testStore.ts";
import {
  TestClock,
  yoctoQueueApi,
  yoctoQueueFixture,
} from "../../../../../../packages/github-adapter/test/support/fakeGithub.ts";
import { parseGithubRemote } from "../../../../../../packages/git-adapter/src/remote.ts";
import type { CheckoutHandle } from "../../../../../../packages/git-adapter/src/checkout.ts";
import type { AnalyzeGitHistoryOptions } from "../../../../../../packages/git-adapter/src/history.ts";
import {
  canonicalCommitKey,
  canonicalIssueKey,
  canonicalPullRequestKey,
  entityId,
} from "../../../../../../packages/core/history/src/ids.ts";
import type {
  GitCommitRecord,
  GitHistoryAnalysis,
  GitHistoryCoverage,
  GitIdentity,
} from "../../../../../../packages/core/history/src/types.ts";
import { HistoryError } from "../../../../../../packages/core/history/src/errors.ts";

const MERGE_SHA = "d631ea87f49443c4c8dbf84fd79bf600d11a5fac";
const FAIL_SHA = "f".repeat(40);
const STARTED = "2026-10-31T00:00:00Z";
const REPO_ID = "11111111-1111-4111-8111-111111111111";

const commitSha = MERGE_SHA;
const identity: GitIdentity = {
  key: "git:email:victor.fernandez.gabriel@gmail.com",
  name: "Víctor Fernández",
  email: "victor.fernandez.gabriel@gmail.com",
  rawNames: ["Víctor Fernández"],
  rawEmails: ["victor.fernandez.gabriel@gmail.com"],
  mailmapped: false,
};

function gitAnalysis(): GitHistoryAnalysis {
  const changed = ["index.js", "index.d.ts", "readme.md", "test.js"];
  const commit: GitCommitRecord = {
    sha: commitSha,
    parents: ["0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b"],
    author: identity,
    committer: identity,
    authoredAt: "2025-03-06T12:27:36Z",
    committedAt: "2025-03-06T12:27:36Z",
    message: "Add `.drain()` method (#12)",
    subject: "Add `.drain()` method (#12)",
    changes: changed.map((filePath) => ({
      status: "modified" as const,
      path: filePath,
      currentPath: filePath,
      previousPath: null,
      similarity: null,
      isBinary: false,
      blobSha: null,
      size: null,
    })),
    isMerge: false,
  };
  const coverage: GitHistoryCoverage = {
    requestedSha: commitSha,
    resolvedSha: commitSha,
    shallow: false,
    historyDepthRequested: 100,
    commitsAnalyzed: 1,
    commitsTruncated: false,
    maxCommitsReached: false,
    filesAtHead: 6,
    filesTruncated: false,
    renamesObserved: 0,
    renameConflicts: 0,
    deletedFilesExcluded: 0,
    mailmapPresent: false,
    window: { from: "2025-03-06T12:27:36Z", to: "2025-03-06T12:27:36Z" },
    warnings: [],
  };
  return {
    coverage,
    commits: [commit],
    contributors: [identity],
    currentFiles: ["index.js", "index.d.ts", "readme.md", "test.js", "package.json", "license"],
    possibleAliasGroups: [],
    fileContributions: changed.map((filePath) => ({
      snapshotId: "",
      path: filePath,
      contributorKey: identity.key,
      contributorName: identity.name,
      contributorEmail: identity.email,
      observedCommits: 1,
      firstTouch: "2025-03-06T12:27:36Z",
      lastTouch: "2025-03-06T12:27:36Z",
      commitShas: [commitSha],
    })),
  };
}

function createFixtureDirectory(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-pipeline-files-"));
  fs.writeFileSync(
    path.join(dir, "index.js"),
    "export default class Queue {\n\t* drain() {}\n}\n",
  );
  fs.writeFileSync(
    path.join(dir, "index.d.ts"),
    "export default class Queue<T> { drain(): Generator<T>; }\n",
  );
  fs.writeFileSync(path.join(dir, "readme.md"), "The queue exposes a drain method.\n");
  fs.writeFileSync(path.join(dir, "test.js"), "import Queue from './index.js';\n");
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"yocto-queue"}\n');
  fs.writeFileSync(path.join(dir, "license"), "MIT\n");
  return dir;
}

function fakeCheckout(directory: string, sha: string): CheckoutHandle {
  const files = [
    "index.js",
    "index.d.ts",
    "readme.md",
    "test.js",
    "package.json",
    "license",
  ];
  return {
    remote: parseGithubRemote("https://github.com/sindresorhus/yocto-queue"),
    sha,
    directory,
    readOnly: true,
    async listFiles() {
      return files.map((file) => ({
        path: file,
        mode: "100644",
        blobSha: "a".repeat(40),
        size: fs.statSync(path.join(directory, file)).size,
      }));
    },
    async readFile(repoPath: string) {
      return fs.readFileSync(path.join(directory, repoPath), "utf8");
    },
    async getChangeSet() {
      return [];
    },
    async getCommit() {
      throw new Error("not used");
    },
    async getRenameMap() {
      return new Map();
    },
    async dispose() {
      // The test owns this fixture directory.
    },
  };
}

async function runPipeline(input: {
  store: Awaited<ReturnType<typeof createTestStore>>["store"];
  headSha?: string;
  analyzer?: (directory: string, options: AnalyzeGitHistoryOptions) => Promise<GitHistoryAnalysis>;
  snapshotId?: string;
  signal?: AbortSignal;
  directory: string;
  progress?: (event: { phase: string; message: string }) => void;
}) {
  return await runHistoryImport(
    {
      repoUrl: "https://github.com/sindresorhus/yocto-queue",
      headSha: input.headSha ?? MERGE_SHA,
      branch: "main",
      ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
      focusIssueNumbers: [11],
      focusPullRequestNumbers: [12],
      collectionLimits: {
        maxIssues: 10,
        maxPullRequests: 5,
        maxPages: 2,
        maxCommentsPerItem: 50,
        maxIssuesWithComments: 3,
        maxReferencedIssues: 5,
        maxReviewsPerPullRequest: 50,
        maxCommitsPerPullRequest: 50,
        maxFilesPerPullRequest: 100,
        maxDocuments: 5,
        timeBudgetMs: 60_000,
      },
      indexing: {
        maxIndexedFiles: 20,
        maxFileBytes: 64 * 1024,
        maxChunksPerFile: 2,
        maxChunksPerSource: 10,
        maxEvidenceChunks: 500,
        includeFileExcerpts: true,
      },
      coChange: { maxTargets: 10, minSupport: 2, maxResults: 5, maxFilesPerCommit: 50 },
    },
    {
      github: yoctoQueueApi(),
      store: input.store,
      clock: new TestClock(STARTED),
      checkoutFactory: async () =>
        fakeCheckout(input.directory, input.headSha ?? MERGE_SHA),
      analyzer:
        input.analyzer ??
        (async () => gitAnalysis()),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.progress === undefined
        ? {}
        : { progress: (event) => input.progress?.({ phase: event.phase, message: event.message }) }),
    },
  );
}

test("runs a real graph/evidence pipeline over the public source fixture and persists it", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-pipeline-db-"));
  fs.rmdirSync(dataDir);
  const directory = createFixtureDirectory();
  const testStore = await createTestStore(dataDir);
  const phases: string[] = [];
  try {
    const result = await runPipeline({
      store: testStore.store,
      directory,
      progress: (event) => phases.push(event.phase),
    });
    assert.equal(result.snapshot.status, "ready");
    assert.equal(result.snapshot.headSha, MERGE_SHA);
    assert.equal(result.snapshot.completedAt, "2026-10-31T00:00:00.000Z");
    assert.ok(result.counts.entities > 10);
    assert.ok(result.counts.evidenceChunks > 5);
    assert.ok(result.counts.contributorRows >= 4);
    assert.equal(result.counts.indexedFiles, 4);
    assert.ok(phases.includes("fetching_github"));
    assert.ok(phases.includes("checking_out_git"));
    assert.ok(phases.includes("analyzing_history"));
    assert.ok(phases.includes("publishing"));

    const fixture = yoctoQueueFixture();
    const pullRequest = fixture.pullRequest as { id: number };
    const issue = fixture.issue as { id: number };
    const repoId = result.repository.id;
    const prId = entityId(repoId, "PullRequest", canonicalPullRequestKey(pullRequest.id));
    const issueId = entityId(repoId, "Issue", canonicalIssueKey(issue.id));
    const commitId = entityId(repoId, "Commit", canonicalCommitKey(MERGE_SHA));

    const neighborhood = await testStore.store.getNeighbors({
      repoId,
      snapshotId: result.snapshot.id,
      entityIds: [prId],
      depth: 1,
      maxNodes: 20,
      maxEdges: 40,
    });
    assert.ok(neighborhood.nodes.some((node) => node.id === issueId));
    assert.ok(neighborhood.nodes.some((node) => node.id === commitId));
    const closes = neighborhood.edges.find((edge) => edge.kind === "CLOSES_ISSUE");
    assert.ok(closes);
    assert.equal(closes.verification, "observed");
    assert.equal(closes.fromEntityId, prId);
    assert.equal(closes.toEntityId, issueId);

    const commitNeighborhood = await testStore.store.getNeighbors({
      repoId,
      snapshotId: result.snapshot.id,
      entityIds: [commitId],
      depth: 1,
      maxNodes: 20,
      maxEdges: 40,
    });
    assert.ok(
      commitNeighborhood.nodes.some(
        (node) => node.kind === "FileRevision" && node.metadata.path === "index.js",
      ),
    );

    const search = await testStore.store.searchEvidence({
      repoId,
      snapshotId: result.snapshot.id,
      query: "intended behavior drain",
      limit: 10,
    });
    const rationale = search.find((chunk) =>
      chunk.body.includes("This is intended behavior"),
    );
    assert.ok(rationale);
    assert.equal(
      rationale.sourceUrl,
      "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039",
    );
    assert.match(rationale.locator, /comment 2696500039/);

    const dataset = await testStore.store.getCoChangeDataset(repoId, result.snapshot.id);
    assert.ok(dataset);
    assert.equal(dataset.commitsAnalyzed, 1);
    assert.deepEqual(dataset.observations[0]?.files, [
      "index.d.ts",
      "index.js",
      "readme.md",
      "test.js",
    ]);

    const before = await countRows(testStore, result.snapshot.id);
    const second = await runPipeline({ store: testStore.store, directory });
    assert.equal(second.snapshot.id, result.snapshot.id);
    const after = await countRows(testStore, result.snapshot.id);
    assert.deepEqual(after, before);

    await testStore.close();
    const reopened = await openTestStore(dataDir);
    try {
      const persisted = await reopened.store.getSnapshot(repoId, result.snapshot.id);
      assert.equal(persisted?.status, "ready");
      const persistedSearch = await reopened.store.searchEvidence({
        repoId,
        snapshotId: result.snapshot.id,
        query: "intended behavior",
        limit: 5,
      });
      assert.ok(persistedSearch.length > 0);
      const persistedNeighborhood = await reopened.store.getNeighbors({
        repoId,
        snapshotId: result.snapshot.id,
        entityIds: [prId],
        depth: 1,
        maxNodes: 10,
        maxEdges: 10,
      });
      assert.ok(persistedNeighborhood.edges.some((edge) => edge.kind === "CLOSES_ISSUE"));
    } finally {
      await reopened.close();
    }
  } finally {
    try {
      await testStore.close();
    } catch {
      // Already closed after the persistence check.
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("marks a snapshot failed when Git analysis fails", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-pipeline-fail-"));
  fs.rmdirSync(dataDir);
  const directory = createFixtureDirectory();
  const testStore = await createTestStore(dataDir);
  try {
    await assert.rejects(
      runPipeline({
        store: testStore.store,
        directory,
        headSha: FAIL_SHA,
        analyzer: async () => {
          throw new HistoryError("GIT_FAILED", "simulated analyzer failure", {
            recoverable: true,
          });
        },
      }),
      (error: unknown) => error instanceof HistoryError && error.code === "GIT_FAILED",
    );
    const repoId = "00000000-0000-4000-8000-000000000000";
    const latest = await testStore.store.getLatestSnapshot(repoId);
    assert.equal(latest, null);
    const snapshotRows = await testStore.client.query<{
      id: string;
      status: string;
      errors: unknown;
    }>(`SELECT id, status, errors FROM index_snapshots ORDER BY started_at DESC`);
    const failed = snapshotRows.rows.find((row) => row.status === "failed");
    assert.ok(failed);
    assert.match(JSON.stringify(failed.errors), /simulated analyzer failure/);
  } finally {
    await testStore.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cancels before publication when the caller aborts", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-pipeline-cancel-"));
  fs.rmdirSync(dataDir);
  const directory = createFixtureDirectory();
  const testStore = await createTestStore(dataDir);
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      runPipeline({ store: testStore.store, directory, signal: controller.signal }),
      (error: unknown) =>
        error instanceof HistoryError && error.code === "COLLECTION_CANCELLED",
    );
    const rows = await testStore.client.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM index_snapshots`,
    );
    assert.equal(Number(rows.rows[0]?.count), 0);
  } finally {
    await testStore.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function countRows(
  testStore: Awaited<ReturnType<typeof createTestStore>>,
  snapshotId: string,
): Promise<{ entities: number; edges: number; chunks: number; contributors: number }> {
  const entities = await testStore.client.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM entities`,
  );
  const edges = await testStore.client.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM edges WHERE snapshot_id = $1`,
    [snapshotId],
  );
  const chunks = await testStore.client.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM evidence_documents WHERE snapshot_id = $1`,
    [snapshotId],
  );
  const contributors = await testStore.client.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM file_contributors WHERE snapshot_id = $1`,
    [snapshotId],
  );
  return {
    entities: Number(entities.rows[0]?.count ?? 0),
    edges: Number(edges.rows[0]?.count ?? 0),
    chunks: Number(chunks.rows[0]?.count ?? 0),
    contributors: Number(contributors.rows[0]?.count ?? 0),
  };
}
