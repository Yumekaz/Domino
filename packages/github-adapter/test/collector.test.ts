import { test } from "node:test";
import assert from "node:assert/strict";
import { collectGithubRepository } from "../src/collect.ts";
import { GithubApiError } from "../src/http.ts";
import { HistoryError } from "../../core/history/src/errors.ts";
import {
  FakeGithubApi,
  TestClock,
  issueRaw,
  ok,
  repositoryRaw,
  testConfig,
  testSleep,
  yoctoQueueApi,
  yoctoQueueFixture,
} from "./support/fakeGithub.ts";

const YOCTO_MERGE_SHA = "d631ea87f49443c4c8dbf84fd79bf600d11a5fac";
const YOCTO_PR_HEAD_SHA = "87d4a591b6584b9120a16daea822c919ff36c1ee";
const YOCTO_BASE_SHA = "0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b";

test("collects the real yocto-queue chain with confirmed closing metadata and coverage", async () => {
  const api = yoctoQueueApi();
  const clock = new TestClock();
  const { sleep } = testSleep(clock);
  const result = await collectGithubRepository(api, testConfig(), { clock, sleep });

  assert.equal(result.repository.id, 315531538);
  assert.equal(result.repository.fullName, "sindresorhus/yocto-queue");
  assert.equal(result.repository.licenseSpdx, "MIT");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.id, 2891449053);
  assert.equal(result.issues[0]?.number, 11);
  assert.equal(result.issues[0]?.htmlUrl, "https://github.com/sindresorhus/yocto-queue/issues/11");

  assert.equal(result.pullRequests.length, 1);
  const pullRequest = result.pullRequests[0];
  assert.ok(pullRequest);
  assert.equal(pullRequest.number, 12);
  assert.equal(pullRequest.mergeCommitSha, YOCTO_MERGE_SHA);
  assert.equal(pullRequest.headSha, YOCTO_PR_HEAD_SHA);
  assert.equal(pullRequest.baseSha, YOCTO_BASE_SHA);
  assert.equal(pullRequest.mergedAt, "2025-03-06T12:27:36Z");

  const rationale = result.comments.find((comment) => comment.id === 2696500039);
  assert.ok(rationale);
  assert.match(rationale.body, /intended behavior/i);
  assert.match(rationale.body, /drain/);
  assert.equal(rationale.parentNumber, 11);
  assert.equal(rationale.parentKind, "Issue");
  assert.equal(rationale.authorLogin, "sindresorhus");

  assert.equal(result.pullRequestCommits.length, 1);
  assert.equal(result.pullRequestCommits[0]?.commits.length, 6);
  assert.ok(result.pullRequestCommits[0]?.commits.some((commit) => commit.sha === YOCTO_PR_HEAD_SHA));

  assert.equal(result.pullRequestFiles.length, 1);
  const files = result.pullRequestFiles[0]?.files ?? [];
  assert.equal(files.length, 4);
  const indexFile = files.find((file) => file.filename === "index.js");
  assert.ok(indexFile);
  assert.equal(indexFile.blobSha, "2fa5f670219c2726c212a93096245cda5a498bce");
  assert.ok(files.some((file) => file.filename === "readme.md"));
  assert.ok(files.some((file) => file.filename === "test.js"));

  assert.equal(result.closingReferences.length, 1);
  const closing = result.closingReferences[0];
  assert.ok(closing);
  assert.equal(closing.prNumber, 12);
  assert.equal(closing.issueNumber, 11);
  assert.equal(closing.confirmed, true);
  assert.equal(closing.confirmation.method, "cross_reference_and_issue_closed");
  if (closing.confirmation.method === "cross_reference_and_issue_closed") {
    assert.equal(closing.confirmation.issueClosedAt, "2025-03-06T12:27:37Z");
    assert.equal(closing.confirmation.prMergedAt, "2025-03-06T12:27:36Z");
    assert.ok(closing.confirmation.crossReferencedAt);
  }

  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0]?.path.toLowerCase(), "readme.md");
  assert.match(result.documents[0]?.body ?? "", /Queue/i);
  assert.equal(result.documents[0]?.ref, YOCTO_MERGE_SHA);

  const timeline = result.timelines.find((item) => item.issueNumber === 11);
  assert.ok(timeline);
  assert.ok(timeline.events.some((event) => event.event === "cross-referenced"));
  assert.ok(timeline.events.some((event) => event.event === "closed"));

  for (const source of [
    "issues",
    "pullRequests",
    "comments",
    "reviews",
    "commits",
    "changedFiles",
    "documents",
    "timelines",
  ] as const) {
    assert.equal(result.coverage.sources[source]?.status, "complete", source);
  }
  assert.equal(result.coverage.limits.headSha, YOCTO_MERGE_SHA);
  assert.equal(result.fetchedAt, "2026-10-31T00:00:00.000Z");

  const routeNames = new Set(api.calls.map((call) => call.route));
  assert.ok(routeNames.has("GET /repos/{owner}/{repo}/pulls/{pull_number}/files"));
  assert.ok(routeNames.has("GET /repos/{owner}/{repo}/issues/{issue_number}/timeline"));
  assert.ok(routeNames.has("GET /repos/{owner}/{repo}/readme"));
});

test("bounded configuration skips optional review sources and discloses partial coverage", async () => {
  const api = yoctoQueueApi();
  const clock = new TestClock();
  const result = await collectGithubRepository(
    api,
    testConfig({
      includeReviews: false,
      includeReviewComments: false,
      includePullRequestThreadComments: false,
    }),
    { clock, sleep: testSleep(clock).sleep },
  );
  assert.equal(api.counts.get("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews") ?? 0, 0);
  assert.equal(api.counts.get("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments") ?? 0, 0);
  assert.equal(api.counts.get("GET /repos/{owner}/{repo}/issues/{issue_number}/comments"), 1);
  assert.equal(result.coverage.sources.reviews?.status, "partial");
  assert.equal(result.coverage.sources.comments?.status, "partial");
  assert.equal(result.coverage.sources.reviews?.capHit, true);
  assert.ok(
    result.coverage.sources.reviews?.warnings.some((warning) => /skipped/.test(warning)),
  );
  assert.ok(
    result.coverage.sources.comments?.warnings.some((warning) => /skipped/.test(warning)),
  );
  assert.equal(result.issues.length, 1);
  assert.equal(result.pullRequests.length, 1);
  assert.equal(result.closingReferences[0]?.confirmed, true);
});

test("duplicate import of the same public source produces identical stable hashes", async () => {
  const first = await collectGithubRepository(yoctoQueueApi(), testConfig(), {
    clock: new TestClock(),
    sleep: testSleep(new TestClock()).sleep,
  });
  const second = await collectGithubRepository(yoctoQueueApi(), testConfig(), {
    clock: new TestClock(),
    sleep: testSleep(new TestClock()).sleep,
  });
  assert.equal(first.issues[0]?.id, second.issues[0]?.id);
  assert.equal(first.issues[0]?.contentSha, second.issues[0]?.contentSha);
  assert.equal(first.pullRequests[0]?.contentSha, second.pullRequests[0]?.contentSha);
  assert.deepEqual(
    first.comments.map((comment) => comment.contentSha),
    second.comments.map((comment) => comment.contentSha),
  );
  assert.deepEqual(
    first.pullRequestCommits[0]?.commits.map((commit) => commit.contentSha),
    second.pullRequestCommits[0]?.commits.map((commit) => commit.contentSha),
  );
  assert.deepEqual(
    first.pullRequestFiles[0]?.files.map((file) => file.contentSha),
    second.pullRequestFiles[0]?.files.map((file) => file.contentSha),
  );
});

function readmeRaw(): Record<string, unknown> {
  const body = "# Fixture\n\nA small public queue.\n";
  return {
    type: "file",
    encoding: "base64",
    content: Buffer.from(body, "utf8").toString("base64"),
    size: Buffer.byteLength(body),
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    path: "README.md",
    html_url: "https://github.com/sindresorhus/yocto-queue/blob/main/README.md",
  };
}

function pagedIssueApi(input: {
  page1: unknown[];
  page2: unknown[];
}): FakeGithubApi {
  return new FakeGithubApi()
    .on("GET /repos/{owner}/{repo}", () => ok(repositoryRaw()))
    .on("GET /repos/{owner}/{repo}/issues", (params) =>
      ok(params.page === 1 ? input.page1 : params.page === 2 ? input.page2 : []),
    )
    .on("GET /repos/{owner}/{repo}/readme", () => ok(readmeRaw()));
}

test("paginates, deduplicates, and reports a truthful cap", async () => {
  const page1 = Array.from({ length: 100 }, (_, index) =>
    issueRaw({ id: 10_000 + index, number: index + 1 }),
  );
  const page2 = [issueRaw({ id: 10_000, number: 1 }), issueRaw({ id: 20_000, number: 500 })];
  const api = pagedIssueApi({ page1, page2 });
  const result = await collectGithubRepository(
    api,
    testConfig({
      focusIssueNumbers: [],
      focusPullRequestNumbers: [],
      issueState: "all",
      limits: {
        ...testConfig().limits,
        maxIssues: 150,
        maxPullRequests: 1,
        maxPages: 2,
        maxIssuesWithComments: 0,
      },
    }),
    { clock: new TestClock(), sleep: testSleep(new TestClock()).sleep },
  );
  assert.equal(result.issues.length, 101);
  assert.equal(new Set(result.issues.map((issue) => issue.id)).size, 101);
  assert.equal(result.coverage.sources.issues?.status, "complete");
  assert.equal(result.coverage.sources.issues?.items, 101);

  const cappedApi = pagedIssueApi({ page1, page2: [] });
  const capped = await collectGithubRepository(
    cappedApi,
    testConfig({
      focusIssueNumbers: [],
      focusPullRequestNumbers: [],
      limits: {
        ...testConfig().limits,
        maxIssues: 5,
        maxPullRequests: 1,
        maxPages: 1,
        maxIssuesWithComments: 0,
      },
    }),
    { clock: new TestClock(), sleep: testSleep(new TestClock()).sleep },
  );
  assert.equal(capped.issues.length, 5);
  assert.equal(capped.coverage.sources.issues?.status, "partial");
  assert.equal(capped.coverage.sources.issues?.capHit, true);
});

test("retries transient failures with bounded backoff", async () => {
  let repoAttempts = 0;
  const api = new FakeGithubApi()
    .on("GET /repos/{owner}/{repo}", () => {
      repoAttempts += 1;
      if (repoAttempts < 3) {
        throw new GithubApiError(500, "temporary outage");
      }
      return ok(repositoryRaw());
    })
    .on("GET /repos/{owner}/{repo}/issues", () => ok([]))
    .on("GET /repos/{owner}/{repo}/readme", () => ok(readmeRaw()));
  const clock = new TestClock();
  const { sleep, sleeps } = testSleep(clock);
  const result = await collectGithubRepository(
    api,
    testConfig({
      focusIssueNumbers: [],
      focusPullRequestNumbers: [],
      retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, maxRateLimitWaitMs: 1_000 },
    }),
    { clock, sleep, random: () => 0 },
  );
  assert.equal(result.repository.id, 315531538);
  assert.equal(repoAttempts, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("honors retry-after and refuses a rate-limit wait beyond the configured budget", async () => {
  let attempts = 0;
  const retryApi = new FakeGithubApi()
    .on("GET /repos/{owner}/{repo}", () => {
      attempts += 1;
      if (attempts === 1) {
        throw new GithubApiError(429, "slow down", { "retry-after": "1" });
      }
      return ok(repositoryRaw());
    })
    .on("GET /repos/{owner}/{repo}/issues", () => ok([]))
    .on("GET /repos/{owner}/{repo}/readme", () => ok(readmeRaw()));
  const clock = new TestClock();
  const { sleep, sleeps } = testSleep(clock);
  const result = await collectGithubRepository(
    retryApi,
    testConfig({
      focusIssueNumbers: [],
      focusPullRequestNumbers: [],
      retry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 10, maxRateLimitWaitMs: 2_000 },
    }),
    { clock, sleep, random: () => 0 },
  );
  assert.equal(result.repository.id, 315531538);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [1_000]);

  const reset = Math.floor(clock.now() / 1000) + 3_600;
  const blockedApi = new FakeGithubApi().on("GET /repos/{owner}/{repo}", () => {
    throw new GithubApiError(403, "API rate limit exceeded", {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(reset),
    });
  });
  await assert.rejects(
    collectGithubRepository(
      blockedApi,
      testConfig({ focusIssueNumbers: [], focusPullRequestNumbers: [] }),
      { clock, sleep: testSleep(clock).sleep },
    ),
    (error: unknown) =>
      error instanceof HistoryError &&
      error.code === "GITHUB_RATE_LIMITED" &&
      typeof error.details.retryAt === "string",
  );
});

test("keeps other sources when one PR source is unavailable", async () => {
  const api = yoctoQueueApi().on(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
    () => {
      throw new GithubApiError(503, "files endpoint unavailable");
    },
  );
  const clock = new TestClock();
  const result = await collectGithubRepository(api, testConfig(), {
    clock,
    sleep: testSleep(clock).sleep,
  });
  assert.equal(result.pullRequests.length, 1);
  assert.equal(result.closingReferences[0]?.confirmed, true);
  assert.equal(result.pullRequestFiles[0]?.files.length, 0);
  assert.equal(result.coverage.sources.changedFiles?.status, "failed");
  assert.ok(result.warnings.some((warning) => warning.includes("changed files")));
});

test("cancellation stops collection without returning fabricated partial success", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    collectGithubRepository(yoctoQueueApi(), testConfig(), {
      signal: controller.signal,
      clock: new TestClock(),
      sleep: testSleep(new TestClock()).sleep,
    }),
    (error: unknown) =>
      error instanceof HistoryError && error.code === "COLLECTION_CANCELLED",
  );

  const midController = new AbortController();
  const api = yoctoQueueApi().on(
    "GET /repos/{owner}/{repo}/issues/{issue_number}",
    () => {
      midController.abort();
      return ok(yoctoQueueFixture().issue);
    },
  );
  await assert.rejects(
    collectGithubRepository(api, testConfig(), {
      signal: midController.signal,
      clock: new TestClock(),
      sleep: testSleep(new TestClock()).sleep,
    }),
    (error: unknown) =>
      error instanceof HistoryError && error.code === "COLLECTION_CANCELLED",
  );
});

test("stops at the time budget and reports partial coverage", async () => {
  const clock = new TestClock();
  const api = yoctoQueueApi().on(
    "GET /repos/{owner}/{repo}/issues/{issue_number}",
    () => {
      clock.advance(1_000);
      return ok(yoctoQueueFixture().issue);
    },
  );
  const result = await collectGithubRepository(
    api,
    testConfig({
      limits: { ...testConfig().limits, timeBudgetMs: 100 },
    }),
    { clock, sleep: testSleep(clock).sleep },
  );
  assert.equal(result.issues.length, 1);
  assert.equal(result.pullRequests.length, 0);
  assert.ok(result.warnings.some((warning) => /time budget/i.test(warning)));
  assert.notEqual(result.coverage.sources.pullRequests?.status, "complete");
});

