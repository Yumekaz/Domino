import type {
  Clock,
  GithubApi,
  GithubCollectionConfig,
  GithubCollectionLimits,
  GithubRetryPolicy,
  SourceClosingReference,
} from "../../../../../packages/core/history/src/source.ts";
import type {
  GitHistoryAnalysis,
  HistoryProgressEvent,
  RepositoryRecord,
  EntityRecord,
  SnapshotRecord,
} from "../../../../../packages/core/history/src/types.ts";
import type { HistoryStore } from "../../../../../packages/core/history/src/ports.ts";
import { HistoryError, errorMessage, isHistoryError } from "../../../../../packages/core/history/src/errors.ts";
import {
  canonicalCommentKey,
  canonicalCommitKey,
  canonicalDocumentKey,
  canonicalFileKey,
  canonicalIssueKey,
  canonicalPullRequestKey,
  canonicalReviewKey,
  entityId,
  repositoryId,
  snapshotId as deterministicSnapshotId,
} from "../../../../../packages/core/history/src/ids.ts";
import {
  githubBlobUrl,
  buildHistoricalGraph,
  buildCoChangeRelationships,
} from "../../../../../packages/core/history/src/graph.ts";
import {
  buildCoChangeDataset,
  computeCoChange,
  type CoChangeDataset,
} from "../../../../../packages/core/history/src/cochange.ts";
import { isRiskSourcePath } from "../../../../../packages/core/history/src/paths.ts";
import { CoverageBuilder } from "../../../../../packages/core/history/src/coverage.ts";
import {
  collectGithubRepository,
  DEFAULT_GITHUB_LIMITS,
  DEFAULT_GITHUB_RETRY,
  normalizeGithubConfig,
} from "../../../../../packages/github-adapter/src/collect.ts";
import type { SourceDocument } from "../../../../../packages/core/history/src/source.ts";
import {
  checkoutRepository,
  type CheckoutHandle,
  type CheckoutOptions,
} from "../../../../../packages/git-adapter/src/checkout.ts";
import { assertFullSha, parseGithubRemote } from "../../../../../packages/git-adapter/src/remote.ts";
import {
  analyzeGitHistory,
  type AnalyzeGitHistoryOptions,
} from "../../../../../packages/git-adapter/src/history.ts";
import { chunkSource, type ChunkOptions } from "../../../../../packages/retrieval/src/chunk.ts";
import type { EvidenceChunkRecord } from "../../../../../packages/core/history/src/types.ts";

export interface HistoryIndexingOptions {
  maxIndexedFiles: number;
  maxFileBytes: number;
  maxChunksPerFile: number;
  maxChunksPerSource: number;
  maxEvidenceChunks: number;
  includeFileExcerpts: boolean;
}

export const DEFAULT_INDEXING_OPTIONS: HistoryIndexingOptions = {
  maxIndexedFiles: 300,
  maxFileBytes: 64 * 1024,
  maxChunksPerFile: 4,
  maxChunksPerSource: 20,
  maxEvidenceChunks: 5_000,
  includeFileExcerpts: true,
};

export interface HistoryCoChangeOptions {
  maxTargets: number;
  minSupport: number;
  maxResults: number;
  maxFilesPerCommit: number;
}

export const DEFAULT_COCHANGE_PIPELINE_OPTIONS: HistoryCoChangeOptions = {
  maxTargets: 50,
  minSupport: 2,
  maxResults: 5,
  maxFilesPerCommit: 50,
};

export interface HistoryImportJob {
  repoUrl: string;
  headSha: string;
  branch?: string;
  repoId?: string;
  snapshotId?: string;
  focusIssueNumbers?: number[];
  focusPullRequestNumbers?: number[];
  issueState?: "all" | "open" | "closed";
  documentPaths?: string[];
  includePullRequestThreadComments?: boolean;
  includeReviews?: boolean;
  includeReviewComments?: boolean;
  collectionLimits?: Partial<GithubCollectionLimits>;
  retry?: Partial<GithubRetryPolicy>;
  checkout?: Partial<Omit<CheckoutOptions, "remoteUrl" | "sha">>;
  indexing?: Partial<HistoryIndexingOptions>;
  coChange?: Partial<HistoryCoChangeOptions>;
}

export type CheckoutFactory = (options: CheckoutOptions) => Promise<CheckoutHandle>;
export type HistoryAnalyzer = (
  directory: string,
  options: AnalyzeGitHistoryOptions,
) => Promise<GitHistoryAnalysis>;

export interface StructuralAnalysisResult {
  status: "complete" | "partial" | "failed";
  items: number;
  gaps: number;
  excludedModules: number;
  warnings: string[];
}

export type StructuralAnalysisHook = (input: {
  repository: RepositoryRecord;
  snapshotId: string;
  headSha: string;
  checkout: CheckoutHandle;
  signal?: AbortSignal;
}) => Promise<StructuralAnalysisResult>;

export interface HistoryImportDeps {
  github: GithubApi;
  store: HistoryStore;
  clock: Clock;
  checkoutFactory?: CheckoutFactory;
  analyzer?: HistoryAnalyzer;
  structural?: StructuralAnalysisHook;
  codeIntelligence?: (input: {
    repository: RepositoryRecord;
    snapshotId: string;
    headSha: string;
    checkout: CheckoutHandle;
    entities: readonly EntityRecord[];
    signal?: AbortSignal;
  }) => Promise<{ chunks: EvidenceChunkRecord[]; warnings: string[]; capHit: boolean }>;
  progress?: (event: HistoryProgressEvent) => void | Promise<void>;
  signal?: AbortSignal;
  gitBinary?: string;
}

export interface HistoryImportResult {
  repository: RepositoryRecord;
  snapshot: SnapshotRecord;
  counts: {
    entities: number;
    relationships: number;
    evidenceChunks: number;
    contributorRows: number;
    indexedFiles: number;
    coChangeEdges: number;
  };
  warnings: string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function runHistoryImport(
  job: HistoryImportJob,
  deps: HistoryImportDeps,
): Promise<HistoryImportResult> {
  const signal = deps.signal;
  const report = async (
    phase: HistoryProgressEvent["phase"],
    message: string,
    processed: number | null = null,
    total: number | null = null,
    warnings: string[] = [],
  ) => {
    try {
      await deps.progress?.({ phase, message, processed, total, warnings });
    } catch {
      // Progress reporting must not fail the import.
    }
  };

  const remote = parseGithubRemote(job.repoUrl);
  const headSha = assertFullSha(job.headSha);
  if (job.repoId !== undefined && !UUID_PATTERN.test(job.repoId)) {
    throw new HistoryError("INVALID_REQUEST", "repoId must be a UUID");
  }
  if (job.snapshotId !== undefined && !UUID_PATTERN.test(job.snapshotId)) {
    throw new HistoryError("INVALID_REQUEST", "snapshotId must be a UUID");
  }
  const limits: GithubCollectionLimits = {
    ...DEFAULT_GITHUB_LIMITS,
    ...(job.collectionLimits ?? {}),
  };
  const retry: GithubRetryPolicy = {
    ...DEFAULT_GITHUB_RETRY,
    ...(job.retry ?? {}),
  };
  const collectionConfig: GithubCollectionConfig = {
    owner: remote.owner,
    repo: remote.repo,
    headSha,
    focusIssueNumbers: job.focusIssueNumbers ?? [],
    focusPullRequestNumbers: job.focusPullRequestNumbers ?? [],
    issueState: job.issueState ?? "all",
    documentPaths: job.documentPaths ?? [],
    includeIssueTimelines: true,
    ...(job.includePullRequestThreadComments === undefined
      ? {}
      : { includePullRequestThreadComments: job.includePullRequestThreadComments }),
    ...(job.includeReviews === undefined ? {} : { includeReviews: job.includeReviews }),
    ...(job.includeReviewComments === undefined
      ? {}
      : { includeReviewComments: job.includeReviewComments }),
    limits,
    retry,
  };
  normalizeGithubConfig(collectionConfig);
  const indexing: HistoryIndexingOptions = {
    ...DEFAULT_INDEXING_OPTIONS,
    ...(job.indexing ?? {}),
  };
  const coChangeOptions: HistoryCoChangeOptions = {
    ...DEFAULT_COCHANGE_PIPELINE_OPTIONS,
    ...(job.coChange ?? {}),
  };

  await report("validating", "Validated public GitHub URL and exact SHA");
  const github = await collectGithubRepository(deps.github, collectionConfig, {
    clock: deps.clock,
    signal,
  });
  await report(
    "fetching_github",
    `Collected GitHub sources for ${github.repository.fullName}`,
    github.issues.length + github.pullRequests.length,
    null,
    github.warnings,
  );

  const repository: RepositoryRecord = {
    id: job.repoId ?? repositoryId(github.repository.id),
    githubId: github.repository.id,
    owner: github.repository.owner,
    name: github.repository.name,
    defaultBranch: github.repository.defaultBranch,
    visibility: "public",
    htmlUrl: github.repository.htmlUrl,
    createdAt: deps.clock.isoNow(),
  };
  await deps.store.ensureRepository(repository);

  const snapId = job.snapshotId ?? deterministicSnapshotId(repository.id, headSha);
  const startedAt = deps.clock.isoNow();
  const branch = job.branch?.trim() || repository.defaultBranch || "HEAD";
  const baseSnapshot: SnapshotRecord = {
    id: snapId,
    repoId: repository.id,
    headSha,
    branch,
    status: "pending",
    coverage: github.coverage,
    toolVersions: {
      node: process.version,
      historyPipeline: "0.1.0",
      githubRest: "22.0.1",
      git: "system",
    },
    startedAt,
    completedAt: null,
    errors: [],
  };
  await deps.store.createSnapshot(baseSnapshot);

  let checkout: CheckoutHandle | null = null;
  let coverageBuilder: CoverageBuilder | null = null;
  try {
    const checkoutFactory = deps.checkoutFactory ?? checkoutRepository;
    await report("checking_out_git", "Creating an isolated exact-SHA checkout");
    checkout = await checkoutFactory({
      remoteUrl: remote.canonicalUrl,
      sha: headSha,
      historyDepth: job.checkout?.historyDepth ?? 100,
      maxFiles: job.checkout?.maxFiles ?? 5_000,
      maxBytes: job.checkout?.maxBytes ?? 100 * 1024 * 1024,
      timeoutMs: job.checkout?.timeoutMs ?? 120_000,
      signal,
      ...(deps.gitBinary === undefined ? {} : { gitBinary: deps.gitBinary }),
    });
    if (checkout.sha !== headSha) {
      throw new HistoryError("SHA_NOT_FOUND", "Checkout SHA does not match the requested SHA");
    }
    await report("checking_out_git", "Exact-SHA checkout ready");

    const analyzer = deps.analyzer ?? analyzeGitHistory;
    await report("analyzing_history", "Analyzing Git history and contributor changes");
    const git = await analyzer(checkout.directory, {
      sha: headSha,
      maxCommits: job.checkout?.historyDepth ?? 100,
      historyDepth: job.checkout?.historyDepth ?? 100,
      maxFiles: job.checkout?.maxFiles ?? 5_000,
      timeoutMs: job.checkout?.timeoutMs ?? 120_000,
      signal,
      ...(deps.gitBinary === undefined ? {} : { gitBinary: deps.gitBinary }),
    });
    await report(
      "analyzing_contributors",
      `Observed ${git.commits.length} commit(s) and ${git.fileContributions.length} file-author row(s)`,
      git.commits.length,
      null,
      git.coverage.warnings,
    );

    const dataset = buildCoChangeDataset(git.commits, {
      maxFilesPerCommit: coChangeOptions.maxFilesPerCommit,
      minSupport: coChangeOptions.minSupport,
      maxResults: coChangeOptions.maxResults,
      window: null,
    });
    await report(
      "normalizing",
      "Normalized historical entities and relationships",
      git.commits.length,
      null,
    );
    const graph = buildHistoricalGraph({
      repository,
      snapshot: {
        id: baseSnapshot.id,
        headSha,
        branch,
        startedAt,
      },
      issues: github.issues,
      pullRequests: github.pullRequests,
      comments: github.comments,
      reviews: github.reviews,
      pullRequestCommits: github.pullRequestCommits,
      documents: github.documents,
      closingReferences: github.closingReferences,
      git,
      coChangeDataset: dataset,
    });
    await report(
      "linking",
      `Built ${graph.relationships.length} provenance relationship(s)`,
      graph.entities.length,
      null,
      graph.warnings,
    );
    // Entity versions are needed before structural analysis can attach IMPORT edges.
    await deps.store.upsertEntities(graph.entities);

    const chunkResult = await buildEvidenceSources({
      repository,
      snapshotId: baseSnapshot.id,
      headSha,
      github,
      git,
      checkout,
      indexing,
      signal,
    });
    const targets = [...new Set(git.fileContributions.map((row) => row.path))]
      .sort()
      .slice(0, Math.max(0, coChangeOptions.maxTargets));
    const coChangeEdges = [];
    for (const target of targets) {
      const result = computeCoChange(dataset, target, {
        minSupport: coChangeOptions.minSupport,
        maxResults: coChangeOptions.maxResults,
        maxFilesPerCommit: coChangeOptions.maxFilesPerCommit,
      });
      if (result.observations.length > 0) {
        coChangeEdges.push(
          ...buildCoChangeRelationships({
            repository,
            snapshot: { id: baseSnapshot.id, headSha, branch, startedAt },
            fileEntities: graph.entities,
            coChange: result,
          }),
        );
      }
    }
    const relationships = dedupeRelationships([...graph.relationships, ...coChangeEdges]);
    await report(
      "indexing_retrieval",
      `Indexed ${chunkResult.chunks.length} source chunk(s) and ${coChangeEdges.length} co-change edge(s)`,
      chunkResult.chunks.length,
      null,
      chunkResult.warnings,
    );

    let structural: StructuralAnalysisResult | null = null;
    if (deps.structural) {
      await report(
        "analyzing_structure",
        "Analyzing structural imports at the indexed revision",
      );
      try {
        structural = await deps.structural({
          repository,
          snapshotId: baseSnapshot.id,
          headSha,
          checkout,
          signal,
        });
      } catch (error) {
        structural = {
          status: "failed",
          items: 0,
          gaps: 0,
          excludedModules: 0,
          warnings: [
            `Structural analysis failed: ${errorMessage(error)}`,
          ],
        };
      }
    }

    let codeIntelligence: { status: "partial" | "failed"; items: number; warnings: string[]; capHit: boolean } | undefined;
    if (deps.codeIntelligence) {
      await report("indexing_retrieval", "Extracting optional symbol source evidence");
      try {
        const extra = await deps.codeIntelligence({
          repository, snapshotId: baseSnapshot.id, headSha, checkout, entities: graph.entities, signal,
        });
        const remaining = Math.max(0, indexing.maxEvidenceChunks - chunkResult.chunks.length);
        chunkResult.chunks.push(...extra.chunks.slice(0, remaining));
        chunkResult.warnings.push(...extra.warnings);
        codeIntelligence = {
          status: "partial",
          items: Math.min(extra.chunks.length, remaining),
          warnings: extra.warnings,
          capHit: extra.capHit || extra.chunks.length > remaining,
        };
        if (extra.chunks.length > remaining) {
          chunkResult.capHit = true;
          chunkResult.warnings.push("Optional code intelligence reached the shared evidence chunk limit.");
        }
      } catch (error) {
        const code = error instanceof Error && /^CBM_[A-Z_]{1,48}$/.test(error.message) ? error.message : "CBM_UNAVAILABLE";
        const warning = `Optional code intelligence was unavailable (${code}); baseline history and dependency analysis were retained.`;
        chunkResult.warnings.push(warning);
        codeIntelligence = { status: "failed", items: 0, warnings: [warning], capHit: false };
      }
    }
    if (signal?.aborted) {
      throw new HistoryError("COLLECTION_CANCELLED", "History import was cancelled before publication", { recoverable: true });
    }
    const coverage = finalizeCoverage({
      githubCoverage: github.coverage,
      git,
      chunkResult,
      dataset,
      coChangeOptions,
      structural,
      codeIntelligence,
      warnings: [
        ...github.warnings,
        ...graph.warnings,
        ...chunkResult.warnings,
        ...dataset.warnings,
        ...(structural?.warnings ?? []),
      ],
    });
    coverageBuilder = coverage.builder;
    const incomplete = isCoverageIncomplete(coverage.report);
    const status = incomplete ? "partial" : "ready";
    const completedAt = deps.clock.isoNow();

    await report("publishing", "Publishing snapshot and evidence index");
    await deps.store.upsertRelationships(relationships);
    await deps.store.replaceEvidenceChunks(chunkResult.chunks);
    await deps.store.replaceFileContributors(
      git.fileContributions.map((row) => ({ ...row, snapshotId: baseSnapshot.id })),
    );
    const finalSnapshot: SnapshotRecord = {
      ...baseSnapshot,
      status,
      coverage: coverage.report,
      completedAt,
      errors: [],
    };
    await deps.store.finalizeSnapshot({
      repoId: repository.id,
      snapshotId: baseSnapshot.id,
      status,
      coverage: coverage.report,
      errors: [],
      completedAt,
    });
    await report(
      "publishing",
      `Snapshot ${status} at ${headSha}`,
      graph.entities.length,
      graph.entities.length,
      coverage.report.warnings,
    );
    return {
      repository,
      snapshot: finalSnapshot,
      counts: {
        entities: graph.entities.length,
        relationships: relationships.length,
        evidenceChunks: chunkResult.chunks.length,
        contributorRows: git.fileContributions.length,
        indexedFiles: chunkResult.indexedFiles,
        coChangeEdges: coChangeEdges.length,
      },
      warnings: coverage.report.warnings,
    };
  } catch (error) {
    const cancelled = signal?.aborted === true || (isHistoryError(error) && error.code === "COLLECTION_CANCELLED");
    const code = isHistoryError(error) ? error.code : "GIT_FAILED";
    const completedAt = deps.clock.isoNow();
    const coverage =
      coverageBuilder?.toReport() ??
      github.coverage;
    try {
      await deps.store.finalizeSnapshot({
        repoId: repository.id,
        snapshotId: baseSnapshot.id,
        status: cancelled ? "cancelled" : "failed",
        coverage,
        errors: [`${code}: ${errorMessage(error)}`],
        completedAt,
      });
    } catch {
      // Preserve the original failure.
    }
    if (error instanceof HistoryError) {
      throw error;
    }
    throw new HistoryError(
      cancelled ? "COLLECTION_CANCELLED" : "GIT_FAILED",
      `History import failed: ${errorMessage(error)}`,
      { recoverable: true, cause: error },
    );
  } finally {
    if (checkout !== null) {
      try {
        await checkout.dispose();
      } catch {
        // Cleanup failure is reported by the underlying adapter and must not mask import errors.
      }
    }
  }
}

interface ChunkBuildResult {
  chunks: EvidenceChunkRecord[];
  warnings: string[];
  indexedFiles: number;
  capHit: boolean;
}

async function buildEvidenceSources(input: {
  repository: RepositoryRecord;
  snapshotId: string;
  headSha: string;
  github: Awaited<ReturnType<typeof collectGithubRepository>>;
  git: GitHistoryAnalysis;
  checkout: CheckoutHandle;
  indexing: HistoryIndexingOptions;
  signal?: AbortSignal;
}): Promise<ChunkBuildResult> {
  const { repository, snapshotId, headSha, github, git, checkout, indexing } = input;
  const chunks: EvidenceChunkRecord[] = [];
  const warnings: string[] = [];
  let capHit = false;
  let indexedFiles = 0;
  const chunkOptions: ChunkOptions = {
    maxChars: 900,
    overlapChars: 120,
    maxChunks: indexing.maxChunksPerSource,
  };
  let capWarningEmitted = false;
  const add = (created: EvidenceChunkRecord[], sourceLabel: string) => {
    if (chunks.length >= indexing.maxEvidenceChunks) {
      capHit = true;
      if (!capWarningEmitted) {
        warnings.push("Evidence indexing stopped at the configured total chunk cap.");
        capWarningEmitted = true;
      }
      return;
    }
    const remaining = indexing.maxEvidenceChunks - chunks.length;
    const selected = created.slice(0, remaining);
    chunks.push(...selected);
    if (selected.length < created.length) {
      capHit = true;
      if (!capWarningEmitted) {
        warnings.push("Evidence indexing stopped at the configured total chunk cap.");
        capWarningEmitted = true;
      }
      warnings.push(`${sourceLabel} exceeded the evidence chunk cap; later chunks were not indexed.`);
    }
    if (created.some((chunk) => chunk.metadata.sourceTruncated === true)) {
      warnings.push(`${sourceLabel} was truncated at the configured per-source chunk cap.`);
    }
  };

  for (const issue of github.issues) {
    const id = entityId(repository.id, "Issue", canonicalIssueKey(issue.id));
    add(
      chunkSource(
        {
          repoId: repository.id,
          snapshotId,
          entityId: id,
          entityKind: "Issue",
          sourceKind: "issue",
          sourceId: `issue:${issue.id}`,
          sourceUrl: issue.htmlUrl,
          title: issue.title,
          body: issue.body,
          locatorPrefix: `Issue #${issue.number}`,
          sourceTimestamp: issue.updatedAt,
          revision: headSha,
          metadata: { number: issue.number, title: issue.title, author: issue.authorLogin },
        },
        chunkOptions,
      ),
      `Issue #${issue.number}`,
    );
  }
  for (const pullRequest of github.pullRequests) {
    const id = entityId(
      repository.id,
      "PullRequest",
      canonicalPullRequestKey(pullRequest.id),
    );
    add(
      chunkSource(
        {
          repoId: repository.id,
          snapshotId,
          entityId: id,
          entityKind: "PullRequest",
          sourceKind: "pull_request",
          sourceId: `pr:${pullRequest.id}`,
          sourceUrl: pullRequest.htmlUrl,
          title: pullRequest.title,
          body: pullRequest.body,
          locatorPrefix: `PR #${pullRequest.number}`,
          sourceTimestamp: pullRequest.updatedAt,
          revision: headSha,
          metadata: {
            number: pullRequest.number,
            title: pullRequest.title,
            author: pullRequest.authorLogin,
          },
        },
        chunkOptions,
      ),
      `PR #${pullRequest.number}`,
    );
  }
  for (const comment of github.comments) {
    const id = entityId(
      repository.id,
      "DiscussionComment",
      canonicalCommentKey(comment.id),
    );
    add(
      chunkSource(
        {
          repoId: repository.id,
          snapshotId,
          entityId: id,
          entityKind: "DiscussionComment",
          sourceKind: comment.kind === "review_comment" ? "review_comment" : "issue_comment",
          sourceId: `comment:${comment.id}`,
          sourceUrl: comment.htmlUrl,
          title: `${comment.kind === "review_comment" ? "Review comment" : "Comment"} on #${comment.parentNumber}`,
          body: comment.body,
          locatorPrefix:
            comment.kind === "review_comment"
              ? `PR #${comment.parentNumber} review comment ${comment.id}`
              : `${comment.parentKind} #${comment.parentNumber} comment ${comment.id}`,
          sourceTimestamp: comment.createdAt,
          revision: headSha,
          metadata: {
            number: comment.parentNumber,
            parentKind: comment.parentKind,
            author: comment.authorLogin,
            title: `Comment ${comment.id}`,
          },
        },
        chunkOptions,
      ),
      `Comment ${comment.id}`,
    );
  }
  for (const review of github.reviews) {
    const id = entityId(repository.id, "DiscussionComment", canonicalReviewKey(review.id));
    add(
      chunkSource(
        {
          repoId: repository.id,
          snapshotId,
          entityId: id,
          entityKind: "DiscussionComment",
          sourceKind: "review",
          sourceId: `review:${review.id}`,
          sourceUrl: review.htmlUrl,
          title: `Review ${review.state} on #${review.prNumber}`,
          body: review.body,
          locatorPrefix: `PR #${review.prNumber} review ${review.id}`,
          sourceTimestamp: review.submittedAt,
          revision: headSha,
          metadata: {
            number: review.prNumber,
            state: review.state,
            author: review.authorLogin,
            title: `Review ${review.id}`,
          },
        },
        chunkOptions,
      ),
      `Review ${review.id}`,
    );
  }
  for (const commit of git.commits) {
    const id = entityId(repository.id, "Commit", canonicalCommitKey(commit.sha));
    add(
      chunkSource(
        {
          repoId: repository.id,
          snapshotId,
          entityId: id,
          entityKind: "Commit",
          sourceKind: "commit",
          sourceId: commit.sha,
          sourceUrl: `https://github.com/${repository.owner}/${repository.name}/commit/${commit.sha}`,
          title: commit.subject,
          body: commit.message,
          locatorPrefix: `Commit ${commit.sha.slice(0, 12)}`,
          sourceTimestamp: commit.authoredAt,
          revision: commit.sha,
          metadata: {
            author: commit.author.name,
            title: commit.subject,
          },
        },
        chunkOptions,
      ),
      `Commit ${commit.sha.slice(0, 12)}`,
    );
  }
  for (const document of github.documents) {
    const id = entityId(
      repository.id,
      "Document",
      canonicalDocumentKey(document.path, document.sha),
    );
    add(
      chunkSource(
        {
          repoId: repository.id,
          snapshotId,
          entityId: id,
          entityKind: "Document",
          sourceKind: "document",
          sourceId: `document:${document.path}`,
          sourceUrl: document.htmlUrl,
          title: document.path,
          body: document.body,
          locatorPrefix: document.path,
          sourceTimestamp: null,
          revision: headSha,
          metadata: { path: document.path, title: document.path },
        },
        chunkOptions,
      ),
      `Document ${document.path}`,
    );
  }

  if (indexing.includeFileExcerpts) {
    const lastTouch = new Map<string, string | null>();
    for (const row of git.fileContributions) {
      const existing = lastTouch.get(row.path);
      if (existing === undefined || (row.lastTouch !== null && (existing === null || row.lastTouch > existing))) {
        lastTouch.set(row.path, row.lastTouch);
      }
    }
    const files = (await checkout.listFiles())
      .map((file) => file.path)
      .filter((path) => isRiskSourcePath(path))
      .sort()
      .slice(0, indexing.maxIndexedFiles);
    for (const filePath of files) {
      if (input.signal?.aborted === true) {
        throw new HistoryError("COLLECTION_CANCELLED", "History import was cancelled", {
          recoverable: true,
        });
      }
      if (chunks.length >= indexing.maxEvidenceChunks) {
        capHit = true;
        warnings.push("Evidence indexing stopped at the configured total chunk cap.");
        break;
      }
      let content: string;
      try {
        content = await checkout.readFile(filePath, indexing.maxFileBytes);
      } catch (error) {
        warnings.push(`File ${filePath} was not indexed: ${errorMessage(error)}`);
        continue;
      }
      if (content.trim().length === 0) {
        continue;
      }
      indexedFiles += 1;
      add(
        chunkSource(
          {
            repoId: repository.id,
            snapshotId,
            entityId: entityId(repository.id, "File", canonicalFileKey(filePath)),
            entityKind: "File",
            sourceKind: "file_excerpt",
            sourceId: `${filePath}@${headSha}`,
            sourceUrl: githubBlobUrl(repository.owner, repository.name, headSha, filePath),
            title: filePath,
            body: content,
            locatorPrefix: filePath,
            sourceTimestamp: lastTouch.get(filePath) ?? null,
            revision: headSha,
            metadata: { path: filePath, title: filePath },
          },
          { ...chunkOptions, maxChunks: indexing.maxChunksPerFile },
        ),
        `File ${filePath}`,
      );
    }
  }

  return { chunks, warnings, indexedFiles, capHit };
}

function finalizeCoverage(input: {
  githubCoverage: Awaited<ReturnType<typeof collectGithubRepository>>["coverage"];
  git: GitHistoryAnalysis;
  chunkResult: ChunkBuildResult;
  dataset: CoChangeDataset;
  coChangeOptions: HistoryCoChangeOptions;
  structural: StructuralAnalysisResult | null;
  codeIntelligence?: { status: "partial" | "failed"; items: number; warnings: string[]; capHit: boolean };
  warnings: string[];
}): { report: SnapshotRecord["coverage"]; builder: CoverageBuilder } {
  const limits: Record<string, number | string | boolean | null> = {
    ...input.githubCoverage.limits,
    gitHistoryDepth: input.git.coverage.historyDepthRequested,
    gitAnalyzedSha: input.git.coverage.resolvedSha,
    gitShallow: input.git.coverage.shallow,
    gitCommitsAnalyzed: input.git.coverage.commitsAnalyzed,
    gitFilesAtHead: input.git.coverage.filesAtHead,
    gitMailmapPresent: input.git.coverage.mailmapPresent,
    gitPossibleAliasGroups: input.git.possibleAliasGroups.length,
    gitRenameConflicts: input.git.coverage.renameConflicts,
    gitFilesWithoutObservedHistory: Math.max(
      0,
      input.git.coverage.filesAtHead -
        new Set(input.git.fileContributions.map((row) => row.path)).size,
    ),
    coChangeCommitsAnalyzed: input.dataset.commitsAnalyzed,
    coChangeCommitsExcludedOverCap: input.dataset.commitsExcludedOverCap,
    coChangeExcludedPaths: input.dataset.excludedPaths,
    coChangeMaxFilesPerCommit: input.coChangeOptions.maxFilesPerCommit,
    coChangeMinSupport: input.coChangeOptions.minSupport,
    coChangeWindowFrom: input.dataset.window.from,
    coChangeWindowTo: input.dataset.window.to,
    evidenceChunks: input.chunkResult.chunks.length,
    indexedFiles: input.chunkResult.indexedFiles,
    structuralImports: input.structural?.items ?? 0,
    structuralGaps: input.structural?.gaps ?? 0,
    structuralExcludedModules: input.structural?.excludedModules ?? 0,
  };
  const builder = new CoverageBuilder(limits);
  if (input.codeIntelligence) {
    builder.start("codeIntelligence");
    builder.update("codeIntelligence", { status: input.codeIntelligence.status, items: input.codeIntelligence.items, pagesFetched: 0, capHit: input.codeIntelligence.capHit });
    for (const warning of input.codeIntelligence.warnings) builder.update("codeIntelligence", { warning });
  }
  for (const [source, coverage] of Object.entries(input.githubCoverage.sources) as Array<
    [keyof typeof input.githubCoverage.sources, NonNullable<(typeof input.githubCoverage.sources)[keyof typeof input.githubCoverage.sources]>]
  >) {
    builder.start(source as never);
    for (const warning of coverage.warnings) {
      builder.update(source as never, { warning });
    }
    builder.update(source as never, {
      status: coverage.status,
      pagesFetched: coverage.pagesFetched,
      items: coverage.items,
      capHit: coverage.capHit,
      window: coverage.window,
      ...(coverage.errorCode === undefined ? {} : { errorCode: coverage.errorCode }),
      ...(coverage.errorMessage === undefined ? {} : { errorMessage: coverage.errorMessage }),
    });
  }
  builder.start("gitHistory");
  const gitStatus =
    input.git.coverage.shallow ||
    input.git.coverage.commitsTruncated ||
    input.git.coverage.filesTruncated
      ? "partial"
      : "complete";
  for (const warning of input.git.coverage.warnings) {
    builder.update("gitHistory", { warning });
  }
  builder.update("gitHistory", {
    status: gitStatus,
    pagesFetched: 1,
    items: input.git.coverage.commitsAnalyzed,
    capHit: input.git.coverage.commitsTruncated || input.git.coverage.filesTruncated,
    window: input.git.coverage.window,
  });
  builder.start("retrieval");
  for (const warning of input.chunkResult.warnings) {
    builder.update("retrieval", { warning });
  }
  builder.update("retrieval", {
    status: input.chunkResult.capHit ? "partial" : "complete",
    pagesFetched: 1,
    items: input.chunkResult.chunks.length,
    capHit: input.chunkResult.capHit,
    window: null,
  });
  if (input.structural) {
    builder.start("structural");
    for (const warning of input.structural.warnings) {
      builder.update("structural", { warning });
    }
    builder.update("structural", {
      status: input.structural.status,
      pagesFetched: 1,
      items: input.structural.items,
      capHit: false,
      window: null,
    });
  }
  for (const warning of input.warnings) {
    builder.addWarning(warning);
  }
  return { report: builder.toReport(), builder };
}

function isCoverageIncomplete(report: SnapshotRecord["coverage"]): boolean {
  const required: Array<keyof typeof report.sources> = ["issues", "gitHistory", "retrieval"];
  if (required.some((source) => report.sources[source]?.status !== "complete")) {
    return true;
  }
  if (report.warnings.some((warning) => /blocked|rate limit|time budget/i.test(warning))) {
    return true;
  }
  return Object.values(report.sources).some(
    (source) =>
      source.status === "partial" ||
      source.status === "failed" ||
      source.warnings.some((warning) => /blocked|rate limit|time budget/i.test(warning)),
  );
}

function dedupeRelationships(relationships: ReturnType<typeof buildHistoricalGraph>["relationships"]): ReturnType<typeof buildHistoricalGraph>["relationships"] {
  const map = new Map<string, (typeof relationships)[number]>();
  for (const edge of relationships) {
    map.set(edge.id, edge);
  }
  return [...map.values()];
}
