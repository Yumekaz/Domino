import type {
  Clock,
  GithubApi,
  GithubCollectionConfig,
  GithubCollectionLimits,
  GithubCollectionResult,
  GithubResponse,
  GithubRetryPolicy,
  Sleep,
  SourceChangedFile,
  SourceClosingReference,
  SourceComment,
  SourceCommit,
  SourceDocument,
  SourceIssue,
  SourcePullRequest,
  SourcePullRequestCommits,
  SourcePullRequestFiles,
  SourceReview,
  SourceTimeline,
  SourceTimelineEvent,
} from "../../core/history/src/source.ts";
import type { CoverageStatus, SourceName } from "../../core/history/src/types.ts";
import { HistoryError, errorMessage } from "../../core/history/src/errors.ts";
import { normalizeRepoPath } from "../../core/history/src/paths.ts";
import {
  GithubApiError,
  isSignalAborted,
  realClock,
  realSleep,
  withGithubRetry,
} from "./http.ts";
import {
  buildClosingReference,
  normalizeDocument,
  normalizeChangedFile,
  normalizeIssueComment,
  normalizePullRequestCommit,
  normalizeReview,
  normalizeReviewComment,
  normalizeSourceIssue,
  normalizeSourcePullRequest,
  normalizeSourceRepository,
  normalizeTimelineEvents,
  parseClosingKeywords,
} from "./normalize.ts";

export const DEFAULT_GITHUB_LIMITS: GithubCollectionLimits = {
  maxIssues: 30,
  maxPullRequests: 5,
  maxPages: 2,
  maxCommentsPerItem: 50,
  maxIssuesWithComments: 3,
  maxReferencedIssues: 5,
  maxReviewsPerPullRequest: 50,
  maxCommitsPerPullRequest: 50,
  maxFilesPerPullRequest: 100,
  maxDocuments: 5,
  timeBudgetMs: 180_000,
};

export const DEFAULT_GITHUB_RETRY: GithubRetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  maxRateLimitWaitMs: 5_000,
};

export interface CollectGithubDeps {
  clock?: Clock;
  sleep?: Sleep;
  signal?: AbortSignal;
  random?: () => number;
  onWarning?: (warning: string) => void;
  onRetry?: (input: {
    attempt: number;
    waitMs: number;
    status: number | null;
    reason: "backoff" | "rate_limit";
  }) => void;
  maxDocumentBytes?: number;
}

export interface NormalizedGithubConfig {
  owner: string;
  repo: string;
  headSha: string | null;
  focusIssueNumbers: number[];
  focusPullRequestNumbers: number[];
  issueState: "all" | "open" | "closed";
  documentPaths: string[];
  includeIssueTimelines: boolean;
  includePullRequestThreadComments: boolean;
  includeReviews: boolean;
  includeReviewComments: boolean;
  limits: GithubCollectionLimits;
  retry: GithubRetryPolicy;
}

const ALL_SOURCES: SourceName[] = [
  "issues",
  "pullRequests",
  "comments",
  "reviews",
  "commits",
  "changedFiles",
  "documents",
  "timelines",
];

interface SourceStats {
  pages: number;
  items: number;
  capHit: boolean;
  attempted: boolean;
  errors: string[];
  errorCode: string | null;
  warnings: string[];
  windowFrom: string | null;
  windowTo: string | null;
}

type StatsMap = Record<SourceName, SourceStats>;

export function normalizeGithubConfig(config: GithubCollectionConfig): NormalizedGithubConfig {
  const owner = config.owner.trim();
  const repo = config.repo.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
    throw new HistoryError("INVALID_REQUEST", "Invalid GitHub owner");
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
    throw new HistoryError("INVALID_REQUEST", "Invalid GitHub repository name");
  }
  const headSha = config.headSha?.trim().toLowerCase() ?? null;
  if (headSha !== null && !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new HistoryError("INVALID_REQUEST", "headSha must be a full 40-character SHA");
  }
  const focusIssueNumbers = uniquePositive(config.focusIssueNumbers, "focusIssueNumbers");
  const focusPullRequestNumbers = uniquePositive(
    config.focusPullRequestNumbers,
    "focusPullRequestNumbers",
  );
  if (config.issueState !== "all" && config.issueState !== "open" && config.issueState !== "closed") {
    throw new HistoryError("INVALID_REQUEST", "issueState must be all, open or closed");
  }
  const documentPaths: string[] = [];
  for (const raw of config.documentPaths) {
    const normalized = normalizeRepoPath(raw);
    if (!/\.(md|mdx|txt|rst)$/i.test(normalized)) {
      throw new HistoryError("INVALID_REQUEST", "Only text documents can be collected", {
        details: { path: normalized },
      });
    }
    if (!documentPaths.includes(normalized)) {
      documentPaths.push(normalized);
    }
  }
  const limits: GithubCollectionLimits = {
    maxIssues: clampInt(config.limits.maxIssues, 1, 200),
    maxPullRequests: clampInt(config.limits.maxPullRequests, 1, 50),
    maxPages: clampInt(config.limits.maxPages, 1, 20),
    maxCommentsPerItem: clampInt(config.limits.maxCommentsPerItem, 1, 500),
    maxIssuesWithComments: clampInt(config.limits.maxIssuesWithComments, 0, 50),
    maxReferencedIssues: clampInt(config.limits.maxReferencedIssues, 0, 50),
    maxReviewsPerPullRequest: clampInt(config.limits.maxReviewsPerPullRequest, 1, 500),
    maxCommitsPerPullRequest: clampInt(config.limits.maxCommitsPerPullRequest, 1, 500),
    maxFilesPerPullRequest: clampInt(config.limits.maxFilesPerPullRequest, 1, 500),
    maxDocuments: clampInt(config.limits.maxDocuments, 1, 30),
    timeBudgetMs: clampInt(config.limits.timeBudgetMs, 100, 600_000),
  };
  const retry: GithubRetryPolicy = {
    maxRetries: clampInt(config.retry.maxRetries, 0, 10),
    baseDelayMs: clampInt(config.retry.baseDelayMs, 0, 60_000),
    maxDelayMs: clampInt(config.retry.maxDelayMs, 0, 300_000),
    maxRateLimitWaitMs: clampInt(config.retry.maxRateLimitWaitMs, 0, 300_000),
  };
  return {
    owner,
    repo,
    headSha,
    focusIssueNumbers,
    focusPullRequestNumbers,
    issueState: config.issueState,
    documentPaths: documentPaths.slice(0, 10),
    includeIssueTimelines: config.includeIssueTimelines,
    includePullRequestThreadComments: config.includePullRequestThreadComments ?? true,
    includeReviews: config.includeReviews ?? true,
    includeReviewComments: config.includeReviewComments ?? true,
    limits,
    retry,
  };
}

export async function collectGithubRepository(
  api: GithubApi,
  rawConfig: GithubCollectionConfig,
  deps: CollectGithubDeps = {},
): Promise<GithubCollectionResult> {
  const config = normalizeGithubConfig(rawConfig);
  const clock = deps.clock ?? realClock;
  const sleep = deps.sleep ?? realSleep;
  const deadline = clock.now() + config.limits.timeBudgetMs;
  const signal = deps.signal;
  const stats = createStats();
  const warnings: string[] = [];
  let blocked: "rate_limit" | "time_budget" | "unavailable" | null = null;
  const warned = new Set<string>();

  const addWarning = (warning: string) => {
    if (!warned.has(warning)) {
      warned.add(warning);
      warnings.push(warning);
      deps.onWarning?.(warning);
    }
  };

  const sourceStats = (source: SourceName): SourceStats => stats[source];

  const recordWindow = (source: SourceName, value: string | null) => {
    if (value === null) {
      return;
    }
    const entry = sourceStats(source);
    if (entry.windowFrom === null || value < entry.windowFrom) {
      entry.windowFrom = value;
    }
    if (entry.windowTo === null || value > entry.windowTo) {
      entry.windowTo = value;
    }
  };

  const recordNotFound = (source: SourceName, context: string) => {
    const entry = sourceStats(source);
    entry.attempted = true;
    entry.warnings.push(`${context} was not found`);
  };

  const recordError = (source: SourceName, error: unknown) => {
    const entry = sourceStats(source);
    entry.attempted = true;
    const code = error instanceof HistoryError ? error.code : "GITHUB_UNAVAILABLE";
    if (entry.errorCode === null) {
      entry.errorCode = code;
    }
    entry.errors.push(`${code}: ${errorMessage(error)}`);
  };

  const checkBlocked = (source: SourceName): boolean => {
    if (blocked === null) {
      return false;
    }
    const entry = sourceStats(source);
    if (entry.pages === 0 && entry.items === 0) {
      entry.warnings.push(`Not attempted because collection was blocked by ${blocked}`);
    }
    return true;
  };

  const budgetExceeded = (): boolean => {
    if (clock.now() <= deadline) {
      return false;
    }
    blocked = blocked ?? "time_budget";
    addWarning("GitHub collection stopped at its configured time budget.");
    return true;
  };

  const safeRequest = async (
    route: string,
    params: Record<string, unknown>,
    source: SourceName,
    options: { notFound: "warning" | "error"; context: string },
  ): Promise<GithubResponse | null> => {
    if (signal?.aborted === true) {
      throw new HistoryError("COLLECTION_CANCELLED", "GitHub collection was cancelled", {
        recoverable: true,
      });
    }
    if (checkBlocked(source)) {
      return null;
    }
    if (budgetExceeded()) {
      recordError(source, new HistoryError("COLLECTION_TIME_BUDGET", "GitHub collection time budget exceeded"));
      return null;
    }
    sourceStats(source).attempted = true;
    try {
      const result = await withGithubRetry(
        () => api.request(route, params, signal),
        config.retry,
        {
          clock,
          sleep,
          random: deps.random,
          onRetry: deps.onRetry,
        },
        signal,
      );
      sourceStats(source).pages += 1;
      return result.value;
    } catch (error) {
      if (isSignalAborted(signal)) {
        throw new HistoryError("COLLECTION_CANCELLED", "GitHub collection was cancelled", {
          recoverable: true,
        });
      }
      if (error instanceof GithubApiError && error.status === 404) {
        if (options.notFound === "error") {
          recordError(source, error);
        } else {
          recordNotFound(source, options.context);
        }
        return null;
      }
      if (error instanceof HistoryError) {
        if (error.code === "COLLECTION_CANCELLED") {
          throw error;
        }
        if (error.code === "GITHUB_RATE_LIMITED") {
          blocked = "rate_limit";
        } else if (error.code === "COLLECTION_TIME_BUDGET") {
          blocked = "time_budget";
        }
        recordError(source, error);
        addWarning(`${options.context}: ${error.message}`);
        return null;
      }
      recordError(source, error);
      addWarning(`${options.context}: ${errorMessage(error)}`);
      return null;
    }
  };

  const paginate = async <T>(input: {
    route: string;
    params: Record<string, unknown>;
    source: SourceName;
    normalize: (raw: unknown) => T | null;
    keyOf: (item: T) => string;
    timestampOf?: (item: T) => string | null;
    maxItems: number;
    maxPages: number;
    perPage?: number;
    context: string;
  }): Promise<T[]> => {
    const items: T[] = [];
    const seen = new Set<string>();
    const capHitBefore = sourceStats(input.source).capHit;
    const perPage = input.perPage ?? 100;
    let page = 1;
    let complete = false;
    while (page <= input.maxPages) {
      const response = await safeRequest(
        input.route,
        { ...input.params, per_page: perPage, page },
        input.source,
        { notFound: "warning", context: `${input.context} page ${page}` },
      );
      if (response === null) {
        break;
      }
      if (!Array.isArray(response.data)) {
        recordError(
          input.source,
          new HistoryError("GITHUB_UNAVAILABLE", `${input.context} did not return an array`),
        );
        break;
      }
      const pageItems = response.data;
      for (const raw of pageItems) {
        if (items.length >= input.maxItems) {
          sourceStats(input.source).capHit = true;
          break;
        }
        let item: T | null;
        try {
          item = input.normalize(raw);
        } catch (error) {
          recordError(input.source, error);
          addWarning(`${input.context}: skipped one malformed record: ${errorMessage(error)}`);
          continue;
        }
        if (item === null) {
          continue;
        }
        const key = input.keyOf(item);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push(item);
        sourceStats(input.source).items += 1;
        if (input.timestampOf !== undefined) {
          recordWindow(input.source, input.timestampOf(item));
        }
      }
      if (items.length >= input.maxItems) {
        sourceStats(input.source).capHit = true;
        break;
      }
      if (pageItems.length < perPage) {
        complete = true;
        break;
      }
      page += 1;
    }
    if (!complete && items.length < input.maxItems && page > input.maxPages) {
      sourceStats(input.source).capHit = true;
    }
    if (sourceStats(input.source).capHit && !capHitBefore) {
      addWarning(
        `${input.context} reached a configured page/item cap; the source coverage is partial.`,
      );
    }
    return items;
  };

  const repoResponse = await (async () => {
    if (signal?.aborted === true) {
      throw new HistoryError("COLLECTION_CANCELLED", "GitHub collection was cancelled", {
        recoverable: true,
      });
    }
    try {
      const result = await withGithubRetry(
        () =>
          api.request(
            "GET /repos/{owner}/{repo}",
            { owner: config.owner, repo: config.repo },
            signal,
          ),
        config.retry,
        { clock, sleep, random: deps.random, onRetry: deps.onRetry },
        signal,
      );
      return result.value;
    } catch (error) {
      if (error instanceof GithubApiError && error.status === 404) {
        throw new HistoryError("REPO_NOT_PUBLIC", "Repository is not available as a public GitHub repository", {
          recoverable: true,
          details: { status: 404 },
        });
      }
      if (error instanceof HistoryError) {
        throw error;
      }
      throw new HistoryError("GITHUB_UNAVAILABLE", "Unable to read repository metadata", {
        recoverable: true,
        cause: error,
      });
    }
  })();

  const repository = normalizeSourceRepository(repoResponse.data, {
    owner: config.owner,
    repo: config.repo,
  });
  const ref = config.headSha ?? repository.defaultBranch;
  if (config.headSha === null) {
    addWarning(
      "No exact head SHA was supplied; GitHub documents are read from the default branch and cannot claim exact-SHA provenance.",
    );
  }

  const issuesByNumber = new Map<number, SourceIssue>();
  const pullRequestNumbers = new Set<number>();
  const pullRequestsByNumber = new Map<number, SourcePullRequest>();
  const comments: SourceComment[] = [];
  const reviews: SourceReview[] = [];
  const pullRequestCommits: SourcePullRequestCommits[] = [];
  const pullRequestFiles: SourcePullRequestFiles[] = [];
  const documents = new Map<string, SourceDocument>();
  const timelines = new Map<number, SourceTimelineEvent[]>();
  const closingReferences: SourceClosingReference[] = [];

  const focusIssues = new Set(config.focusIssueNumbers);
  const focusPullRequests = new Set(config.focusPullRequestNumbers);
  const hasFocus = focusIssues.size > 0 || focusPullRequests.size > 0;
  const selectedIssueNumbers = new Set<number>();

  if (hasFocus) {
    for (const number of config.focusIssueNumbers) {
      const response = await safeRequest(
        "GET /repos/{owner}/{repo}/issues/{issue_number}",
        { owner: config.owner, repo: config.repo, issue_number: number },
        "issues",
        { notFound: "error", context: `Focused issue #${number}` },
      );
      if (response === null) {
        continue;
      }
      const data = response.data as Record<string, unknown>;
      if (data.pull_request !== undefined && data.pull_request !== null) {
        pullRequestNumbers.add(number);
        focusPullRequests.add(number);
        continue;
      }
      try {
        const issue = normalizeSourceIssue(response.data, config.owner, config.repo);
        issuesByNumber.set(issue.number, issue);
        selectedIssueNumbers.add(issue.number);
        recordWindow("issues", issue.createdAt);
      } catch (error) {
        recordError("issues", error);
        addWarning(`Focused issue #${number} could not be normalized: ${errorMessage(error)}`);
      }
    }
    for (const number of config.focusPullRequestNumbers) {
      pullRequestNumbers.add(number);
    }
  } else {
    type Discovery =
      | { kind: "issue"; issue: SourceIssue }
      | { kind: "pullRequest"; number: number };
    const discovered = await paginate<Discovery>({
      route: "GET /repos/{owner}/{repo}/issues",
      params: {
        owner: config.owner,
        repo: config.repo,
        state: config.issueState,
        sort: "updated",
        direction: "desc",
      },
      source: "issues",
      normalize: (raw) => {
        if (raw === null || typeof raw !== "object") {
          return null;
        }
        const data = raw as Record<string, unknown>;
        if (data.pull_request !== undefined && data.pull_request !== null) {
          const number = typeof data.number === "number" ? data.number : null;
          return number === null ? null : { kind: "pullRequest", number };
        }
        return { kind: "issue", issue: normalizeSourceIssue(raw, config.owner, config.repo) };
      },
      keyOf: (item) =>
        item.kind === "issue" ? `issue:${item.issue.id}` : `pr:${item.number}`,
      timestampOf: (item) => (item.kind === "issue" ? item.issue.createdAt : null),
      maxItems: config.limits.maxIssues + config.limits.maxPullRequests,
      maxPages: config.limits.maxPages,
      context: "Issue/PR list",
    });
    for (const item of discovered) {
      if (item.kind === "issue" && issuesByNumber.size < config.limits.maxIssues) {
        issuesByNumber.set(item.issue.number, item.issue);
        selectedIssueNumbers.add(item.issue.number);
      } else if (item.kind === "pullRequest" && pullRequestNumbers.size < config.limits.maxPullRequests) {
        pullRequestNumbers.add(item.number);
      } else {
        sourceStats(item.kind === "issue" ? "issues" : "pullRequests").capHit = true;
      }
    }
  }

  if (issuesByNumber.size > config.limits.maxIssues) {
    sourceStats("issues").capHit = true;
    addWarning(
      `Issue collection is capped at ${config.limits.maxIssues}; additional issues were not selected.`,
    );
  }
  if (pullRequestNumbers.size > config.limits.maxPullRequests) {
    sourceStats("pullRequests").capHit = true;
    addWarning(
      `Pull-request collection is capped at ${config.limits.maxPullRequests}; additional PRs were not selected.`,
    );
  }

  const selectedPullRequests = [...pullRequestNumbers]
    .sort((left, right) => left - right)
    .slice(0, config.limits.maxPullRequests);

  for (const prNumber of selectedPullRequests) {
    const detail = await safeRequest(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      { owner: config.owner, repo: config.repo, pull_number: prNumber },
      "pullRequests",
      { notFound: "error", context: `Pull request #${prNumber}` },
    );
    if (detail === null) {
      continue;
    }
    let pullRequest: SourcePullRequest;
    try {
      pullRequest = normalizeSourcePullRequest(detail.data, config.owner, config.repo);
    } catch (error) {
      recordError("pullRequests", error);
      addWarning(`Pull request #${prNumber} could not be normalized: ${errorMessage(error)}`);
      continue;
    }
    pullRequestsByNumber.set(pullRequest.number, pullRequest);
    recordWindow("pullRequests", pullRequest.createdAt);

    if (config.includePullRequestThreadComments) {
      const threadComments = await paginate<SourceComment>({
        route: "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        params: { owner: config.owner, repo: config.repo, issue_number: prNumber },
        source: "comments",
        normalize: (raw) =>
          normalizeIssueComment(raw, prNumber, "PullRequest", config.owner, config.repo),
        keyOf: (item) => String(item.id),
        timestampOf: (item) => item.createdAt,
        maxItems: config.limits.maxCommentsPerItem,
        maxPages: config.limits.maxPages,
        context: `Pull request #${prNumber} conversation comments`,
      });
      comments.push(...threadComments);
    } else {
      sourceStats("comments").attempted = true;
      sourceStats("comments").capHit = true;
      sourceStats("comments").warnings.push(
        "Pull-request conversation comments were skipped by the bounded collection configuration.",
      );
    }

    if (config.includeReviewComments) {
      const reviewComments = await paginate<SourceComment>({
        route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
        params: { owner: config.owner, repo: config.repo, pull_number: prNumber },
        source: "comments",
        normalize: (raw) => normalizeReviewComment(raw, prNumber, config.owner, config.repo),
        keyOf: (item) => String(item.id),
        timestampOf: (item) => item.createdAt,
        maxItems: config.limits.maxCommentsPerItem,
        maxPages: config.limits.maxPages,
        context: `Pull request #${prNumber} review comments`,
      });
      comments.push(...reviewComments);
    } else {
      sourceStats("comments").attempted = true;
      sourceStats("comments").capHit = true;
      sourceStats("comments").warnings.push(
        "Pull-request review comments were skipped by the bounded collection configuration.",
      );
    }

    if (config.includeReviews) {
      const prReviews = await paginate<SourceReview>({
        route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        params: { owner: config.owner, repo: config.repo, pull_number: prNumber },
        source: "reviews",
        normalize: (raw) => normalizeReview(raw, prNumber, config.owner, config.repo),
        keyOf: (item) => String(item.id),
        timestampOf: (item) => item.submittedAt,
        maxItems: config.limits.maxReviewsPerPullRequest,
        maxPages: config.limits.maxPages,
        context: `Pull request #${prNumber} reviews`,
      });
      reviews.push(...prReviews);
    } else {
      sourceStats("reviews").attempted = true;
      sourceStats("reviews").capHit = true;
      sourceStats("reviews").warnings.push(
        "Pull-request reviews were skipped by the bounded collection configuration.",
      );
    }

    const commits = await paginate<SourceCommit>({
      route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/commits",
      params: { owner: config.owner, repo: config.repo, pull_number: prNumber },
      source: "commits",
      normalize: (raw) => normalizePullRequestCommit(raw, config.owner, config.repo),
      keyOf: (item) => item.sha,
      timestampOf: (item) => item.authoredAt ?? item.committedAt,
      maxItems: config.limits.maxCommitsPerPullRequest,
      maxPages: config.limits.maxPages,
      context: `Pull request #${prNumber} commits`,
    });
    pullRequestCommits.push({ prNumber, commits });

    const files = await paginate<SourceChangedFile>({
      route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
      params: { owner: config.owner, repo: config.repo, pull_number: prNumber },
      source: "changedFiles",
      normalize: (raw) => normalizeChangedFile(raw, config.owner, config.repo),
      keyOf: (item) => item.filename,
      maxItems: config.limits.maxFilesPerPullRequest,
      maxPages: config.limits.maxPages,
      context: `Pull request #${prNumber} changed files`,
    });
    pullRequestFiles.push({ prNumber, files });
  }

  const commentIssueNumbers = new Set<number>();
  for (const issue of issuesByNumber.values()) {
    if (focusIssues.has(issue.number)) {
      commentIssueNumbers.add(issue.number);
    }
  }
  const remainingCommentBudget = Math.max(
    0,
    config.limits.maxIssuesWithComments - commentIssueNumbers.size,
  );
  if (remainingCommentBudget > 0) {
    const candidates = [...issuesByNumber.values()]
      .filter((issue) => !commentIssueNumbers.has(issue.number))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, remainingCommentBudget);
    for (const issue of candidates) {
      commentIssueNumbers.add(issue.number);
    }
  }
  for (const issueNumber of commentIssueNumbers) {
    const issue = issuesByNumber.get(issueNumber);
    if (issue === undefined) {
      continue;
    }
    const issueComments = await paginate<SourceComment>({
      route: "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      params: { owner: config.owner, repo: config.repo, issue_number: issueNumber },
      source: "comments",
      normalize: (raw) =>
        normalizeIssueComment(raw, issueNumber, "Issue", config.owner, config.repo),
      keyOf: (item) => String(item.id),
      timestampOf: (item) => item.createdAt,
      maxItems: config.limits.maxCommentsPerItem,
      maxPages: config.limits.maxPages,
      context: `Issue #${issueNumber} comments`,
    });
    comments.push(...issueComments);
  }

  const referencedIssueNumbers = new Set<number>();
  for (const pullRequest of pullRequestsByNumber.values()) {
    const keywords = parseClosingKeywords(pullRequest.body, config.owner, config.repo).slice(0, 10);
    for (const keyword of keywords) {
      if (referencedIssueNumbers.size >= config.limits.maxReferencedIssues) {
        addWarning(
          `Closing-reference issue collection is capped at ${config.limits.maxReferencedIssues}.`,
        );
        break;
      }
      referencedIssueNumbers.add(keyword.issueNumber);
      let issue = issuesByNumber.get(keyword.issueNumber) ?? null;
      if (issue === null) {
        const detail = await safeRequest(
          "GET /repos/{owner}/{repo}/issues/{issue_number}",
          { owner: config.owner, repo: config.repo, issue_number: keyword.issueNumber },
          "issues",
          { notFound: "warning", context: `Referenced issue #${keyword.issueNumber}` },
        );
        if (detail !== null) {
          try {
            const data = detail.data as Record<string, unknown>;
            if (data.pull_request === undefined || data.pull_request === null) {
              issue = normalizeSourceIssue(detail.data, config.owner, config.repo);
              issuesByNumber.set(issue.number, issue);
              recordWindow("issues", issue.createdAt);
            }
          } catch (error) {
            recordError("issues", error);
          }
        }
      }
      let timeline: SourceTimelineEvent[] | null = null;
      if (config.includeIssueTimelines) {
        timeline = await loadTimeline(keyword.issueNumber);
      }
      closingReferences.push(
        buildClosingReference({
          prNumber: pullRequest.number,
          issueNumber: keyword.issueNumber,
          keyword: keyword.keyword,
          excerpt: keyword.excerpt,
          prUrl: pullRequest.htmlUrl,
          issue,
          prMergedAt: pullRequest.mergedAt,
          timeline,
        }),
      );
    }
  }

  if (config.includeIssueTimelines) {
    for (const issueNumber of focusIssues) {
      if (!referencedIssueNumbers.has(issueNumber)) {
        await loadTimeline(issueNumber);
      }
    }
  }

  const documentRef = ref ?? "HEAD";
  const maxDocumentBytes = deps.maxDocumentBytes ?? 200_000;
  const readme = await safeRequest(
    "GET /repos/{owner}/{repo}/readme",
    { owner: config.owner, repo: config.repo, ref: documentRef },
    "documents",
    { notFound: "warning", context: "README" },
  );
  if (readme !== null) {
    try {
      const data = readme.data as Record<string, unknown>;
      const path = typeof data.path === "string" ? data.path : "README.md";
      if (documents.size < config.limits.maxDocuments) {
        const document = normalizeDocument(readme.data, {
          owner: config.owner,
          repo: config.repo,
          path,
          ref: documentRef,
          maxBytes: maxDocumentBytes,
        });
        documents.set(document.path, document);
        sourceStats("documents").items += 1;
      } else {
        sourceStats("documents").capHit = true;
      }
    } catch (error) {
      recordError("documents", error);
      addWarning(`README could not be collected: ${errorMessage(error)}`);
    }
  }
  for (const documentPath of config.documentPaths) {
    if (documents.size >= config.limits.maxDocuments) {
      sourceStats("documents").capHit = true;
      break;
    }
    if (documents.has(documentPath)) {
      continue;
    }
    const response = await safeRequest(
      "GET /repos/{owner}/{repo}/contents/{path}",
      { owner: config.owner, repo: config.repo, path: documentPath, ref: documentRef },
      "documents",
      { notFound: "warning", context: `Document ${documentPath}` },
    );
    if (response === null) {
      continue;
    }
    try {
      const document = normalizeDocument(response.data, {
        owner: config.owner,
        repo: config.repo,
        path: documentPath,
        ref: documentRef,
        maxBytes: maxDocumentBytes,
      });
      documents.set(document.path, document);
      sourceStats("documents").items += 1;
    } catch (error) {
      recordError("documents", error);
      addWarning(`Document ${documentPath} could not be collected: ${errorMessage(error)}`);
    }
  }
  if (config.headSha === null && sourceStats("documents").items > 0) {
    sourceStats("documents").warnings.push(
      "Documents were read from the default branch, not an exact indexed SHA.",
    );
  }

  async function loadTimeline(issueNumber: number): Promise<SourceTimelineEvent[] | null> {
    const cached = timelines.get(issueNumber);
    if (cached !== undefined) {
      return cached;
    }
    const events = await paginate<SourceTimelineEvent>({
      route: "GET /repos/{owner}/{repo}/issues/{issue_number}/timeline",
      params: { owner: config.owner, repo: config.repo, issue_number: issueNumber },
      source: "timelines",
      normalize: (raw) => normalizeTimelineEvents([raw])[0] ?? null,
      keyOf: (item) => `${item.id}:${item.event}:${item.createdAt}`,
      timestampOf: (item) => item.createdAt,
      maxItems: 200,
      maxPages: 2,
      context: `Issue #${issueNumber} timeline`,
    });
    timelines.set(issueNumber, events);
    return events;
  }

  sourceStats("issues").items = issuesByNumber.size;
  sourceStats("pullRequests").items = pullRequestsByNumber.size;

  const sortedIssues = [...issuesByNumber.values()].sort(
    (left, right) => left.number - right.number,
  );
  const sortedPullRequests = [...pullRequestsByNumber.values()].sort(
    (left, right) => left.number - right.number,
  );
  comments.sort((left, right) => left.id - right.id);
  reviews.sort((left, right) => left.id - right.id);
  pullRequestCommits.sort((left, right) => left.prNumber - right.prNumber);
  for (const bundle of pullRequestCommits) {
    bundle.commits.sort((left, right) => left.sha.localeCompare(right.sha));
  }
  pullRequestFiles.sort((left, right) => left.prNumber - right.prNumber);
  for (const bundle of pullRequestFiles) {
    bundle.files.sort((left, right) => left.filename.localeCompare(right.filename));
  }
  const sortedDocuments = [...documents.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const sortedTimelines: SourceTimeline[] = [...timelines.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([issueNumber, events]) => ({ issueNumber, events }));
  closingReferences.sort(
    (left, right) => left.prNumber - right.prNumber || left.issueNumber - right.issueNumber,
  );

  const coverage = buildCoverage();
  return {
    repository,
    issues: sortedIssues,
    pullRequests: sortedPullRequests,
    comments,
    reviews,
    pullRequestCommits,
    pullRequestFiles,
    documents: sortedDocuments,
    timelines: sortedTimelines,
    closingReferences,
    coverage,
    fetchedAt: clock.isoNow(),
    warnings,
  };

  function buildCoverage() {
    const sources: GithubCollectionResult["coverage"]["sources"] = {};
    for (const source of ALL_SOURCES) {
      const entry = sourceStats(source);
      let status: CoverageStatus;
      if (!entry.attempted) {
        status = "not_attempted";
      } else if (entry.errors.length > 0) {
        status = entry.items > 0 ? "partial" : "failed";
      } else if (entry.capHit) {
        status = "partial";
      } else {
        status = "complete";
      }
      if (blocked !== null && !entry.attempted) {
        entry.warnings.push(`Collection blocked before this source by ${blocked}`);
      }
      sources[source] = {
        source,
        status,
        pagesFetched: entry.pages,
        items: entry.items,
        capHit: entry.capHit,
        warnings: [...new Set([...entry.warnings, ...entry.errors])],
        window:
          entry.windowFrom === null && entry.windowTo === null
            ? null
            : { from: entry.windowFrom, to: entry.windowTo },
        ...(entry.errorCode === null ? {} : { errorCode: entry.errorCode }),
        ...(entry.errors.length === 0 ? {} : { errorMessage: entry.errors[0] }),
      };
    }
    if (blocked !== null) {
      addWarning(`GitHub collection is partial because the collector was blocked by ${blocked}.`);
    }
    return {
      sources,
      warnings,
      limits: {
        maxIssues: config.limits.maxIssues,
        maxPullRequests: config.limits.maxPullRequests,
        maxPages: config.limits.maxPages,
        maxCommentsPerItem: config.limits.maxCommentsPerItem,
        maxIssuesWithComments: config.limits.maxIssuesWithComments,
        maxReferencedIssues: config.limits.maxReferencedIssues,
        maxReviewsPerPullRequest: config.limits.maxReviewsPerPullRequest,
        maxCommitsPerPullRequest: config.limits.maxCommitsPerPullRequest,
        maxFilesPerPullRequest: config.limits.maxFilesPerPullRequest,
        maxDocuments: config.limits.maxDocuments,
        timeBudgetMs: config.limits.timeBudgetMs,
        headSha: config.headSha,
        ref: documentRef,
        focusIssues: config.focusIssueNumbers.join(","),
        focusPullRequests: config.focusPullRequestNumbers.join(","),
      },
    };
  }
}

function createStats(): StatsMap {
  const stats = {} as StatsMap;
  for (const source of ALL_SOURCES) {
    stats[source] = {
      pages: 0,
      items: 0,
      capHit: false,
      attempted: false,
      errors: [],
      errorCode: null,
      warnings: [],
      windowFrom: null,
      windowTo: null,
    };
  }
  return stats;
}

function uniquePositive(values: number[], context: string): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new HistoryError("INVALID_REQUEST", `${context} must contain positive integers`);
    }
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
