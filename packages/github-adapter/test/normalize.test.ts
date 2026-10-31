import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClosingReference,
  normalizeChangedFile,
  normalizeDocument,
  normalizeSourceIssue,
  normalizeSourcePullRequest,
  normalizeSourceRepository,
  parseClosingKeywords,
} from "../src/normalize.ts";
import { HistoryError } from "../../core/history/src/errors.ts";
import {
  yoctoQueueFixture,
} from "./support/fakeGithub.ts";
import { GithubApiError, withGithubRetry } from "../src/http.ts";
import { TestClock, testSleep } from "./support/fakeGithub.ts";
import type { SourceIssue } from "../../core/history/src/source.ts";

const fixture = yoctoQueueFixture();

test("normalizes real public issue, PR and repository data with stable identities", () => {
  const repository = normalizeSourceRepository(fixture.repository, {
    owner: "sindresorhus",
    repo: "yocto-queue",
  });
  assert.equal(repository.id, 315531538);
  assert.equal(repository.defaultBranch, "main");
  assert.equal(repository.visibility, "public");
  assert.equal(repository.licenseSpdx, "MIT");

  const issue = normalizeSourceIssue(fixture.issue, "sindresorhus", "yocto-queue");
  assert.equal(issue.id, 2891449053);
  assert.equal(issue.number, 11);
  assert.equal(issue.state, "closed");
  assert.equal(issue.closedByLogin, "sindresorhus");
  assert.equal(issue.closedAt, "2025-03-06T12:27:37Z");
  assert.match(issue.title, /Iterator doesn't update size/);
  assert.match(issue.body, /doesn't update the internals/);

  const pullRequest = normalizeSourcePullRequest(
    fixture.pullRequest,
    "sindresorhus",
    "yocto-queue",
  );
  assert.equal(pullRequest.number, 12);
  assert.equal(pullRequest.headSha, "87d4a591b6584b9120a16daea822c919ff36c1ee");
  assert.equal(pullRequest.baseSha, "0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b");
  assert.equal(pullRequest.mergeCommitSha, "d631ea87f49443c4c8dbf84fd79bf600d11a5fac");
  assert.equal(pullRequest.mergedAt, "2025-03-06T12:27:36Z");
  assert.match(pullRequest.body, /Fixes #11/);
});

test("rejects private/mismatched repositories and PR objects masquerading as issues", () => {
  const privateRepo = {
    ...(fixture.repository as Record<string, unknown>),
    visibility: "private",
    private: true,
  };
  assert.throws(
    () =>
      normalizeSourceRepository(privateRepo, {
        owner: "sindresorhus",
        repo: "yocto-queue",
      }),
    (error: unknown) =>
      error instanceof HistoryError && error.code === "REPO_NOT_PUBLIC",
  );
  const mismatched = {
    ...(fixture.repository as Record<string, unknown>),
    full_name: "someone/else",
    name: "else",
  };
  assert.throws(
    () =>
      normalizeSourceRepository(mismatched, {
        owner: "sindresorhus",
        repo: "yocto-queue",
      }),
    (error: unknown) =>
      error instanceof HistoryError && error.code === "UNSUPPORTED_REMOTE",
  );
  assert.throws(
    () => normalizeSourceIssue(fixture.pullRequest, "sindresorhus", "yocto-queue"),
    (error: unknown) =>
      error instanceof HistoryError && error.code === "GITHUB_UNAVAILABLE",
  );
});

test("rejects unsafe paths and oversized documents", () => {
  assert.throws(
    () =>
      normalizeChangedFile(
        {
          filename: "../escape.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          sha: "a".repeat(40),
          raw_url: "https://github.com/sindresorhus/yocto-queue/raw/main/x",
          patch: "x",
        },
        "sindresorhus",
        "yocto-queue",
      ),
    (error: unknown) => error instanceof HistoryError && error.code === "INVALID_PATH",
  );

  const content = Buffer.from("hello", "utf8").toString("base64");
  const document = normalizeDocument(
    {
      type: "file",
      encoding: "base64",
      content,
      size: 5,
      sha: "a".repeat(40),
      path: "docs/decision.md",
      html_url:
        "https://github.com/sindresorhus/yocto-queue/blob/d631ea87f49443c4c8dbf84fd79bf600d11a5fac/docs/decision.md",
    },
    {
      owner: "sindresorhus",
      repo: "yocto-queue",
      path: "docs/decision.md",
      ref: "d631ea87f49443c4c8dbf84fd79bf600d11a5fac",
      maxBytes: 10,
    },
  );
  assert.equal(document.body, "hello");
  assert.throws(
    () =>
      normalizeDocument(
        {
          type: "file",
          encoding: "base64",
          content,
          size: 5,
          sha: "a".repeat(40),
          path: "docs/decision.md",
          html_url:
            "https://github.com/sindresorhus/yocto-queue/blob/d631ea87f49443c4c8dbf84fd79bf600d11a5fac/docs/decision.md",
        },
        {
          owner: "sindresorhus",
          repo: "yocto-queue",
          path: "docs/decision.md",
          ref: "d631ea87f49443c4c8dbf84fd79bf600d11a5fac",
          maxBytes: 2,
        },
      ),
    (error: unknown) => error instanceof HistoryError && error.code === "CHECKOUT_TOO_LARGE",
  );
});

test("closing keywords stay references unless the API confirms the close", () => {
  const body = "Fixes #11\nAlso closes https://github.com/sindresorhus/yocto-queue/issues/12";
  const keywords = parseClosingKeywords(body, "sindresorhus", "yocto-queue");
  assert.deepEqual(
    keywords.map((keyword) => keyword.issueNumber),
    [11, 12],
  );
  assert.deepEqual(
    parseClosingKeywords("Closes https://github.com/other/project/issues/4", "sindresorhus", "yocto-queue"),
    [],
  );

  const issue = normalizeSourceIssue(fixture.issue, "sindresorhus", "yocto-queue");
  const confirmed = buildClosingReference({
    prNumber: 12,
    issueNumber: 11,
    keyword: "Fixes",
    excerpt: "Fixes #11",
    prUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
    issue,
    prMergedAt: "2025-03-06T12:27:36Z",
    timeline: [
      {
        event: "cross-referenced",
        id: 1,
        actorLogin: "victor141516",
        createdAt: "2025-03-03T14:48:11Z",
        commitId: null,
        sourceNumber: 12,
        sourceIsPullRequest: true,
        sourceMergedAt: "2025-03-06T12:27:36Z",
      },
      {
        event: "closed",
        id: 2,
        actorLogin: "sindresorhus",
        createdAt: "2025-03-06T12:27:38Z",
        commitId: null,
        sourceNumber: null,
        sourceIsPullRequest: false,
        sourceMergedAt: null,
      },
    ],
  });
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.confirmation.method, "cross_reference_and_issue_closed");

  const openIssue: SourceIssue = {
    ...issue,
    state: "open",
    closedAt: null,
    closedByLogin: null,
  };
  const unconfirmedOpen = buildClosingReference({
    prNumber: 12,
    issueNumber: 11,
    keyword: "Fixes",
    excerpt: "Fixes #11",
    prUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
    issue: openIssue,
    prMergedAt: "2025-03-06T12:27:36Z",
    timeline: [],
  });
  assert.equal(unconfirmedOpen.confirmed, false);
  assert.equal(unconfirmedOpen.confirmation.method, "unconfirmed");

  const closedBeforeMerge = buildClosingReference({
    prNumber: 12,
    issueNumber: 11,
    keyword: "Fixes",
    excerpt: "Fixes #11",
    prUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
    issue: { ...issue, closedAt: "2025-03-01T00:00:00Z" },
    prMergedAt: "2025-03-06T12:27:36Z",
    timeline: [
      {
        event: "cross-referenced",
        id: 1,
        actorLogin: "victor141516",
        createdAt: "2025-03-03T14:48:11Z",
        commitId: null,
        sourceNumber: 12,
        sourceIsPullRequest: true,
        sourceMergedAt: "2025-03-06T12:27:36Z",
      },
    ],
  });
  assert.equal(closedBeforeMerge.confirmed, false);
});

test("retry policy handles auth, 404 and permission errors without endless retries", async () => {
  const clock = new TestClock();
  const { sleep } = testSleep(clock);
  await assert.rejects(
    withGithubRetry(
      async () => {
        throw new GithubApiError(401, "Bad credentials");
      },
      { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 1, maxRateLimitWaitMs: 10 },
      { clock, sleep },
      undefined,
    ),
    (error: unknown) => error instanceof HistoryError && error.code === "GITHUB_AUTH_REQUIRED",
  );
  await assert.rejects(
    withGithubRetry(
      async () => {
        throw new GithubApiError(404, "Not Found");
      },
      { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 1, maxRateLimitWaitMs: 10 },
      { clock, sleep },
      undefined,
    ),
    (error: unknown) => error instanceof GithubApiError && error.status === 404,
  );
  let forbiddenAttempts = 0;
  await assert.rejects(
    withGithubRetry(
      async () => {
        forbiddenAttempts += 1;
        throw new GithubApiError(403, "Resource not accessible by integration");
      },
      { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 1, maxRateLimitWaitMs: 10 },
      { clock, sleep },
      undefined,
    ),
    (error: unknown) => error instanceof GithubApiError && error.status === 403,
  );
  assert.equal(forbiddenAttempts, 1);
});
