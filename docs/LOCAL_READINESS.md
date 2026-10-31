# Local readiness — 31 October 2026

Scope: the local presentation stack and desktop workspace. Deployment is excluded and mobile remains deferred. The existing Domino visual identity, official mark and original assets are preserved. This record supersedes older statements that live ingestion/model answers and worker PR-head analysis were unavailable. It does not certify universal repository compatibility or hosted production readiness.

## Integration decisions

- **LD-01:** Manual PR checks enqueue `analysis.impact`, resolve and revalidate exact public PR revisions, and persist an isolated structural snapshot. `tool_versions.purpose=pull_request` excludes that snapshot from the workspace's default history/index lookup. No endpoint path changes.
- **LD-02:** The repository response may include at most five `recentAnalyses` summaries. This is a bounded extension of the shared repository DTO so automatically observed checks can be discovered without inventing a new list endpoint or browser-local fake run IDs. The existing explicit run lookup remains.
- **LD-03:** Optional local Actions observation uses GitHub's read-only workflow-run API for `.github/workflows/pr-impact.yml`. A successful, public, exact-current-head run may trigger a local recomputation. Its genuine Actions URL is retained; the result is explicitly identified as locally recomputed after observing that run. No external artifact is promoted to a verified dependency, no imported workflow is executed locally, and no public ingress is opened. Missing PR associations, older heads and unavailable workflows are skipped rather than guessed.
- **LD-04:** Data, native binaries, backups and review artifacts live under ignored `.domino`, outside npm-managed directories. PostgreSQL 17.11 binaries are pinned to the package integrity in `tools/setup-local-postgres.mjs`. A cold physical backup was restored on a separate loopback port and all five database inventories matched.
- **LD-05:** `npm run demo` builds and verifies the actual frontend, checks server-secret exclusion, starts the local API and both worker queues, and serves the production SPA behind a same-origin local proxy. A supervisor may recover only jobs tagged with its own worker instance after observing that process exit.
- **LD-06:** The force-layout calculation runs in a dedicated Web Worker; Cytoscape still renders actual API nodes/edges. A quick resting layout remains available during computation; interruption terminates the worker and unavailable spatial layout falls back with a visible note. No graph records or relationships are generated for presentation.

## Acceptance

| Area | Result and actual evidence |
| --- | --- |
| Shared API / persistence | PASS: root `npm run typecheck`; full `npm test`: 43 Vitest, 81 history/evidence/retrieval and 65 impact tests passed; six explicitly gated live/database tests skipped. After the final report-error and timeout-message changes, 22 focused queue/API/contract tests passed. No paid model calls in these suites. |
| Web | PASS: `typecheck`, `lint`, 44 tests, production build and `verify:production`. The supervisor also checks the actual emitted JavaScript for configured server credential values before serving it. The lazy Three.js chunk (~568 kB) and layout-worker chunk (~561 kB) remain disclosed. |
| Public ingestion / reindex | PASS, explicitly partial: actual `yocto-queue` and `ky` imports through the worker and production UI. Public-only validation refused the private Domino repository. No private repository data was indexed. Earlier live acceptance also covered `p-limit` and `expressjs/cors`. |
| History / source inspection | PASS: real paginated history and exact original source links; source inspector/source-list recovery after stopping the API and using both retry buttons. Long CBM source text no longer causes horizontal page overflow. |
| Live Q&A | PASS for the rehearsed question: one bounded GPT-6 Luna request returned `supported` with three documented claims about the iterator/drain decision, citing issue #11 comment `2696500039`. The original source was inspected. An unrelated no-focus question returned `not found` with “No indexed source text matched the question.” No model retry or alternate model was used. |
| Change impact | PASS: `ky` `source/core/Ky.ts` produced actual direct/transitive paths with dynamic-import caveats and a visibly separate historical co-change signal. Source inspection retained exact-SHA links. |
| Real graph | PASS for bounded functionality: `ky` depth 3 returned 79 records / 275 relationships. Network/record presentations, zoom/pan, depth expansion, accessible record selection, source inspection, Escape and command search worked. Actual API records only. Performance limits below still apply. |
| Knowledge at risk | PASS: real observed contributor counts, source history, partial-window caveats and pagination were rendered. Earlier controlled real-Git contributor-change/reindex evidence remains in `LIVE_WORKSPACE_VALIDATION.md`; no contributor was invented during this pass. |
| Fresh manual PR | PASS: actual `yocto-queue` PR12, run `f92a91a6-ff47-4adc-9cdc-9fdb944166d0`, PR head `87d4a591b6584b9120a16daea822c919ff36c1ee`, base `0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b`, partial, one affected file. Evidence URLs identify that PR head, repeated input is idempotent, and the main snapshot remains unchanged. `tests/live/pr-acceptance.ts` verifies this without model calls. |
| Actions discovery | PASS for one genuine public workflow: `rcm-on/tsql-lineage-toolkit` PR1, [run 28790477749](https://github.com/rcm-on/tsql-lineage-toolkit/actions/runs/28790477749), head `826782bcaab048ca2a7ded37acc270379e22f9f9`. Local run `18b05ac3-5e4f-4ffe-99bf-6181ec4401fb` was automatically queued, persisted and surfaced by the UI. It is explicitly locally recomputed, partial and JS/TS-only; this predominantly C# repository does not establish C# support. `tests/live/actions-observation.ts` compared real workflow metadata, head, link and discoverability. |
| Optional CBM | PASS: latest `ky` snapshot `59bf5f7c-fdb0-4b23-bb6f-7d7b12ef0384` includes 250 genuine symbol excerpts, with cap-hit/partial coverage. Two oversized test files are skipped before reading rather than discarding every valid symbol. Seven adapter tests cover bounds/failure/cancellation; no extra model calls. |
| Worker interruption | PASS: `tests/live/local-recovery.ts` interrupted a supervisor-owned worker during real reindex `f5d5954d-c3e1-41bf-88a3-370337b47408`. The old good snapshot was preserved, the operation became a retryable failure, and the worker restarted. Retry `62ba0b80-15f3-42bb-bfba-2750372b3de7` published partial snapshot `17065cd0-a80a-4ab7-a112-f9bd9dffcc7c` at the same actual main SHA. No synthetic job or evidence rows were inserted. |
| Backup / restore | PASS: PostgreSQL 17.11 cold backup was restored on a separate loopback port; all five database inventories matched. Original data retained. Backup SHA-256: `6bd57c43a3cc49d8d0518d797fe5e2fcd4e7017f0b713bae042eae035d09fdc5`. |
| Cold startup / model outage | PASS: gracefully stopped the owned app and verified PostgreSQL cluster; `npm run demo` restarted the existing cluster without data initialization/reset. In a separate launch process with both model-key variables omitted, a source-matching question returned `unavailable` / `LLM_UNAVAILABLE`; history and original comment links still worked. Zero model calls in that test. The ignored `.env` was unchanged. The normal stack was restored and `demo:doctor` confirmed API/database/queue/web ready, model configured and CBM executable available. |

## Desktop visual and accessibility review

Actual production frontend, built-in Chromium browser on Windows; 1366×768 and 1440×1000. The opt-in local QA overlay uses pinned development-only `axe-core` 4.14.0 (MPL-2.0) and is never part of `apps/web/dist` or product evidence. Screenshots and raw audit/profile JSON are retained privately under ignored `.domino/review`. The public source sample was not published.

| Before | After | Why |
| --- | --- | --- |
| Twenty launch text nodes failed the automated contrast check | Controlled text-color/size corrections; actual launch scan reports zero violations | Improve readability while preserving the palette and composition. |
| Hero progress could show a stale accessible value | Slider value, numeric readout and accessible value advance together; keyboard scrubbing and 100% completion verified | Screen-reader state must match visible progress. |
| Spatial arrangement blocked the interaction thread | Dedicated layout worker, immediate resting state, cancellation and visible fallback | Keep controls usable while arranging actual topology. |
| All 30 large `Ky.ts` sources rendered immediately; long tokens overflowed the page | Six sources initially, working “show more,” all original sources retained, text wraps; measured document width equals viewport | Preserve source access without overwhelming initial layout. |
| Breadcrumb, impact labels, risk metadata/pagination and PR file chips had contrast failures | Narrow corrections in their existing light/dark surfaces | Fix observed defects rather than redesigning the product. |
| Loading 98 risk files or many impact paths stretched the page far below its evidence panel | Desktop master/detail panes have bounded independent scrolling and named keyboard-focusable regions; all returned records remain available | Dense real data must keep its evidence context usable. |
| Expanded graph lacked explicit modal semantics | Named dialog semantics, Tab containment and Escape returning focus to its toggle | Make the existing focus mode understandable to keyboard/assistive navigation. |

Zero-violation automated scans were recorded for the launch, connection page, history/source inspector, supported and unavailable Q&A, expanded real graph, risk, impact and PR report after contrast corrections. Final real-data checks verified all 98 risk records remain available, the selected structural path and co-change sample/window remain inspectable, and history/source panes are equally bounded. At 1440×1000 these panes measured 780px high, with independent scrolling rather than a many-thousand-pixel page. Manual review includes actual screenshots, original-source readability, keyboard graph selection, Ctrl+K search, Escape, hero playback/reset/scrubbing and the user-facing reduced-motion toggle. Automated scans are not a full assistive-technology audit; manual contrast checks remain for some pseudo-elements/canvas content.

## Performance observations

Foreground production observations on this machine, not a GPU benchmark or universal FPS guarantee. No backend regression/build workload was running during the final measurements.

| Five-second interaction | Measured result |
| --- | --- |
| `ky` first file selection, 76 nodes / 239 edges, before progressive sources | p95 interval 17.3 ms, max 300 ms, four long tasks / 570 ms total |
| Matched first selection after progressive sources | p95 17.0 ms, max 283.6 ms, two long tasks / 286 ms total |
| Settled depth-3 `ky` graph, zoom and pan | p95 16.9 ms, max 17.6 ms, zero long tasks |
| Launch domino cascade | p95 17.2 ms, max 33.3 ms, zero long tasks |

The first graph opening still has a brief main-thread hitch from initial rendering/module/source work. It is improved, not eliminated. These measurements cover the actual bounded neighborhood; they do not prove repository-wide graphs with thousands of nodes will remain smooth. Graph limits remain 200 nodes / 400 edges per request.

## Run and recover locally

1. Keep the existing ignored `.env` with `DATABASE_URL`, server-side keys and `DOMINO_LLM_MODEL=gpt-6-luna`. Never put credentials in `VITE_` values. The launcher can use an existing GitHub CLI login in server memory.
   Use Node 22.20+ for this complete local workflow (verified locally on 22.20.0); CI uses Node 24.11.1.
2. Run `npm run demo`, then open `http://127.0.0.1:5173`. It builds/validates the actual production frontend and waits for API, worker and local proxy readiness.
3. `npm run demo:doctor` verifies local services, PostgreSQL and configured engine availability without exposing credentials. It does not spend model credits.
4. If a request fails, inspect its actual status and use its retry control. Failed imports preserve the last published snapshot. Failed/cancelled PR runs request the current head again. Never substitute a fixture or repeatedly generate model answers to hide a failure.
5. `npm run demo:stop` gracefully stops only managed app services; PostgreSQL stays available. Restarting does not reset data. Optional `npm run setup:postgres` downloads/verifies pinned Windows x64 tools, but never creates or resets a cluster. Use an existing initialized cluster or explicitly initialize a separate development database yourself.

The local launcher is not a hosted production server. Its loopback proxy keeps API credentials server-side and checks Host/Origin. Do not expose this presentation setup to the public network.

## Preserved failures and boundaries

- Installing the QA dependency pruned an extraneous native PostgreSQL package from `node_modules`. The exact verified binaries and original data were recovered, moved outside npm-managed directories and independently backed up/restored. Initial failures remain in the local worklog.
- One initial `pg_ctl` launch inherited daemon pipes and appeared to time out even after PostgreSQL started. The launcher now detaches those pipes; cold-start acceptance is recorded separately.
- The first sandboxed backend run failed six local-HTTP model-adapter tests. They all passed with loopback permission enabled; the subsequent full suite passed. No fake model key was sent to OpenAI by those tests.
- Native Chrome automation was stopped by its URL-confidence safeguard. The completed review used the built-in browser. A Brave launch rendered, but no full alternate-browser acceptance is claimed. Firefox/WebKit and a full screen-reader audit are NOT PERFORMED.
- Public GitHub availability, rate limits, upstream changes and model quota/network remain external dependencies. Repository support is public GitHub, JS/TS first, bounded by declared history/file/resolver limits. Partial coverage must remain visible.
- Deployment, distributed operational hardening, pgvector/RepoGraph experiments and deferred mobile acceptance are outside this local pass. Do not claim them complete.
- Local-only handoffs/instructions, credentials, native data, backups and raw machine-specific review artifacts must stay out of source publication. Earlier role sign-off records are not fabricated or silently marked passed by this document.
