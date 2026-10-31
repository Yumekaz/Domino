# Domino frontend

A cinematic product launch and an evidence-led engineering workspace for INNOVISTA PS06.

The authoritative product specification is `PROJECT_BRAIN_PS06_MASTER_SPEC.md`; the creative brief is `DOMINO_FRONTEND_CREATIVE_AND_CODEX_SPEC.md`. The desktop frontend lives in `apps/web`. The role A backend branch adds shared contracts, Fastify, PostgreSQL migrations and pg-boss integration; the historical implementation remains in role B's separate draft PR until reviewed and integrated.

## Run

Requires Node.js 22.12+ (validated with 22.20.0) and npm.

```powershell
cd apps/web
npm ci
npm run dev
```

Open the printed local URL. `/` is the launch; `/app` connects repositories. Vite proxies `/api` to `http://127.0.0.1:3000`. Configure `VITE_API_BASE_URL` in `.env.local` to use another API origin; do not include `/api/v1` in that value. Only public configuration belongs in `VITE_` variables.

**Live mode is the default.** Without the API, import and analysis show honest connection errors. The web client still uses provisional decoders; D must bind it to the accepted shared contracts. A separately tested A+B checkout has ingested a public repository, but a live model answer, C's impact/PR service, and complete web-to-backend acceptance are not yet verified.

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

- [Proposed backend contracts, endpoints, setup boundaries and remaining integration gates](docs/API_CONTRACTS.md)
- [Backend validation and live integration evidence](docs/BACKEND_VALIDATION.md)
- [Desktop frontend freeze and current verification](docs/frontend/final/VISUAL_FREEZE.md)
- [Spatial graph revision and the test-harness/product distinction](docs/frontend/network/GRAPH.md)
- [Current investigation studio, desktop critique, and verification](docs/frontend/studio/HANDOFF.md)
- [Previous desktop north star and iteration evidence](docs/frontend/desktop-northstar/DESKTOP_NORTHSTAR.md)
- [Design direction and reference research](docs/frontend/DESIGN.md)
- [API integration assumptions and backend gaps](docs/frontend/INTEGRATION.md)
- [Asset provenance and generation prompts](docs/frontend/ASSETS.md)
- [First-pass visual QA and acceptance evidence](docs/frontend/QA.md)

For deployment, serve `apps/web/dist` with SPA fallback to `index.html`, route `/api/v1` to the backend, and use HTTPS. Do not deploy the Vite development server. Source publication does not deploy or host the application.

## Backend development (role A)

Use Node 22.12+ and PostgreSQL 13+. The backend and frontend retain separate lockfiles. From the repository root:

```powershell
npm ci --ignore-scripts
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE'
npm run db:migrate
npm run dev:api
```

In a second terminal with the same `DATABASE_URL`, run `npm run dev:worker`. The worker requires B's reviewed history packages to be present; before B is integrated it exits with a clear error. The API starts without them but history-backed routes remain unavailable. C's impact/PR services are not yet connected, so imported snapshots explicitly remain partial until structural analysis is implemented. Use only an isolated development database. PostgreSQL migrations are checksum-verified and forward-only.

For installations with a corporate/system TLS root, Node can use the operating system certificate store with `NODE_USE_SYSTEM_CA=1`; do not disable certificate verification. Configure GitHub/model tokens only in the server environment. `DOMINO_GITHUB_TOKEN` is optional for public imports but avoids the much lower anonymous GitHub rate limit.

`docker-compose.yml` and `Dockerfile` provide a local PostgreSQL/API/worker layout. Copy `.env.example` to `.env` and `.env.postgres.example` to `.env.postgres`; set the same URL-safe database password in the PostgreSQL file and `DATABASE_URL`, and set a long random `DOMINO_API_TOKEN`. Then run `docker compose up --build`. The container API requires `Authorization: Bearer <token>`; D must configure a secure development proxy or other agreed browser authentication before using the existing web client against this mode. Compose has not been tested on this machine because Docker is unavailable.

Backend checks: `npm run typecheck` and `npm test`. Real PostgreSQL/queue tests run only with `DOMINO_ALLOW_POSTGRES_TESTS=1` and `DOMINO_TEST_DATABASE_URL` pointing to a database named `domino_a_test`; see `.github/workflows/backend-ci.yml`. The frontend checks remain under `apps/web` and are unchanged.
