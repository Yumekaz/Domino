import fs from "node:fs";
import type {
  Clock,
  GithubApi,
  GithubCollectionConfig,
  GithubResponse,
  Sleep,
} from "../../../core/history/src/source.ts";
import { HistoryError } from "../../../core/history/src/errors.ts";

export function ok(
  data: unknown,
  headers: Record<string, string | number | undefined> = {},
): GithubResponse {
  return { status: 200, headers, data };
}

export type FakeHandler = (
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
) => Promise<GithubResponse> | GithubResponse;

export class FakeGithubApi implements GithubApi {
  private readonly handlers = new Map<string, FakeHandler>();
  readonly calls: Array<{ route: string; params: Record<string, unknown> }> = [];
  readonly counts = new Map<string, number>();

  on(route: string, handler: FakeHandler): this {
    this.handlers.set(route, handler);
    return this;
  }

  async request(
    route: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<GithubResponse> {
    this.calls.push({ route, params });
    this.counts.set(route, (this.counts.get(route) ?? 0) + 1);
    if (signal?.aborted === true) {
      throw new HistoryError("COLLECTION_CANCELLED", "GitHub collection was cancelled", {
        recoverable: true,
      });
    }
    const handler = this.handlers.get(route);
    if (handler === undefined) {
      throw new HistoryError("GITHUB_UNAVAILABLE", `No fake handler for ${route}`, {
        recoverable: true,
      });
    }
    return await handler(params, signal);
  }
}

function readFixture(name: string): unknown {
  const url = new URL(`../fixtures/yocto-queue/${name}`, import.meta.url);
  return JSON.parse(fs.readFileSync(url, "utf8")) as unknown;
}

export function yoctoQueueFixture(): {
  repository: unknown;
  issue: unknown;
  issueComments: unknown;
  timeline: unknown;
  pullRequest: unknown;
  pullRequestCommits: unknown;
  pullRequestFiles: unknown;
  pullRequestComments: unknown;
  reviews: unknown;
  reviewComments: unknown;
  readme: unknown;
} {
  return {
    repository: readFixture("yq-repo.json"),
    issue: readFixture("yq-issue-11.json"),
    issueComments: readFixture("yq-issue-11-comments.json"),
    timeline: readFixture("yq-issue-11-timeline.json"),
    pullRequest: readFixture("yq-pr-12.json"),
    pullRequestCommits: readFixture("yq-pr-12-commits.json"),
    pullRequestFiles: readFixture("yq-pr-12-files.json"),
    pullRequestComments: readFixture("yq-pr-12-comments.json"),
    reviews: readFixture("yq-pr-12-reviews.json"),
    reviewComments: readFixture("yq-pr-12-review-comments.json"),
    readme: readFixture("yq-readme.json"),
  };
}

export function yoctoQueueApi(): FakeGithubApi {
  const fixture = yoctoQueueFixture();
  return new FakeGithubApi()
    .on("GET /repos/{owner}/{repo}", () => ok(fixture.repository))
    .on("GET /repos/{owner}/{repo}/issues/{issue_number}", (params) => {
      if (params.issue_number === 11) {
        return ok(fixture.issue);
      }
      return Promise.reject(
        Object.assign(new Error("Not Found"), { status: 404, response: { headers: {}, data: { message: "Not Found" } } }),
      );
    })
    .on("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", (params) => {
      if (params.issue_number === 11) {
        return ok(fixture.issueComments);
      }
      if (params.issue_number === 12) {
        return ok(fixture.pullRequestComments);
      }
      return ok([]);
    })
    .on("GET /repos/{owner}/{repo}/issues/{issue_number}/timeline", () =>
      ok(fixture.timeline),
    )
    .on("GET /repos/{owner}/{repo}/pulls/{pull_number}", (params) => {
      if (params.pull_number === 12) {
        return ok(fixture.pullRequest);
      }
      return Promise.reject(
        Object.assign(new Error("Not Found"), { status: 404, response: { headers: {}, data: { message: "Not Found" } } }),
      );
    })
    .on("GET /repos/{owner}/{repo}/pulls/{pull_number}/commits", () =>
      ok(fixture.pullRequestCommits),
    )
    .on("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", () =>
      ok(fixture.pullRequestFiles),
    )
    .on("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments", () =>
      ok(fixture.reviewComments),
    )
    .on("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", () => ok(fixture.reviews))
    .on("GET /repos/{owner}/{repo}/readme", () => ok(fixture.readme));
}

export class TestClock implements Clock {
  private current: number;
  constructor(startIso = "2026-10-31T00:00:00Z") {
    this.current = Date.parse(startIso);
  }
  now(): number {
    return this.current;
  }
  isoNow(): string {
    return new Date(this.current).toISOString();
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

export function testSleep(clock: TestClock): { sleep: Sleep; sleeps: number[] } {
  const sleeps: number[] = [];
  const sleep: Sleep = async (ms, signal) => {
    sleeps.push(ms);
    clock.advance(ms);
    if (signal?.aborted === true) {
      throw new HistoryError("COLLECTION_CANCELLED", "GitHub collection was cancelled", {
        recoverable: true,
      });
    }
  };
  return { sleep, sleeps };
}

export function testConfig(
  overrides: Partial<GithubCollectionConfig> = {},
): GithubCollectionConfig {
  return {
    owner: "sindresorhus",
    repo: "yocto-queue",
    headSha: "d631ea87f49443c4c8dbf84fd79bf600d11a5fac",
    focusIssueNumbers: [11],
    focusPullRequestNumbers: [12],
    issueState: "all",
    documentPaths: [],
    includeIssueTimelines: true,
    limits: {
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
    retry: {
      maxRetries: 2,
      baseDelayMs: 0,
      maxDelayMs: 10,
      maxRateLimitWaitMs: 1_000,
    },
    ...overrides,
  };
}

export function issueRaw(input: {
  id: number;
  number: number;
  title?: string;
  body?: string;
  createdAt?: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    number: input.number,
    title: input.title ?? `Issue ${input.number}`,
    body: input.body ?? `Body ${input.number}`,
    state: "open",
    state_reason: null,
    user: { login: "tester" },
    created_at: input.createdAt ?? "2025-01-01T00:00:00Z",
    updated_at: input.createdAt ?? "2025-01-01T00:00:00Z",
    closed_at: null,
    closed_by: null,
    html_url: `https://github.com/sindresorhus/yocto-queue/issues/${input.number}`,
    labels: [],
    comments: 0,
  };
}

export function repositoryRaw(): Record<string, unknown> {
  return {
    id: 315531538,
    node_id: "MDEwOlJlcG9zaXRvcnkzMTU1MzE1Mzg=",
    owner: { login: "sindresorhus" },
    name: "yocto-queue",
    full_name: "sindresorhus/yocto-queue",
    html_url: "https://github.com/sindresorhus/yocto-queue",
    default_branch: "main",
    visibility: "public",
    private: false,
    license: { spdx_id: "MIT" },
    archived: false,
    fork: false,
  };
}
