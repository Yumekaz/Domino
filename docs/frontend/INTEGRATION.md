# Backend integration handoff

## Current boundary

The web client now imports the shared runtime Zod contracts from `packages/contracts` and no longer maintains a provisional response-schema authority. `apps/web/src/api/schemas.ts` only re-exports the accepted contracts and keeps presentation helpers. The development fixture uses contract-valid UUIDs and ISO timestamps and remains explicitly labelled and excluded from production.

The backend composes role A's persistence/queue/API, role B's history/retrieval/evidence pipeline and role C's dependency-cruiser impact engine. During import, the worker analyses the exact-SHA checkout, stores snapshot-scoped dependencies and source-backed `IMPORTS` edges, and publishes structural coverage. The API exposes deterministic impact over those observations and a manual PR-analysis run service. C's read-only `pull_request` workflow produces the automatic PR step summary independently.

Live model synthesis, a live public PR Actions run, a fresh live import through the integrated worker, deployment and a complete browser-to-live-backend journey remain unverified. Fixture and browser checks are not substitutes for those gates.

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
| POST `/repositories/:repoId/pr-check` | Explicit PR analysis request | Resolves exact PR base/head; persists a run; stale with no result when snapshot ≠ head |
| GET `/repositories/:repoId/analysis/:runId` | Run status, base/head/event, result, actual Actions link | Shared analysis contract; polls every 2.5s until terminal/error |

## Behaviour and limits

- Responses are parsed with the shared contracts. Malformed responses surface as `CONTRACT_MISMATCH`; the client never substitutes analysis data.
- Fetches time out after 20 seconds and obsolete reads are aborted. Mutations are not automatically retried; polling stops on terminal states and errors.
- Q&A `unavailable` preserves search/source availability messaging and never displays a fabricated answer. `not_found` remains a separate factual result.
- Risk dates may be null. Percentages are shares of returned contributor entries, never knowledge scores. Cursor pagination is explicit.
- Co-change sample/window are displayed only when returned. Historical association stays outside structural paths.
- A Vite dev proxy can attach a server-side `DOMINO_API_TOKEN`; the token is not exposed in `VITE_` variables or the browser bundle. A deployed static host needs an equivalent reverse proxy.
- No repository-list or analysis-run-list endpoint exists; the browser-local recent list and explicit run-ID lookup remain intentional.

## Remaining acceptance

1. Fresh live import through the integrated worker against a public repository, including structural coverage and a persisted graph after restart.
2. A live model-generated supported answer and semantic-support validation; an unsupported question and model outage still need live confirmation.
3. A real opened/synchronized PR Actions summary from the merged workflow, with two different head SHAs.
4. A manual PR run against a snapshot whose SHA equals the PR head (otherwise the UI correctly reports stale).
5. Deployment, reverse-proxy authentication, CORS and HTTPS checks.
6. Representative large-graph/foreground motion profiling, cross-browser/accessibility review and the deferred mobile acceptance.
