import type { CoverageReport } from "./types.ts";

export interface SourceRepository {
  id: number;
  nodeId: string;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string | null;
  visibility: "public";
  licenseSpdx: string | null;
  archived: boolean;
  fork: boolean;
}

export interface SourceIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  stateReason: string | null;
  authorLogin: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByLogin: string | null;
  htmlUrl: string;
  labels: string[];
  commentsCount: number;
  contentSha: string;
}

export interface SourcePullRequest {
  id: number;
  issueDatabaseId: number | null;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  draft: boolean;
  authorLogin: string | null;
  mergedByLogin: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  baseSha: string;
  baseRef: string;
  headSha: string;
  headRef: string;
  htmlUrl: string;
  commitsCount: number;
  changedFilesCount: number;
  additions: number;
  deletions: number;
  contentSha: string;
}

export type CommentKind = "issue_comment" | "review_comment";

export interface SourceComment {
  id: number;
  kind: CommentKind;
  parentNumber: number;
  parentKind: "Issue" | "PullRequest";
  authorLogin: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  authorAssociation: string | null;
  path: string | null;
  line: number | null;
  inReplyToId: number | null;
  contentSha: string;
}

export interface SourceReview {
  id: number;
  prNumber: number;
  authorLogin: string | null;
  state: string;
  body: string;
  submittedAt: string | null;
  htmlUrl: string;
  commitId: string | null;
  contentSha: string;
}

export interface SourceCommit {
  sha: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  authorEmail: string | null;
  committerLogin: string | null;
  committerName: string | null;
  committerEmail: string | null;
  authoredAt: string | null;
  committedAt: string | null;
  htmlUrl: string | null;
  parents: string[];
  contentSha: string;
}

export interface SourceChangedFile {
  filename: string;
  previousFilename: string | null;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  blobSha: string | null;
  rawUrl: string | null;
  patchExcerpt: string | null;
  contentSha: string;
}

export interface SourceDocument {
  path: string;
  sha: string;
  htmlUrl: string;
  body: string;
  contentSha: string;
  ref: string;
}

export interface SourceTimelineEvent {
  event: string;
  id: number;
  actorLogin: string | null;
  createdAt: string;
  commitId: string | null;
  sourceNumber: number | null;
  sourceIsPullRequest: boolean;
  sourceMergedAt: string | null;
}

export interface SourceClosingReference {
  prNumber: number;
  issueNumber: number;
  keyword: string;
  bodyExcerpt: string;
  sourceUrl: string;
  confirmed: boolean;
  confirmation:
    | {
        method: "cross_reference_and_issue_closed";
        crossReferencedAt: string | null;
        issueClosedAt: string | null;
        prMergedAt: string | null;
      }
    | {
        method: "unconfirmed";
        reason: string;
      };
}

export interface SourceTimeline {
  issueNumber: number;
  events: SourceTimelineEvent[];
}

export interface SourcePullRequestCommits {
  prNumber: number;
  commits: SourceCommit[];
}

export interface SourcePullRequestFiles {
  prNumber: number;
  files: SourceChangedFile[];
}

export interface GithubCollectionLimits {
  maxIssues: number;
  maxPullRequests: number;
  maxPages: number;
  maxCommentsPerItem: number;
  maxIssuesWithComments: number;
  maxReferencedIssues: number;
  maxReviewsPerPullRequest: number;
  maxCommitsPerPullRequest: number;
  maxFilesPerPullRequest: number;
  maxDocuments: number;
  timeBudgetMs: number;
}

export interface GithubRetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRateLimitWaitMs: number;
}

export interface GithubCollectionConfig {
  owner: string;
  repo: string;
  headSha: string | null;
  focusIssueNumbers: number[];
  focusPullRequestNumbers: number[];
  issueState: "all" | "open" | "closed";
  documentPaths: string[];
  includeIssueTimelines: boolean;
  includePullRequestThreadComments?: boolean;
  includeReviews?: boolean;
  includeReviewComments?: boolean;
  limits: GithubCollectionLimits;
  retry: GithubRetryPolicy;
}

export interface GithubCollectionResult {
  repository: SourceRepository;
  issues: SourceIssue[];
  pullRequests: SourcePullRequest[];
  comments: SourceComment[];
  reviews: SourceReview[];
  pullRequestCommits: SourcePullRequestCommits[];
  pullRequestFiles: SourcePullRequestFiles[];
  documents: SourceDocument[];
  timelines: SourceTimeline[];
  closingReferences: SourceClosingReference[];
  coverage: CoverageReport;
  fetchedAt: string;
  warnings: string[];
}

export interface GithubResponse {
  status: number;
  headers: Record<string, string | number | undefined>;
  data: unknown;
}

export interface GithubApi {
  request(
    route: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<GithubResponse>;
}

export interface Clock {
  now(): number;
  isoNow(): string;
}

export interface Sleep {
  (ms: number, signal?: AbortSignal): Promise<void>;
}
