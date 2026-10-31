import type { CoChangeDataset } from "./cochange.ts";
import type {
  CoChangeResult,
  EntityKind,
  EntityRecord,
  GitHistoryAnalysis,
  RelationshipEvidence,
  RelationshipKind,
  RelationshipRecord,
  RepositoryRecord,
  SnapshotRecord,
  Verification,
} from "./types.ts";
import type {
  SourceClosingReference,
  SourceComment,
  SourceDocument,
  SourceIssue,
  SourcePullRequest,
  SourcePullRequestCommits,
  SourceReview,
} from "./source.ts";
import {
  canonicalCommentKey,
  canonicalCommitKey,
  canonicalDocumentKey,
  canonicalFileKey,
  canonicalFileRevisionKey,
  canonicalIssueKey,
  canonicalPullRequestKey,
  canonicalRepositoryKey,
  canonicalReviewKey,
  entityId,
  gitContributorKey,
  githubContributorKey,
  relationshipId,
} from "./ids.ts";
import { clip, contentSha256, extensionOf, normalizeRepoPath } from "./paths.ts";

export interface HistoricalGraphInput {
  repository: RepositoryRecord;
  snapshot: Pick<SnapshotRecord, "id" | "headSha" | "branch" | "startedAt">;
  issues: SourceIssue[];
  pullRequests: SourcePullRequest[];
  comments: SourceComment[];
  reviews: SourceReview[];
  pullRequestCommits: SourcePullRequestCommits[];
  documents: SourceDocument[];
  closingReferences: SourceClosingReference[];
  git: GitHistoryAnalysis;
  coChangeDataset?: CoChangeDataset;
}

export interface BuiltHistoricalGraph {
  entities: EntityRecord[];
  relationships: RelationshipRecord[];
  warnings: string[];
}

interface AddRelationshipInput {
  fromEntityId: string;
  toEntityId: string;
  kind: RelationshipKind;
  verification: Verification;
  sourceUrl: string | null;
  sourceEntityId: string | null;
  extractor: string;
  observedAt: string;
  verificationDetail: string | null;
  evidence: RelationshipEvidence;
}

export function githubBlobUrl(
  owner: string,
  repo: string,
  sha: string,
  repoPath: string,
): string {
  const encodedPath = repoPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://github.com/${owner}/${repo}/blob/${sha}/${encodedPath}`;
}

export function githubCommitUrl(owner: string, repo: string, sha: string): string {
  return `https://github.com/${owner}/${repo}/commit/${sha}`;
}

function isoOrFallback(value: string | null, fallback: string): string {
  return value ?? fallback;
}

function excerptAround(body: string, index: number, needleLength: number): string {
  const start = Math.max(0, index - 120);
  const end = Math.min(body.length, index + needleLength + 160);
  return body.slice(start, end).replace(/\s+/g, " ").trim();
}

function stripFencedCode(value: string): string {
  return value.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

export interface ExplicitReference {
  kind: "number" | "commit";
  value: string;
  index: number;
  excerpt: string;
}

export function extractExplicitReferences(
  body: string,
  owner: string,
  repo: string,
): ExplicitReference[] {
  const searchable = stripFencedCode(body);
  const references: ExplicitReference[] = [];
  const seen = new Set<string>();
  const numberRegex = /(?:^|[^\w&#])#(\d{1,9})\b/g;
  const urlRegex = new RegExp(
    `https?://github\\.com/${escapeRegExp(owner)}/${escapeRegExp(repo)}/(?:issues|pull)/(\\d{1,9})\\b`,
    "gi",
  );
  const commitRegex = new RegExp(
    `https?://github\\.com/${escapeRegExp(owner)}/${escapeRegExp(repo)}/commit/([0-9a-f]{40})\\b`,
    "gi",
  );

  for (const match of searchable.matchAll(numberRegex)) {
    const value = match[1];
    const key = `number:${value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const index = (match.index ?? 0) + match[0].indexOf("#");
    references.push({
      kind: "number",
      value,
      index,
      excerpt: excerptAround(searchable, index, value.length + 1),
    });
  }
  for (const match of searchable.matchAll(urlRegex)) {
    const value = match[1];
    const key = `number:${value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({
      kind: "number",
      value,
      index: match.index ?? 0,
      excerpt: excerptAround(searchable, match.index ?? 0, match[0].length),
    });
  }
  for (const match of searchable.matchAll(commitRegex)) {
    const value = match[1].toLowerCase();
    const key = `commit:${value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({
      kind: "commit",
      value,
      index: match.index ?? 0,
      excerpt: excerptAround(searchable, match.index ?? 0, match[0].length),
    });
  }
  references.sort((left, right) => left.index - right.index);
  return references;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildHistoricalGraph(input: HistoricalGraphInput): BuiltHistoricalGraph {
  const { repository, snapshot, git } = input;
  const entities = new Map<string, EntityRecord>();
  const relationships = new Map<string, RelationshipRecord>();
  const warnings: string[] = [];

  function addEntity(
    kind: EntityKind,
    canonicalKey: string,
    title: string | null,
    sourceUrl: string | null,
    metadata: Record<string, unknown>,
  ): EntityRecord {
    const mapKey = `${kind}|${canonicalKey}`;
    const existing = entities.get(mapKey);
    if (existing !== undefined) {
      if (existing.sourceUrl === null && sourceUrl !== null) {
        existing.sourceUrl = sourceUrl;
      }
      if (existing.title === null && title !== null) {
        existing.title = title;
      }
      existing.metadata = { ...metadata, ...existing.metadata };
      return existing;
    }
    const record: EntityRecord = {
      id: entityId(repository.id, kind, canonicalKey),
      repoId: repository.id,
      kind,
      canonicalKey,
      title,
      sourceUrl,
      metadata,
    };
    entities.set(mapKey, record);
    return record;
  }

  function getEntity(kind: EntityKind, canonicalKey: string): EntityRecord | null {
    return entities.get(`${kind}|${canonicalKey}`) ?? null;
  }

  function addRelationship(edge: AddRelationshipInput): RelationshipRecord | null {
    const key = [
      edge.fromEntityId,
      edge.toEntityId,
      edge.kind,
      edge.sourceEntityId ?? "",
    ].join("|");
    const existing = relationships.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const record: RelationshipRecord = {
      id: relationshipId({
        repoId: repository.id,
        snapshotId: snapshot.id,
        kind: edge.kind,
        fromEntityId: edge.fromEntityId,
        toEntityId: edge.toEntityId,
        sourceEntityId: edge.sourceEntityId,
      }),
      repoId: repository.id,
      snapshotId: snapshot.id,
      fromEntityId: edge.fromEntityId,
      toEntityId: edge.toEntityId,
      kind: edge.kind,
      verification: edge.verification,
      sourceUrl: edge.sourceUrl,
      sourceEntityId: edge.sourceEntityId,
      extractor: edge.extractor,
      observedAt: edge.observedAt,
      verificationDetail: edge.verificationDetail,
      evidence: edge.evidence,
    };
    relationships.set(key, record);
    return record;
  }

  const repositoryEntity = addEntity(
    "Repository",
    canonicalRepositoryKey(repository.githubId),
    `${repository.owner}/${repository.name}`,
    repository.htmlUrl,
    {
      githubId: repository.githubId,
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      visibility: repository.visibility,
      createdAt: repository.createdAt,
      snapshotId: snapshot.id,
      snapshotSha: snapshot.headSha,
      branch: snapshot.branch,
    },
  );
  if (repositoryEntity.kind !== "Repository") {
    throw new Error("Repository entity identity mismatch");
  }

  const issueByNumber = new Map<number, EntityRecord>();
  const pullRequestByNumber = new Map<number, EntityRecord>();
  const commitBySha = new Map<string, EntityRecord>();

  for (const issue of input.issues) {
    const entity = addEntity(
      "Issue",
      canonicalIssueKey(issue.id),
      `#${issue.number} ${issue.title}`.trim(),
      issue.htmlUrl,
      {
        githubId: issue.id,
        number: issue.number,
        state: issue.state,
        stateReason: issue.stateReason,
        authorLogin: issue.authorLogin,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt,
        closedByLogin: issue.closedByLogin,
        labels: issue.labels,
        commentsCount: issue.commentsCount,
        contentSha: issue.contentSha,
        bodyExcerpt: clip(issue.body, 280),
      },
    );
    issueByNumber.set(issue.number, entity);
  }

  for (const pullRequest of input.pullRequests) {
    const entity = addEntity(
      "PullRequest",
      canonicalPullRequestKey(pullRequest.id),
      `#${pullRequest.number} ${pullRequest.title}`.trim(),
      pullRequest.htmlUrl,
      {
        githubId: pullRequest.id,
        issueDatabaseId: pullRequest.issueDatabaseId,
        number: pullRequest.number,
        state: pullRequest.state,
        draft: pullRequest.draft,
        authorLogin: pullRequest.authorLogin,
        mergedByLogin: pullRequest.mergedByLogin,
        createdAt: pullRequest.createdAt,
        updatedAt: pullRequest.updatedAt,
        closedAt: pullRequest.closedAt,
        mergedAt: pullRequest.mergedAt,
        mergeCommitSha: pullRequest.mergeCommitSha,
        baseSha: pullRequest.baseSha,
        baseRef: pullRequest.baseRef,
        headSha: pullRequest.headSha,
        headRef: pullRequest.headRef,
        commitsCount: pullRequest.commitsCount,
        changedFilesCount: pullRequest.changedFilesCount,
        additions: pullRequest.additions,
        deletions: pullRequest.deletions,
        contentSha: pullRequest.contentSha,
        bodyExcerpt: clip(pullRequest.body, 280),
      },
    );
    pullRequestByNumber.set(pullRequest.number, entity);
  }

  const coChangeFilesBySha = new Map<string, string[]>();
  for (const observation of input.coChangeDataset?.observations ?? []) {
    coChangeFilesBySha.set(observation.sha, observation.files);
  }

  for (const commit of git.commits) {
    const url = githubCommitUrl(repository.owner, repository.name, commit.sha);
    const coChangeFiles = coChangeFilesBySha.get(commit.sha) ?? null;
    const entity = addEntity(
      "Commit",
      canonicalCommitKey(commit.sha),
      commit.subject.length > 0 ? commit.subject : commit.sha.slice(0, 12),
      url,
      {
        sha: commit.sha,
        parents: commit.parents,
        authorName: commit.author.name,
        authorEmail: commit.author.email,
        authorKey: commit.author.key,
        committerName: commit.committer.name,
        committerEmail: commit.committer.email,
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        isMerge: commit.isMerge,
        contentSha: contentSha256(commit.message),
        messageExcerpt: clip(commit.message, 400),
        inIndexedHistory: true,
        coChangeEligible: coChangeFiles !== null,
        ...(coChangeFiles === null ? {} : { coChangeFiles }),
      },
    );
    commitBySha.set(commit.sha, entity);
  }

  for (const bundle of input.pullRequestCommits) {
    const pullRequest = input.pullRequests.find((item) => item.number === bundle.prNumber);
    if (pullRequest === undefined) {
      continue;
    }
    let skipped = 0;
    for (const commit of bundle.commits) {
      let commitEntity = commitBySha.get(commit.sha) ?? null;
      if (commitEntity === null) {
        const url =
          commit.htmlUrl ?? githubCommitUrl(repository.owner, repository.name, commit.sha);
        commitEntity = addEntity(
          "Commit",
          canonicalCommitKey(commit.sha),
          commit.message.split("\n")[0]?.slice(0, 200) ?? commit.sha.slice(0, 12),
          url,
          {
            sha: commit.sha,
            parents: commit.parents,
            authorName: commit.authorName,
            authorEmail: commit.authorEmail,
            committerName: commit.committerName,
            committerEmail: commit.committerEmail,
            authoredAt: commit.authoredAt,
            committedAt: commit.committedAt,
            isMerge: false,
            contentSha: commit.contentSha,
            messageExcerpt: clip(commit.message, 400),
            inIndexedHistory: false,
          },
        );
        commitBySha.set(commit.sha, commitEntity);
        skipped += 1;
      }
      addRelationship({
        fromEntityId: commitEntity.id,
        toEntityId: pullRequestByNumber.get(bundle.prNumber)?.id ?? "",
        kind: "IN_PR",
        verification: "observed",
        sourceUrl: pullRequest.htmlUrl,
        sourceEntityId: pullRequestByNumber.get(bundle.prNumber)?.id ?? null,
        extractor: "github-pull-request-commits",
        observedAt: isoOrFallback(
          pullRequest.mergedAt ?? pullRequest.updatedAt,
          snapshot.startedAt,
        ),
        verificationDetail:
          "GitHub pull-request commits API associates this commit with the pull request",
        evidence: {
          excerpt: `GitHub API returned ${commit.sha} in the commits of PR #${pullRequest.number}`,
          sourceId: String(pullRequest.id),
          metadata: { prNumber: pullRequest.number, inIndexedHistory: commitEntity.metadata.inIndexedHistory },
        },
      });
    }
    if (skipped > 0) {
      warnings.push(
        `${skipped} commit(s) associated with PR #${pullRequest.number} were not present in the indexed checkout; they are represented by GitHub source metadata only.`,
      );
    }
  }

  for (const pullRequest of input.pullRequests) {
    const prEntity = pullRequestByNumber.get(pullRequest.number);
    if (prEntity === undefined) {
      continue;
    }
    const candidateShas = new Set<string>();
    if (pullRequest.headSha.length === 40) {
      candidateShas.add(pullRequest.headSha.toLowerCase());
    }
    if (pullRequest.mergeCommitSha !== null && pullRequest.mergeCommitSha.length === 40) {
      candidateShas.add(pullRequest.mergeCommitSha.toLowerCase());
    }
    for (const sha of candidateShas) {
      const commitEntity = commitBySha.get(sha);
      if (commitEntity === undefined) {
        continue;
      }
      addRelationship({
        fromEntityId: commitEntity.id,
        toEntityId: prEntity.id,
        kind: "IN_PR",
        verification: "observed",
        sourceUrl: pullRequest.htmlUrl,
        sourceEntityId: prEntity.id,
        extractor: "github-pull-request-metadata",
        observedAt: isoOrFallback(
          pullRequest.mergedAt ?? pullRequest.updatedAt,
          snapshot.startedAt,
        ),
        verificationDetail:
          sha === pullRequest.mergeCommitSha?.toLowerCase()
            ? "GitHub pull-request merge_commit_sha metadata"
            : "GitHub pull-request head_sha metadata",
        evidence: {
          excerpt:
            sha === pullRequest.mergeCommitSha?.toLowerCase()
              ? `PR #${pullRequest.number} merge commit ${sha}`
              : `PR #${pullRequest.number} head commit ${sha}`,
          sourceId: String(pullRequest.id),
          metadata: { prNumber: pullRequest.number, role: sha === pullRequest.mergeCommitSha?.toLowerCase() ? "merge" : "head" },
        },
      });
    }
  }

  const fileLastRevision = new Map<
    string,
    { sha: string; path: string; authoredAt: string }
  >();
  const fileEntityByPath = new Map<string, EntityRecord>();
  for (const currentPath of git.currentFiles) {
    const normalized = normalizeRepoPath(currentPath);
    const fileEntity = addEntity(
      "File",
      canonicalFileKey(normalized),
      normalized,
      githubBlobUrl(repository.owner, repository.name, snapshot.headSha, normalized),
      {
        path: normalized,
        currentAtSnapshot: true,
        snapshotSha: snapshot.headSha,
        extension: extensionOf(normalized),
      },
    );
    fileEntityByPath.set(normalized, fileEntity);
  }

  for (const commit of git.commits) {
    const commitEntity = commitBySha.get(commit.sha);
    if (commitEntity === undefined) {
      continue;
    }
    const authorEntity = addEntity(
      "Contributor",
      gitContributorKey(commit.author),
      commit.author.name,
      null,
      {
        provider: "git",
        key: commit.author.key,
        name: commit.author.name,
        email: commit.author.email,
        mailmapped: commit.author.mailmapped,
        rawNames: commit.author.rawNames,
        rawEmails: commit.author.rawEmails,
      },
    );
    addRelationship({
      fromEntityId: authorEntity.id,
      toEntityId: commitEntity.id,
      kind: "AUTHORED",
      verification: "observed",
      sourceUrl: githubCommitUrl(repository.owner, repository.name, commit.sha),
      sourceEntityId: commitEntity.id,
      extractor: "git-log-mailmap",
      observedAt: commit.authoredAt,
      verificationDetail: "Git author metadata with .mailmap normalization when present",
      evidence: {
        excerpt: `${commit.author.name} <${commit.author.email}> authored ${commit.sha}`,
        sourceId: commit.sha,
        metadata: {
          authorName: commit.author.name,
          authorEmail: commit.author.email,
          mailmapped: commit.author.mailmapped,
        },
      },
    });

    for (const change of commit.changes) {
      const normalizedPath = normalizeRepoPath(change.path);
      const currentPath =
        change.currentPath === null ? null : normalizeRepoPath(change.currentPath);
      const previousPath =
        change.previousPath === null ? null : normalizeRepoPath(change.previousPath);
      const revisionUrl =
        change.status === "deleted"
          ? githubCommitUrl(repository.owner, repository.name, commit.sha)
          : githubBlobUrl(
              repository.owner,
              repository.name,
              commit.sha,
              normalizedPath,
            );
      const revisionEntity = addEntity(
        "FileRevision",
        canonicalFileRevisionKey(normalizedPath, commit.sha),
        `${normalizedPath}@${commit.sha.slice(0, 12)}`,
        revisionUrl,
        {
          path: normalizedPath,
          currentPath,
          previousPath,
          changeStatus: change.status,
          commitSha: commit.sha,
          blobSha: change.blobSha,
          size: change.size,
          isBinary: change.isBinary,
          similarity: change.similarity,
        },
      );
      if (currentPath !== null && change.status !== "deleted") {
        const last = fileLastRevision.get(currentPath);
        if (last === undefined || commit.authoredAt > last.authoredAt) {
          fileLastRevision.set(currentPath, {
            sha: commit.sha,
            path: normalizedPath,
            authoredAt: commit.authoredAt,
          });
        }
      }
      const targetPath = currentPath ?? normalizedPath;
      if (!fileEntityByPath.has(targetPath) && change.status !== "deleted") {
        const fileEntity = addEntity(
          "File",
          canonicalFileKey(targetPath),
          targetPath,
          null,
          {
            path: targetPath,
            currentAtSnapshot: false,
            snapshotSha: snapshot.headSha,
            extension: extensionOf(targetPath),
          },
        );
        fileEntityByPath.set(targetPath, fileEntity);
      }
      addRelationship({
        fromEntityId: commitEntity.id,
        toEntityId: revisionEntity.id,
        kind: "MODIFIED",
        verification: "observed",
        sourceUrl: githubCommitUrl(repository.owner, repository.name, commit.sha),
        sourceEntityId: commitEntity.id,
        extractor: "git-log-name-status",
        observedAt: commit.authoredAt,
        verificationDetail: `Git diff status ${change.status}`,
        evidence: {
          excerpt: `${change.status} ${normalizedPath}${previousPath === null ? "" : ` (from ${previousPath})`}`,
          locator: `${normalizedPath} at ${commit.sha}`,
          sourceId: commit.sha,
          metadata: {
            changeStatus: change.status,
            previousPath,
            currentPath,
            similarity: change.similarity,
            isBinary: change.isBinary,
          },
        },
      });
    }
  }

  for (const [path, fileEntity] of fileEntityByPath) {
    if (fileEntity.metadata.currentAtSnapshot === true) {
      continue;
    }
    const last = fileLastRevision.get(path);
    if (last !== undefined) {
      fileEntity.sourceUrl = githubBlobUrl(
        repository.owner,
        repository.name,
        last.sha,
        last.path,
      );
      fileEntity.metadata = {
        ...fileEntity.metadata,
        lastKnownRevision: last.sha,
      };
    }
  }

  for (const comment of input.comments) {
    const commentEntity = addEntity(
      "DiscussionComment",
      canonicalCommentKey(comment.id),
      `${comment.kind === "review_comment" ? "Review comment" : "Comment"} on #${comment.parentNumber}`,
      comment.htmlUrl,
      {
        githubId: comment.id,
        kind: comment.kind,
        parentNumber: comment.parentNumber,
        parentKind: comment.parentKind,
        authorLogin: comment.authorLogin,
        authorAssociation: comment.authorAssociation,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        path: comment.path,
        line: comment.line,
        inReplyToId: comment.inReplyToId,
        contentSha: comment.contentSha,
        bodyExcerpt: clip(comment.body, 280),
      },
    );
    const parent =
      comment.parentKind === "PullRequest"
        ? pullRequestByNumber.get(comment.parentNumber) ?? null
        : issueByNumber.get(comment.parentNumber) ?? null;
    if (parent === null) {
      warnings.push(
        `Comment ${comment.id} references #${comment.parentNumber}, which was not present in the collected source set; COMMENTS_ON was withheld.`,
      );
      continue;
    }
    addRelationship({
      fromEntityId: commentEntity.id,
      toEntityId: parent.id,
      kind: "COMMENTS_ON",
      verification: "observed",
      sourceUrl: comment.htmlUrl,
      sourceEntityId: commentEntity.id,
      extractor: "github-comment",
      observedAt: comment.createdAt,
      verificationDetail: "GitHub discussion thread parent relationship",
      evidence: {
        excerpt: clip(comment.body, 240),
        sourceId: String(comment.id),
        metadata: {
          kind: comment.kind,
          parentNumber: comment.parentNumber,
          parentKind: comment.parentKind,
        },
      },
    });
  }

  for (const review of input.reviews) {
    const prEntity = pullRequestByNumber.get(review.prNumber);
    if (prEntity === undefined) {
      warnings.push(
        `Review ${review.id} references PR #${review.prNumber}, which was not present in the collected source set; REVIEWED was withheld.`,
      );
      continue;
    }
    const reviewEntity = addEntity(
      "DiscussionComment",
      canonicalReviewKey(review.id),
      `Review ${review.state} on #${review.prNumber}`,
      review.htmlUrl,
      {
        githubId: review.id,
        kind: "review",
        parentNumber: review.prNumber,
        parentKind: "PullRequest",
        authorLogin: review.authorLogin,
        state: review.state,
        submittedAt: review.submittedAt,
        commitId: review.commitId,
        contentSha: review.contentSha,
        bodyExcerpt: clip(review.body, 280),
      },
    );
    if (review.authorLogin !== null) {
      const reviewerEntity = addEntity(
        "Contributor",
        githubContributorKey(review.authorLogin),
        review.authorLogin,
        `https://github.com/${review.authorLogin}`,
        {
          provider: "github",
          login: review.authorLogin,
        },
      );
      addRelationship({
        fromEntityId: reviewerEntity.id,
        toEntityId: prEntity.id,
        kind: "REVIEWED",
        verification: "observed",
        sourceUrl: review.htmlUrl,
        sourceEntityId: reviewEntity.id,
        extractor: "github-pull-request-reviews",
        observedAt: isoOrFallback(review.submittedAt, prEntity.metadata.updatedAt as string ?? snapshot.startedAt),
        verificationDetail: `GitHub review state ${review.state}`,
        evidence: {
          excerpt: review.body.length > 0 ? clip(review.body, 240) : `Review ${review.state} by ${review.authorLogin}`,
          sourceId: String(review.id),
          metadata: { state: review.state, commitId: review.commitId },
        },
      });
    }
    if (review.body.trim().length > 0) {
      addRelationship({
        fromEntityId: reviewEntity.id,
        toEntityId: prEntity.id,
        kind: "COMMENTS_ON",
        verification: "observed",
        sourceUrl: review.htmlUrl,
        sourceEntityId: reviewEntity.id,
        extractor: "github-pull-request-reviews",
        observedAt: isoOrFallback(review.submittedAt, snapshot.startedAt),
        verificationDetail: "Review body belongs to the pull request thread",
        evidence: {
          excerpt: clip(review.body, 240),
          sourceId: String(review.id),
        },
      });
    }
  }

  for (const closing of input.closingReferences) {
    const prEntity = pullRequestByNumber.get(closing.prNumber);
    const issueEntity = issueByNumber.get(closing.issueNumber);
    if (prEntity === undefined || issueEntity === undefined) {
      warnings.push(
        `Closing reference PR #${closing.prNumber} -> issue #${closing.issueNumber} could not be linked because one endpoint was absent; no edge was created.`,
      );
      continue;
    }
    if (closing.confirmed && closing.confirmation.method === "cross_reference_and_issue_closed") {
      addRelationship({
        fromEntityId: prEntity.id,
        toEntityId: issueEntity.id,
        kind: "CLOSES_ISSUE",
        verification: "observed",
        sourceUrl: prEntity.sourceUrl,
        sourceEntityId: prEntity.id,
        extractor: "github-closing-keyword+cross-reference",
        observedAt:
          closing.confirmation.issueClosedAt ??
          closing.confirmation.prMergedAt ??
          snapshot.startedAt,
        verificationDetail:
          "GitHub closing keyword confirmed by a cross-reference event and the issue-closed transition",
        evidence: {
          excerpt: closing.bodyExcerpt,
          sourceId: String(closing.prNumber),
          metadata: {
            keyword: closing.keyword,
            crossReferencedAt: closing.confirmation.crossReferencedAt,
            issueClosedAt: closing.confirmation.issueClosedAt,
            prMergedAt: closing.confirmation.prMergedAt,
            method: closing.confirmation.method,
          },
        },
      });
    } else {
      addRelationship({
        fromEntityId: prEntity.id,
        toEntityId: issueEntity.id,
        kind: "REFERENCES",
        verification: "observed",
        sourceUrl: prEntity.sourceUrl,
        sourceEntityId: prEntity.id,
        extractor: "github-closing-keyword-unconfirmed",
        observedAt: isoOrFallback(
          prEntity.metadata.updatedAt as string | null,
          snapshot.startedAt,
        ),
        verificationDetail:
          closing.confirmation.method === "unconfirmed"
            ? `Closing keyword not promoted: ${closing.confirmation.reason}`
            : "Closing keyword not promoted without cross-reference and issue-closed evidence",
        evidence: {
          excerpt: closing.bodyExcerpt,
          sourceId: String(closing.prNumber),
          metadata: { keyword: closing.keyword, confirmed: false },
        },
      });
    }
  }

  const referenceSources: Array<{
    entity: EntityRecord;
    body: string;
    url: string;
    observedAt: string;
    extractor: string;
    sourceKind: string;
  }> = [];
  for (const issue of input.issues) {
    const entity = issueByNumber.get(issue.number);
    if (entity !== undefined) {
      referenceSources.push({
        entity,
        body: issue.body,
        url: issue.htmlUrl,
        observedAt: issue.updatedAt,
        extractor: "github-issue-body",
        sourceKind: "Issue",
      });
    }
  }
  for (const pullRequest of input.pullRequests) {
    const entity = pullRequestByNumber.get(pullRequest.number);
    if (entity !== undefined) {
      referenceSources.push({
        entity,
        body: pullRequest.body,
        url: pullRequest.htmlUrl,
        observedAt: pullRequest.updatedAt,
        extractor: "github-pull-request-body",
        sourceKind: "PullRequest",
      });
    }
  }
  for (const comment of input.comments) {
    const entity = getEntity("DiscussionComment", canonicalCommentKey(comment.id));
    if (entity !== null) {
      referenceSources.push({
        entity,
        body: comment.body,
        url: comment.htmlUrl,
        observedAt: comment.updatedAt,
        extractor: "github-comment-body",
        sourceKind: "DiscussionComment",
      });
    }
  }
  for (const review of input.reviews) {
    const entity = getEntity("DiscussionComment", canonicalReviewKey(review.id));
    if (entity !== null && review.body.trim().length > 0) {
      referenceSources.push({
        entity,
        body: review.body,
        url: review.htmlUrl,
        observedAt: isoOrFallback(review.submittedAt, snapshot.startedAt),
        extractor: "github-review-body",
        sourceKind: "DiscussionComment",
      });
    }
  }

  const missingReferenceTargets = new Set<number>();
  for (const source of referenceSources) {
    const references = extractExplicitReferences(
      source.body,
      repository.owner,
      repository.name,
    );
    let added = 0;
    for (const reference of references) {
      if (added >= 30) {
        break;
      }
      if (reference.kind === "commit") {
        const target = commitBySha.get(reference.value);
        if (target === undefined) {
          continue;
        }
        addRelationship({
          fromEntityId: source.entity.id,
          toEntityId: target.id,
          kind: "REFERENCES",
          verification: "observed",
          sourceUrl: source.url,
          sourceEntityId: source.entity.id,
          extractor: source.extractor,
          observedAt: source.observedAt,
          verificationDetail:
            "Explicit GitHub commit URL in source text; this is a reference, not a closing link",
          evidence: {
            excerpt: reference.excerpt,
            sourceId: source.entity.canonicalKey,
            metadata: { targetKind: "Commit", targetSha: reference.value },
          },
        });
        added += 1;
        continue;
      }
      const number = Number(reference.value);
      const target = pullRequestByNumber.get(number) ?? issueByNumber.get(number);
      if (target === undefined) {
        missingReferenceTargets.add(number);
        continue;
      }
      if (target.id === source.entity.id) {
        continue;
      }
      const alreadyCloses =
        source.entity.kind === "PullRequest" &&
        target.kind === "Issue" &&
        [...relationships.values()].some(
          (edge) =>
            edge.fromEntityId === source.entity.id &&
            edge.toEntityId === target.id &&
            edge.kind === "CLOSES_ISSUE",
        );
      if (alreadyCloses) {
        continue;
      }
      addRelationship({
        fromEntityId: source.entity.id,
        toEntityId: target.id,
        kind: "REFERENCES",
        verification: "observed",
        sourceUrl: source.url,
        sourceEntityId: source.entity.id,
        extractor: source.extractor,
        observedAt: source.observedAt,
        verificationDetail:
          "Explicit textual reference; mentions are never promoted to CLOSES_ISSUE",
        evidence: {
          excerpt: reference.excerpt,
          sourceId: source.entity.canonicalKey,
          metadata: { targetKind: target.kind, targetNumber: number, method: "textual_reference" },
        },
      });
      added += 1;
    }
  }
  if (missingReferenceTargets.size > 0) {
    warnings.push(
      `${missingReferenceTargets.size} referenced issue/PR number(s) were not in the collected source set; no dangling REFERENCES edges were created.`,
    );
  }

  for (const document of input.documents) {
    const normalized = normalizeRepoPath(document.path);
    const documentEntity = addEntity(
      "Document",
      canonicalDocumentKey(normalized, document.sha),
      normalized,
      document.htmlUrl,
      {
        path: normalized,
        sha: document.sha,
        ref: document.ref,
        contentSha: document.contentSha,
        bodyExcerpt: clip(document.body, 280),
      },
    );
    const codeSpans = [...document.body.matchAll(/`([^`\n]{2,240})`/g)].slice(0, 40);
    let edgeCount = 0;
    for (const match of codeSpans) {
      const candidate = match[1].trim().replace(/^\.\//, "");
      if (candidate.length === 0) {
        continue;
      }
      let normalizedCandidate: string;
      try {
        normalizedCandidate = normalizeRepoPath(candidate);
      } catch {
        continue;
      }
      const fileEntity = fileEntityByPath.get(normalizedCandidate);
      if (fileEntity === undefined) {
        continue;
      }
      addRelationship({
        fromEntityId: documentEntity.id,
        toEntityId: fileEntity.id,
        kind: "DOCUMENTS",
        verification: "observed",
        sourceUrl: document.htmlUrl,
        sourceEntityId: documentEntity.id,
        extractor: "document-literal-path",
        observedAt: snapshot.startedAt,
        verificationDetail:
          "Literal repository-relative path in a document code span that exists at the indexed SHA",
        evidence: {
          excerpt: match[0],
          sourceId: document.path,
          metadata: { path: normalizedCandidate, sha: document.sha },
        },
      });
      edgeCount += 1;
      if (edgeCount >= 25) {
        break;
      }
    }
  }

  return {
    entities: [...entities.values()],
    relationships: [...relationships.values()],
    warnings,
  };
}

export function buildCoChangeRelationships(input: {
  repository: RepositoryRecord;
  snapshot: Pick<SnapshotRecord, "id" | "headSha" | "branch" | "startedAt">;
  fileEntities: EntityRecord[];
  coChange: CoChangeResult;
}): RelationshipRecord[] {
  const { repository, snapshot, fileEntities, coChange } = input;
  if (coChange.observations.length === 0) {
    return [];
  }
  const target = fileEntities.find(
    (entity) =>
      entity.kind === "File" && entity.canonicalKey === canonicalFileKey(coChange.targetFile),
  );
  if (target === undefined) {
    return [];
  }
  const relationships: RelationshipRecord[] = [];
  for (const observation of coChange.observations) {
    const other = fileEntities.find(
      (entity) =>
        entity.kind === "File" && entity.canonicalKey === canonicalFileKey(observation.file),
    );
    if (other === undefined) {
      continue;
    }
    relationships.push({
      id: relationshipId({
        repoId: repository.id,
        snapshotId: snapshot.id,
        kind: "CO_CHANGED_WITH",
        fromEntityId: target.id,
        toEntityId: other.id,
        sourceEntityId: null,
      }),
      repoId: repository.id,
      snapshotId: snapshot.id,
      fromEntityId: target.id,
      toEntityId: other.id,
      kind: "CO_CHANGED_WITH",
      verification: "derived",
      sourceUrl: null,
      sourceEntityId: null,
      extractor: "git-cochange",
      observedAt: snapshot.startedAt,
      verificationDetail:
        "Observed historical co-change association; not an import or runtime dependency",
      evidence: {
        excerpt: `${observation.sharedCommits} shared commit(s) out of ${observation.targetCommits} commits touching ${coChange.targetFile}`,
        sourceId: observation.commitShas.join(","),
        metadata: {
          sharedCommits: observation.sharedCommits,
          targetCommits: observation.targetCommits,
          share: observation.share,
          minSupport: coChange.coverage.minSupport,
          windowFrom: observation.window.from,
          windowTo: observation.window.to,
          sampleCommitShas: observation.commitShas,
          commitsAnalyzed: coChange.coverage.commitsAnalyzed,
        },
      },
    });
  }
  return relationships;
}
