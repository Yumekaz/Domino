import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestStore, openTestStore } from "./support/testStore.ts";
import { chunkSource } from "../src/chunk.ts";
import {
  canonicalCommentKey,
  canonicalCommitKey,
  canonicalFileKey,
  canonicalFileRevisionKey,
  canonicalIssueKey,
  canonicalPullRequestKey,
  entityId,
  relationshipId,
} from "../../core/history/src/ids.ts";
import type {
  CoverageReport,
  EntityRecord,
  EvidenceChunkRecord,
  RelationshipRecord,
  RepositoryRecord,
  SnapshotRecord,
} from "../../core/history/src/types.ts";

const REPO_A = "11111111-1111-4111-8111-111111111111";
const REPO_B = "11111111-1111-4111-8111-222222222222";
const SNAP_A = "22222222-2222-4222-8222-111111111111";
const SNAP_B = "22222222-2222-4222-8222-222222222222";
const SNAP_B2 = "22222222-2222-4222-8222-333333333333";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const COMMIT_SHA = "d631ea87f49443c4c8dbf84fd79bf600d11a5fac";
const STARTED = "2026-10-31T00:00:00Z";

function coverage(): CoverageReport {
  return {
    sources: {
      gitHistory: {
        source: "gitHistory",
        status: "complete",
        pagesFetched: 1,
        items: 3,
        capHit: false,
        warnings: [],
        window: { from: "2025-01-01T00:00:00Z", to: "2025-03-06T12:27:36Z" },
      },
    },
    warnings: [],
    limits: {
      coChangeCommitsAnalyzed: 1,
      coChangeCommitsExcludedOverCap: 0,
      coChangeExcludedPaths: 1,
      coChangeMaxFilesPerCommit: 50,
      coChangeMinSupport: 2,
      coChangeWindowFrom: "2025-01-01T00:00:00Z",
      coChangeWindowTo: "2025-03-06T12:27:36Z",
      gitPossibleAliasGroups: 0,
      gitMailmapPresent: false,
    },
  };
}

function repository(id: string, githubId: number, name: string): RepositoryRecord {
  return {
    id,
    githubId,
    owner: "sindresorhus",
    name,
    defaultBranch: "main",
    visibility: "public",
    htmlUrl: `https://github.com/sindresorhus/${name}`,
    createdAt: STARTED,
  };
}

function snapshot(id: string, repoId: string, sha: string, startedAt: string): SnapshotRecord {
  return {
    id,
    repoId,
    headSha: sha,
    branch: "main",
    status: "ready",
    coverage: coverage(),
    toolVersions: { git: "2.52.0", node: "24.13.0" },
    startedAt,
    completedAt: startedAt,
    errors: [],
  };
}

const issueId = entityId(REPO_A, "Issue", canonicalIssueKey(2891449053));
const commentId = entityId(REPO_A, "DiscussionComment", canonicalCommentKey(2696500039));
const prId = entityId(REPO_A, "PullRequest", canonicalPullRequestKey(2360000000));
const commitId = entityId(REPO_A, "Commit", canonicalCommitKey(COMMIT_SHA));
const fileIndexId = entityId(REPO_A, "File", canonicalFileKey("index.js"));
const fileDtsId = entityId(REPO_A, "File", canonicalFileKey("index.d.ts"));
const revIndexId = entityId(REPO_A, "FileRevision", canonicalFileRevisionKey("index.js", COMMIT_SHA));
const revDtsId = entityId(REPO_A, "FileRevision", canonicalFileRevisionKey("index.d.ts", COMMIT_SHA));
const workflowFileId = entityId(REPO_A, "File", canonicalFileKey(".github/workflows/main.yml"));
const workflowRevId = entityId(
  REPO_A,
  "FileRevision",
  canonicalFileRevisionKey(".github/workflows/main.yml", COMMIT_SHA),
);

function entities(): EntityRecord[] {
  return [
    {
      id: issueId,
      repoId: REPO_A,
      kind: "Issue",
      canonicalKey: canonicalIssueKey(2891449053),
      title: "#11 Iterator doesn't update size",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/issues/11",
      metadata: { number: 11, state: "closed", closedAt: "2025-03-06T12:27:37Z" },
    },
    {
      id: commentId,
      repoId: REPO_A,
      kind: "DiscussionComment",
      canonicalKey: canonicalCommentKey(2696500039),
      title: "Comment on #11",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039",
      metadata: { parentNumber: 11, authorLogin: "sindresorhus" },
    },
    {
      id: prId,
      repoId: REPO_A,
      kind: "PullRequest",
      canonicalKey: canonicalPullRequestKey(2360000000),
      title: "#12 Add drain method",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
      metadata: {
        number: 12,
        state: "closed",
        mergedAt: "2025-03-06T12:27:36Z",
        mergeCommitSha: COMMIT_SHA,
      },
    },
    {
      id: commitId,
      repoId: REPO_A,
      kind: "Commit",
      canonicalKey: canonicalCommitKey(COMMIT_SHA),
      title: "Add .drain() method (#12)",
      sourceUrl: `https://github.com/sindresorhus/yocto-queue/commit/${COMMIT_SHA}`,
      metadata: {
        sha: COMMIT_SHA,
        authoredAt: "2025-03-06T12:27:36Z",
        authorKey: "git:email:victor.fernandez.gabriel@gmail.com",
        coChangeEligible: true,
        coChangeFiles: ["index.d.ts", "index.js"],
      },
    },
    {
      id: fileIndexId,
      repoId: REPO_A,
      kind: "File",
      canonicalKey: canonicalFileKey("index.js"),
      title: "index.js",
      sourceUrl: `https://github.com/sindresorhus/yocto-queue/blob/${SHA_A}/index.js`,
      metadata: { path: "index.js", currentAtSnapshot: true },
    },
    {
      id: fileDtsId,
      repoId: REPO_A,
      kind: "File",
      canonicalKey: canonicalFileKey("index.d.ts"),
      title: "index.d.ts",
      sourceUrl: `https://github.com/sindresorhus/yocto-queue/blob/${SHA_A}/index.d.ts`,
      metadata: { path: "index.d.ts", currentAtSnapshot: true },
    },
    {
      id: revIndexId,
      repoId: REPO_A,
      kind: "FileRevision",
      canonicalKey: canonicalFileRevisionKey("index.js", COMMIT_SHA),
      title: "index.js@commit",
      sourceUrl: `https://github.com/sindresorhus/yocto-queue/blob/${COMMIT_SHA}/index.js`,
      metadata: { path: "index.js", currentPath: "index.js", commitSha: COMMIT_SHA },
    },
    {
      id: revDtsId,
      repoId: REPO_A,
      kind: "FileRevision",
      canonicalKey: canonicalFileRevisionKey("index.d.ts", COMMIT_SHA),
      title: "index.d.ts@commit",
      sourceUrl: `https://github.com/sindresorhus/yocto-queue/blob/${COMMIT_SHA}/index.d.ts`,
      metadata: { path: "index.d.ts", currentPath: "index.d.ts", commitSha: COMMIT_SHA },
    },
    {
      id: workflowFileId,
      repoId: REPO_A,
      kind: "File",
      canonicalKey: canonicalFileKey(".github/workflows/main.yml"),
      title: ".github/workflows/main.yml",
      sourceUrl: `https://github.com/sindresorhus/yocto-queue/blob/${SHA_A}/.github/workflows/main.yml`,
      metadata: { path: ".github/workflows/main.yml", currentAtSnapshot: true },
    },
    {
      id: workflowRevId,
      repoId: REPO_A,
      kind: "FileRevision",
      canonicalKey: canonicalFileRevisionKey(".github/workflows/main.yml", COMMIT_SHA),
      title: ".github/workflows/main.yml@commit",
      sourceUrl: `https://github.com/sindresorhus/yocto-queue/blob/${COMMIT_SHA}/.github/workflows/main.yml`,
      metadata: {
        path: ".github/workflows/main.yml",
        currentPath: ".github/workflows/main.yml",
        commitSha: COMMIT_SHA,
      },
    },
  ];
}

function chunks(): EvidenceChunkRecord[] {
  return [
    ...chunkSource({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      entityId: issueId,
      entityKind: "Issue",
      sourceKind: "issue",
      sourceId: "11",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/issues/11",
      title: "Iterator doesn't update size, head, tail",
      body: "The iterator is intentionally non-destructive. A separate method called drain was suggested for dequeuing.",
      locatorPrefix: "Issue #11",
      sourceTimestamp: "2025-03-03T14:42:37Z",
      revision: SHA_A,
      metadata: { number: 11 },
    }),
    ...chunkSource({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      entityId: commentId,
      entityKind: "DiscussionComment",
      sourceKind: "issue_comment",
      sourceId: "2696500039",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039",
      title: "Comment on #11",
      body: "This is intended behavior. It should be a separate method. Maybe called drain().",
      locatorPrefix: "Issue #11 comment 2696500039",
      sourceTimestamp: "2025-03-04T07:41:41Z",
      revision: SHA_A,
      metadata: { number: 11, author: "sindresorhus" },
    }),
    ...chunkSource({
      repoId: REPO_A,
      snapshotId: SNAP_B,
      entityId: issueId,
      entityKind: "Issue",
      sourceKind: "issue",
      sourceId: "11",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/issues/11",
      title: "Iterator doesn't update size, head, tail",
      body: "Unrelated release notes for a later snapshot.",
      locatorPrefix: "Issue #11",
      sourceTimestamp: "2025-03-03T14:42:37Z",
      revision: SHA_B,
      metadata: { number: 11 },
    }),
  ];
}

function edges(): RelationshipRecord[] {
  return [
    {
      id: relationshipId({
        repoId: REPO_A,
        snapshotId: SNAP_A,
        kind: "CLOSES_ISSUE",
        fromEntityId: prId,
        toEntityId: issueId,
        sourceEntityId: prId,
      }),
      repoId: REPO_A,
      snapshotId: SNAP_A,
      fromEntityId: prId,
      toEntityId: issueId,
      kind: "CLOSES_ISSUE",
      verification: "observed",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
      sourceEntityId: prId,
      extractor: "github-closing-keyword+cross-reference",
      observedAt: "2025-03-06T12:27:37Z",
      verificationDetail: "Confirmed by cross-reference and issue-closed transition",
      evidence: { excerpt: "Fixes #11" },
    },
    {
      id: relationshipId({
        repoId: REPO_A,
        snapshotId: SNAP_A,
        kind: "IN_PR",
        fromEntityId: commitId,
        toEntityId: prId,
        sourceEntityId: prId,
      }),
      repoId: REPO_A,
      snapshotId: SNAP_A,
      fromEntityId: commitId,
      toEntityId: prId,
      kind: "IN_PR",
      verification: "observed",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
      sourceEntityId: prId,
      extractor: "github-pull-request-metadata",
      observedAt: "2025-03-06T12:27:36Z",
      verificationDetail: "merge_commit_sha",
      evidence: { excerpt: `PR #12 merge commit ${COMMIT_SHA}` },
    },
    ...["index.js", "index.d.ts", ".github/workflows/main.yml"].map((filePath) => {
      const revision =
        filePath === "index.js"
          ? revIndexId
          : filePath === "index.d.ts"
            ? revDtsId
            : workflowRevId;
      return {
        id: relationshipId({
          repoId: REPO_A,
          snapshotId: SNAP_A,
          kind: "MODIFIED",
          fromEntityId: commitId,
          toEntityId: revision,
          sourceEntityId: commitId,
        }),
        repoId: REPO_A,
        snapshotId: SNAP_A,
        fromEntityId: commitId,
        toEntityId: revision,
        kind: "MODIFIED" as const,
        verification: "observed" as const,
        sourceUrl: `https://github.com/sindresorhus/yocto-queue/commit/${COMMIT_SHA}`,
        sourceEntityId: commitId,
        extractor: "git-log-name-status",
        observedAt: "2025-03-06T12:27:36Z",
        verificationDetail: "Git diff status modified",
        evidence: { excerpt: `modified ${filePath}` },
      };
    }),
    {
      id: relationshipId({
        repoId: REPO_A,
        snapshotId: SNAP_A,
        kind: "CO_CHANGED_WITH",
        fromEntityId: fileIndexId,
        toEntityId: fileDtsId,
        sourceEntityId: null,
      }),
      repoId: REPO_A,
      snapshotId: SNAP_A,
      fromEntityId: fileIndexId,
      toEntityId: fileDtsId,
      kind: "CO_CHANGED_WITH",
      verification: "derived",
      sourceUrl: null,
      sourceEntityId: null,
      extractor: "git-cochange",
      observedAt: STARTED,
      verificationDetail: "Observed historical co-change; not an import",
      evidence: {
        metadata: {
          sharedCommits: 4,
          targetCommits: 6,
          minSupport: 2,
          windowFrom: "2025-01-01T00:00:00Z",
          windowTo: "2025-03-06T12:27:36Z",
        },
      },
    },
  ];
}

function contributorRows() {
  return [
    {
      snapshotId: SNAP_A,
      path: "src/only.ts",
      contributorKey: "git:email:alice@example.com",
      contributorName: "Alice",
      contributorEmail: "alice@example.com",
      observedCommits: 3,
      firstTouch: "2025-01-01T00:00:00Z",
      lastTouch: "2025-03-01T00:00:00Z",
      commitShas: ["1".repeat(40), "2".repeat(40), "3".repeat(40)],
    },
    {
      snapshotId: SNAP_A,
      path: "src/shared.ts",
      contributorKey: "git:email:alice@example.com",
      contributorName: "Alice",
      contributorEmail: "alice@example.com",
      observedCommits: 2,
      firstTouch: "2025-01-01T00:00:00Z",
      lastTouch: "2025-02-01T00:00:00Z",
      commitShas: ["1".repeat(40), "2".repeat(40)],
    },
    {
      snapshotId: SNAP_A,
      path: "src/shared.ts",
      contributorKey: "git:email:bob@example.com",
      contributorName: "Bob",
      contributorEmail: "bob@example.com",
      observedCommits: 1,
      firstTouch: "2025-03-01T00:00:00Z",
      lastTouch: "2025-03-01T00:00:00Z",
      commitShas: ["3".repeat(40)],
    },
  ];
}

async function seed(store: Awaited<ReturnType<typeof createTestStore>>["store"]) {
  await store.ensureRepository(repository(REPO_A, 315531538, "yocto-queue"));
  await store.createSnapshot(snapshot(SNAP_A, REPO_A, SHA_A, STARTED));
  await store.createSnapshot(snapshot(SNAP_B, REPO_A, SHA_B, "2026-10-31T01:00:00Z"));
  await store.upsertEntities(entities());
  await store.upsertRelationships(edges());
  await store.replaceEvidenceChunks(chunks());
  await store.replaceFileContributors(contributorRows());
}

test("PostgreSQL full-text retrieval is snapshot-scoped and returns exact source records", async () => {
  const testStore = await createTestStore();
  try {
    await seed(testStore.store);
    const hits = await testStore.store.searchEvidence({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      query: "drain method",
      limit: 10,
    });
    assert.ok(hits.length > 0);
    const comment = hits.find((hit) => hit.entityId === commentId);
    assert.ok(comment);
    assert.match(comment.body, /separate method/);
    assert.equal(comment.sourceUrl, "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039");
    assert.match(comment.locator, /comment 2696500039/);
    assert.ok(comment.contentSha.length === 64);
    assert.equal(comment.revision, SHA_A);

    const later = await testStore.store.searchEvidence({
      repoId: REPO_A,
      snapshotId: SNAP_B,
      query: "drain method",
      limit: 10,
    });
    assert.equal(later.length, 0);
    const unrelated = await testStore.store.searchEvidence({
      repoId: REPO_A,
      snapshotId: SNAP_B,
      query: "unrelated release notes",
      limit: 10,
    });
    assert.equal(unrelated.length, 1);

    const issueOnly = await testStore.store.searchEvidence({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      query: "iterator",
      limit: 10,
      entityKinds: ["Issue"],
    });
    assert.ok(issueOnly.length > 0);
    assert.equal(issueOnly.every((hit) => hit.entityKind === "Issue"), true);

    const naturalQuestion = await testStore.store.searchEvidence({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      query: "Why doesn't the iterator drain the queue?",
      limit: 10,
    });
    assert.ok(naturalQuestion.length > 0);
    assert.ok(naturalQuestion.some((hit) => hit.entityId === commentId || hit.entityId === issueId));

    const noEvidence = await testStore.store.searchEvidence({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      query: "quantum chromodynamics",
      limit: 10,
    });
    assert.deepEqual(noEvidence, []);
  } finally {
    await testStore.close();
  }
});

test("cross-repository isolation and bounded graph neighborhoods", async () => {
  const testStore = await createTestStore();
  try {
    await seed(testStore.store);
    await testStore.store.ensureRepository(repository(REPO_B, 999, "other-repo"));
    await testStore.store.createSnapshot(snapshot(SNAP_B2, REPO_B, SHA_B, STARTED));
    const otherEntityId = entityId(REPO_B, "Issue", canonicalIssueKey(1));
    await testStore.store.upsertEntities([
      {
        id: otherEntityId,
        repoId: REPO_B,
        kind: "Issue",
        canonicalKey: canonicalIssueKey(1),
        title: "#1 other issue",
        sourceUrl: "https://github.com/sindresorhus/other-repo/issues/1",
        metadata: { number: 1 },
      },
    ]);
    await testStore.store.replaceEvidenceChunks(
      chunkSource({
        repoId: REPO_B,
        snapshotId: SNAP_B2,
        entityId: otherEntityId,
        entityKind: "Issue",
        sourceKind: "issue",
        sourceId: "1",
        sourceUrl: "https://github.com/sindresorhus/other-repo/issues/1",
        title: "other",
        body: "A completely different drain method discussion.",
        locatorPrefix: "Issue #1",
        sourceTimestamp: null,
        revision: SHA_B,
      }),
    );
    const repoBHits = await testStore.store.searchEvidence({
      repoId: REPO_B,
      snapshotId: SNAP_B2,
      query: "drain method",
      limit: 10,
    });
    assert.equal(repoBHits.length, 1);
    const repoAHits = await testStore.store.searchEvidence({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      query: "drain method",
      limit: 10,
    });
    assert.equal(repoAHits.some((hit) => hit.entityId === otherEntityId), false);

    const neighborhood = await testStore.store.getNeighbors({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      entityIds: [prId],
      depth: 1,
      maxNodes: 10,
      maxEdges: 10,
    });
    assert.equal(neighborhood.truncated, false);
    assert.ok(neighborhood.nodes.some((node) => node.id === prId));
    assert.ok(neighborhood.nodes.some((node) => node.id === issueId));
    assert.ok(neighborhood.nodes.some((node) => node.id === commitId));
    assert.equal(neighborhood.edges.length, 2);
    assert.equal(
      neighborhood.edges.every((edge) => edge.verification === "observed"),
      true,
    );

    const bounded = await testStore.store.getNeighbors({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      entityIds: [prId],
      depth: 2,
      maxNodes: 2,
      maxEdges: 1,
    });
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.nodes.length <= 2);
    assert.ok(bounded.edges.length <= 1);
    assert.ok(
      bounded.edges.every(
        (edge) =>
          bounded.nodes.some((node) => node.id === edge.fromEntityId) &&
          bounded.nodes.some((node) => node.id === edge.toEntityId),
      ),
    );
  } finally {
    await testStore.close();
  }
});

test("co-change observations and risk rows are reconstructed from stored snapshot data", async () => {
  const testStore = await createTestStore();
  try {
    await seed(testStore.store);
    const dataset = await testStore.store.getCoChangeDataset(REPO_A, SNAP_A);
    assert.ok(dataset);
    assert.equal(dataset.commitsAnalyzed, 1);
    assert.equal(dataset.commitsExcludedOverCap, 0);
    assert.equal(dataset.excludedPaths, 1);
    assert.equal(dataset.observations.length, 1);
    assert.deepEqual(dataset.observations[0]?.files, ["index.d.ts", "index.js"]);
    assert.equal(dataset.observations[0]?.files.includes(".github/workflows/main.yml"), false);
    assert.equal(dataset.observations[0]?.sha, COMMIT_SHA);

    const coChangeEdges = await testStore.store.getCoChangeEdges({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      filePath: "index.js",
      limit: 10,
    });
    assert.equal(coChangeEdges.length, 1);
    assert.equal(coChangeEdges[0]?.kind, "CO_CHANGED_WITH");
    assert.equal(coChangeEdges[0]?.verification, "derived");

    const risk = await testStore.store.getRiskPage({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      limit: 2,
      offset: 0,
      riskExtensions: [".ts"],
      includeAllPaths: false,
    });
    assert.equal(risk.totalFiles, 2);
    assert.equal(risk.rows.length, 3);
    assert.equal(risk.rows.some((row) => row.path === "src/shared.ts"), true);

    const page = await testStore.store.getRiskPage({
      repoId: REPO_A,
      snapshotId: SNAP_A,
      limit: 1,
      offset: 0,
      riskExtensions: [".ts"],
      includeAllPaths: false,
    });
    assert.equal(page.totalFiles, 2);
    assert.equal(new Set(page.rows.map((row) => row.path)).size, 1);
  } finally {
    await testStore.close();
  }
});

test("duplicate upserts are idempotent and snapshot data survives a store restart", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-pglite-"));
  fs.rmdirSync(dataDir);
  try {
    const first = await createTestStore(dataDir);
    await seed(first.store);
    await first.store.upsertEntities(entities());
    await first.store.upsertRelationships(edges());
    await first.store.replaceEvidenceChunks(chunks());
    await first.store.replaceFileContributors(contributorRows());
    const entityCount = await first.client.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM entities`,
    );
    const edgeCount = await first.client.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM edges`,
    );
    const chunkCount = await first.client.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM evidence_documents`,
    );
    assert.equal(Number(entityCount.rows[0]?.count), 10);
    assert.equal(Number(edgeCount.rows[0]?.count), 6);
    assert.equal(Number(chunkCount.rows[0]?.count), 3);
    await first.close();

    const reopened = await openTestStore(dataDir);
    try {
      const hits = await reopened.store.searchEvidence({
        repoId: REPO_A,
        snapshotId: SNAP_A,
        query: "drain method",
        limit: 10,
      });
      assert.ok(hits.length > 0);
      const snapshots = await reopened.store.getLatestSnapshot(REPO_A);
      assert.equal(snapshots?.id, SNAP_B);
      const risk = await reopened.store.getRiskPage({
        repoId: REPO_A,
        snapshotId: SNAP_A,
        limit: 10,
        offset: 0,
        riskExtensions: [".ts"],
        includeAllPaths: false,
      });
      assert.equal(risk.totalFiles, 2);
    } finally {
      await reopened.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
