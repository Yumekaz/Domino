import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestStore } from "../support/testStore.ts";
import { runHistoryImport } from "../../../../apps/worker/src/handlers/history/pipeline.ts";
import { createOctokitApiFromEnv } from "../../../github-adapter/src/octokitApi.ts";
import { checkoutRepository } from "../../../git-adapter/src/checkout.ts";
import { analyzeGitHistory } from "../../../git-adapter/src/history.ts";
import {
  canonicalCommitKey,
  canonicalIssueKey,
  canonicalPullRequestKey,
  entityId,
  snapshotId as deterministicSnapshotId,
} from "../../../core/history/src/ids.ts";
import { computeCoChange } from "../../../core/history/src/cochange.ts";
import { computeKnowledgeRisk } from "../../../core/knowledge-risk/src/risk.ts";
import { DefaultEvidenceRetriever } from "../../src/pack.ts";
import { askQuestion } from "../../../core/evidence/src/ask.ts";
import { HistoryError } from "../../../core/history/src/errors.ts";
import type {
  LlmGenerateRequest,
  LlmGenerateResponse,
  LlmProvider,
} from "../../../core/evidence/src/types.ts";
import type { CoverageReport, SourceCoverage } from "../../../core/history/src/types.ts";

const REMOTE = "https://github.com/sindresorhus/yocto-queue";
const MERGE_SHA = "d631ea87f49443c4c8dbf84fd79bf600d11a5fac";
const BASE_SHA = "0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b";
const ISSUE_ID = 2891449053;
const PR_ID = 2368338991;
const HISTORY_DEPTH = 500;
const clock = {
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
};

interface PromptEvidence {
  id: string;
  kind: string;
  text: string;
  url: string;
  locator: string;
}

class DeterministicEvidenceProvider implements LlmProvider {
  readonly provider = "deterministic-oracle";
  readonly model = "not-a-model";
  calls = 0;

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    this.calls += 1;
    const evidence = parseEvidence(request.user);
    const comment = evidence.find((item) => /intended behavior/i.test(item.text));
    const issue = evidence.find((item) => /intentionally non-destructive/i.test(item.text));
    const chosen = comment ?? issue;
    if (chosen === undefined) {
      throw new Error("No claim-bearing evidence was supplied to the deterministic provider");
    }
    const commentClaim =
      '"This is intended behavior" and "It should be a separate method."';
    const issueClaim =
      '"The iterator is intentionally non-destructive." and "A separate method called drain was suggested for dequeuing."';
    return {
      text: JSON.stringify({
        status: "supported",
        answer:
          "The available sources describe the iterator behavior as intended and record a separate drain method.",
        claims: [
          {
            text: comment !== undefined ? commentClaim : issueClaim,
            evidenceIds: [chosen.id],
            support: "documented",
          },
        ],
        unknowns: [],
      }),
      provider: this.provider,
      model: this.model,
    };
  }
}

class OutageProvider implements LlmProvider {
  readonly provider = "simulated-outage";
  readonly model = "none";

  async generate(): Promise<LlmGenerateResponse> {
    throw new HistoryError("LLM_TIMEOUT", "Simulated provider timeout", {
      recoverable: true,
    });
  }
}

function parseEvidence(user: string): PromptEvidence[] {
  const start = user.indexOf("[");
  const end = user.lastIndexOf("]");
  if (start < 0 || end <= start) {
    return [];
  }
  const parsed = JSON.parse(user.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (item): item is PromptEvidence =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as PromptEvidence).id === "string" &&
      typeof (item as PromptEvidence).text === "string",
  );
}

async function main(): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-live-acceptance-"));
  fs.rmdirSync(dataDir);
  const storeHandle = await createTestStore(dataDir);
  const summary: Record<string, unknown> = {
    startedAt: clock.isoNow(),
    remote: REMOTE,
    mergeSha: MERGE_SHA,
    baseSha: BASE_SHA,
    liveModelCheck: {
      status: "NOT PERFORMED",
      reason:
        "OPENAI_API_KEY was rejected by the provider with HTTP 401 invalid_api_key; no live model credential was used for this run.",
    },
  };
  try {
    console.error("Running live history import at merge SHA...");
    const merge = await runHistoryImport(
      {
        repoUrl: REMOTE,
        headSha: MERGE_SHA,
        branch: "main",
        focusIssueNumbers: [11],
        focusPullRequestNumbers: [12],
        includePullRequestThreadComments: false,
        includeReviews: false,
        includeReviewComments: false,
        collectionLimits: {
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
          timeBudgetMs: 120_000,
        },
        retry: {
          maxRetries: 1,
          baseDelayMs: 250,
          maxDelayMs: 1_000,
          maxRateLimitWaitMs: 1_000,
        },
        checkout: {
          historyDepth: HISTORY_DEPTH,
          maxFiles: 5_000,
          maxBytes: 100 * 1024 * 1024,
          timeoutMs: 300_000,
        },
        indexing: {
          maxIndexedFiles: 300,
          maxFileBytes: 64 * 1024,
          maxChunksPerFile: 4,
          maxChunksPerSource: 20,
          maxEvidenceChunks: 5_000,
          includeFileExcerpts: true,
        },
        coChange: {
          maxTargets: 50,
          minSupport: 2,
          maxResults: 5,
          maxFilesPerCommit: 50,
        },
      },
      {
        github: createOctokitApiFromEnv(),
        store: storeHandle.store,
        clock,
        progress: (event) => {
          console.error(`[${event.phase}] ${event.message}`);
        },
      },
    );
    const repoId = merge.repository.id;
    const mergeSnapshotId = merge.snapshot.id;

    const prEntityId = entityId(repoId, "PullRequest", canonicalPullRequestKey(PR_ID));
    const issueEntityId = entityId(repoId, "Issue", canonicalIssueKey(ISSUE_ID));
    const commitEntityId = entityId(repoId, "Commit", canonicalCommitKey(MERGE_SHA));
    const neighborhood = await storeHandle.store.getNeighbors({
      repoId,
      snapshotId: mergeSnapshotId,
      entityIds: [prEntityId],
      depth: 1,
      maxNodes: 40,
      maxEdges: 80,
    });
    const closes = neighborhood.edges.find(
      (edge) =>
        edge.kind === "CLOSES_ISSUE" &&
        edge.fromEntityId === prEntityId &&
        edge.toEntityId === issueEntityId,
    );
    if (closes === undefined) {
      throw new Error("Live chain did not produce the expected CLOSES_ISSUE edge");
    }
    const inPr = neighborhood.edges.find(
      (edge) => edge.kind === "IN_PR" && edge.fromEntityId === commitEntityId,
    );
    if (inPr === undefined) {
      throw new Error("Live chain did not produce IN_PR for the merge commit");
    }
    const commitNeighborhood = await storeHandle.store.getNeighbors({
      repoId,
      snapshotId: mergeSnapshotId,
      entityIds: [commitEntityId],
      depth: 1,
      maxNodes: 40,
      maxEdges: 80,
    });
    const modifiedFiles = commitNeighborhood.nodes
      .filter((node) => node.kind === "FileRevision")
      .map((node) => node.metadata.path)
      .sort();

    const search = await storeHandle.store.searchEvidence({
      repoId,
      snapshotId: mergeSnapshotId,
      query: "intended behavior drain",
      limit: 10,
    });
    const rationale = search.find((chunk) => /intended behavior/i.test(chunk.body));
    if (rationale === undefined) {
      throw new Error("Live retrieval did not find the maintainer rationale");
    }

    const retriever = new DefaultEvidenceRetriever({ store: storeHandle.store, clock });
    const provider = new DeterministicEvidenceProvider();
    const supported = await askQuestion(
      {
        repoId,
        snapshotId: mergeSnapshotId,
        question: "Why doesn't the iterator drain the queue?",
      },
      { retriever, store: storeHandle.store, llm: provider, clock },
    );
    const providerCallsAfterSupported = provider.calls;
    const unsupported = await askQuestion(
      {
        repoId,
        snapshotId: mergeSnapshotId,
        question: "quantum chromodynamics tennis",
      },
      { retriever, store: storeHandle.store, llm: provider, clock },
    );
    const outage = await askQuestion(
      {
        repoId,
        snapshotId: mergeSnapshotId,
        question: "Why does the iterator behave this way?",
      },
      { retriever, store: storeHandle.store, llm: new OutageProvider(), clock },
    );
    const searchAfterOutage = await storeHandle.store.searchEvidence({
      repoId,
      snapshotId: mergeSnapshotId,
      query: "drain method",
      limit: 5,
    });
    if (supported.status !== "supported" || supported.sources.length === 0) {
      console.error(
        "Supported Q&A debug:",
        JSON.stringify(
          {
            status: supported.status,
            errorCode: supported.errorCode,
            claims: supported.claims,
            unknowns: supported.unknowns,
            warnings: supported.warnings,
            validation: supported.validation,
          },
          null,
          2,
        ),
      );
      throw new Error(`Live supported Q&A did not pass validation: ${supported.status}`);
    }
    if (unsupported.status !== "not_found") {
      throw new Error(`Live unsupported Q&A returned ${unsupported.status}`);
    }
    if (provider.calls !== providerCallsAfterSupported) {
      throw new Error("The provider was called for an unsupported question");
    }
    if (outage.status !== "unavailable" || outage.searchAvailable !== true) {
      throw new Error("Live outage behavior did not preserve search availability");
    }
    if (searchAfterOutage.length === 0) {
      throw new Error("Search was not usable after the simulated model outage");
    }

    console.error("Analyzing base SHA for the contributor reindex proof...");
    const baseCheckout = await checkoutRepository({
      remoteUrl: REMOTE,
      sha: BASE_SHA,
      historyDepth: HISTORY_DEPTH,
      maxFiles: 5_000,
      maxBytes: 100 * 1024 * 1024,
      timeoutMs: 300_000,
    });
    let baseAnalysis;
    try {
      baseAnalysis = await analyzeGitHistory(baseCheckout.directory, {
        sha: BASE_SHA,
        maxCommits: HISTORY_DEPTH,
        historyDepth: HISTORY_DEPTH,
        maxFiles: 5_000,
        timeoutMs: 300_000,
      });
    } finally {
      await baseCheckout.dispose();
    }
    const baseSnapshotId = deterministicSnapshotId(repoId, BASE_SHA);
    const gitSource: SourceCoverage = {
      source: "gitHistory",
      status:
        baseAnalysis.coverage.shallow ||
        baseAnalysis.coverage.commitsTruncated ||
        baseAnalysis.coverage.filesTruncated
          ? "partial"
          : "complete",
      pagesFetched: 1,
      items: baseAnalysis.coverage.commitsAnalyzed,
      capHit:
        baseAnalysis.coverage.commitsTruncated || baseAnalysis.coverage.filesTruncated,
      warnings: baseAnalysis.coverage.warnings,
      window: baseAnalysis.coverage.window,
    };
    const baseCoverage: CoverageReport = {
      sources: { gitHistory: gitSource },
      warnings: [
        "History-only comparison snapshot for the contributor reindex proof; no GitHub API sources were collected at this SHA.",
      ],
      limits: {
        gitMailmapPresent: baseAnalysis.coverage.mailmapPresent,
        gitPossibleAliasGroups: baseAnalysis.possibleAliasGroups.length,
        gitShallow: baseAnalysis.coverage.shallow,
        gitCommitsAnalyzed: baseAnalysis.coverage.commitsAnalyzed,
      },
    };
    const baseStartedAt = "2026-10-30T00:00:00.000Z";
    await storeHandle.store.createSnapshot({
      id: baseSnapshotId,
      repoId,
      headSha: BASE_SHA,
      branch: "main",
      status: "pending",
      coverage: baseCoverage,
      toolVersions: { node: process.version, git: "system" },
      startedAt: baseStartedAt,
      completedAt: null,
      errors: [],
    });
    await storeHandle.store.replaceFileContributors(
      baseAnalysis.fileContributions.map((row) => ({
        ...row,
        snapshotId: baseSnapshotId,
      })),
    );
    await storeHandle.store.finalizeSnapshot({
      repoId,
      snapshotId: baseSnapshotId,
      status: "partial",
      coverage: baseCoverage,
      errors: [],
      completedAt: clock.isoNow(),
    });

    const baseRisk = await computeKnowledgeRisk(
      { repoId, snapshotId: baseSnapshotId, limit: 200 },
      { store: storeHandle.store, clock },
    );
    const mergeRisk = await computeKnowledgeRisk(
      { repoId, snapshotId: mergeSnapshotId, limit: 200 },
      { store: storeHandle.store, clock },
    );
    const baseFile = baseRisk.files.find((file) => file.path === "index.d.ts");
    const mergeFile = mergeRisk.files.find((file) => file.path === "index.d.ts");
    if (baseFile === undefined || mergeFile === undefined) {
      throw new Error("The live risk result did not include index.d.ts");
    }
    if (baseFile.observedAuthors !== 1 || mergeFile.observedAuthors !== 2) {
      throw new Error(
        `Unexpected index.d.ts author counts: base=${baseFile.observedAuthors}, merge=${mergeFile.observedAuthors}`,
      );
    }
    if (baseFile.classification !== "single_observed_contributor") {
      throw new Error("Base risk file was not classified as a single observed contributor");
    }
    if (mergeFile.classification !== "multiple_observed_contributors") {
      throw new Error("Merge risk file did not move to multiple observed contributors");
    }

    const dataset = await storeHandle.store.getCoChangeDataset(repoId, mergeSnapshotId);
    if (dataset === null) {
      throw new Error("Live co-change dataset was not stored");
    }
    const coChange = computeCoChange(dataset, "index.js", { minSupport: 2, maxResults: 10 });

    summary.merge = {
      repoId,
      snapshotId: mergeSnapshotId,
      status: merge.snapshot.status,
      coverage: merge.snapshot.coverage,
      counts: merge.counts,
      warnings: merge.warnings,
    };
    summary.chain = {
      issue: {
        id: ISSUE_ID,
        url: "https://github.com/sindresorhus/yocto-queue/issues/11",
      },
      pullRequest: {
        id: PR_ID,
        url: "https://github.com/sindresorhus/yocto-queue/pull/12",
        mergeCommitSha: MERGE_SHA,
      },
      edges: neighborhood.edges.map((edge) => ({
        id: edge.id,
        kind: edge.kind,
        verification: edge.verification,
        sourceUrl: edge.sourceUrl,
        observedAt: edge.observedAt,
        evidence: edge.evidence,
      })),
      mergeCommitModifiedFiles: modifiedFiles,
    };
    summary.search = {
      query: "intended behavior drain",
      matches: search.length,
      rationale: {
        id: rationale.id,
        sourceUrl: rationale.sourceUrl,
        locator: rationale.locator,
        excerpt: rationale.excerpt,
        revision: rationale.revision,
      },
    };
    summary.qa = {
      supported: {
        status: supported.status,
        answer: supported.answer,
        claims: supported.claims,
        sources: supported.sources,
        validation: supported.validation,
        model: supported.model,
      },
      unsupported: {
        status: unsupported.status,
        answer: unsupported.answer,
        sources: unsupported.sources.length,
        providerCallsBefore: providerCallsAfterSupported,
        providerCallsAfter: provider.calls,
      },
      outage: {
        status: outage.status,
        errorCode: outage.errorCode,
        searchAvailable: outage.searchAvailable,
        answer: outage.answer,
      },
      searchAfterOutage: searchAfterOutage.length,
      providerKind: "deterministic-oracle (not a live model)",
    };
    summary.risk = {
      base: {
        snapshotId: baseSnapshotId,
        sha: BASE_SHA,
        status: "partial",
        historyShallow: baseAnalysis.coverage.shallow,
        historyCommits: baseAnalysis.coverage.commitsAnalyzed,
        indexDts: baseFile,
        caveats: baseRisk.caveats,
      },
      merge: {
        snapshotId: mergeSnapshotId,
        sha: MERGE_SHA,
        status: merge.snapshot.status,
        indexDts: mergeFile,
        caveats: mergeRisk.caveats,
      },
    };
    summary.coChange = {
      dataset: {
        observations: dataset.observations.length,
        commitsAnalyzed: dataset.commitsAnalyzed,
        commitsExcludedOverCap: dataset.commitsExcludedOverCap,
        window: dataset.window,
      },
      target: "index.js",
      coverage: coChange.coverage,
      observations: coChange.observations,
    };
    summary.finishedAt = clock.isoNow();
    const outputPath = path.join(os.tmpdir(), "domino-live-acceptance.json");
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf8");
    console.log(JSON.stringify(summary, null, 2));
    console.error(`Live acceptance evidence written to ${outputPath}`);
  } finally {
    await storeHandle.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
