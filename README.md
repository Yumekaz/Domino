# Domino frontend

A cinematic product launch and an evidence-led engineering workspace for INNOVISTA PS06.

The authoritative product specification is `PROJECT_BRAIN_PS06_MASTER_SPEC.md`; the creative brief is `DOMINO_FRONTEND_CREATIVE_AND_CODEX_SPEC.md`. This implementation adds **frontend code only** under `apps/web`. No backend, database, worker, or GitHub Action has been created or changed.

## Run

Requires Node.js 22.12+ (validated with 22.20.0) and npm.

```powershell
cd apps/web
npm ci
npm run dev
```

Open the printed local URL. `/` is the launch; `/app` connects repositories. Vite proxies `/api` to `http://127.0.0.1:3000`. Configure `VITE_API_BASE_URL` in `.env.local` to use another API origin; do not include `/api/v1` in that value. Only public configuration belongs in `VITE_` variables.

**Live mode is the default. This repository does not contain the backend.** Without it, import and analysis show honest connection errors. HTTP endpoint adapters exist; successful live ingestion, evidence retrieval, and PR execution have not been validated.

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

- [Current investigation studio, desktop critique, and verification](docs/frontend/studio/HANDOFF.md)
- [Previous desktop north star and iteration evidence](docs/frontend/desktop-northstar/DESKTOP_NORTHSTAR.md)
- [Design direction and reference research](docs/frontend/DESIGN.md)
- [API integration assumptions and backend gaps](docs/frontend/INTEGRATION.md)
- [Asset provenance and generation prompts](docs/frontend/ASSETS.md)
- [First-pass visual QA and acceptance evidence](docs/frontend/QA.md)

For deployment, serve `apps/web/dist` with SPA fallback to `index.html`, route `/api/v1` to the backend, and use HTTPS. Do not deploy the Vite development server. Source publication does not deploy or host the application.
