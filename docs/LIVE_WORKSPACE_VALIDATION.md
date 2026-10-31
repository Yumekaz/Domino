# Live workspace validation — 31 October 2026

This pass targets the merged application, excluding automatic GitHub summary integration as requested. It uses a real local PostgreSQL 17 database, pg-boss worker, Fastify API and the live Vite workspace. No successful result below comes from the frontend fixture adapter.

## Changes

- Historical co-change now uses the existing snapshot-scoped history store. A rename/reindex regression proves that an earlier snapshot retains its original associations while the new snapshot sees the renamed paths.
- Impact evidence links to the stored importer source at the exact analyzed SHA. Missing or stale source URLs stay unavailable; no line number is invented.
- GPT-6 Luna is the configured default. Chat requests use `reasoning_effort: none`, no response storage, at most 600 output tokens, six evidence chunks and a 12,000-character prompt budget. There are no automatic generation retries or expensive-model fallbacks. The prompt favors short atomic claims without weakening source validation.
- Normal API/worker/migration commands load an optional ignored root `.env`. Vite can read the root server-side API token for proxying; secrets are not included in browser configuration. Runtime start aliases are available for API and worker.

## Actual live proof

| Flow               | Observed result                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser connection | Imported `sindresorhus/yocto-queue` through the form, queue and integrated history/static worker. Head `72a8fa96a9d389765cdf2bb9c6daba8302fc375d`; structural coverage complete with two imports. Overall coverage remains partial with actual warnings.                                                                                         |
| Search/history     | Searched `iterator`, selected the genuine issue #11 comment and inspected its original GitHub permalink.                                                                                                                                                                                                                                         |
| Live GPT-6 Luna    | A real server-side answer had two claims accepted by validation. The browser journey displayed a partial answer with one documented claim and source links while withholding another unsupported claim. A prior generated answer was fully withheld. These differing outcomes are preserved; there was no canned substitution.                   |
| Model budget       | Three bounded generation requests were used. The credential-access check used model metadata, not generation. Unit tests use local mocks. No exact billing amount is claimed.                                                                                                                                                                    |
| Missing evidence   | An absent-history query returned `not_found`, zero claims and zero sources before invoking the model.                                                                                                                                                                                                                                            |
| Impact/provenance  | `index.js` returned two direct dependents and four separate historical associations. The browser inspected actual records and a source permalink at the indexed revision.                                                                                                                                                                        |
| Reindex            | Replayed genuine public base `0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b` and merge `d631ea87f49443c4c8dbf84fd79bf600d11a5fac` through the actual queue/worker, then restored today's branch. Original impact/co-change results stayed unchanged before the independent source-link enrichment. The product's Refresh index action also completed. |
| Contributor change | `index.d.ts` had one observed author at the base and two at the merge: Sindre Sorhus and Víctor Fernández, backed by actual commit URLs. This is genuine historical replay, not a newly authored demo commit or a manually edited count.                                                                                                         |
| Graph              | Live file search focused `index.js`, expanded the returned neighborhood, inspected actual records and exited focus mode with Escape. Only returned nodes/edges were rendered.                                                                                                                                                                    |
| Risk UI            | Displayed real contributor shares and commit sources. Space toggled the single-contributor filter and selected a genuine single-observed-author file.                                                                                                                                                                                            |
| Keyboard/motion    | Ctrl+K opened focused live search, Escape dismissed it, and the reduced-motion toggle changed the document policy and was restored. This is core interaction verification, not a full accessibility audit.                                                                                                                                       |

Local screenshots and raw test evidence remain under the uncommitted role A handoff directory. The key is stored only in ignored local configuration and is never printed or committed.

Final automated checks passed: backend/history/impact typechecks; 28 backend tests including real PostgreSQL/pg-boss, 65 history/provider tests, 63 impact/analyzer tests, and 40 frontend tests. Three optional history live tests were skipped; the explicit live flows above were run separately. Frontend lint, production build and fixture exclusion passed. The normal `npm run start:api` command was also started successfully with the local environment file.

## Reproduce

Configure `DATABASE_URL`, server-only `DOMINO_OPENAI_API_KEY`, and `DOMINO_LLM_MODEL=gpt-6-luna` in `.env`. Run `npm run db:migrate`, `npm run dev:api` and `npm run dev:worker`; start `apps/web` with its existing dev command. Public imports can use `DOMINO_GITHUB_TOKEN` to avoid the lower anonymous quota. Preserve TLS verification; this Windows environment uses its system CA store.

For contributor-history replay, use a separate database named `domino_live_validation`, a running API on loopback port 3000 and `DOMINO_ALLOW_CONTRIBUTOR_REPLAY=1`, then run `node --env-file=.env --import tsx tests/live/contributor-history.ts`. The guard prevents replay against an unrelated database. It restores the default branch and makes no model calls.

## Limits

Automatic Actions-to-Domino integration and PR-head refresh are unchanged in this pass. Hosted HTTPS deployment, Docker execution, a full accessibility/cross-browser audit and a production-scale foreground graph profile are not established here. Mobile remains deferred. The lazy Three.js bundle warning is still visible. The local workspace and live data flows above work; remaining release gates are not relabelled as passed.
