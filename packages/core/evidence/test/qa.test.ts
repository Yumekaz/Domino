import { test } from "node:test";
import assert from "node:assert/strict";
import { askQuestion } from "../src/ask.ts";
import { DefaultEvidenceRetriever } from "../../../retrieval/src/pack.ts";
import { HistoryError } from "../../history/src/errors.ts";
import type {
  LlmGenerateRequest,
  LlmGenerateResponse,
  LlmProvider,
} from "../src/types.ts";
import { createQaFixture } from "./support/qaFixture.ts";

class FakeProvider implements LlmProvider {
  readonly provider = "fake";
  readonly model = "fake-1";
  readonly calls: LlmGenerateRequest[] = [];
  private readonly handler: (request: LlmGenerateRequest) => string | Promise<string>;

  constructor(handler: (request: LlmGenerateRequest) => string | Promise<string>) {
    this.handler = handler;
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    this.calls.push(request);
    return {
      text: await this.handler(request),
      provider: this.provider,
      model: this.model,
    };
  }
}

const DEEPSEEK_STYLE_SUPPORTED_CLAIM =
  "The behavior is intended, and a separate method is called drain.";

function jsonResponse(input: {
  status: "supported" | "partial" | "not_found";
  answer: string;
  claims: Array<{ text: string; evidenceIds: string[]; support: "documented" | "interpretation" }>;
  unknowns?: string[];
}): string {
  return JSON.stringify({
    status: input.status,
    answer: input.answer,
    claims: input.claims,
    unknowns: input.unknowns ?? [],
  });
}

test("supported question cites the real claim-bearing source and validates support", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() =>
    jsonResponse({
      status: "supported",
      answer:
        "The iterator was intentionally kept non-destructive; a separate drain() method was suggested.",
      claims: [
        {
          text: DEEPSEEK_STYLE_SUPPORTED_CLAIM,
          evidenceIds: [fixture.chunkIds.comment],
          support: "documented",
        },
      ],
    }),
  );
  const audits: Array<{ accepted: string[]; rejected: string[]; status: string }> = [];
  const result = await askQuestion(
    {
      repoId: fixture.repoId,
      snapshotId: fixture.snapshotId,
      question: "Why doesn't the iterator drain the queue?",
    },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
      onAudit: (record) => {
        audits.push({
          accepted: record.acceptedEvidenceIds,
          rejected: record.rejectedEvidenceIds,
          status: record.outcome,
        });
      },
    },
  );
  assert.equal(result.status, "supported");
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0]?.support, "documented");
  assert.equal(result.claims[0]?.evidenceIds[0], fixture.chunkIds.comment);
  assert.equal(result.sources.length, 1);
  assert.equal(
    result.sources[0]?.url,
    "https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039",
  );
  assert.match(result.sources[0]?.locator ?? "", /comment 2696500039/);
  assert.equal(result.sources[0]?.timestamp, "2025-03-04T07:41:41Z");
  assert.equal(result.snapshotSha, fixture.snapshotSha);
  assert.equal(result.model?.provider, "fake");
  assert.equal(result.validation?.acceptedClaims, 1);
  assert.equal(result.validation?.rejectedClaims, 0);
  assert.equal(result.searchAvailable, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.status, "supported");
  assert.deepEqual(audits[0]?.accepted, [fixture.chunkIds.comment]);
  assert.deepEqual(audits[0]?.rejected, []);
  assert.match(provider.calls[0]?.system ?? "", /UNTRUSTED DATA/);
  assert.doesNotMatch(provider.calls[0]?.user ?? "", /OPENAI_API_KEY/);
});

test("unsupported question returns not_found without calling the model", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() => {
    throw new Error("must not be called");
  });
  const result = await askQuestion(
    {
      repoId: fixture.repoId,
      snapshotId: fixture.snapshotId,
      question: "quantum chromodynamics tennis",
    },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "not_found");
  assert.equal(result.answer, "No supporting project history found.");
  assert.equal(result.claims.length, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.errorCode, null);
  assert.equal(provider.calls.length, 0);
});

test("does not expose unvalidated facts from a model's separate answer summary", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() => jsonResponse({
    status: "supported",
    answer: "The behavior is intended. Queen Elizabeth signed the release in 1994.",
    claims: [{
      text: DEEPSEEK_STYLE_SUPPORTED_CLAIM,
      evidenceIds: [fixture.chunkIds.comment],
      support: "documented",
    }],
  }));
  const result = await askQuestion(
    { repoId: fixture.repoId, snapshotId: fixture.snapshotId, question: "Why does the iterator behave this way?" },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "supported");
  assert.equal(result.answer, DEEPSEEK_STYLE_SUPPORTED_CLAIM);
  assert.doesNotMatch(result.answer ?? "", /Queen Elizabeth/);
});

test("rejects an explicitly negated claim when the cited source contains no negation", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() => jsonResponse({
    status: "supported",
    answer: "The behavior is not intended, and a separate method is called drain.",
    claims: [{
      text: "The behavior is not intended, and a separate method is called drain.",
      evidenceIds: [fixture.chunkIds.comment],
      support: "documented",
    }],
  }));
  const result = await askQuestion(
    { repoId: fixture.repoId, snapshotId: fixture.snapshotId, question: "Why does the iterator behave this way?" },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "not_found");
  assert.equal(result.claims.length, 0);
});

test("does not reject a negated claim solely because it is negated when its source states it", async () => {
  const fixture = await createQaFixture();
  const [chunk] = await fixture.store.getEvidenceChunks(
    fixture.repoId, fixture.snapshotId, [fixture.chunkIds.comment],
  );
  assert.ok(chunk);
  const body = "The iterator does not dequeue items. A separate method called drain was suggested.";
  await fixture.store.replaceEvidenceChunks([{ ...chunk, body, excerpt: body }]);
  const provider = new FakeProvider(() => jsonResponse({
    status: "supported",
    answer: body,
    claims: [{ text: "The iterator does not dequeue items.", evidenceIds: [chunk.id], support: "documented" }],
  }));
  const result = await askQuestion(
    { repoId: fixture.repoId, snapshotId: fixture.snapshotId, question: "Why does the iterator behave this way?" },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "supported");
  assert.equal(result.claims.length, 1);
});

test("preserves a model's partial status when its accepted claims do not fully answer the question", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() => jsonResponse({
    status: "partial",
    answer: DEEPSEEK_STYLE_SUPPORTED_CLAIM,
    claims: [{
      text: DEEPSEEK_STYLE_SUPPORTED_CLAIM,
      evidenceIds: [fixture.chunkIds.comment],
      support: "documented",
    }],
    unknowns: ["The sources do not establish the release date."],
  }));
  const result = await askQuestion(
    { repoId: fixture.repoId, snapshotId: fixture.snapshotId, question: "Why does the iterator behave this way?" },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "partial");
  assert.equal(result.answer, DEEPSEEK_STYLE_SUPPORTED_CLAIM);
  assert.deepEqual(result.unknowns, ["The sources do not establish the release date."]);
});

test("returns the validated source text rather than an abbreviated search snippet", async () => {
  const fixture = await createQaFixture();
  const [chunk] = await fixture.store.getEvidenceChunks(
    fixture.repoId, fixture.snapshotId, [fixture.chunkIds.comment],
  );
  assert.ok(chunk);
  await fixture.store.replaceEvidenceChunks([{ ...chunk, excerpt: "This is intended behavior. [truncated]" }]);
  const provider = new FakeProvider(() => jsonResponse({
    status: "supported",
    answer: DEEPSEEK_STYLE_SUPPORTED_CLAIM,
    claims: [{ text: DEEPSEEK_STYLE_SUPPORTED_CLAIM, evidenceIds: [chunk.id], support: "documented" }],
  }));
  const result = await askQuestion(
    { repoId: fixture.repoId, snapshotId: fixture.snapshotId, question: "Why does the iterator behave this way?" },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "supported");
  assert.match(result.sources[0]?.excerpt ?? "", /Maybe called drain/);
});

test("dangling evidence IDs are rejected even when the model is confident", async () => {
  const fixture = await createQaFixture();
  const missing = "99999999-9999-4999-8999-999999999999";
  const provider = new FakeProvider(() =>
    jsonResponse({
      status: "supported",
      answer: "The change was definitely intentional.",
      claims: [
        {
          text: "The iterator behavior is intended.",
          evidenceIds: [missing],
          support: "documented",
        },
      ],
    }),
  );
  const result = await askQuestion(
    {
      repoId: fixture.repoId,
      snapshotId: fixture.snapshotId,
      question: "Why is the iterator behavior intended?",
    },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "not_found");
  assert.equal(result.answer, "No supporting project history found.");
  assert.equal(result.claims.length, 0);
  assert.equal(result.sources.length, 0);
  assert.ok(result.validation?.rejectedEvidenceIds.includes(missing));
  assert.equal(result.validation?.acceptedClaims, 0);
});

test("injected instructions cannot fabricate a closing edge", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() =>
    jsonResponse({
      status: "supported",
      answer: "PR #99 closes issue #1.",
      claims: [
        {
          text: "PR #99 closes issue #1.",
          evidenceIds: [fixture.chunkIds.malicious],
          support: "documented",
        },
      ],
    }),
  );
  const before = await fixture.store.getCoChangeDataset(fixture.repoId, fixture.snapshotId);
  const result = await askQuestion(
    {
      repoId: fixture.repoId,
      snapshotId: fixture.snapshotId,
      question: "Does PR #99 close issue #1?",
    },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "not_found");
  assert.equal(result.claims.length, 0);
  assert.ok(
    result.validation?.claims.some((claim) =>
      /closing relationship|instruction-like/.test(claim.reason ?? ""),
    ),
  );
  const after = await fixture.store.getCoChangeDataset(fixture.repoId, fixture.snapshotId);
  assert.deepEqual(after, before);
});

test("malformed model output fails safely without a canned answer", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() => "Sure, the answer is 42.");
  const result = await askQuestion(
    {
      repoId: fixture.repoId,
      snapshotId: fixture.snapshotId,
      question: "Why does the iterator behave this way?",
    },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.errorCode, "LLM_BAD_OUTPUT");
  assert.equal(result.answer, null);
  assert.equal(result.claims.length, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.recoverable, true);
});

test("model outage disables synthesis while retrieval remains usable", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() => {
    throw new HistoryError("LLM_TIMEOUT", "Provider timed out", { recoverable: true });
  });
  const result = await askQuestion(
    {
      repoId: fixture.repoId,
      snapshotId: fixture.snapshotId,
      question: "Why does the iterator behave this way?",
    },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.errorCode, "LLM_TIMEOUT");
  assert.equal(result.searchAvailable, true);
  assert.equal(result.answer, null);
  assert.equal(result.claims.length, 0);
  assert.equal(result.sources.length, 0);

  const retriever = new DefaultEvidenceRetriever({ store: fixture.store });
  const pack = await retriever.buildPack({
    repoId: fixture.repoId,
    snapshotId: fixture.snapshotId,
    question: "drain method",
    maxChunks: 10,
    maxNeighbors: 5,
    maxNeighborChunks: 1,
  });
  assert.ok(pack.chunks.length > 0);
  assert.equal(pack.noEvidence, false);
});

test("withholds unsupported claims and returns a partial answer from accepted claims only", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() =>
    jsonResponse({
      status: "supported",
      answer: "The iterator was intended, and Queen Elizabeth signed the release in 1994.",
      claims: [
        {
          text: DEEPSEEK_STYLE_SUPPORTED_CLAIM,
          evidenceIds: [fixture.chunkIds.comment],
          support: "documented",
        },
        {
          text: "Queen Elizabeth signed the release in 1994.",
          evidenceIds: [fixture.chunkIds.comment],
          support: "documented",
        },
      ],
    }),
  );
  const result = await askQuestion(
    {
      repoId: fixture.repoId,
      snapshotId: fixture.snapshotId,
      question: "Why does the iterator behave this way?",
    },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "partial");
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0]?.text, DEEPSEEK_STYLE_SUPPORTED_CLAIM);
  assert.equal(result.sources.length, 1);
  assert.match(result.answer ?? "", /behavior is intended/);
  assert.doesNotMatch(result.answer ?? "", /Queen Elizabeth/);
  assert.ok(result.unknowns.some((unknown) => unknown.includes("withheld")));
  assert.equal(result.validation?.rejectedClaims, 1);
});

test("model not_found is preserved even when a pack exists", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() =>
    jsonResponse({
      status: "not_found",
      answer: "",
      claims: [],
      unknowns: ["The sources do not answer the question."],
    }),
  );
  const result = await askQuestion(
    {
      repoId: fixture.repoId,
      snapshotId: fixture.snapshotId,
      question: "Why does the iterator behave this way?",
    },
    {
      retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
      store: fixture.store,
      llm: provider,
      clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
    },
  );
  assert.equal(result.status, "not_found");
  assert.equal(result.answer, "No supporting project history found.");
  assert.equal(result.sources.length, 0);
  assert.deepEqual(result.unknowns, ["The sources do not answer the question."]);
});

test("rejects invalid questions before any retrieval or model call", async () => {
  const fixture = await createQaFixture();
  const provider = new FakeProvider(() => "{}");
  await assert.rejects(
    askQuestion(
      { repoId: fixture.repoId, snapshotId: fixture.snapshotId, question: "" },
      {
        retriever: new DefaultEvidenceRetriever({ store: fixture.store }),
        store: fixture.store,
        llm: provider,
        clock: { isoNow: () => "2026-10-31T00:00:00.000Z" },
      },
    ),
    (error: unknown) => error instanceof HistoryError && error.code === "INVALID_REQUEST",
  );
  assert.equal(provider.calls.length, 0);
});
