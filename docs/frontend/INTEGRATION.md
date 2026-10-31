# Backend integration handoff

## Current boundary

The investigation studio and launch doorway reuse these same adapters. The studio requests entity detail and impact for the selected indexed record; the doorway uses the shared repository import form. No new endpoint, backend response field, or local authoritative analysis was introduced. Contributor percentages are labelled shares of the returned contributor counts only.

At initial inspection the repository contained only the supplied specifications and brand files. There was no `apps/api`, `apps/worker`, `packages/contracts`, running service, or ready-made frontend. Those backend areas remain untouched.

`apps/web/src/api/client.ts` calls the master specification's endpoint paths. `schemas.ts` contains **provisional frontend Zod decoders**, derived from the illustrative response examples and the UI's required fields. They are not a newly established backend contract. Replace/import them from the integrator's shared DTO package when available, keeping the server authoritative. A mismatch surfaces as `CONTRACT_MISMATCH`; the client does not guess field aliases or populate missing analysis data.

## Endpoint wiring

| Method and suffix under `/api/v1` | Frontend use | Integration status |
| --- | --- | --- |
| GET `/health` | Connection status | Adapter implemented; live service absent |
| POST `/repositories` | Public URL import, returned `repoId`, `jobId` | Adapter + inline validation + simulated dev journey |
| GET `/repositories/:repoId` | Identity, snapshot, coverage | Provisional response decoder |
| GET `/repositories/:repoId/jobs/:jobId` | Phase/status/warnings; optional reported progress | Polls every 2s; stops on terminal status/error |
| POST `/repositories/:repoId/reindex` | Explicit refresh, returned job | Adapter implemented |
| GET `/repositories/:repoId/search` | Paginated history/root lookup | `q`, `limit=30`, optional `cursor` assumed |
| GET `/repositories/:repoId/entities/:entityId` | Sources/neighbors/relationship proof | Provisional detail decoder |
| GET `/repositories/:repoId/graph` | Snapshot + entity + bounded depth | Spec request names retained; array query encoding requires integrator confirmation |
| POST `/repositories/:repoId/ask` | Claim/source report and explicit not-found | Spec example response supported; dangling citations withheld |
| POST `/repositories/:repoId/impact` | Changed files or proposed diff + maxDepth | Spec example response supported; no client traversal |
| GET `/repositories/:repoId/knowledge-risk` | Scoped authorship + evidence | `snapshotId`, `limit=50` and response envelope assumed |
| POST `/repositories/:repoId/pr-check` | Explicit PR analysis request | `{prNumber}` → `{runId}` assumed; needs approval by backend owner |
| GET `/repositories/:repoId/analysis/:runId` | Run status, base/head/event, result, actual Actions link | Decoder assumed; polls every 2.5s until terminal/error |

Every listed integration is client wiring, **not a validated live round trip**. Real evidence and automatic PR acceptance remain NOT PERFORMED until the backend is available.

## Specific gaps for the integrator

1. Supply the shared Zod package and actual response envelopes: repository/snapshot camelCase vs stored snake_case, job statuses/progress units, entity/graph provenance naming, list pagination, and error nesting. The spec fixes endpoint paths but does not finalize most response DTOs.
2. Confirm graph query serialization for array fields and risk snapshot/pagination parameters. The UI bounds calls; it never interprets a bounded graph as a repository-wide count. Risk results are explicitly limited to the returned results until a pagination DTO exists.
3. Confirm PR request/response, run status vocabulary, timestamp fields, snapshot freshness, GitHub PR URL and actual Actions summary URL. No PR comment or installed workflow is implied by the UI.
4. There is no repository-list endpoint in the agreed specification. The switcher only lists successfully opened records in this browser; users can open an existing ID. A server-wide repository picker is blocked on an agreed list contract.
5. There is no analysis-run list endpoint. The UI supports a returned run ID and manual/deep-link run lookup. A server-wide PR run history is blocked on an agreed list contract.
6. Confirm real import caps, supported-language errors, resolver blind spots, and source coverage so the UI can show the backend's actual warnings. The client never estimates import percentages.
7. Confirm deployed API origin/CORS and any frontend authentication requirement. No API/GitHub/model secrets belong in the browser. Same-origin `/api/v1` is the default; local proxy target is port 3000.
8. Confirm source URLs and evidence excerpts are claim-bearing. Client citation-membership checks do not establish semantic support or source existence; server validation remains mandatory.
9. Supply a real issue → PR → commit → file chain, multi-hop import graph, Git-derived contributor history, and Actions run to complete live acceptance. Synthetic UI exercises are not substitutes for these proofs.
10. Finalize historical co-change sample size and observation-window fields. They are required by master spec 9.1 but absent from the illustrative impact response/provisional decoder. The UI currently discloses them as unavailable; it does not infer them from path length or evidence count. Unknown/incomplete signals are rendered separately and never added to the structural cascade.

## Failure behavior

Fetches time out after 20 seconds; Query cancellation aborts obsolete reads. Mutations are not automatically retried. Machine-readable server errors are shown with explicit recovery. Index/analysis polling stops on error, with a retry control. Unsupported analysis affects its own view; history and graph retain independent queries. Missing/unsafe URLs render as unavailable rather than fabricated anchors.

Snapshots and result SHAs are visible. Answers, risk, impact, and PR results are checked against their active revision, with stale warnings. No Q&A result is used to create graph edges, and no graph neighborhood is used to calculate ownership or total impact.
