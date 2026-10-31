import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkSource, chunkText } from "../src/chunk.ts";

const REPO = "11111111-1111-5111-8111-111111111111";
const SNAPSHOT = "22222222-2222-5222-8222-222222222222";
const ENTITY = "33333333-3333-5333-8333-333333333333";
const SHA = "d631ea87f49443c4c8dbf84fd79bf600d11a5fac";

test("chunks small text with exact line locators", () => {
  const text = "Line one.\nLine two.\nLine three.";
  const chunks = chunkText(text, { maxChars: 900, overlapChars: 0, maxChunks: 10 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.text, text);
  assert.equal(chunks[0]?.lineStart, 1);
  assert.equal(chunks[0]?.lineEnd, 3);
});

test("splits long text into bounded chunks with overlap and line coverage", () => {
  const paragraphs = Array.from(
    { length: 30 },
    (_, index) => `Paragraph ${index + 1} explains the authentication decision and its consequences.`,
  );
  const text = paragraphs.join("\n\n");
  const chunks = chunkText(text, { maxChars: 220, overlapChars: 40, maxChunks: 100 });
  assert.ok(chunks.length > 2);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 220, `chunk length ${chunk.text.length}`);
    assert.ok(chunk.lineStart >= 1);
    assert.ok(chunk.lineEnd >= chunk.lineStart);
  }
  assert.equal(chunks[0]?.lineStart, 1);
  assert.equal(chunks.at(-1)?.charEnd, text.length);
  assert.equal(chunks.at(-1)?.lineEnd, text.split("\n").length);
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index].charStart < chunks[index - 1].charEnd);
    assert.ok(chunks[index].charStart > chunks[index - 1].charStart);
  }
});

test("splits an oversized single line without losing coverage", () => {
  const text = "x".repeat(1_000);
  const chunks = chunkText(text, { maxChars: 300, overlapChars: 0, maxChunks: 10 });
  assert.ok(chunks.length >= 4);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), text);
  assert.equal(chunks.every((chunk) => chunk.lineStart === 1 && chunk.lineEnd === 1), true);
});

test("honors maxChunks and exposes a truncated marker on the last chunk", () => {
  const lines = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`);
  const chunks = chunkSource(
    {
      repoId: REPO,
      snapshotId: SNAPSHOT,
      entityId: ENTITY,
      entityKind: "Issue",
      sourceKind: "issue",
      sourceId: "11",
      sourceUrl: "https://github.com/sindresorhus/yocto-queue/issues/11",
      title: "Iterator behavior",
      body: lines.join("\n"),
      locatorPrefix: "Issue #11",
      sourceTimestamp: "2025-03-06T12:27:37Z",
      revision: SHA,
      metadata: { number: 11 },
    },
    { maxChars: 120, overlapChars: 0, maxChunks: 2 },
  );
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1]?.metadata.sourceTruncated, true);
  assert.equal(chunks[0]?.sourceUrl, "https://github.com/sindresorhus/yocto-queue/issues/11");
  assert.match(chunks[0]?.locator ?? "", /^Issue #11 lines /);
  assert.match(chunks[0]?.id ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(chunks[0]?.contentSha.length, 64);
  assert.equal(chunks[0]?.revision, SHA);
});

test("uses a title-only source and rejects invalid evidence URLs", () => {
  const chunks = chunkSource({
    repoId: REPO,
    snapshotId: SNAPSHOT,
    entityId: ENTITY,
    entityKind: "PullRequest",
    sourceKind: "pull_request",
    sourceId: "12",
    sourceUrl: "https://github.com/sindresorhus/yocto-queue/pull/12",
    title: "Add drain method",
    body: "",
    locatorPrefix: "PR #12",
    sourceTimestamp: null,
    revision: SHA,
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.body, "Add drain method");
  assert.throws(
    () =>
      chunkSource({
        repoId: REPO,
        snapshotId: SNAPSHOT,
        entityId: ENTITY,
        entityKind: "Issue",
        sourceKind: "issue",
        sourceId: "13",
        sourceUrl: "http://example.com/issue",
        title: "x",
        body: "x",
        locatorPrefix: "Issue #13",
        sourceTimestamp: null,
        revision: SHA,
      }),
    /HTTPS/,
  );
});

test("is deterministic for identical sources", () => {
  const input = {
    repoId: REPO,
    snapshotId: SNAPSHOT,
    entityId: ENTITY,
    entityKind: "DiscussionComment" as const,
    sourceKind: "issue_comment",
    sourceId: "2696500039",
    sourceUrl:
      "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039",
    title: "Comment on #11",
    body: "This is intended behavior. It should be a separate method. Maybe called drain().",
    locatorPrefix: "Issue #11 comment 2696500039",
    sourceTimestamp: "2025-03-04T07:41:41Z",
    revision: SHA,
  };
  const first = chunkSource(input);
  const second = chunkSource(input);
  assert.deepEqual(first, second);
});
