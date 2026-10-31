import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  GitCommitRecord,
  GitHistoryAnalysis,
  GitIdentity,
  RepositoryRecord,
} from "../src/types.ts";
import type {
  SourceClosingReference,
  SourceComment,
  SourceDocument,
  SourceIssue,
  SourcePullRequest,
  SourceReview,
} from "../src/source.ts";
import { buildCoChangeRelationships, buildHistoricalGraph } from "../src/graph.ts";
import { canonicalCommitKey, canonicalFileKey, canonicalIssueKey, canonicalPullRequestKey } from "../src/ids.ts";
import { contentSha256 } from "../src/paths.ts";
import type { CoChangeResult } from "../src/types.ts";

const MERGE_SHA = "d631ea87f49443c4c8dbf84fd79bf600d11a5fac";
const HEAD_SHA = "87d4a591b6584b9120a16daea822c919ff36c1ee";
const BASE_SHA = "0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b";
const STARTED = "2026-10-31T00:00:00.000Z";

const repository: RepositoryRecord = {
  id: "11111111-1111-5111-8111-111111111111",
  githubId: 315531538,
  owner: "sindresorhus",
  name: "yocto-queue",
  defaultBranch: "main",
  visibility: "public",
  htmlUrl: "https://github.com/sindresorhus/yocto-queue",
  createdAt: STARTED,
};

const snapshot = {
  id: "22222222-2222-5222-8222-222222222222",
  headSha: MERGE_SHA,
  branch: "main",
  startedAt: STARTED,
};

function issue(): SourceIssue {
  return {
    id: 2891449053,
    number: 11,
    title: "Iterator doesn't update size, head, tail",
    body: "Maybe there is a reason for it, but the iterator functionality doesn't update the internals.",
    state: "closed",
    stateReason: "completed",
    authorLogin: "victor141516",
    createdAt: "2025-03-03T14:42:37Z",
    updatedAt: "2025-03-06T12:27:37Z",
    closedAt: "2025-03-06T12:27:37Z",
    closedByLogin: "sindresorhus",
    htmlUrl: "https://github.com/sindresorhus/yocto-queue/issues/11",
    labels: [],
    commentsCount: 3,
    contentSha: contentSha256("issue"),
  };
}

function pullRequest(): SourcePullRequest {
  return {
    id: 2360000000,
    issueDatabaseId: null,
    number: 12,
    title: "fix: add new drain method that iterates and dequeues",
    body: "Adds a separate `drain()` method.\n\nFixes #11",
    state: "closed",
    draft: false,
    authorLogin: "victor141516",
    mergedByLogin: "sindresorhus",
    createdAt: "2025-03-03T14:47:00Z",
    updatedAt: "2025-03-06T12:27:36Z",
    closedAt: "2025-03-06T12:27:36Z",
    mergedAt: "2025-03-06T12:27:36Z",
    mergeCommitSha: MERGE_SHA,
    baseSha: BASE_SHA,
    baseRef: "main",
    headSha: HEAD_SHA,
    headRef: "patch-1",
    htmlUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
    commitsCount: 1,
    changedFilesCount: 4,
    additions: 41,
    deletions: 1,
    contentSha: contentSha256("pr"),
  };
}

function comment(id: number, body: string, login: string, createdAt: string): SourceComment {
  return {
    id,
    kind: "issue_comment",
    parentNumber: 11,
    parentKind: "Issue",
    authorLogin: login,
    body,
    createdAt,
    updatedAt: createdAt,
    htmlUrl: `https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-${id}`,
    authorAssociation: "MEMBER",
    path: null,
    line: null,
    inReplyToId: null,
    contentSha: contentSha256(body),
  };
}

function review(): SourceReview {
  return {
    id: 9001,
    prNumber: 12,
    authorLogin: "sindresorhus",
    state: "APPROVED",
    body: "This matches the intended non-destructive iterator design.",
    submittedAt: "2025-03-05T00:00:00Z",
    htmlUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
    commitId: HEAD_SHA,
    contentSha: contentSha256("review"),
  };
}

function document(): SourceDocument {
  return {
    path: "readme.md",
    sha: "f94f98ef865f793b8e09c28e9d1a862fd088ae34",
    htmlUrl: `https://github.com/sindresorhus/yocto-queue/blob/${MERGE_SHA}/readme.md`,
    body: "The queue exposes `index.js` and a separate drain method.",
    contentSha: contentSha256("readme"),
    ref: MERGE_SHA,
  };
}

function author(): GitIdentity {
  return {
    key: "git:email:victor.fernandez.gabriel@gmail.com",
    name: "Víctor Fernández",
    email: "victor.fernandez.gabriel@gmail.com",
    rawNames: ["Víctor Fernández"],
    rawEmails: ["victor.fernandez.gabriel@gmail.com"],
    mailmapped: false,
  };
}

function gitAnalysis(): GitHistoryAnalysis {
  const identity = author();
  const commit: GitCommitRecord = {
    sha: MERGE_SHA,
    parents: [BASE_SHA],
    author: identity,
    committer: identity,
    authoredAt: "2025-03-06T13:27:36+01:00",
    committedAt: "2025-03-06T13:27:36+01:00",
    message: "Add `.drain()` method (#12)",
    subject: "Add `.drain()` method (#12)",
    changes: ["index.js", "index.d.ts", "readme.md", "test.js"].map((path) => ({
      status: "modified" as const,
      path,
      currentPath: path,
      previousPath: null,
      similarity: null,
      isBinary: false,
      blobSha: null,
      size: null,
    })),
    isMerge: false,
  };
  return {
    coverage: {
      requestedSha: MERGE_SHA,
      resolvedSha: MERGE_SHA,
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
      window: { from: commit.authoredAt, to: commit.authoredAt },
      warnings: [],
    },
    commits: [commit],
    contributors: [identity],
    fileContributions: [],
    currentFiles: ["index.js", "index.d.ts", "readme.md", "test.js", "package.json", "license"],
    possibleAliasGroups: [],
  };
}

function confirmedClose(): SourceClosingReference {
  return {
    prNumber: 12,
    issueNumber: 11,
    keyword: "Fixes",
    bodyExcerpt: "Fixes #11",
    sourceUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
    confirmed: true,
    confirmation: {
      method: "cross_reference_and_issue_closed",
      crossReferencedAt: "2025-03-03T14:48:11Z",
      issueClosedAt: "2025-03-06T12:27:37Z",
      prMergedAt: "2025-03-06T12:27:36Z",
    },
  };
}

function graphInput(overrides: {
  issues?: SourceIssue[];
  comments?: SourceComment[];
  reviews?: SourceReview[];
  documents?: SourceDocument[];
  closingReferences?: SourceClosingReference[];
} = {}) {
  return {
    repository,
    snapshot,
    issues: overrides.issues ?? [issue()],
    pullRequests: [pullRequest()],
    comments:
      overrides.comments ?? [
        comment(2696500039, "This is intended behavior. It should be a separate method, maybe called drain().", "sindresorhus", "2025-03-04T07:41:41Z"),
      ],
    reviews: overrides.reviews ?? [],
    pullRequestCommits: [],
    documents: overrides.documents ?? [document()],
    closingReferences: overrides.closingReferences ?? [confirmedClose()],
    git: gitAnalysis(),
  };
}

test("builds a provenance-complete issue -> PR -> commit -> file chain", () => {
  const graph = buildHistoricalGraph(graphInput());
  const issueEntity = graph.entities.find(
    (entity) => entity.kind === "Issue" && entity.canonicalKey === canonicalIssueKey(2891449053),
  );
  const prEntity = graph.entities.find(
    (entity) => entity.kind === "PullRequest" && entity.canonicalKey === canonicalPullRequestKey(2360000000),
  );
  const commitEntity = graph.entities.find(
    (entity) => entity.kind === "Commit" && entity.canonicalKey === canonicalCommitKey(MERGE_SHA),
  );
  assert.ok(issueEntity);
  assert.ok(prEntity);
  assert.ok(commitEntity);

  const closes = graph.relationships.find((edge) => edge.kind === "CLOSES_ISSUE");
  assert.ok(closes);
  assert.equal(closes.fromEntityId, prEntity.id);
  assert.equal(closes.toEntityId, issueEntity.id);
  assert.equal(closes.verification, "observed");
  assert.equal(closes.sourceUrl, "https://github.com/sindresorhus/yocto-queue/pull/12");
  assert.equal(closes.observedAt, "2025-03-06T12:27:37Z");
  assert.equal(closes.evidence.metadata?.method, "cross_reference_and_issue_closed");
  assert.match(closes.verificationDetail ?? "", /cross-reference/);

  const inPr = graph.relationships.find(
    (edge) => edge.kind === "IN_PR" && edge.fromEntityId === commitEntity.id,
  );
  assert.ok(inPr);
  assert.equal(inPr.toEntityId, prEntity.id);
  assert.equal(inPr.verification, "observed");

  const modified = graph.relationships.filter((edge) => edge.kind === "MODIFIED");
  assert.equal(modified.length, 4);
  const modifiedFiles = modified
    .map((edge) => graph.entities.find((entity) => entity.id === edge.toEntityId))
    .map((entity) => entity?.metadata.path)
    .sort();
  assert.deepEqual(modifiedFiles, ["index.d.ts", "index.js", "readme.md", "test.js"]);

  const authored = graph.relationships.find((edge) => edge.kind === "AUTHORED");
  assert.ok(authored);
  assert.equal(authored.verification, "observed");
  assert.match(authored.evidence.excerpt ?? "", /Víctor Fernández/);

  const commentsOn = graph.relationships.find((edge) => edge.kind === "COMMENTS_ON");
  assert.ok(commentsOn);
  assert.equal(commentsOn.toEntityId, issueEntity.id);

  const documents = graph.relationships.find((edge) => edge.kind === "DOCUMENTS");
  assert.ok(documents);
  const documentedFile = graph.entities.find((entity) => entity.id === documents.toEntityId);
  assert.equal(documentedFile?.metadata.path, "index.js");

  const crossReference = graph.relationships.filter(
    (edge) =>
      edge.fromEntityId === prEntity.id &&
      edge.toEntityId === issueEntity.id &&
      edge.kind === "REFERENCES",
  );
  assert.equal(crossReference.length, 0);
  assert.equal(new Set(graph.entities.map((entity) => entity.id)).size, graph.entities.length);
  assert.equal(new Set(graph.relationships.map((edge) => edge.id)).size, graph.relationships.length);
  assert.equal(
    graph.relationships.every((edge) => edge.snapshotId === snapshot.id),
    true,
  );

  const second = buildHistoricalGraph(graphInput());
  assert.deepEqual(second.entities, graph.entities);
  assert.deepEqual(second.relationships, graph.relationships);
});

test("an unconfirmed closing keyword stays an explicit reference, never CLOSES_ISSUE", () => {
  const unconfirmed: SourceClosingReference = {
    prNumber: 12,
    issueNumber: 11,
    keyword: "Fixes",
    bodyExcerpt: "Fixes #11",
    sourceUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
    confirmed: false,
    confirmation: { method: "unconfirmed", reason: "No API cross-reference event" },
  };
  const graph = buildHistoricalGraph(
    graphInput({
      closingReferences: [unconfirmed],
      reviews: [review()],
    }),
  );
  const prEntity = graph.entities.find(
    (entity) => entity.kind === "PullRequest" && entity.canonicalKey === canonicalPullRequestKey(2360000000),
  );
  const issueEntity = graph.entities.find(
    (entity) => entity.kind === "Issue" && entity.canonicalKey === canonicalIssueKey(2891449053),
  );
  assert.ok(prEntity && issueEntity);
  assert.equal(graph.relationships.some((edge) => edge.kind === "CLOSES_ISSUE"), false);
  const reference = graph.relationships.find(
    (edge) =>
      edge.kind === "REFERENCES" &&
      edge.fromEntityId === prEntity.id &&
      edge.toEntityId === issueEntity.id,
  );
  assert.ok(reference);
  assert.match(reference.verificationDetail ?? "", /not promoted/);

  const reviewed = graph.relationships.find((edge) => edge.kind === "REVIEWED");
  assert.ok(reviewed);
  assert.equal(reviewed.verification, "observed");
  assert.equal(reviewed.sourceEntityId !== null, true);
});

test("missing endpoints withhold links and mention-only discussion stays REFERENCES", () => {
  const missing = buildHistoricalGraph(graphInput({ issues: [] }));
  assert.equal(missing.relationships.some((edge) => edge.kind === "CLOSES_ISSUE"), false);
  assert.ok(missing.warnings.some((warning) => warning.includes("could not be linked")));

  const mention = comment(
    12345,
    "This is related to #11 but does not close it.",
    "victor141516",
    "2025-03-04T00:00:00Z",
  );
  const graph = buildHistoricalGraph(graphInput({ comments: [mention] }));
  const issueEntity = graph.entities.find(
    (entity) => entity.kind === "Issue" && entity.canonicalKey === canonicalIssueKey(2891449053),
  );
  const commentEntity = graph.entities.find(
    (entity) => entity.kind === "DiscussionComment" && entity.metadata.githubId === 12345,
  );
  assert.ok(issueEntity && commentEntity);
  const reference = graph.relationships.find(
    (edge) =>
      edge.kind === "REFERENCES" &&
      edge.fromEntityId === commentEntity.id &&
      edge.toEntityId === issueEntity.id,
  );
  assert.ok(reference);
  assert.match(reference.verificationDetail ?? "", /mentions are never promoted/);
  assert.equal(graph.relationships.some((edge) => edge.kind === "CLOSES_ISSUE"), true);
});

test("co-change edges are derived, snapshot-scoped and carry their sample window", () => {
  const graph = buildHistoricalGraph(graphInput());
  const files = graph.entities.filter((entity) => entity.kind === "File");
  const coChange: CoChangeResult = {
    targetFile: "index.js",
    observations: [
      {
        file: "index.d.ts",
        sharedCommits: 4,
        targetCommits: 6,
        share: 4 / 6,
        commitShas: [MERGE_SHA],
        window: { from: "2025-01-01T00:00:00Z", to: "2025-03-06T12:27:36Z" },
      },
    ],
    coverage: {
      commitsAnalyzed: 12,
      commitsTouchingTarget: 6,
      commitsExcludedOverCap: 0,
      observationsTruncated: 0,
      maxFilesPerCommit: 50,
      minSupport: 2,
      window: { from: "2025-01-01T00:00:00Z", to: "2025-03-06T12:27:36Z" },
      excludedPaths: 1,
      warnings: [],
    },
  };
  const edges = buildCoChangeRelationships({
    repository,
    snapshot,
    fileEntities: files,
    coChange,
  });
  assert.equal(edges.length, 1);
  const edge = edges[0];
  assert.ok(edge);
  assert.equal(edge.kind, "CO_CHANGED_WITH");
  assert.equal(edge.verification, "derived");
  assert.equal(edge.snapshotId, snapshot.id);
  assert.equal(edge.evidence.metadata?.sharedCommits, 4);
  assert.equal(edge.evidence.metadata?.targetCommits, 6);
  assert.equal(edge.evidence.metadata?.minSupport, 2);
  const source = graph.entities.find((entity) => entity.id === edge.fromEntityId);
  const target = graph.entities.find((entity) => entity.id === edge.toEntityId);
  assert.equal(source?.canonicalKey, canonicalFileKey("index.js"));
  assert.equal(target?.canonicalKey, canonicalFileKey("index.d.ts"));
});
