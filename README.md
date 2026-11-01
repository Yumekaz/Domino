<p align="center">
  <img src="apps/web/public/assets/domino-mark.png" width="76" alt="Domino logo" />
</p>

# Domino

**Know why code changed. See what another change could affect.**

Domino is an engineering memory and investigation workspace for public GitHub repositories. It brings source code, project history and recorded relationships into one place, so developers can follow a decision to its evidence and explore the possible consequences of a change.

Built for INNOVISTA PS06, Domino pairs a cinematic product launch with a working local engineering workspace. It is a hackathon MVP, not a hosted production service.

## What you can do

- **Connect a repository.** Import available Git history, GitHub issues, pull requests, discussions and source excerpts into an indexed snapshot tied to a revision. The workspace shows coverage and warns when collection is partial.
- **Follow connected history.** Search indexed records, explore their relationships and open original sources from the evidence inspector.
- **Ask Domino.** Ask questions about indexed history and inspect the sources behind returned claims. Domino can return partial or not-found results when it cannot support an answer. Inspect sources: citation validation is not a guarantee of correctness.
- **Trace change impact.** Enter repository-relative paths or a proposed diff to explore possible direct and transitive dependents. Historical co-change is shown separately as an association, not a dependency or a prediction of breakage.
- **Explore the memory graph.** Navigate a bounded network of records and relationships, with filters, source inspection and a record-list alternative.
- **Find knowledge at risk.** Review observed contributors to files in indexed Git history. A single observed contributor is a reason to investigate, not proof that only one person understands the code.
- **Review pull requests.** Request an analysis of a public PR's head revision and inspect its changed files, possible impact, status and coverage. An optional integration can observe a successful GitHub Actions run and trigger a locally recomputed report.

## How it works

```text
Public GitHub repository
       │
       ▼
Git / GitHub history + source files ──► Background worker
                                           │
                           Static imports + source evidence
                                           │
                                           ▼
                            PostgreSQL indexed snapshot
                                           │
                              API + shared contracts
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
           History, impact and graph                    Evidence-backed Q&A
                    │                                   (model + validation)
                    └──────────────────────┬──────────────────────┘
                                           ▼
                                  Domino web workspace
```

The React, TypeScript and Vite frontend uses Cytoscape.js for the interactive graph. The backend uses Fastify, PostgreSQL, pg-boss and Git/GitHub adapters. Dependency-cruiser supplies supported static import relationships; the optional Codebase Memory MCP integration adds function and method excerpts. Q&A retrieves indexed evidence before asking a configured model.

## Run locally

### Prerequisites

- Node.js **22.20 or later**, npm and Git.
- A running local PostgreSQL database (PostgreSQL 13+), with an existing database and credentials. The demo launcher does not create or reset your database.
- An OpenAI API key and a model available to your account for AI answers. Other workspace features can be explored without a configured model; Q&A will report its availability.
- Optional: a GitHub token for public repository imports. Unauthenticated requests have lower rate limits.

1. Install dependencies from the repository root:

   ```powershell
   npm ci --ignore-scripts
   npm ci --prefix apps/web
   ```

2. Copy `.env.example` to `.env` and configure it for your **local** PostgreSQL instance. The example file's `postgres` hostname is for Compose; use a loopback hostname such as `127.0.0.1` with the local demo launcher. Set the database credentials for your existing instance, and add any model or GitHub credentials server-side. Never commit `.env` or put secrets in `VITE_` variables.

   ```dotenv
   DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE
   DOMINO_GITHUB_TOKEN=
   DOMINO_OPENAI_API_KEY=
   DOMINO_LLM_MODEL=gpt-6-luna
   ```

   Use a model name available to your account. The provided Windows helper can start an already initialized PostgreSQL 17 cluster when its binary and data paths are configured; see [local setup and recovery](docs/LOCAL_READINESS.md#run-and-recover-locally).

3. Start the local stack:

   ```powershell
   npm run demo
   ```

   Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)**. The launcher migrates the existing database, builds the frontend and starts the API, worker queues and loopback web proxy. Leave the terminal running.

4. From another terminal, check or stop the managed services:

   ```powershell
   npm run demo:doctor
   npm run demo:stop
   ```

   Stopping the app preserves the database and indexed data. The launcher is for local use; it is not a public deployment.

## Try an investigation

1. Open the workspace and connect a public GitHub repository, such as `https://github.com/sindresorhus/yocto-queue`. Wait for indexing and check the coverage notes.
2. In **Connected history**, select a record and inspect its original source.
3. In **Ask Domino**, ask a specific question about available project evidence and inspect any cited sources.
4. In **Change impact**, enter an actual path from that repository, such as `index.js` in yocto-queue. Select a returned dependent to inspect the path and evidence. Results describe possible impact, not confirmed failures.

Imports and answers depend on GitHub availability, rate limits, the selected revision and available evidence. A question can return no answer, even when related source material exists; inspect the original records and coverage notes.

## Development and checks

The root package manages the API, worker and backend packages. The web app has its own package and lockfile. To run the backend and Vite separately, configure `.env`, then run `npm run db:migrate`, `npm run dev:api` and `npm run dev:worker` from the root in separate terminals. Run `npm run dev` in `apps/web`; Vite proxies `/api` to the local API on port 3000. `VITE_API_BASE_URL` can point to a different API origin and must not contain `/api/v1`.

```powershell
# Backend, from the repository root
npm run typecheck
npm test

# Frontend
npm run typecheck --prefix apps/web
npm run lint --prefix apps/web
npm test --prefix apps/web
npm run build --prefix apps/web
npm run verify:production --prefix apps/web
```

Production builds use the live API; connection failures are shown rather than replaced with sample results. A separate development-only renderer harness is available with `npm run dev:renderer` in `apps/web`.

An optional, pinned Codebase Memory MCP adapter adds function and method source excerpts without introducing dependency edges or extra model calls. See [setup and boundaries](docs/CODE_INTELLIGENCE.md). A separate [GitHub Actions workflow](.github/workflows/pr-impact.yml) can generate a read-only PR impact summary; optional observation inside Domino requires server-side configuration described in [local readiness](docs/LOCAL_READINESS.md).

## Scope and limitations

- Public GitHub repositories are supported; structural analysis is JavaScript/TypeScript-first and bounded by the indexer's file, history and resolver limits.
- Indexed history can be partial. Missing relationships, dynamic behavior and runtime effects may not be captured.
- Model answers and citation checks are fallible. An answer can be partial, unavailable or not found; a source link is not proof that an interpretation is correct.
- Contributor observations describe indexed commit history, not actual ownership or knowledge. Impact paths indicate what to investigate, not guaranteed breakage.
- Local desktop operation has been exercised with real repositories. Hosted deployment, production hardening, complete cross-browser accessibility and mobile acceptance are not claimed as complete.

## Further reading

- [Product and backend specification](PROJECT_BRAIN_PS06_MASTER_SPEC.md)
- [Frontend creative brief](DOMINO_FRONTEND_CREATIVE_AND_CODEX_SPEC.md)
- [API contracts and integration boundaries](docs/API_CONTRACTS.md)
- [Local startup, acceptance and limitations](docs/LOCAL_READINESS.md)
- [Optional code intelligence](docs/CODE_INTELLIGENCE.md)
- [Design direction and research](docs/frontend/DESIGN.md)
- [Graph design and accessibility](docs/frontend/network/GRAPH.md)
