import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support/testStore.ts";
import { DefaultEvidenceRetriever } from "../src/pack.ts";
import { chunkSource } from "../src/chunk.ts";
import { HistoryError } from "../../core/history/src/errors.ts";
import {
  canonicalCommentKey,
  canonicalFileKey,
  canonicalIssueKey,
  entityId,
  relationshipId,
} from "../../core/history/src/ids.ts";
import type {
  CoverageReport,
  EntityRecord,
  EvidenceChunkRecord,
  RelationshipRecord,
} from "../../core/history/src/types.ts";

const REPO = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "22222222-2222-4222-8222-111111111111";
const SHA = "a".repeat(40);
const NOW = "2026-10-31T00:00:00.000Z";

function coverage(): CoverageReport {
  return {
    sources: {
      gitHistory: {
        source: "gitHistory",
        status: "complete",
        pagesFetched: 1,
        items: 5,
        capHit: false,
        warnings: [],
        window: { from: "2025-01-01T00:00:00Z", to: "2025-03-06T12:27:36Z" },
      },
    },
    warnings: [],
    limits: {},
  };
}

async function seed() {
  const testStore = await createTestStore();
  await testStore.store.ensureRepository({
    id: REPO,
    githubId: 315531538,
    owner: "sindresorhus",
    name: "yocto-queue",
    defaultBranch: "main",
    visibility: "public",
    htmlUrl: "https://github.com/sindresorhus/yocto-queue",
    createdAt: NOW,
  });
  await testStore.store.createSnapshot({
    id: SNAPSHOT,
    repoId: REPO,
    headSha: SHA,
    branch: "main",
    status: "ready",
    coverage: coverage(),
    toolVersions: {},
    startedAt: NOW,
    completedAt: NOW,
    errors: [],
  });
  const issueId = entityId(REPO, "Issue", canonicalIssueKey(11));
  const commentId = entityId(REPO, "DiscussionComment", canonicalCommentKey(2696500039));
  const entities: EntityRecord[] = [
    {
      id: issueId,
      repoId: REPO,
      kind: "Issue",
      canonicalKey: canonicalIssueKey(11),
      title: "#11 iterator",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/issues/11",
      metadata: { number: 11 },
    },
    {
      id: commentId,
      repoId: REPO,
      kind: "DiscussionComment",
      canonicalKey: canonicalCommentKey(2696500039),
      title: "Comment on #11",
      sourceUrl:
        "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039",
      metadata: { number: 11 },
    },
  ];
  const chunks: EvidenceChunkRecord[] = [];
  for (let index = 0; index < 14; index += 1) {
    const filePath = `src/file-${String(index).padStart(2, "0")}.ts`;
    const fileId = entityId(REPO, "File", canonicalFileKey(filePath));
    entities.push({
      id: fileId,
      repoId: REPO,
      kind: "File",
      canonicalKey: canonicalFileKey(filePath),
      title: filePath,
      sourceUrl: `https://github.com/sindresorhus/yocto-queue/blob/${SHA}/${filePath}`,
      metadata: { path: filePath },
    });
    chunks.push(
      ...chunkSource({
        repoId: REPO,
        snapshotId: SNAPSHOT,
        entityId: fileId,
        entityKind: "File",
        sourceKind: "file_excerpt",
        sourceId: `${filePath}@${SHA}`,
        sourceUrl: `https://github.com/sindresorhus/yocto-queue/blob/${SHA}/${filePath}`,
        title: filePath,
        body: `drain drain drain drain drain method method ${Array.from(
          { length: 30 },
          (_, repeat) => `drain method line ${repeat + 1}`,
        ).join("\n")}`,
        locatorPrefix: filePath,
        sourceTimestamp: "2025-03-06T12:27:36Z",
        revision: SHA,
      }),
    );
  }
  const issueChunks = chunkSource({
    repoId: REPO,
    snapshotId: SNAPSHOT,
    entityId: issueId,
    entityKind: "Issue",
    sourceKind: "issue",
    sourceId: "issue:2891449053",
    sourceUrl: "https://github.com/sindresorhus/yocto-queue/issues/11",
    title: "Iterator behavior",
    body: "The iterator is intentionally non-destructive. A separate method called drain was suggested.",
    locatorPrefix: "Issue #11",
    sourceTimestamp: "2025-03-03T14:42:37Z",
    revision: SHA,
  });
  const commentChunks = chunkSource({
    repoId: REPO,
    snapshotId: SNAPSHOT,
    entityId: commentId,
    entityKind: "DiscussionComment",
    sourceKind: "issue_comment",
    sourceId: "comment:2696500039",
    sourceUrl:
      "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039",
    title: "Comment on #11",
    body: "This is intended behavior. It should be a separate method. Maybe called drain().",
    locatorPrefix: "Issue #11 comment 2696500039",
    sourceTimestamp: "2025-03-04T07:41:41Z",
    revision: SHA,
  });
  chunks.push(...issueChunks, ...commentChunks);
  await testStore.store.upsertEntities(entities);
  await testStore.store.replaceEvidenceChunks(chunks);
  const edges: RelationshipRecord[] = [
    {
      id: relationshipId({
        repoId: REPO,
        snapshotId: SNAPSHOT,
        kind: "COMMENTS_ON",
        fromEntityId: commentId,
        toEntityId: issueId,
        sourceEntityId: commentId,
      }),
      repoId: REPO,
      snapshotId: SNAPSHOT,
      fromEntityId: commentId,
      toEntityId: issueId,
      kind: "COMMENTS_ON",
      verification: "observed",
      sourceUrl:
        "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039",
      sourceEntityId: commentId,
      extractor: "github-comment",
      observedAt: "2025-03-04T07:41:41Z",
      verificationDetail: "thread parent",
      evidence: { excerpt: "This is intended behavior." },
    },
  ];
  await testStore.store.upsertRelationships(edges);
  return { testStore, issueId, commentId };
}

test("keeps discussion evidence in a pack dominated by high-ranking file excerpts", async () => {
  const { testStore, commentId, issueId } = await seed();
  try {
    const retriever = new DefaultEvidenceRetriever({
      store: testStore.store,
      clock: { isoNow: () => NOW },
    });
    const pack = await retriever.buildPack({
      repoId: REPO,
      snapshotId: SNAPSHOT,
      question: "drain method",
      maxChunks: 5,
      maxNeighbors: 4,
      maxNeighborChunks: 1,
    });
    assert.equal(pack.chunks.length, 5);
    assert.ok(pack.chunks.some((chunk) => chunk.entityId === commentId));
    assert.ok(pack.chunks.some((chunk) => chunk.entityId === issueId));
    assert.equal(pack.truncated, true);
    assert.equal(pack.snapshotSha, SHA);
    assert.ok(pack.entities.some((entity) => entity.id === issueId));
    assert.ok(pack.edges.some((edge) => edge.kind === "COMMENTS_ON"));
    assert.equal(pack.noEvidence, false);
  } finally {
    await testStore.close();
  }
});

test("focus evidence remains available when full-text search has no hits", async () => {
  const { testStore, issueId } = await seed();
  try {
    const retriever = new DefaultEvidenceRetriever({
      store: testStore.store,
      clock: { isoNow: () => NOW },
    });
    const pack = await retriever.buildPack({
      repoId: REPO,
      snapshotId: SNAPSHOT,
      question: "quantum chromodynamics",
      focusEntityId: issueId,
      maxChunks: 5,
      maxNeighbors: 0,
      maxNeighborChunks: 0,
    });
    assert.ok(pack.chunks.some((chunk) => chunk.entityId === issueId));
    assert.equal(pack.noEvidence, false);
    assert.ok(pack.warnings.some((warning) => /No direct full-text hits/.test(warning)));
  } finally {
    await testStore.close();
  }
});

test("no-evidence and unpublished-snapshot packs fail truthfully", async () => {
  const { testStore } = await seed();
  try {
    const retriever = new DefaultEvidenceRetriever({
      store: testStore.store,
      clock: { isoNow: () => NOW },
    });
    const empty = await retriever.buildPack({
      repoId: REPO,
      snapshotId: SNAPSHOT,
      question: "quantum chromodynamics tennis",
      maxChunks: 5,
      maxNeighbors: 2,
      maxNeighborChunks: 1,
    });
    assert.equal(empty.noEvidence, true);
    assert.equal(empty.chunks.length, 0);

    await assert.rejects(
      retriever.buildPack({
        repoId: REPO,
        snapshotId: "99999999-9999-4999-8999-999999999999",
        question: "drain",
        maxChunks: 5,
        maxNeighbors: 2,
        maxNeighborChunks: 1,
      }),
      (error: unknown) =>
        error instanceof HistoryError && error.code === "SNAPSHOT_NOT_FOUND",
    );

    await testStore.store.createSnapshot({
      id: "33333333-3333-4333-8333-333333333333",
      repoId: REPO,
      headSha: "b".repeat(40),
      branch: "main",
      status: "pending",
      coverage: coverage(),
      toolVersions: {},
      startedAt: NOW,
      completedAt: null,
      errors: [],
    });
    await assert.rejects(
      retriever.buildPack({
        repoId: REPO,
        snapshotId: "33333333-3333-4333-8333-333333333333",
        question: "drain",
        maxChunks: 5,
        maxNeighbors: 2,
        maxNeighborChunks: 1,
      }),
      (error: unknown) =>
        error instanceof HistoryError && error.code === "INVALID_REQUEST",
    );
  } finally {
    await testStore.close();
  }
});
