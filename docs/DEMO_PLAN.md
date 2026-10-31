# Domino demo plan

## Current local presentation startup

Run `npm run demo` from the repository root with the existing ignored `.env` configured. Open `http://127.0.0.1:5173`; `npm run demo:doctor` verifies local readiness. `npm run demo:stop` stops the owned app processes while preserving PostgreSQL and indexed data. The launcher builds the live production frontend, checks fixture/credential exclusion, and manages the API and both worker queues. See [LOCAL_READINESS.md](LOCAL_READINESS.md) for the final acceptance record.

No hosted deployment or public sample publication is part of this pass. Keep the prepared sample local, as the user requested. Present genuine public repository data and its actual partial-coverage notes. A pre-indexed repository is a practical network precaution; public import has also been exercised on multiple repositories.

## Rehearsed public-repository walkthrough

The following steps use real indexed data, not a fixture. The source and the
repository may change; always rehearse on the presentation machine immediately
before the demo and check the snapshot SHA and coverage shown in the app.

1. Connect or reopen `https://github.com/sindresorhus/yocto-queue`. A rehearsal
   on 31 October 2026 used `main` at
   `72a8fa96a9d389765cdf2bb9c6daba8302fc375d`. Its overall coverage was partial;
   show the coverage notes rather than suggesting that all history was indexed.
2. In Connected history, search `iterator` and open the 4 March 2025 comment on
   issue #11 at
   `https://github.com/sindresorhus/yocto-queue/issues/11#issuecomment-2696500039`.
   Use **Ask about this record**, then ask: “Why was a separate drain() method
   added instead of changing the existing iterator to dequeue items?” Select a
   claim and inspect the original source. One live run returned two inferred
   claims explaining the breaking-change concern and the suggested separate
   method. Other runs returned partial answers; the output is generated, not a
   guaranteed script. If it is partial or unavailable, show the actual status
   and original discussion instead of repeating calls or claiming success.
3. Ask an unrelated question with no selected record, and show `not found` when
   no indexed source matches. With an entity selected, focus evidence can still
   be retrieved even for an unrelated question, so clear the focus first.
4. Trace `index.js` in Change impact. In this snapshot `test.js` and
   `index.test-d.ts` were direct possible dependents; the co-change entries
   were separate historical associations. Inspect an actual source link.
5. Open `index.js` in the graph, use the accessible record list to inspect a
   connection, and show the risk view's observed-contributor caveats.
6. In PR checks, request public `yocto-queue` PR **12**. The registered worker now analyzes its exact head independently of the default branch index. A verified local run used head `87d4a591b6584b9120a16daea822c919ff36c1ee` and base `0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b`, reported partial structural coverage and retained the workspace snapshot. Inspect actual SHAs and warnings because upstream revisions can change. Failed/cancelled runs have a retry control.

The validator requires each returned claim to be a complete source sentence from every
cited source and also checks citation membership and conservative text support.
It may withhold valid paraphrases or fragments; it does not establish whether a quote is
complete or representative in context. Inspect the original source before
presenting a claim as fact. Source excerpts can be bounded and their original
GitHub links remain the definitive context.

For a larger graph, a separate rehearsal indexed the public `sindresorhus/ky`
repository at `3541888878c4d303a8bc2ad61815f4e048f55a5d`. It returned 182
structural imports with **partial** coverage because its extended TypeScript
configuration was unavailable. A three-hop neighborhood of `source/core/Ky.ts`
showed 79 records and 275 relationships; the graph is bounded, not a complete
repository-wide map. Search results are paginated: use **Load more starting
points** if a file is preceded by many historical revisions. Spatial arrangement now runs in a Web Worker. A measured first-use selection still had a brief main-thread pause; settled panning/zooming was smoother. Use **Expand map**, zoom to readable labels, and inspect individual records. See the measurements in local readiness.

Two additional public repositories were checked on 31 October 2026:

- `sindresorhus/p-limit` at `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`:
  partial overall coverage, four indexed structural imports, a source-linked
  question about issue #87, three possible direct dependents of `index.js`, and
  observed contributor counts. A manual analysis of PR #109 was stale because
  the PR head differed from the indexed default branch; no result was invented.
- `expressjs/cors` at `5317ebe670db2aaebc1d496eb5d33493deefb3ed`:
  partial overall coverage, four indexed structural imports, four possible
  direct dependents of `lib/index.js`, a five-record graph and observed
  contributor counts. Both imports reported unresolved/external imports.

The launch's domino reset and story controls, a history interaction, impact
story interaction and the workspace link were exercised in a desktop browser
before the p-limit import. This is not proof that every public repository,
language, browser or network will work. Do not treat a stale manual PR run as
a fresh impact report: refreshing the default branch may not index the PR head.

Optional local Actions observation is now implemented and was verified against an existing successful public `pr-impact.yml` run. Its genuine URL is retained and its report is explicitly labelled as locally recomputed. The sample was not published. This does not establish a hosted event-ingestion service. The longer matrix below retains historical acceptance criteria and earlier state notes for context.

**Latest live proof:** see [Local readiness](LOCAL_READINESS.md) for current PR-head queues, recovery and desktop review, and [Live workspace validation](LIVE_WORKSPACE_VALIDATION.md) for earlier contributor-history replay and reindex evidence. The original status matrix below is historical. Hosted delivery and broad cross-engine/assistive-technology acceptance are not claimed.

Historical baseline status: **integration complete, live acceptance pending.** The following original matrix covers the integrated
A/B/C backend and shared-contract frontend on `codex/backend-integration`. The code, tests, local
analyzer dry run and fixture browser journeys pass; a fresh live import, live model answer, live
PR Actions run, deployment and performance/browser acceptance remain required gates. Fixture-mode UI
exercises are labelled synthetic and are never evidence of ingestion, analysis, authorship or
Actions output.

- Repository: https://github.com/Yumekaz/Domino
- Role / owner: D (frontend integration and final acceptance)
- Frontend freeze: `0716669e7140f5a722ad5208e6bde2a63ac3e903`; verified documentation at
  `docs/frontend/final/VISUAL_FREEZE.md`.
- Shared contracts: integrated in `packages/contracts`; the web client imports them and fixture data
  is contract-valid.
- Services: `apps/api`, worker, PostgreSQL migration/queue composition, B history and C structural
  analysis/PR action are integrated. Live deployment/database credentials remain a gate.
- Mobile: deferred by the user; this plan covers desktop acceptance only.

## Rules for this demo

1. Backend values are authoritative. The browser never computes impact, risk, contributor counts,
   claim support, graph expansion or repository-wide totals.
2. Fixture mode is `import.meta.env.DEV && VITE_DATA_MODE === 'fixture'`. It must never be enabled in
   production or used as an error fallback.
3. Every indexed or analyzed result displays its revision and coverage. Stale, partial and
   unavailable states remain visible.
4. No secrets in `VITE_` variables, URLs, browser storage, screenshots or logs.
5. Evidence records the data mode, viewport, browser, revision and actual input. Unperformed checks
   are reported as NOT PERFORMED.

## Prerequisites and setup verification

Node.js 22.12+ and npm are required.

```powershell
cd apps/web
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:production
```

Expected result on this branch: typecheck, lint, **40 Vitest tests across 5 files**, production
build and fixture-exclusion verification pass. `npm test` covers malformed responses, transport
errors, obsolete-read cancellation, the request timeout map, citation membership, URL restrictions,
fixture boundaries and returned graph integrity. The build prints the disclosed lazy Three.js chunk
warning (~568 kB minified); do not raise the threshold to hide it.

Start the real stack from the repository root with an isolated database:

```powershell
npm ci --ignore-scripts
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE'
npm run db:migrate
npm run dev:api
# second terminal, same DATABASE_URL
npm run dev:worker
```

```powershell
# Live UI (proxies /api to 127.0.0.1:3000 by default)
cd apps/web
npm run dev

# Synthetic UI exercise only, never for acceptance
npm run dev:fixtures -- --port 5174

# Production preview after a build
npm run preview
```

For the container API, set `DOMINO_API_TOKEN` in the shell running Vite; the dev proxy adds the
Bearer header server-side. Do not place the token in `VITE_` values.

Verify the live API through the same path the browser uses:

```powershell
curl.exe http://127.0.0.1:5173/api/v1/health
```

A 502/non-JSON response means the API is not reachable and no live step can pass. The frontend shows
an explicit error with retry and does not load fixtures.

## Demo data and provenance

Use one public JS/TS repository agreed with A/B/C, or a legitimately pre-indexed public snapshot
with its disclosed SHA and indexing date. Record:

- repository ID and canonical URL
- indexed branch and full head SHA
- indexing completion time and per-source coverage
- whether history or files were capped, and which categories are partial
- the exact issue/PR/commit/file used for the connected-memory story

A controlled public demo repository with genuine commits and PRs is acceptable when labelled.
Fixture data from `development-fixture` is never acceptable demo evidence.

## Runbook: seven capabilities

Current live status: **NOT PERFORMED**. The code paths and fixture journeys pass; the live run
requires a migrated database, a worker-run public import, a model credential for M3 and a real PR
event for the Actions summary. The manual PR run analyzes the indexed snapshot and is marked stale
when the snapshot SHA differs from the PR head; the automatic workflow analyzes the fresh head.

### M1 — History collection (owner A/B)

1. Paste a public GitHub URL into the existing connection form on `/app` or the launch doorway.
2. Follow the returned job/status and confirm actual phase progression, not a simulated percentage.
3. Inspect the published snapshot: full SHA, branch, completion time and per-source coverage.
4. Exercise a reindex and a partial/failed/private/rate-limited response.

Evidence: repository ID, job IDs, status transitions, coverage values, SHA, refresh persistence.

### M2 — Connected memory (owner B/A)

1. Search a real record from `/app/repositories/:repoId/history`; paginate where available.
2. Open a genuine issue → PR → commit → file chain.
3. Inspect sources/neighbors, then open the original GitHub source links.
4. Confirm selection continuity into graph and Q&A routes.

Evidence: entity IDs and URLs for each hop; pagination cursors; source locator/excerpt.

### M3 — Evidence Q&A (owner B/A)

1. Ask a supported design-rationale question.
2. Open each claim's cited source; confirm the excerpt and locator support the claim.
3. Ask a genuinely unsupported question; expect an explicit not-found answer with no claims.
4. With B/A, exercise a malformed/dangling citation and a model outage.

Evidence: supported/not_found/partial/outage states, claim-to-source mapping, server validation
result. Client citation membership alone is not semantic proof.

### M4 — Change impact (owner C/A)

1. Submit one or more repository-relative changed files (or an agreed proposed diff).
2. Verify direct and transitive paths, hop depth, analyzer signal, evidence line and warnings.
3. Select each returned signal independently, including structural and historical co-change entries
   for the same file.
4. Confirm the declared snapshot SHA and stale/partial behavior.

Evidence: returned paths/file IDs, evidence locators, warnings, analyzer revision. The frontend must
not perform traversal or invent a missing path.

### B1 — Connected-memory graph (owner A + existing frontend)

1. Open a bounded neighborhood from a real entity at depth 1–3.
2. Verify every visible node/edge exists in the API response and every edge opens source proof.
3. Apply the finalized kind/verification/date filters and expansion; confirm truncation/warnings.
4. Select a record, traverse to a changed file, and open the exact GitHub source.

Evidence: API response IDs versus visible graph IDs, expansion bounds, source URLs.

### B3 — Knowledge at risk (owner B/A)

1. Open `/risk` for a real snapshot; record observed contributor counts, history window and caveats.
2. Open a file's underlying contribution sources.
3. In the controlled repository, have a genuine second contributor modify the file, reindex, and
   confirm the observed-author classification changes.

Evidence: before/after contributor counts, commits/authors, window, alias/truncation caveats.

### B2 — Automatic PR check (owner C/A)

1. Open or update a PR in the controlled repository to trigger the read-only Actions run.
2. Open the run on `/pr`, record PR number, event, base SHA, head SHA, result revision and the actual
   Actions summary URL.
3. Add a commit to the PR head, wait for the synchronized run, and verify a different head SHA and a
   refreshed result.

Evidence: two real head SHAs, two Actions run URLs, changed inputs/results. Do not imply a PR comment
exists unless one was actually posted.

## Failure and truthfulness rehearsal

Rehearse and capture each state with its machine-readable error code:

- private/invalid repository
- GitHub rate limit or partial import
- unsupported language/analyzer gap
- stale snapshot versus newer PR head
- unsupported Q&A / no supporting history
- invalid or dangling citation (withheld answer)
- model outage while search/graph/impact remain usable
- failed/cancelled analysis run; polling must terminate
- API unavailable: the UI must show a real connection/proxy error with retry and must not load
  fixtures

## Random source inspection

During the demo, an audience member selects an arbitrary indexed file, issue or PR. Open its source
proof and original GitHub URL. If no evidence or locator is returned, show the explicit unavailable
state. Never substitute a nearby record.

## Evidence capture

- Desktop screenshots at 1366×768 and 1440×1000, with the data-mode banner visible when synthetic.
- Record browser version, viewport, revision, input and actual response identifiers.
- Store sanitized acceptance evidence outside committed source; distinguish fixture, live, desktop,
  mobile, screenshot and performance results.
- Performance results must name the environment and be foreground. No production motion or
  graph-scale result has been accepted for this branch yet; the D-09 gate remains open.
- Cross-browser and assistive-technology checks must be reported as PASS, FAIL, BLOCKED or NOT
  PERFORMED, not inferred from a screenshot.

## Known blockers and limitations

| Area                                           | State                        | Owner / next action                                                              |
| ---------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| Shared runtime contracts                       | Integrated                   | Shared schemas consumed by the web client; live round trips still required       |
| Live import, search, Q&A, impact, risk, PR run | NOT PERFORMED locally        | Run the integrated worker/API against an isolated database and public repo       |
| Live model answer / outage                     | NOT PERFORMED                | Configure a server-side provider and rehearse supported/not-found/unavailable    |
| Live PR Actions summary                        | NOT PERFORMED                | Merge the read-only workflow to the base branch, then open/synchronize a real PR |
| Graph-scale acceptance                         | NOT PERFORMED; no real graph | Use a representative bounded live neighborhood                                   |
| Deployment/CORS/origin                         | NOT PERFORMED                | Configure HTTPS, same-origin routing and reverse-proxy auth                      |
| Mobile                                         | Deferred                     | User priority decision                                                           |

## Pre-demo go/no-go

A demo is ready only when: shared contracts are accepted and bound; every live step above has real
IDs/URLs/SHAs; unsupported and failure states have been rehearsed; the production build passes
`verify:production`; and no fixture or invented value appears in the acceptance path.
