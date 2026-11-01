# Backend integration handoff

## Current boundary

The web client now imports the shared runtime Zod contracts from `packages/contracts` and no longer maintains a provisional response-schema authority. `apps/web/src/api/schemas.ts` only re-exports the accepted contracts and keeps presentation helpers. The development fixture uses contract-valid UUIDs and ISO timestamps and remains explicitly labelled and excluded from production.

The backend composes role A's persistence/queue/API, role B's history/retrieval/evidence pipeline and role C's dependency-cruiser impact engine. During import, the worker analyses the exact-SHA checkout, stores snapshot-scoped dependencies and source-backed `IMPORTS` edges, and publishes structural coverage. The API exposes deterministic impact over those observations and a manual PR-analysis run service. C's read-only `pull_request` workflow produces the automatic PR step summary independently.

Real public imports, model-backed supported/partial answers, unsupported questions, source inspection, impact, graph, contributor-risk and fresh PR-head worker analysis have been exercised locally. Current acceptance and remaining limits are recorded in [LOCAL_READINESS.md](../LOCAL_READINESS.md); older validation documents retain their historical results. Deployment is excluded and mobile remains deferred.

## Endpoint wiring

| Method and suffix under `/api/v1` | Frontend use | Integration state |
| --- | --- | --- |
| GET `/health` | Connection status | Shared health contract; live service required |
| POST `/repositories` | Public URL import, returned `repoId`, `jobId` | Shared contract; worker required for completion |
| GET `/repositories/:repoId` | Identity, snapshot, coverage | Shared contract |
| GET `/repositories/:repoId/jobs/:jobId` | Phase/status/warnings; optional reported progress | Shared contract; polls every 2s, stops on terminal states including `cancelled` |
| POST `/repositories/:repoId/reindex` | Explicit refresh, returned job | Shared contract |
| GET `/repositories/:repoId/search` | Paginated history/root lookup | Shared contract; empty `q` lists indexed records |
| GET `/repositories/:repoId/entities/:entityId` | Sources/neighbors/relationship proof | Shared detail contract |
| GET `/repositories/:repoId/graph` | Snapshot + entity + bounded depth | Shared graph contract; bounded client-side filters |
| POST `/repositories/:repoId/ask` | Claim/source report and explicit not-found | Shared answer contract; `unavailable` is rendered as a synthesis outage, not not-found |
| POST `/repositories/:repoId/impact` | Changed files or proposed diff + maxDepth | Shared impact contract; structural paths and separate co-change metadata |
| GET `/repositories/:repoId/knowledge-risk` | Scoped authorship + evidence | Shared risk contract; cursor pagination, nullable dates, lower-bound counts and caveats |
| POST `/repositories/:repoId/pr-check` | Explicit PR analysis request | Resolves exact PR base/head, atomically enqueues `analysis.impact`, publishes an isolated structural snapshot; withholds a result if the PR advances |
| GET `/repositories/:repoId/analysis/:runId` | Run status, base/head/event, result, actual Actions link | Shared analysis contract; polls every 2.5s until terminal/error |

## Behaviour and limits

- Responses are parsed with the shared contracts. Malformed responses surface as `CONTRACT_MISMATCH`; the client never substitutes analysis data.
- Fetches time out after 20 seconds and obsolete reads are aborted. Mutations are not automatically retried; polling stops on terminal states and errors.
- Q&A `unavailable` preserves search/source availability messaging and never displays a fabricated answer. `not_found` remains a separate factual result.
- Risk dates may be null. Percentages are shares of returned contributor entries, never knowledge scores. Cursor pagination is explicit.
- Co-change sample/window are displayed only when returned. Historical association stays outside structural paths.
- A Vite dev proxy can attach a server-side `DOMINO_API_TOKEN`; the token is not exposed in `VITE_` variables or the browser bundle. A deployed static host needs an equivalent reverse proxy.
- No repository-list or analysis-run-list endpoint exists. The repository response may include at most five `recentAnalyses` summaries; PR checks poll that response every 10s and use the existing explicit run-ID lookup. The browser-local repository list remains a convenience, not an authoritative inventory.
- Failed/cancelled PR runs can be retried. Retrying the same run invalidates its cached terminal response so status polling resumes. PR snapshots never replace the default history snapshot.
- Optional Actions observation discovers genuine successful public workflow runs and queues local recomputation. The UI labels `actions_observed` explicitly and retains the real Actions URL; it never claims to have ingested the workflow's artifact.
- Spatial graph arrangement runs in a Web Worker with a bounded fallback and cancellation. The renderer still uses only actual API records and relationships. Source inspectors progressively reveal large returned source lists; all sources remain accessible.

## Acceptance boundaries

See [local readiness](../LOCAL_READINESS.md) for the latest commands, real repository revisions, browser evidence, recovery tests and performance observations. A passing automated accessibility scan is not a complete assistive-technology audit. In-app Chromium coverage does not establish compatibility with other engines. Model validation remains conservative and does not prove that a source quote represents its complete context. Hosted HTTPS/operations and deferred mobile acceptance are not claimed.
