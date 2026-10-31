import { test } from "node:test";
import assert from "node:assert/strict";
import { collectGithubRepository } from "../src/collect.ts";
import { createOctokitApiFromEnv } from "../src/octokitApi.ts";
import { realClock, realSleep } from "../src/http.ts";
import { testConfig } from "./support/fakeGithub.ts";

const live = process.env.DOMINO_LIVE_GITHUB === "1";

test(
  "LIVE: collects the real yocto-queue issue/PR chain and confirmed closing metadata",
  { skip: !live, timeout: 180_000 },
  async () => {
    const result = await collectGithubRepository(
      createOctokitApiFromEnv(),
      testConfig({
        headSha: "d631ea87f49443c4c8dbf84fd79bf600d11a5fac",
        focusIssueNumbers: [11],
        focusPullRequestNumbers: [12],
        limits: {
          ...testConfig().limits,
          timeBudgetMs: 120_000,
        },
      }),
      { clock: realClock, sleep: realSleep },
    );
    assert.equal(result.repository.id, 315531538);
    assert.equal(result.repository.fullName, "sindresorhus/yocto-queue");
    const issue = result.issues.find((item) => item.number === 11);
    assert.ok(issue);
    assert.equal(issue.id, 2891449053);
    assert.equal(issue.state, "closed");
    const pullRequest = result.pullRequests.find((item) => item.number === 12);
    assert.ok(pullRequest);
    assert.equal(pullRequest.mergeCommitSha, "d631ea87f49443c4c8dbf84fd79bf600d11a5fac");
    assert.equal(pullRequest.headSha, "87d4a591b6584b9120a16daea822c919ff36c1ee");
    const rationale = result.comments.find((comment) => comment.id === 2696500039);
    assert.ok(rationale);
    assert.match(rationale.body, /intended behavior/i);
    assert.match(rationale.body, /drain/);
    const closing = result.closingReferences.find(
      (reference) => reference.prNumber === 12 && reference.issueNumber === 11,
    );
    assert.ok(closing);
    assert.equal(closing.confirmed, true);
    assert.equal(closing.confirmation.method, "cross_reference_and_issue_closed");
    assert.ok(result.pullRequestFiles[0]?.files.some((file) => file.filename === "index.js"));
    assert.ok(result.documents.some((document) => document.path.toLowerCase() === "readme.md"));
    assert.equal(result.coverage.sources.issues?.status, "complete");
    assert.equal(result.coverage.sources.pullRequests?.status, "complete");
    assert.equal(result.coverage.sources.timelines?.status, "complete");
  },
);
