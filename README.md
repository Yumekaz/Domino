<div align="center">
  <img src="apps/web/public/assets/domino-mark.png" width="82" alt="Domino logo" />
  <h1>Domino</h1>
  <p><strong>Know why code changed. See what could follow.</strong></p>
  <p>Engineering memory for the decisions, dependencies and people behind a codebase.</p>
  <p><a href="#explore-domino">Explore Domino</a> · <a href="#how-it-works">How it works</a> · <a href="#run-locally">Run locally</a> · <a href="#scope-and-limits">Scope &amp; limits</a></p>
  <p><sub>INNOVISTA · PS06 &nbsp; / &nbsp; HACKATHON MVP</sub></p>
</div>

---

When a developer leaves or a project grows, the code stays—but the reasoning behind it can be scattered across commits, issues, pull requests and conversations. **Domino connects that context** so teams can investigate a change with its evidence in view.

## Explore Domino

| Investigation | What Domino helps you do |
| --- | --- |
| **Connected history** | Search project records, follow relationships and inspect original sources. |
| **Ask Domino** | Ask about indexed history and examine the evidence behind supported claims. |
| **Change impact** | Trace possible direct and indirect dependents of changed files. Historical co-change is shown separately. |
| **Memory graph** | Explore a bounded network of files, commits, pull requests and discussions. |
| **Knowledge at risk** | Find files with concentrated *observed* contributor history—a prompt to share context. |
| **PR checks** | Analyze a pull request's head revision and explore possible affected paths. |

## How it works

```mermaid
flowchart LR
    A["Public GitHub repository"] --> B["Background worker<br/>Git + GitHub history"]
    B --> C["Source evidence<br/>+ static imports"]
    C --> D[("PostgreSQL<br/>indexed snapshot")]
    D --> E["API + shared contracts"]
    E --> F["History + memory graph"]
    E --> G["Change impact + PR checks"]
    E --> H["Evidence retrieval<br/>+ AI answer validation"]
    F & G & H --> I["Domino workspace"]
    classDef blue fill:#123fba,stroke:#4475ff,color:#fff
    classDef dark fill:#101b2e,stroke:#6d91c9,color:#fff
    classDef orange fill:#ff914f,stroke:#ffb27e,color:#101b2e
    class A,D dark
    class B,C,E,F,G,H blue
    class I orange
```

The workspace uses **React, TypeScript, Vite and Cytoscape.js**. A **Fastify API, PostgreSQL and background workers** collect and serve the indexed data. Dependency-cruiser supplies supported static import relationships; optional [Codebase Memory MCP](docs/CODE_INTELLIGENCE.md) adds source excerpts.

## Run locally

**You'll need:** Node.js 22.20+, npm, Git, and an existing PostgreSQL database. A configured OpenAI key is needed for AI answers; a GitHub token is optional for public imports.

```powershell
npm ci --ignore-scripts
npm ci --prefix apps/web
```

Copy `.env.example` to `.env` and configure your existing local database and optional credentials. Use a model available to your account:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE
DOMINO_GITHUB_TOKEN=
DOMINO_OPENAI_API_KEY=
DOMINO_LLM_MODEL=gpt-6-luna
```

Keep credentials out of Git and browser-facing `VITE_` variables. Then start the local stack:

```powershell
npm run demo
```

Open **[localhost:5173](http://127.0.0.1:5173)**. The launcher builds the frontend, migrates the existing database and starts the API, worker and local web proxy. Leave its terminal running. To check readiness or stop managed services, use `npm run demo:doctor` or `npm run demo:stop`. Stopping preserves indexed data. See [local setup and recovery](docs/LOCAL_READINESS.md#run-and-recover-locally) for PostgreSQL configuration and troubleshooting.

## Try an investigation

1. Connect a public repository, for example [sindresorhus/yocto-queue](https://github.com/sindresorhus/yocto-queue), and review the index coverage.
2. Open **Connected history** to inspect a record and its original source.
3. Ask a specific question in **Ask Domino**, then inspect any citations.
4. In **Change impact**, enter `index.js` and explore the returned dependency paths.

## Scope and limits

- Public GitHub repositories are supported; structural analysis is **JavaScript/TypeScript-first** and coverage may be partial.
- Impact paths show **possible consequences**, not confirmed failures. Co-change is a historical association, not an import.
- AI answers can be partial, unavailable or withheld even when related evidence exists. Citations help inspection; they do not guarantee semantic correctness.
- Contributor counts describe indexed commit history, not who actually understands the code.
- This is a locally exercised hackathon MVP. Hosted deployment and production readiness are not claimed.

## More information

[Product specification](PROJECT_BRAIN_PS06_MASTER_SPEC.md) · [Frontend brief](DOMINO_FRONTEND_CREATIVE_AND_CODEX_SPEC.md) · [API contracts](docs/API_CONTRACTS.md) · [Local readiness](docs/LOCAL_READINESS.md) · [Design direction](docs/frontend/DESIGN.md)
