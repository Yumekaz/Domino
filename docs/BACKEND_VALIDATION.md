# Backend validation record

31 October 2026. This record distinguishes role A's branch from the separate B draft. The A+B integration checks used a temporary local checkout of B commit `62b1d7dfe757e760396ea85fcfc893eb9994631f`, with A-owned files copied alongside it. B's PR was not merged to perform the tests. All imported content below came from a real public repository; these results are not the frontend development fixture.

## Integration update

Role B (`62b1d7d`) was merged into `codex/backend-integration` at merge commit `0855f02`. On the merged tree, without re-running live ingestion:

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS: backend contracts/API/database and all B history, retrieval, evidence, risk and worker-handler sources |
| `npm test` — Vitest | PASS: 16 tests, 3 skipped (real PostgreSQL/pg-boss suite requires its isolated database environment) |
| `npm test` — history suites | PASS: 64 tests, 3 skipped (optional live Git/GitHub checks) |
| Clean `npm ci --ignore-scripts` | PASS in an isolated temporary workspace with the updated root lockfile |
| Runtime loader paths | PASS: the API/worker dynamically resolve all eight integrated B modules, including `createHistoryImportHandler` |
| Frontend checks | PASS: `npm run typecheck` and 38 tests |

The live public import, a model-generated answer, C's impact/PR services, the frontend binding, Docker Compose and deployment were **not** re-run for this merge. The live evidence below remains the earlier role A+B validation.

## C and D integration update

31 October 2026. Role C's domain code was merged into `codex/backend-integration` at `e8bde82`; this integration pass added the missing worker/API composition and D's shared-contract binding.

| Check | Result |
| --- | --- |
| Backend typecheck (A, B, C, D API adapters) | PASS: `npm run typecheck` across backend, history and impact configs |
| Vitest backend | PASS: 23 tests, 3 skipped (the real PostgreSQL/pg-boss suite requires `DOMINO_TEST_DATABASE_URL`) |
| History suites | PASS: 64 tests, 3 optional live checks skipped |
| Impact/analyzer/PR-action suites | PASS: 63 tests |
| Worker structural analysis | PASS: a temporary exact-SHA checkout produced stored dependencies and `IMPORTS` edges through `replacePendingStructural` |
| Deterministic impact over stored imports | PASS: direct `session.ts` and transitive `dashboard.tsx` reverse paths returned from persisted observations |
| Manual PR run persistence | PASS: idempotent run reuse; a differing PR head persists a stale run with no substituted result |
| PR-action local dry run | PASS: the real workflow script analyzed `apps/web/src/api/schemas.ts` with dependency-cruiser 18.7.0 and emitted a genuine step summary with direct dependents |
| Live PR Actions | PASS: temporary PR #13 ran the read-only workflow on opened head `2e2a590…` (run 41175040860) and synchronized head `9410250…` (run 41175108532), each cruising 67 modules / 111 structural imports and returning direct dependents of `apps/web/src/api/client.ts` |
| Frontend shared-contract migration | PASS: typecheck, lint, 40 tests, production build and production-fixture exclusion |
| Browser fixture journeys | PASS: overview, history with an empty browse query, supported Q&A with source inspection, impact plus separate co-change sample/window, risk caveats, and a stale PR run; no captured console errors |
| Clean workspace install | PASS: `npm ci --ignore-scripts` with the refreshed root lockfile |

The live workflow originally produced zero modules because the package-only analyzer install hoisted dependency-cruiser without its TypeScript peer. Installing the trusted base workspace at the analyzer root fixed module discovery. The target checkout's nested Git metadata is also removed before analysis; target installs, builds, scripts and hooks are never executed.

Not performed for this pass: a fresh live public import through the integrated worker, a live model-generated answer, a live manual API PR run, Docker Compose, deployment, and browser-to-live-backend acceptance. Docker/PostgreSQL credentials were not available locally; the hosted CI PostgreSQL service remains the database acceptance path.

## Verified locally

| Check                             | Result                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict backend TypeScript         | PASS                                           | `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Backend tests                     | PASS                                           | `DOMINO_ALLOW_POSTGRES_TESTS=1` and `DOMINO_TEST_DATABASE_URL` pointing to the dedicated `domino_a_test` database, then `npm test`: 19 tests. The suite includes Fastify request checks, contract guards, snapshot isolation, real PostgreSQL, pg-boss concurrency/rollback and dependency-write transactions.                                                                                                                                                       |
| PostgreSQL migration              | PASS                                           | `npm run db:migrate` on an isolated PostgreSQL 17 cluster; second run was idempotent. A database restart preserved the real indexed graph.                                                                                                                                                                                                                                                                                                                           |
| B focused tests                   | PASS with skips                                | Clean A+B checkout, `tsx --test` on B's test directories: 64 passed, 3 optional live tests skipped. B source/tests typecheck with `tsc -p tsconfig.history.integration.json`. An initial sandboxed run could not reach the loopback model stub; the same tests passed with loopback access enabled.                                                                                                                                                                  |
| Frontend preservation             | PASS for checks                                | Clean `apps/web` install, typecheck, lint, 38 tests, build and `verify:production`. Frontend source was not changed. The pre-existing lazy 3D size warning remains.                                                                                                                                                                                                                                                                                                  |
| Real public import and reindex    | PASS for historical pipeline; partial coverage | `POST /api/v1/repositories` for `https://github.com/sindresorhus/yocto-queue` queued and imported head `72a8fa96a9d389765cdf2bb9c6daba8302fc375d`. Initial snapshot `56d41d2d-bb9f-48eb-8351-a1440d60c506` remained queryable after a same-SHA reindex and PostgreSQL restart. Final snapshot `2cbf1816-87ac-455c-ae36-d47337bcb71f` reported partial, with structural analysis explicitly `not_attempted`. An anonymous reindex also disclosed a GitHub rate limit. |
| Search, provenance and graph      | PASS for the observed public example           | Search returned the real [issue #11](https://github.com/sindresorhus/yocto-queue/issues/11), [PR #12](https://github.com/sindresorhus/yocto-queue/pull/12) and related Git records. The original two-hop graph returned 13 nodes and 12 source-backed relationships after restart. Counts describe only that bounded view.                                                                                                                                           |
| Knowledge at risk                 | PASS for returned live sample                  | The API returned observed contributors and actual commit links for indexed files, together with history-window and partial-coverage caveats. This does not prove a person knows or does not know the code.                                                                                                                                                                                                                                                           |
| Missing evidence and model outage | PASS                                           | An unsupported live question returned `not_found` with zero claims. With no model configured, a supported-topic question returned `unavailable`, while search and graph remained usable.                                                                                                                                                                                                                                                                             |

The local Windows Node runtime required `NODE_USE_SYSTEM_CA=1` to trust the machine's certificate chain. TLS verification remained enabled. Existing GitHub authentication was used only for public read-only collection; no token is stored in this record or repository.

An initial frontend build inside a worktree nested under `node_modules` produced a larger generated CSS file. Rebuilding the same A+B checkout after moving it to a normal workspace path resolved the difference: SHA-256 hashes of the main CSS, workspace, graph and 3D-scene chunks matched the original frontend build. No frontend source or styling was changed.

## Open acceptance gates

- The shared contract is proposed for B/C/D review; it is not an accepted team contract yet. D has not replaced the provisional frontend schemas or performed a complete browser-to-live-backend journey.
- C's real static analyzer, dependency paths, PR-check service and automatic GitHub Actions report are not present. Impact/PR routes return explicit unavailable errors until C's adapters are connected. The worker marks structural coverage as not attempted.
- A real model-generated supported answer and semantic-support validation against a live provider were not tested. The observed model-unavailable behavior is not a successful generated answer.
- Docker Compose and hosted deployment were not run because Docker is unavailable here. GitHub CI results must be checked on the actual PR after it is published.
- Recovery from every possible process/DB failure and production-scale graph/performance behavior remain unverified. The queue tests cover atomic enqueue, concurrent deduplication and terminal-state reconciliation, not a comprehensive chaos test.
- B's draft still needs review and merge through the integration branch. C/D work and seven-capability acceptance remain team gates; this record does not claim A or the product is fully complete.
