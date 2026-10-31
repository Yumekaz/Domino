# Optional symbol-source intelligence

Domino can use **Codebase Memory MCP 0.12.1** to supplement source retrieval with function and method excerpts. This is an opt-in native adapter. PostgreSQL, Git history and dependency-cruiser remain the primary implementation; endpoint paths and response contracts are unchanged.

## What it adds

The existing history pipeline indexes a bounded number of initial file chunks. A useful function farther down a file can be outside those chunks. CBM parses the exact-SHA checkout, exports function/method locations, and Domino reads those locations from the actual checkout. The resulting `code_symbol` evidence includes the file, qualified symbol name, full revision, line range, content hash, engine version and original GitHub line link.

These excerpts enter the same PostgreSQL evidence index used by history search, evidence inspection and Q&A retrieval. They do not add graph nodes, verified imports, impact paths or contributor claims. A symbol's presence does not prove a behavioral interpretation, and existing claim validation still applies. No embedding service or additional model request is introduced.

Example demonstrated on `sindresorhus/p-limit` at `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`: baseline excerpts for `index.js` ended at line 117. CBM additionally exposed [`validateConcurrency`, lines 144–148](https://github.com/sindresorhus/p-limit/blob/a8a6fbec4e0e866d6d779b10889bb4f5567e70eb/index.js#L144-L148). Its source remains inspectable rather than being converted into an inferred explanation.

## Install and enable on Windows x64

Run from the repository root:

```powershell
npm run setup:cbm
```

The setup downloads the official v0.12.1 archive, verifies its **pinned SHA-256**, and extracts only the executable, MIT license and bundled dependency notices under ignored `node_modules/.domino-engines`. Existing files are verified against that archive rather than silently overwritten. It does not run the upstream installer or change global agent/MCP settings, hooks or services.

Paste the three settings printed by setup into the ignored root `.env`:

```dotenv
DOMINO_CODE_INTELLIGENCE=cbm
DOMINO_CBM_BINARY=C:/absolute/path/to/codebase-memory-mcp.exe
DOMINO_CBM_CACHE_DIR=C:/Users/your-user/.domino-cbm
```

Restart the worker, then import or reindex. Existing published snapshots are immutable; they are not retroactively enriched. The API and web application need no new public environment variable. Never put these settings or credentials into `VITE_` variables.

On this Windows machine, CBM refused caches below shared temp and Desktop directories because of their ancestor ACLs. A dedicated direct child of the user's profile worked. Do not weaken existing ACLs to force a cache through. The default cache is `~/.domino-cbm`; use a dedicated directory outside any imported checkout. A setup on a different OS needs its official **0.12.1** binary and checksum verification; Linux/macOS operation has not been accepted in this pass. The Windows executable is not included in the Docker image.

## Runtime and failure behavior

1. Run only when `DOMINO_CODE_INTELLIGENCE=cbm`; the default is disabled.
2. Require the pinned executable version, absolute paths and the same full SHA as the checkout.
3. Index with `mode=fast`, `persistence=false`, `doc_candidates=false`, a generated snapshot-specific project name, and the checkout as `CBM_ALLOWED_ROOT`. No imported installs, builds or hooks are executed by Domino.
4. Query the engine's JSON CLI for `Function` and `Method` locations. Validate the real export schema, including its numeric-string line numbers. Upstream text is data, never instructions.
5. Consider at most 250 locations, read source through the existing safe checkout API, require an existing canonical File entity, deduplicate locations, and retain excerpts no larger than 401 lines / 8000 characters. Files over the 128 KiB read limit cause the optional adapter to fail closed. The existing shared evidence-chunk cap still applies.
6. Append excerpts alongside baseline evidence before the existing atomic snapshot publication. Always disclose partial symbol coverage; a cap flag is set only when the location or shared evidence limit is reached.
7. On malformed output, wrong version, timeout or engine failure, retain baseline evidence and structural analysis and report failed optional coverage. An aborted import remains cancelled and cannot publish a fallback snapshot.
8. Delete only this snapshot's temporary project in the dedicated cache. Cleanup gets a separate five-second attempt and reports a warning if it cannot finish. Tool argument files are removed. The engine cache/config itself is retained.

The CLI subprocess budget is 120 seconds plus the bounded cleanup attempt. Its environment is allowlisted and excludes model/GitHub/database credentials. `CBM_MAX_THREADS=2` limits requested native concurrency. This is not an OS memory quota or a large-repository performance certification. The existing checkout size/file limits continue to apply.

The existing source-detail endpoint returns at most 30 excerpts for a file. A file with many symbols can therefore have more indexed evidence than that one inspector response displays. This adapter does not add source pagination or claim an exhaustive symbol browser.

To disable, clear `DOMINO_CODE_INTELLIGENCE` and restart the worker. Baseline imports continue. Previously stored, revision-addressed symbol evidence remains in its original snapshots.

## Reproduce the live acceptance

Use an explicitly separate PostgreSQL database named **`domino_cbm_test`**, created without resetting another database. Set `DATABASE_URL` to that database, configure the pinned binary/cache and, preferably, a server-only `DOMINO_GITHUB_TOKEN` for GitHub's authenticated quota. Anonymous quota exhaustion is a genuine failure state, not a reason to substitute fixtures.

```powershell
$env:DOMINO_CBM_ACCEPTANCE = '1'
node --use-system-ca --env-file=.env --import tsx tests/live/code-intelligence.ts
```

The live script rejects other database names and an occupied acceptance API port, applies migrations, starts its own API/worker on loopback 5395, imports the public repository, verifies native symbol evidence persisted alongside baseline evidence, checks full-SHA line links and the existing source-detail/search endpoints, then stops its own children. Runtime logs stay ignored under `node_modules/.domino-engines/acceptance`. `--use-system-ca` was needed with this Windows machine's trusted certificate store; certificate verification was kept enabled.

The default public repository is `sindresorhus/p-limit`. Set `DOMINO_CBM_REPO=https://github.com/expressjs/cors` for the second accepted repository. No Q&A/model endpoint is called. The script's output reports the actual run IDs and zero model calls.

## Acceptance record — 31 October 2026

| Check | Result | Evidence |
| --- | --- | --- |
| Native export schema | PASS | Official 0.12.1 binary indexed an isolated TS fixture and returned real function locations; numeric-string line values were accounted for |
| Public worker/API import: p-limit | PASS, partial coverage | Snapshot `35dac3fd-8527-4a9d-9dd0-d5f78a49a585`, job `cf104cdb-1806-410c-8329-bcab14f6595f`, SHA `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`; 28 symbols + 163 baseline chunks; 26.5s overall import |
| Public worker/API import: cors | PASS, partial coverage | Snapshot `aa0b4239-db2e-469f-b155-7a152ea96b07`, job `a54d3914-4d4e-49b4-a100-27fc6a6b9ded`, SHA `5317ebe670db2aaebc1d496eb5d33493deefb3ed`; 17 symbols + 221 baseline chunks; 52.8s overall import |
| New evidence beyond baseline | PASS | p-limit `index.js` lines 144–148 versus baseline through line 117; `benchmark.js` lines 184–187 versus baseline through line 95 |
| Existing browser presentation | PASS, desktop IAB Chromium | Actual p-limit history inspector rendered `code symbol` excerpts and exact line links alongside original sources; no frontend source changed |
| Adapter/source safeguards | PASS | Version/environment isolation, schema/path rejection, actual source text/revision, location bounds, no invented File entities, own-project cleanup |
| Persistence and fallback | PASS, isolated PGlite | Symbol sources remain searchable beside baseline; native failure retains baseline; cancellation during optional analysis prevents publication |
| Regressions | PASS | Root typechecks; backend suite with isolated PostgreSQL/pg-boss; history and impact suites; web typecheck/lint/44 tests/build/fixture exclusion |
| Live model answer using a new symbol | NOT PERFORMED | No credits spent; existing retrieval can consume these sources, but answer quality improvement is not claimed |
| Large repositories / other OS / deployed containers | NOT PERFORMED | Bounded native export only; no broad compatibility or performance claim |

Preserved failed attempts: native 0.12.1 startup under shared caches; 0.10.8 diagnostic attempt (not integrated); first isolated HTTP attempt without the Windows system CA; one acceptance-script search call rejected for an unsupported query parameter (corrected to the existing contract); anonymous GitHub quota exhaustion on the second repo before retrying with the existing CLI sign-in in memory. None was counted as a passing run. Private logs/downloads remain local and ignored.

## Version, license and selection

- Upstream: [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp).
- Selected release: [v0.12.1](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.12.1), tag commit `a7158ac2f48ca646b4527341b76f930f2aeff87e`.
- Windows x64 archive SHA-256: `4e4e0f16b45233af5c757a1fcbe3c3b16e9056375b1fbe2ce020b6de75dedcc0`.
- License: MIT, copyright 2025 DeusData; retained at `packages/code-intelligence/LICENSE.cbm`. Review [upstream third-party inventory](https://github.com/DeusData/codebase-memory-mcp/blob/v0.12.1/THIRD_PARTY.md); setup retains the release's full `THIRD_PARTY_NOTICES.md` beside the binary. If redistributing that binary, retain all bundled notices.
- No upstream implementation was copied into Domino. The adapter is Domino code around the versioned CLI.
- RepoGraph was not selected because it adds FalkorDB and overlaps existing history/co-change work. pgvector was not selected because a useful semantic pipeline also requires embeddings and evaluation. Neither is installed or claimed as integrated.
