# Frontend verification and visual review

**First-pass record.** For the current desktop redesign and its latest 29-test result, see [Desktop north star](desktop-northstar/DESKTOP_NORTHSTAR.md). Mobile captures below cover the earlier implementation, not acceptance of the current desktop revision.

Reviewed 30 October 2026. This is a frontend acceptance record, not a claim of passing the master specification's full backend release suite.

## Automated results

| Check | Result | Scope |
| --- | --- | --- |
| `npm run build` | PASS | Strict TypeScript build and Vite production compilation |
| `npm run lint` | PASS | TypeScript/React Hooks and JavaScript linting |
| `npm test` | PASS | 25 tests in 2 files: transport/error behavior, request fields, source URL safety, citation membership, graph integrity, and explicit fixture boundaries |
| `npm run verify:production` | PASS | No synthetic evidence markers or fixture adapter in production JS |
| `npm exec vite -- build --mode fixtures` + production guard | PASS | A fixture-named build still uses the real API; `import.meta.env.DEV` prevents fixture activation |
| Prettier source check | PASS | All frontend source, scripts, and configuration formatted |
| `git diff --check` | PASS | Tracked changes contain no whitespace errors; new source files were formatted with Prettier |

Final measured production chunks: launch 415.02 KB / 134.07 KB gzip; workspace loaded on demand 178.27 KB / 50.70 KB gzip; Cytoscape renderer loaded on demand 439.04 KB / 139.46 KB gzip. These are build artifact sizes, not a measured network speed or performance score. No current >500 KB chunk warning. No FPS, Lighthouse, or production latency claim is made.

## Browser evidence

The local app was opened in the in-app Chromium browser. Screenshots below are actual rendered pages. Main desktop review used **1440×1000 CSS pixels**, mobile review **390×844**. An additional new-tab check used **1280×720**, verified through DOM viewport dimensions. Mobile means a browser viewport, not physical-phone testing.

| Journey | Result | Captures |
| --- | --- | --- |
| Launch hierarchy, artwork, and CTA | PASS | [Desktop](screenshots/landing-desktop.jpg), [mobile](screenshots/landing-mobile.jpg) |
| Controlled cascade and keyboard scrubbing | PASS | [Desktop chapter](screenshots/cascade-desktop.jpg), [mobile](screenshots/cascade-mobile.jpg). Running and resolved states observed; End set the native range to 100. |
| Launch → real workspace transition | PASS | Enter the workspace reached `/app`; [desktop connection screen](screenshots/import-desktop.jpg) |
| Invalid GitHub URL | PASS | Inline error displayed before a request; supported URL accepted for submission |
| Live backend absent | PASS for truthful failure | [Mobile live import error](screenshots/import-live-unavailable-mobile.jpg). Import failed; no synthetic result appeared. |
| Simulated indexing → terminal partial | PASS, DEVELOPMENT FIXTURE ONLY | [Running](screenshots/import-job-mobile.jpg), [partial](screenshots/import-partial-mobile.jpg). No estimated percentage shown. |
| Repository overview/coverage | PASS, DEVELOPMENT FIXTURE ONLY | [Desktop](screenshots/workspace-desktop.jpg), [mobile](screenshots/workspace-mobile.jpg) |
| Connected history and source inspection | PASS, DEVELOPMENT FIXTURE ONLY | [Desktop inspector](screenshots/history-desktop.jpg), [mobile inspector](screenshots/history-mobile.jpg). Selecting auth opened its relations and preserved `focus=auth`; related records and cross-view links were inspected. |
| Evidence Q&A | PASS, DEVELOPMENT FIXTURE ONLY | [Supported](screenshots/ask-supported-desktop.jpg), [not found](screenshots/ask-no-evidence-desktop.jpg), [mobile report](screenshots/ask-mobile.jpg), [mobile sources](screenshots/ask-mobile-evidence.jpg). Source anchor followed. |
| Multi-hop impact + co-change distinction | PASS, DEVELOPMENT FIXTURE ONLY | [Desktop](screenshots/impact-desktop.jpg), [mobile](screenshots/impact-mobile.jpg). The two-hop path is inspectable; historical association stays separate. |
| Cytoscape neighborhood and edge proof | PASS, DEVELOPMENT FIXTURE ONLY | [Desktop](screenshots/graph-desktop.jpg), [mobile](screenshots/graph-mobile.jpg). Hops, inferred opt-in, fit, keyboard relationship selection, and provenance inspected. |
| Contributor concentration | PASS, DEVELOPMENT FIXTURE ONLY | [Desktop](screenshots/risk-desktop.jpg), [mobile](screenshots/risk-mobile.jpg). Single-only filter toggled, distributions and evidence opened. |
| PR lifecycle and stale revisions | PASS, DEVELOPMENT FIXTURE ONLY | [Desktop](screenshots/pr-stale-desktop.jpg), [mobile](screenshots/pr-mobile.jpg). Head/base/event/status shown; missing Actions URL remains unavailable. |

The reviewed 390px views did not overflow horizontally (`document.documentElement.scrollWidth` 375px with the browser scrollbar reserved, viewport `innerWidth` 390px). The desktop graph measurement was 1425px within a 1440px viewport. This is a sampled check, not proof for every arbitrary long backend string.

## Critique and subsequent refinement

| Before | After | Why |
| --- | --- | --- |
| Workspace secondary text was too small and pale; [first desktop](screenshots/workspace-desktop-before.jpg) | Increased UI reading sizes, darkened secondary text, retained restrained hierarchy; [refined desktop](screenshots/workspace-desktop.jpg) | Evidence and freshness must be comfortably readable. |
| Selected graph edge dimmed its endpoint labels; [first graph](screenshots/graph-desktop-before.jpg) | Highlight now includes both connected nodes and the relationship; [refined graph](screenshots/graph-desktop.jpg) | Focus should explain a connection without hiding its participants. |
| Narrow layered graph collided longer labels | Two-column mobile grid, label-aware layout sizing, taller mobile canvas, quieter edge chrome; [mobile graph](screenshots/graph-mobile.jpg) | Each visible record needs enough room; complete relationship names remain in the accessible list and inspector. |
| Mobile source inspector appeared after a long result list | Inspector stacks first and scrolls into view when selected | A source selection should lead immediately to inspectable context. |
| Hero art annotation overlapped a colored slab | Annotation moved into negative space; [final hero](screenshots/landing-desktop.jpg) | Preserve annotation contrast and the main sculptural silhouette. |
| Query/schema code was in the initial launch bundle; multiple font subsets emitted | Workspace-scoped Query provider, lightweight shared UI imports, local Latin font subsets | Initial launch JS reduced from about 530 KB to 415 KB minified. Cytoscape remains lazy. |
| Navigation focus used a delayed animation frame | Focus now applies during the navigation effect | Prevent a late focus update from interrupting the next user input. |

A DOM-based contrast sample of visible Q&A paragraphs, labels, links, buttons, time, code, eyebrows and badges returned **zero sampled pairs below 4.5:1** after refinement. That check assumed the nearest opaque solid background. It is not a complete WCAG audit of images, canvas, composited backgrounds, disabled controls, or all routes.

## Explicitly not performed / blocked

- **NOT PERFORMED:** Live import success, actual GitHub issue/PR/commit lineage, source existence and semantic claim support, computed dependency results, contributor reindex behavior, or real graph data. Backend/shared DTOs are absent.
- **NOT PERFORMED:** A genuine opened/synchronized PR triggering GitHub Actions and a real workflow summary link. The UI does not invent one. See [integration gaps](INTEGRATION.md).
- **NOT PERFORMED:** Physical-phone interaction, Safari/Firefox coverage, screen-reader testing, and an OS-level reduced-motion toggle. Reduced motion is implemented in Motion/CSS and the cascade code; browser flag emulation was not exposed by the available control API.
- **NOT PERFORMED:** Lighthouse, high-volume graph benchmark, frame-rate profiling, network-throttled performance, and real production deployment. No score or performance guarantee is implied.
- Full-page browser capture failed on a long mobile view. The documented viewport capture/scroll workflow was used to inspect and save the relevant report and source sections instead.

## Follow-up acceptance with the backend owner

Provide `packages/contracts` and a real API, confirm the explicit assumptions in [INTEGRATION.md](INTEGRATION.md), then repeat every fixture journey against a real bounded public repository. Replace the synthetic acceptance designation only after actual claim-bearing source links, Git-derived counts, dependency paths, and Actions run URLs have been inspected.
