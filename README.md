# Domino

A cinematic product launch and an evidence-led engineering workspace for INNOVISTA PS06.

The authoritative product specification is `PROJECT_BRAIN_PS06_MASTER_SPEC.md`; the creative brief is `DOMINO_FRONTEND_CREATIVE_AND_CODEX_SPEC.md`. The desktop frontend lives in `apps/web`. Fastify, PostgreSQL, pg-boss, Git/GitHub history, evidence-backed Q&A and dependency-cruiser power the actual workspace. The web client validates shared Zod contracts. Public imports, model answers and fresh PR-head analysis have been exercised locally; coverage remains bounded and explicitly partial. See [local readiness](docs/LOCAL_READINESS.md) for current evidence and limitations. Hosted deployment is outside the current scope.

## Local presentation

Install the root dependencies with `npm ci --ignore-scripts` and the web dependencies with `npm ci --prefix apps/web`. Configure the ignored root `.env` from `.env.example`, including an existing PostgreSQL database and server-side credentials. Then run:

```powershell
npm run demo
# In another terminal:
npm run demo:doctor
# To stop the app while preserving PostgreSQL and indexed data:
npm run demo:stop
```

Open `http://127.0.0.1:5173`. The supervisor migrates the existing database, builds and verifies the live production frontend, starts the API and both worker queues, and serves the SPA behind a same-origin loopback proxy. It never initializes or resets database data. Optional existing native PostgreSQL paths and the pinned setup helper are described in [local readiness](docs/LOCAL_READINESS.md). Keep runtime data, tools, backups and review artifacts under ignored `.domino`, outside npm-managed directories.

## Run

Requires Node.js 22.12+ (validated with 22.20.0) and npm.

```powershell
cd apps/web
npm ci
npm run dev
```

Open the printed local URL. `/` is the launch; `/app` connects repositories. Vite proxies `/api` to `http://127.0.0.1:3000`. Configure `VITE_API_BASE_URL` in `.env.local` to use another API origin; do not include `/api/v1` in that value. Only public configuration belongs in `VITE_` variables.

**Live mode is the default.** Without the API, import and analysis show connection errors and retry controls. Fixtures never replace a failed live request. The shared contracts are consumed by the API and frontend; genuine source links, exact revisions and coverage caveats stay visible.

## Explicit development fixture

```powershell
npm run dev:fixtures -- --port 5174
```

Open `/app`, then **Open fixture**. Every workspace view labels synthetic data. The isolated fixture is a UI exercise, not a genuine Git repository or computed analysis. It recognizes one exact example question, the `src/auth.ts` impact input, and PR #12. Arbitrary analyses are refused. No source URL or Actions run is invented. Production builds always use live mode, including builds made with `--mode fixtures`; the fixture module is eliminated from the production bundle.

## Verify

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

Client safety and adapter tests cover malformed responses, connection errors, unsupported input, citation membership, URL restrictions, graph integrity, and isolated fixture response families. Browser review exercises the launch and all seven workspace views. This does not replace live integration testing.

## Handoff

- [Shared backend contracts, endpoints and integration boundaries](docs/API_CONTRACTS.md)
- [Current local acceptance and presentation startup](docs/LOCAL_READINESS.md)
- [Backend validation and live integration evidence](docs/BACKEND_VALIDATION.md)
- [Current live workspace, GPT-6 Luna and contributor-change validation](docs/LIVE_WORKSPACE_VALIDATION.md)
- [Optional CBM symbol-source intelligence: setup, boundaries and real-repository acceptance](docs/CODE_INTELLIGENCE.md)
- [Desktop frontend freeze and current verification](docs/frontend/final/VISUAL_FREEZE.md)
- [Spatial graph revision and the test-harness/product distinction](docs/frontend/network/GRAPH.md)
- [Current investigation studio, desktop critique, and verification](docs/frontend/studio/HANDOFF.md)
- [Previous desktop north star and iteration evidence](docs/frontend/desktop-northstar/DESKTOP_NORTHSTAR.md)
- [Design direction and reference research](docs/frontend/DESIGN.md)
- [API integration assumptions and backend gaps](docs/frontend/INTEGRATION.md)
- [Asset provenance and generation prompts](docs/frontend/ASSETS.md)
- [First-pass visual QA and acceptance evidence](docs/frontend/QA.md)

For deployment, serve `apps/web/dist` with SPA fallback to `index.html`, route `/api/v1` to the backend, and use HTTPS. Do not deploy the Vite development server. Source publication does not deploy or host the application.

## Backend development

The standard API, worker and migration commands load an optional ignored root `.env`. Configure `DOMINO_OPENAI_API_KEY` there and keep `DOMINO_LLM_MODEL=gpt-6-luna`. Q&A uses a bounded evidence pack, 600 output tokens and no automatic model retries. The development proxy reads `DOMINO_API_TOKEN` server-side from the root or web environment; no credentials belong in `VITE_` variables. `npm run start:api` and `npm run start:worker` are also available for runtime use.

Use Node 22.20+ for the complete local launcher/test workflow (verified locally on 22.20.0; CI and Docker use 24.11.1) and PostgreSQL 13+. The individual API/worker packages retain their Node 22.12+ baseline. The backend and frontend use separate lockfiles. From the repository root:

```powershell
npm ci --ignore-scripts
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE'
npm run db:migrate
npm run dev:api
```

In a second terminal with the same `DATABASE_URL`, run `npm run dev:worker`. The worker registers `history.import` and `analysis.impact`. Imports collect Git/GitHub history and run the pinned structural analyzer at an exact SHA before publishing a snapshot. Manual PR checks enqueue an isolated exact-head structural analysis; they do not require the default branch snapshot to match the PR. The workspace's main index stays intact. Missing analyzer coverage remains visible. PostgreSQL migrations are checksum-verified and forward-only. `npm run demo` manages these services together.

The separate read-only `.github/workflows/pr-impact.yml` produces GitHub summaries. Optional `DOMINO_ACTIONS_SYNC=1` observes successful public workflows at that configured path and queues a locally recomputed check only for the current PR head. It retains the genuine Actions link; it does not import remote artifacts or execute imported workflows. This needs a server-side GitHub token and opens no public ingress.

For installations with a corporate/system TLS root, Node can use the operating system certificate store with `NODE_USE_SYSTEM_CA=1`; do not disable certificate verification. Configure GitHub/model tokens only in the server environment. `DOMINO_GITHUB_TOKEN` is optional for public imports but avoids the much lower anonymous GitHub rate limit.

Optional function/method evidence enrichment is available through pinned Codebase Memory MCP 0.12.1. Run `npm run setup:cbm` on Windows x64 and follow [the setup and acceptance record](docs/CODE_INTELLIGENCE.md). It is disabled by default, needs no embeddings or extra model calls, and retains baseline ingestion if the native engine is unavailable. Restart the worker and reindex to enrich a new snapshot.

`docker-compose.yml` and `Dockerfile` provide a local PostgreSQL/API/worker layout. Copy `.env.example` to `.env` and `.env.postgres.example` to `.env.postgres`; set the same URL-safe database password in the PostgreSQL file and `DATABASE_URL`, and set a long random `DOMINO_API_TOKEN`. Then run `docker compose up --build`. The container API requires `Authorization: Bearer <token>`; set the same `DOMINO_API_TOKEN` in the shell that runs the Vite dev server so its `/api` proxy adds the header without exposing the token to the browser. A production static host needs an equivalent server-side reverse proxy. Compose has not been tested on this machine because Docker is unavailable.

Backend checks: `npm run typecheck` (contracts, API, database, history and impact packages) and `npm test` (Vitest API/migration/impact tests plus the history, retrieval, evidence, knowledge-risk, dependency-adapter and PR-action suites). Focused commands are `npm run typecheck:history`, `npm run test:history`, `npm run typecheck:impact` and `npm run test:impact`. Real PostgreSQL/queue tests run only with `DOMINO_ALLOW_POSTGRES_TESTS=1` and `DOMINO_TEST_DATABASE_URL` pointing to a database named `domino_a_test`; live Git/GitHub tests require `DOMINO_LIVE_GIT=1` or `DOMINO_LIVE_GITHUB=1`. See `.github/workflows/backend-ci.yml` and `.github/workflows/pr-impact.yml`. Frontend checks remain under `apps/web`. Server-side model configuration is documented in [the history handler notes](apps/worker/src/handlers/history/README.md). Live model results and conservative validation limits are recorded in [the walkthrough](docs/DEMO_PLAN.md).
