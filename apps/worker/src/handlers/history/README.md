# Role B history handlers: integration notes

This directory is owned by role B. It contains the history ingestion pipeline and its
worker handler. A owns worker bootstrap, job registration, migrations, API routes and
root dependencies; C owns structural analysis; D owns the web application. Nothing
here edits those owners' files or invents the shared wire contract.

## What A must register

```ts
import { createHistoryImportHandler } from "./handlers/history/handler.ts";

const historyImport = createHistoryImportHandler({
  github: githubApi,        // an Octokit-backed GithubApi, server-side credentials only
  store: historyStore,      // A's implementation of the HistoryStore port
  clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
  // optional:
  // progress: (event) => jobs.update(jobId, event),
  // signal: jobSignal,
});
// register historyImport.queue === "history.import" with pg-boss
```

A resolves the public repository's exact head SHA before dispatching the job. B does
not accept a branch name as the analysis revision.

```ts
type HistoryImportJob = {
  repoUrl: string;                 // https://github.com/owner/repo only
  headSha: string;                 // full 40-hex SHA, required
  branch?: string;                 // snapshot label; defaults to the repository default branch
  repoId?: string;                 // A-owned repository UUID; deterministic fallback otherwise
  snapshotId?: string;             // A-supplied UUID; deterministic fallback otherwise
  focusIssueNumbers?: number[];    // bounded focus; otherwise a paginated recent list
  focusPullRequestNumbers?: number[];
  issueState?: "all" | "open" | "closed";
  documentPaths?: string[];        // README is collected automatically
  includePullRequestThreadComments?: boolean;
  includeReviews?: boolean;
  includeReviewComments?: boolean;
  collectionLimits?: Partial<GithubCollectionLimits>;
  retry?: Partial<GithubRetryPolicy>;
  checkout?: { historyDepth?; maxFiles?; maxBytes?; timeoutMs? };
  indexing?: { maxIndexedFiles?; maxFileBytes?; maxChunksPerFile?; maxChunksPerSource?; maxEvidenceChunks?; includeFileExcerpts? };
  coChange?: { maxTargets?; minSupport?; maxResults?; maxFilesPerCommit? };
};
```

The handler returns `{ repository, snapshot, counts, warnings }` and writes through
`HistoryStore`. It does not own the HTTP response DTO; A maps it to `packages/contracts`.

### Snapshot IDs

- If A supplies `snapshotId`, B uses it.
- Otherwise B derives a deterministic UUID from `repoId + headSha`.
- Reindexing the same SHA with the deterministic ID replaces that snapshot's
  edges/evidence/contributors. A should supply a fresh UUID for a reindex that must
  preserve a previous ready snapshot while the new run is pending.

### Storage port

`packages/core/history/src/ports.ts` defines `HistoryStore`. A needs to implement or
adapt it with PostgreSQL. Required methods: repository/snapshot upsert & finalize,
entity/relationship upsert, evidence replacement, contributor-row replacement,
entity/evidence reads, full-text search, bounded neighbors, risk page, commit-file
observations and co-change dataset/edges.

### Migration fields requested from A

B's test harness schema is **not** a migration. It mirrors the master logical schema
with these fields needed for retrieval and contributor proof:

- `evidence_documents`: `snapshot_id`, `source_kind`, `source_id`, `content_sha`,
  `section_locator`, `excerpt`, `line_start`, `line_end`, `source_timestamp`,
  `revision`, `chunk_index`, `search_tsv`, `metadata`. GIN index on `search_tsv`.
- `edges`: `observed_at`, `verification_detail`, `source_entity_id`, `evidence` JSONB,
  `snapshot_id` not null. Snapshot scoping is required for graph/co-change queries.
- `file_contributors`: `contributor_key`, `contributor_name`, `contributor_email`,
  `observed_commits`, `first_touch`, `last_touch`, `commit_shas` JSONB.
- `index_snapshots.coverage`: per-source status/pages/items/cap/warnings/window and
  B's limits (Git coverage, co-change sample/window/min-support, evidence counts).
- No extra co-change table is required. B reconstructs snapshot-scoped observations
  from `MODIFIED` edges joined to Commit/FileRevision entities, filtered by the
  commit's `coChangeFiles` list. `CO_CHANGED_WITH` edges are derived records, not
  imports.

## C: exact checkout and co-change inputs

`packages/git-adapter/src/checkout.ts` returns a `CheckoutHandle` at the requested
full SHA:

- `listFiles()`: normalized repo-relative paths, modes, blob SHAs, sizes.
- `readFile(path, maxBytes)`: rejects traversal, symlink escape, oversized or binary files.
- `getChangeSet(sha)`: Git status changes (A/M/D/R/C) for one commit.
- `getCommit(sha)`: author/committer/message metadata.
- `getRenameMap()`: historical path → current path for the indexed history, with
  ambiguous/deleted paths omitted.
- `dispose()`: confined to the adapter-owned temp workspace.

C's analyzer must treat the checkout as read-only. The worktree is chmodded read-only
on a best-effort basis; the adapter never executes repository installs, scripts, hooks
or configuration.

Co-change observations:

```ts
const dataset = await store.getCoChangeDataset(repoId, snapshotId);
const result = computeCoChange(dataset, "src/auth.ts", {
  minSupport: 2, maxResults: 20, maxFilesPerCommit: 50,
});
```

`result.coverage` declares the denominator (`commitsTouchingTarget`), observed window,
minimum support, over-cap exclusions, excluded paths and truncation. `CO_CHANGED_WITH`
edges carry the same sample/window metadata and `verification: "derived"`. C must keep
these separate from `IMPORTS`/`POSSIBLY_AFFECTS`; path length is never co-change.

## D: result bindings

- `AskResult` (`packages/core/evidence/src/types.ts`): `status` is
  `supported | partial | not_found | unavailable`. `unavailable` carries `errorCode`
  (`LLM_TIMEOUT`, `LLM_RATE_LIMITED`, `LLM_UNAVAILABLE`, `LLM_BAD_OUTPUT`,
  `STORE_FAILED`) and `searchAvailable`. It has no answer. `not_found` is a factual
  result, not an outage. Sources are only those cited by validated claims; every source
  has the stored URL, locator, excerpt, revision and content hash.
- `KnowledgeRiskResult`: observed-author classification plus coverage/caveats. A single
  observed contributor is never labelled universal ownership. Contributor shares are
  shares of returned/observed commits, not confidence.
- Graph neighbours are bounded; `truncated` and warnings must remain visible. Do not
  interpret a returned neighbourhood as repository-wide counts.

## Caps and defaults

- GitHub: 30 issues, 5 PRs, 2 pages/endpoint, 50 comments/item, 3 issues with comments,
  5 referenced issues, 50 reviews, 50 PR commits, 100 PR changed files, 5 documents,
  180 s time budget. Configurable through the job.
- Git checkout: depth 100 commits (500 in the live harness), 5,000 files, 100 MB,
  120 s. Configurable.
- Evidence indexing: 300 files, 64 KiB/file, 4 chunks/file, 20 chunks/source,
  5,000 chunks total. Configurable.
- Co-change: 50 files/commit, min support 2, 5 associations/target, 50 targets.
- Q&A: 12 chunks, 8 neighbours, 24k prompt characters, 800 output tokens, 25 s,
  support threshold 0.65, downgrade threshold 0.45.

All limits are recorded in `snapshot.coverage.limits`; per-source status/warnings are
recorded in `snapshot.coverage.sources`. A cap or skipped source marks the snapshot
`partial`, not `ready`.

## Failure recovery

- GitHub partial/rate-limit: collection returns partial coverage; Git analysis and
  retrieval continue; snapshot is `partial` with warnings.
- Git checkout/analysis failure: snapshot is `failed`; the original checkout workspace
  is cleaned up; no ready state is published.
- Cancellation: snapshot is `cancelled` when a snapshot row already exists; the caller
  receives `COLLECTION_CANCELLED`.
- Model timeout/quota/outage/malformed output: Q&A returns typed `unavailable`;
  search, source records, graph, co-change, risk and C's deterministic impact remain
  usable.
- Invalid citation/source or unsupported claim: the claim is withheld; if none survive,
  the answer is `not_found`. Relationship claims (`closes`, `merged`, commit-in-PR)
  require matching stored edges/records.

## Model setup

Server-side only; never expose in `VITE_` values, logs or commits.

- `DOMINO_OPENAI_API_KEY` or `OPENAI_API_KEY`
- `DOMINO_LLM_MODEL` (default `gpt-4o-mini`)
- `DOMINO_LLM_BASE_URL` (optional OpenAI-compatible base URL)
- `DOMINO_GITHUB_TOKEN` or `GITHUB_TOKEN` (optional; public unauthenticated collection
  works at the lower rate limit)

The live acceptance run on 2026-10-31 used a deterministic evidence provider, not a
model: the configured `OPENAI_API_KEY` was rejected by the provider with HTTP 401
`invalid_api_key`. Live model synthesis is **NOT PERFORMED**. Unit tests cover
provider structured output, malformed output, timeout, 429 and outage behavior.

## Verification commands

Run from the repository root unless noted:

```bash
# package tests
(cd packages/core/history && node --test test/*.test.ts)
(cd packages/git-adapter && node --test test/*.test.ts)
(cd packages/github-adapter && node --test test/*.test.ts)
(cd packages/retrieval && node --test test/*.test.ts)
(cd packages/core/evidence && node --test test/*.test.ts)
(cd packages/core/knowledge-risk && node --test test/*.test.ts)
(cd packages/llm-adapter && node --test test/*.test.ts)
(cd apps/worker/src/handlers/history && node --test test/*.test.ts)

# typecheck all B-owned source and tests
(cd packages/core/history && ./node_modules/.bin/tsc -p tsconfig.history.json)

# live public checks (network; GitHub unauthenticated quota)
(cd packages/git-adapter && DOMINO_LIVE_GIT=1 node --test test/checkout.live.test.ts)
(cd packages/github-adapter && DOMINO_LIVE_GITHUB=1 node --test test/collector.live.test.ts)
node packages/retrieval/test/live/run-yocto-queue.ts
```

## Public evidence used

- Repository: <https://github.com/sindresorhus/yocto-queue> (numeric ID 315531538, MIT).
- Issue: <https://github.com/sindresorhus/yocto-queue/issues/11> (ID 2891449053).
- Claim-bearing comment: <https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039>.
- Pull request: <https://github.com/sindresorhus/yocto-queue/pull/12> (ID 2368338991),
  head `87d4a591b6584b9120a16daea822c919ff36c1ee`, base
  `0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b`, merge
  `d631ea87f49443c4c8dbf84fd79bf600d11a5fac`.
- Changed files at the PR head include `index.js` (blob
  `2fa5f670219c2726c212a93096245cda5a498bce`), `index.d.ts`, `readme.md`, `test.js`.

The fixture under `packages/github-adapter/test/fixtures/yocto-queue/` contains the
genuine public API responses used by deterministic tests. It is not a claim that live
ingestion passed; the guarded live tests re-fetch the source.
