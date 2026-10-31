import type {
  SourceChangedFile,
  SourceClosingReference,
  SourceComment,
  SourceCommit,
  SourceDocument,
  SourceIssue,
  SourcePullRequest,
  SourceRepository,
  SourceReview,
  SourceTimelineEvent,
} from "../../core/history/src/source.ts";
import { HistoryError } from "../../core/history/src/errors.ts";
import {
  canonicalJson,
  contentSha256,
  normalizeRepoPath,
} from "../../core/history/src/paths.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, context: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response was not an object: ${context}`);
  }
  return value as JsonRecord;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response missing string: ${context}`);
  }
  return value;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response missing number: ${context}`);
  }
  return value;
}

function positiveId(value: unknown, context: string): number {
  const parsed = num(value, context);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response has invalid id: ${context}`);
  }
  return parsed;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function timestamp(value: unknown, context: string, nullable: false): string;
function timestamp(value: unknown, context: string, nullable: true): string | null;
function timestamp(value: unknown, context: string, nullable: boolean): string | null {
  if (value === null || value === undefined) {
    if (nullable) {
      return null;
    }
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response missing timestamp: ${context}`);
  }
  const text = str(value, context);
  if (!Number.isFinite(Date.parse(text))) {
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response has invalid timestamp: ${context}`);
  }
  return text;
}

function sha(value: unknown, context: string, nullable: false): string;
function sha(value: unknown, context: string, nullable: true): string | null;
function sha(value: unknown, context: string, nullable: boolean): string | null {
  if (value === null || value === undefined) {
    if (nullable) {
      return null;
    }
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response missing SHA: ${context}`);
  }
  const text = str(value, context).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(text)) {
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response has invalid SHA: ${context}`);
  }
  return text;
}

function login(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const user = record(value, "user");
  return nullableStr(user.login);
}

function repoHtmlUrl(value: unknown, owner: string, repo: string, context: string): string {
  const text = str(value, context);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response has invalid URL: ${context}`);
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
    throw new HistoryError("GITHUB_UNAVAILABLE", `GitHub response URL is not github.com: ${context}`);
  }
  const expectedPrefix = `/${owner}/${repo}/`.toLowerCase();
  const normalPath = `/${owner}/${repo}`.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (path !== normalPath && !path.startsWith(expectedPrefix)) {
    throw new HistoryError(
      "GITHUB_UNAVAILABLE",
      `GitHub response URL does not belong to ${owner}/${repo}: ${context}`,
    );
  }
  return parsed.toString();
}

function optionalRepoHtmlUrl(
  value: unknown,
  owner: string,
  repo: string,
  context: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return repoHtmlUrl(value, owner, repo, context);
}

function body(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeSourceRepository(
  value: unknown,
  expected: { owner: string; repo: string },
): SourceRepository {
  const data = record(value, "repository");
  const owner = record(data.owner, "repository.owner");
  const ownerLogin = str(owner.login, "repository.owner.login");
  const name = str(data.name, "repository.name");
  const fullName = str(data.full_name, "repository.full_name");
  if (fullName.toLowerCase() !== `${expected.owner}/${expected.repo}`.toLowerCase()) {
    throw new HistoryError("UNSUPPORTED_REMOTE", "GitHub returned a different repository identity", {
      details: { requested: `${expected.owner}/${expected.repo}`, returned: fullName },
    });
  }
  if (ownerLogin.toLowerCase() !== expected.owner.toLowerCase()) {
    throw new HistoryError("UNSUPPORTED_REMOTE", "GitHub owner does not match the requested URL");
  }
  const visibility = str(data.visibility ?? (data.private === true ? "private" : "public"), "repository.visibility");
  if (visibility !== "public" || data.private === true) {
    throw new HistoryError("REPO_NOT_PUBLIC", "Only public GitHub repositories are supported");
  }
  const license = data.license === null || data.license === undefined ? null : record(data.license, "repository.license");
  const htmlUrl = repoHtmlUrl(data.html_url, ownerLogin, name, "repository.html_url");
  return {
    id: positiveId(data.id, "repository.id"),
    nodeId: str(data.node_id, "repository.node_id"),
    owner: ownerLogin,
    name,
    fullName,
    htmlUrl,
    defaultBranch: nullableStr(data.default_branch),
    visibility: "public",
    licenseSpdx: license === null ? null : nullableStr(license.spdx_id),
    archived: bool(data.archived, false),
    fork: bool(data.fork, false),
  };
}

export function normalizeSourceIssue(
  value: unknown,
  owner: string,
  repo: string,
): SourceIssue {
  const data = record(value, "issue");
  const looksLikePullRequest =
    (data.pull_request !== undefined && data.pull_request !== null) ||
    (data.head !== undefined && data.base !== undefined && data.merge_commit_sha !== undefined);
  if (looksLikePullRequest) {
    throw new HistoryError("GITHUB_UNAVAILABLE", "Expected an issue but GitHub returned a pull request");
  }
  const number = num(data.number, "issue.number");
  const title = str(data.title, "issue.title");
  const issueBody = body(data.body);
  const state = str(data.state, "issue.state");
  if (state !== "open" && state !== "closed") {
    throw new HistoryError("GITHUB_UNAVAILABLE", "GitHub issue has an unexpected state");
  }
  const htmlUrl = repoHtmlUrl(data.html_url, owner, repo, "issue.html_url");
  const labels = array(data.labels).map((label) => {
    const item = record(label, "issue.label");
    return typeof item.name === "string" ? item.name : "";
  }).filter((value) => value.length > 0);
  const normalized = {
    id: positiveId(data.id, "issue.id"),
    number,
    title,
    body: issueBody,
    state: state as "open" | "closed",
    stateReason: nullableStr(data.state_reason),
    authorLogin: login(data.user),
    createdAt: timestamp(data.created_at, "issue.created_at", false),
    updatedAt: timestamp(data.updated_at, "issue.updated_at", false),
    closedAt: timestamp(data.closed_at, "issue.closed_at", true),
    closedByLogin: login(data.closed_by),
    htmlUrl,
    labels,
    commentsCount: typeof data.comments === "number" ? data.comments : 0,
    contentSha: contentSha256(canonicalJson({ id: data.id, number, title, body: issueBody, state, updatedAt: data.updated_at, closedAt: data.closed_at })),
  };
  return normalized;
}

export function normalizeSourcePullRequest(
  value: unknown,
  owner: string,
  repo: string,
): SourcePullRequest {
  const data = record(value, "pull request");
  const base = record(data.base, "pull_request.base");
  const head = record(data.head, "pull_request.head");
  const title = str(data.title, "pull_request.title");
  const prBody = body(data.body);
  const state = str(data.state, "pull_request.state");
  if (state !== "open" && state !== "closed") {
    throw new HistoryError("GITHUB_UNAVAILABLE", "GitHub pull request has an unexpected state");
  }
  const normalized: SourcePullRequest = {
    id: positiveId(data.id, "pull_request.id"),
    issueDatabaseId: null,
    number: num(data.number, "pull_request.number"),
    title,
    body: prBody,
    state: state as "open" | "closed",
    draft: bool(data.draft, false),
    authorLogin: login(data.user),
    mergedByLogin: login(data.merged_by),
    createdAt: timestamp(data.created_at, "pull_request.created_at", false),
    updatedAt: timestamp(data.updated_at, "pull_request.updated_at", false),
    closedAt: timestamp(data.closed_at, "pull_request.closed_at", true),
    mergedAt: timestamp(data.merged_at, "pull_request.merged_at", true),
    mergeCommitSha: sha(data.merge_commit_sha, "pull_request.merge_commit_sha", true),
    baseSha: sha(base.sha, "pull_request.base.sha", false),
    baseRef: str(base.ref, "pull_request.base.ref"),
    headSha: sha(head.sha, "pull_request.head.sha", false),
    headRef: str(head.ref, "pull_request.head.ref"),
    htmlUrl: repoHtmlUrl(data.html_url, owner, repo, "pull_request.html_url"),
    commitsCount: typeof data.commits === "number" ? data.commits : 0,
    changedFilesCount: typeof data.changed_files === "number" ? data.changed_files : 0,
    additions: typeof data.additions === "number" ? data.additions : 0,
    deletions: typeof data.deletions === "number" ? data.deletions : 0,
    contentSha: "",
  };
  normalized.contentSha = contentSha256(
    canonicalJson({
      id: normalized.id,
      number: normalized.number,
      title,
      body: prBody,
      state,
      headSha: normalized.headSha,
      baseSha: normalized.baseSha,
      updatedAt: normalized.updatedAt,
      mergedAt: normalized.mergedAt,
    }),
  );
  return normalized;
}

export function normalizeIssueComment(
  value: unknown,
  parentNumber: number,
  parentKind: "Issue" | "PullRequest",
  owner: string,
  repo: string,
): SourceComment {
  const data = record(value, "issue comment");
  const commentBody = body(data.body);
  const createdAt = timestamp(data.created_at, "comment.created_at", false);
  const updatedAt = timestamp(data.updated_at, "comment.updated_at", false);
  return {
    id: positiveId(data.id, "comment.id"),
    kind: "issue_comment",
    parentNumber,
    parentKind,
    authorLogin: login(data.user),
    body: commentBody,
    createdAt,
    updatedAt,
    htmlUrl: repoHtmlUrl(data.html_url, owner, repo, "comment.html_url"),
    authorAssociation: nullableStr(data.author_association),
    path: null,
    line: null,
    inReplyToId: null,
    contentSha: contentSha256(
      canonicalJson({ id: data.id, parentNumber, createdAt, updatedAt, body: commentBody }),
    ),
  };
}

export function normalizeReviewComment(
  value: unknown,
  prNumber: number,
  owner: string,
  repo: string,
): SourceComment {
  const data = record(value, "review comment");
  const commentBody = body(data.body);
  const createdAt = timestamp(data.created_at, "review_comment.created_at", false);
  const updatedAt = timestamp(data.updated_at, "review_comment.updated_at", false);
  const line =
    typeof data.line === "number"
      ? data.line
      : typeof data.original_line === "number"
        ? data.original_line
        : null;
  return {
    id: positiveId(data.id, "review_comment.id"),
    kind: "review_comment",
    parentNumber: prNumber,
    parentKind: "PullRequest",
    authorLogin: login(data.user),
    body: commentBody,
    createdAt,
    updatedAt,
    htmlUrl: repoHtmlUrl(data.html_url, owner, repo, "review_comment.html_url"),
    authorAssociation: nullableStr(data.author_association),
    path: nullableStr(data.path),
    line,
    inReplyToId: typeof data.in_reply_to_id === "number" ? data.in_reply_to_id : null,
    contentSha: contentSha256(
      canonicalJson({ id: data.id, prNumber, createdAt, updatedAt, body: commentBody, path: data.path }),
    ),
  };
}

export function normalizeReview(
  value: unknown,
  prNumber: number,
  owner: string,
  repo: string,
): SourceReview {
  const data = record(value, "review");
  const reviewBody = body(data.body);
  const submittedAt = timestamp(data.submitted_at, "review.submitted_at", true);
  return {
    id: positiveId(data.id, "review.id"),
    prNumber,
    authorLogin: login(data.user),
    state: str(data.state, "review.state"),
    body: reviewBody,
    submittedAt,
    htmlUrl: optionalRepoHtmlUrl(data.html_url, owner, repo, "review.html_url") ??
      `https://github.com/${owner}/${repo}/pull/${prNumber}`,
    commitId: sha(data.commit_id, "review.commit_id", true),
    contentSha: contentSha256(
      canonicalJson({ id: data.id, prNumber, state: data.state, body: reviewBody, submittedAt }),
    ),
  };
}

export function normalizePullRequestCommit(
  value: unknown,
  owner: string,
  repo: string,
): SourceCommit {
  const data = record(value, "pull request commit");
  const commit = record(data.commit, "pull_request_commit.commit");
  const author = commit.author === null || commit.author === undefined ? null : record(commit.author, "commit.author");
  const committer = commit.committer === null || commit.committer === undefined ? null : record(commit.committer, "commit.committer");
  const commitSha = sha(data.sha, "pull_request_commit.sha", false);
  const message = str(commit.message, "pull_request_commit.message");
  return {
    sha: commitSha,
    message,
    authorLogin: login(data.author),
    authorName: author === null ? null : nullableStr(author.name),
    authorEmail: author === null ? null : nullableStr(author.email),
    committerLogin: login(data.committer),
    committerName: committer === null ? null : nullableStr(committer.name),
    committerEmail: committer === null ? null : nullableStr(committer.email),
    authoredAt: author === null ? null : timestamp(author.date, "commit.author.date", true),
    committedAt: committer === null ? null : timestamp(committer.date, "commit.committer.date", true),
    htmlUrl: optionalRepoHtmlUrl(data.html_url, owner, repo, "pull_request_commit.html_url"),
    parents: array(data.parents)
      .map((parent) => {
        const item = record(parent, "commit.parent");
        return sha(item.sha, "commit.parent.sha", false);
      }),
    contentSha: contentSha256(canonicalJson({ sha: commitSha, message, author: data.author, parents: data.parents })),
  };
}

export function normalizeChangedFile(
  value: unknown,
  owner: string,
  repo: string,
): SourceChangedFile {
  const data = record(value, "changed file");
  const rawStatus = str(data.status, "changed_file.status");
  const statusMap: Record<string, SourceChangedFile["status"]> = {
    added: "added",
    removed: "removed",
    modified: "modified",
    renamed: "renamed",
    copied: "copied",
    changed: "changed",
    unchanged: "unchanged",
  };
  const status = statusMap[rawStatus];
  if (status === undefined) {
    throw new HistoryError("GITHUB_UNAVAILABLE", `Unexpected changed-file status: ${rawStatus}`);
  }
  const filename = normalizeRepoPath(str(data.filename, "changed_file.filename"));
  const previous =
    data.previous_filename === null || data.previous_filename === undefined
      ? null
      : normalizeRepoPath(str(data.previous_filename, "changed_file.previous_filename"));
  const rawUrl = optionalRepoHtmlUrl(data.raw_url, owner, repo, "changed_file.raw_url");
  const patch = typeof data.patch === "string" ? data.patch.slice(0, 4_000) : null;
  return {
    filename,
    previousFilename: previous,
    status,
    additions: typeof data.additions === "number" ? data.additions : 0,
    deletions: typeof data.deletions === "number" ? data.deletions : 0,
    changes: typeof data.changes === "number" ? data.changes : 0,
    blobSha: nullableStr(data.sha),
    rawUrl,
    patchExcerpt: patch,
    contentSha: contentSha256(
      canonicalJson({ filename, previous, status, sha: data.sha, patch }),
    ),
  };
}

export function normalizeDocument(
  value: unknown,
  input: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
    maxBytes: number;
  },
): SourceDocument {
  const data = record(value, "document");
  if (data.type !== undefined && data.type !== "file") {
    throw new HistoryError("GITHUB_UNAVAILABLE", `Document path is not a file: ${input.path}`);
  }
  const encoding = str(data.encoding ?? "base64", "document.encoding");
  if (encoding !== "base64") {
    throw new HistoryError("GITHUB_UNAVAILABLE", "GitHub document encoding is not base64");
  }
  const size = typeof data.size === "number" ? data.size : null;
  if (size !== null && size > input.maxBytes) {
    throw new HistoryError("CHECKOUT_TOO_LARGE", "Document exceeds the configured size limit", {
      details: { path: input.path, size, maxBytes: input.maxBytes },
    });
  }
  const content = str(data.content, "document.content").replace(/\s+/g, "");
  const decoded = Buffer.from(content, "base64");
  if (decoded.length > input.maxBytes) {
    throw new HistoryError("CHECKOUT_TOO_LARGE", "Document exceeds the configured size limit", {
      details: { path: input.path, size: decoded.length, maxBytes: input.maxBytes },
    });
  }
  const documentPath = normalizeRepoPath(input.path);
  const htmlUrl =
    optionalRepoHtmlUrl(data.html_url, input.owner, input.repo, "document.html_url") ??
    `https://github.com/${input.owner}/${input.repo}/blob/${input.ref}/${documentPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  return {
    path: documentPath,
    sha: nullableStr(data.sha) ?? "",
    htmlUrl,
    body: decoded.toString("utf8"),
    contentSha: contentSha256(decoded),
    ref: input.ref,
  };
}

export function normalizeTimelineEvents(value: unknown): SourceTimelineEvent[] {
  if (!Array.isArray(value)) {
    throw new HistoryError("GITHUB_UNAVAILABLE", "GitHub timeline response was not an array");
  }
  const events: SourceTimelineEvent[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object") {
      continue;
    }
    const data = raw as JsonRecord;
    if (typeof data.event !== "string") {
      continue;
    }
    const source = data.source === null || data.source === undefined ? null : record(data.source, "timeline.source");
    const sourceIssue = source === null ? null : source.issue === null || source.issue === undefined ? null : record(source.issue, "timeline.source.issue");
    const pullRequest = sourceIssue === null || sourceIssue.pull_request === null || sourceIssue.pull_request === undefined
      ? null
      : record(sourceIssue.pull_request, "timeline.source.issue.pull_request");
    events.push({
      event: data.event,
      id: typeof data.id === "number" ? data.id : 0,
      actorLogin: data.actor === null || data.actor === undefined ? null : login(data.actor),
      createdAt: timestamp(data.created_at, "timeline.created_at", false),
      commitId: sha(data.commit_id, "timeline.commit_id", true),
      sourceNumber: sourceIssue !== null && typeof sourceIssue.number === "number" ? sourceIssue.number : null,
      sourceIsPullRequest: sourceIssue !== null && sourceIssue.pull_request !== undefined && sourceIssue.pull_request !== null,
      sourceMergedAt:
        pullRequest === null
          ? null
          : timestamp(pullRequest.merged_at, "timeline.source.pull_request.merged_at", true),
    });
  }
  return events;
}

const CLOSING_KEYWORD_PATTERN =
  /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*(?:#(\d+)|https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+))/gi;

export interface ParsedClosingKeyword {
  keyword: string;
  issueNumber: number;
  index: number;
  excerpt: string;
}

export function parseClosingKeywords(bodyText: string, owner: string, repo: string): ParsedClosingKeyword[] {
  const results: ParsedClosingKeyword[] = [];
  const seen = new Set<number>();
  for (const match of bodyText.matchAll(CLOSING_KEYWORD_PATTERN)) {
    const keyword = match[1] ?? "";
    const directNumber = match[2];
    const urlOwner = match[3];
    const urlRepo = match[4];
    const urlNumber = match[5];
    if (urlOwner !== undefined && (urlOwner.toLowerCase() !== owner.toLowerCase() || urlRepo?.toLowerCase() !== repo.toLowerCase())) {
      continue;
    }
    const value = directNumber ?? urlNumber;
    if (value === undefined) {
      continue;
    }
    const issueNumber = Number(value);
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0 || seen.has(issueNumber)) {
      continue;
    }
    seen.add(issueNumber);
    const index = match.index ?? 0;
    results.push({
      keyword,
      issueNumber,
      index,
      excerpt: bodyText.slice(Math.max(0, index - 100), Math.min(bodyText.length, index + match[0].length + 120)).replace(/\s+/g, " ").trim(),
    });
  }
  return results;
}

export function buildClosingReference(input: {
  prNumber: number;
  issueNumber: number;
  keyword: string;
  excerpt: string;
  prUrl: string;
  issue: SourceIssue | null;
  prMergedAt: string | null;
  timeline: SourceTimelineEvent[] | null;
}): SourceClosingReference {
  const crossReference = input.timeline?.find(
    (event) =>
      event.event === "cross-referenced" &&
      event.sourceNumber === input.prNumber &&
      event.sourceIsPullRequest,
  ) ?? null;
  const issueClosedAt = input.issue?.closedAt ?? null;
  const mergedAt = input.prMergedAt;
  const closedAfterMerge =
    mergedAt !== null &&
    issueClosedAt !== null &&
    Date.parse(issueClosedAt) + 5 * 60 * 1000 >= Date.parse(mergedAt);
  if (crossReference !== null && input.issue?.state === "closed" && issueClosedAt !== null && closedAfterMerge) {
    return {
      prNumber: input.prNumber,
      issueNumber: input.issueNumber,
      keyword: input.keyword,
      bodyExcerpt: input.excerpt,
      sourceUrl: input.prUrl,
      confirmed: true,
      confirmation: {
        method: "cross_reference_and_issue_closed",
        crossReferencedAt: crossReference.createdAt,
        issueClosedAt,
        prMergedAt: mergedAt,
      },
    };
  }
  let reason = "GitHub did not return a cross-reference event from this pull request";
  if (input.issue === null) {
    reason = "The referenced issue was not available in the collected source set";
  } else if (input.issue.state !== "closed" || issueClosedAt === null) {
    reason = "The referenced issue is not closed";
  } else if (!closedAfterMerge) {
    reason = "The issue was not closed at or after the pull request merge";
  } else if (crossReference === null) {
    reason = "No API cross-reference event confirms the closing link";
  }
  return {
    prNumber: input.prNumber,
    issueNumber: input.issueNumber,
    keyword: input.keyword,
    bodyExcerpt: input.excerpt,
    sourceUrl: input.prUrl,
    confirmed: false,
    confirmation: { method: "unconfirmed", reason },
  };
}
