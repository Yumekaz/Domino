# Domino investigation studio — desktop handoff

The subsequent [spatial graph revision](../network/GRAPH.md) updates the renderer and adds fCoSE. Timing samples below cover the earlier renderer and do not establish performance for that revision.

Reviewed 31 October 2026, Asia/Kolkata. Current desktop iteration, following the [earlier north star](../desktop-northstar/DESKTOP_NORTHSTAR.md). Frontend only. The backend, database, workers, Actions, and established endpoint paths remain unchanged. Mobile acceptance remains deferred at the user's request.

## What changed

The overview now supports **Locate → Inspect evidence → Trace consequences** inside one investigation studio. A focus view expands the actual Cytoscape map; original source inspection and returned impact results occupy the same stage. Selection updates the deep-link context without inventing graph edges. The map stays stable when selecting within its returned neighborhood; an outside record requests a new bounded neighborhood. Full graph, Q&A, and impact links retain the selected record. Impact is available only for an indexed file. Focus view has persistent controls, Escape dismissal, and keyboard wrapping.

Q&A is a reasoning-and-source composition rather than a generic chat. Selecting a claim's citation opens its returned source in an inspection document, with excerpt, locator, timestamp, and the safe original URL when supplied. Unsupported citation references still withhold the answer and claims. Missing sources remain unavailable. An unrelated fixture question returns not-found.

Knowledge at risk has a file selector, contributor concentration strip, observed counts, and adjacent source inspection. Percentages are explicitly shares of the **returned contributor entries**, not knowledge scores or repository-wide ownership. A mismatch with the reported file count is disclosed. The single-contributor filter and history navigation remain functional.

PR checks now show a base-to-head revision bridge, the reported event and creation time, a separate result snapshot, and explicit stale-state treatment. Completed status never implies freshness. PR and Actions URLs are displayed only if actually supplied and safe.

The launch's dependency chapter now has four interactive states: input, direct impact, transitive impact, and separate historical association. These examples are visibly illustrative. The product reveal contains the **same working RepositoryConnection component** used by `/app`, with the same validation, API adapter, pending state, error recovery, and returned-job navigation. It replaces the previous decorative timed cover. The connection code loads when the reveal approaches the viewport.

Motion is now controllable through an explicit Reduce motion button, which also respects the system preference. Repeated keyboard interactions skip the new spatial transitions. Hero playback has been isolated from the rest of the launch: its scene reads a mutable progress reference while React updates the explanatory chapter at chapter boundaries. Playback uses elapsed visible time and resets its clock on visibility changes. Reflection and shadow targets were reduced to 512² and 1024² respectively; this is a rendering-budget choice, not proof of a particular frame rate.

## Visual review and corrections

The screenshots are real browser captures, primarily at **1440×1000**, with an opening review at **1366×768**. All successful analysis views use explicitly labelled development fixtures.

| Before | After | Why |
| --- | --- | --- |
| [Earlier workspace](../desktop-northstar/screenshots/23-overview-compact.jpg) primarily switched between screens | [Focused map](screenshots/02-focus-map.jpg), [original source](screenshots/03-focus-evidence.jpg), and [consequences with persistent controls](screenshots/14-studio-impact-sticky.jpg) | Make investigating a connection one coherent product sequence. |
| [Early expanded impact](screenshots/04-focus-consequences.jpg) scrolled the studio controls away | [Persistent controls](screenshots/14-studio-impact-sticky.jpg) remain visible while inspecting the path | Keep navigation available during longer analyses. |
| [First reasoning pass](screenshots/05-reasoning-first.jpg) inherited a stretched claim-number decoration and pale helper text | [Final reasoning](screenshots/18-reasoning-final.jpg) gives the claim index a fixed shape, readable helper text, and selected citation treatment | Preserve reading order and visible cause-and-effect between a claim and its source. |
| Contributor history previously used repeated white report cards | [Contributor distribution](screenshots/07-contributor-distribution.jpg) uses a dark concentration ledger with inspectable source paper | Make the composition reflect contributor concentration instead of generic report chrome. |
| PR inputs and results were a conventional report | [Revision bridge](screenshots/08-revision-bridge.jpg) foregrounds base, head, event, and stale result revision | Explain what the analysis actually compared. |
| Mid-page dependency chapter was static | [Interactive mechanism](screenshots/11-mechanism-proof.jpg) pairs a selected path with an explanatory proof | Make the underlying engineering distinction understandable through interaction. |
| The workspace reveal was a timed overlay | [Working product doorway](screenshots/13-product-reveal-framed.jpg) accepts a real connection request | Let the presentation become usable software directly. |

Additional captures: [final presentation hero](screenshots/17-launch-final-1366.jpg), [not-found report](screenshots/15-no-evidence.jpg), [simulated partial import](screenshots/16-import-partial.jpg). Intermediate screenshots are retained; some precede the next browser paint or show a partial scroll position. The explicit links above identify the relevant review states.

## Verification

- Strict TypeScript and Vite production build: PASS.
- ESLint, Prettier source check, and tracked whitespace check: PASS after correcting callback declaration order.
- Vitest: PASS, **29 tests across 3 files**. Transport, decoder, citation membership, source URL safety, fixture boundaries, and returned impact-path safety remain covered.
- Production exclusion: PASS. Fixture evidence and the renderer harness are absent from production output. The harness lives outside the production entry and is guarded by `DEV` plus fixtures mode.
- Browser journeys: focus view; record → evidence → impact; context-preserving links; exact supported fixture Q&A; citation selection; unrelated not-found question; contributor switching and single-only filtering; PR 12 stale run; shared fixture import → returned job → terminal partial; live doorway → truthful unavailable-API error; reduced-motion selection; hero play/pause/reset and resolved state.
- A fresh runtime review of the launch and fixture workspace produced no captured console warnings/errors. Expected absent-backend transport errors are distinct from rendering errors.

No successful live ingestion, genuine source support, dependency computation, contributor analysis, or Actions execution is claimed. The integration blockers remain in [INTEGRATION.md](../INTEGRATION.md).

## Performance evidence and limits

The development-only harness is available at `http://localhost:5174/qa/renderer.html` when running `npm run dev:fixtures -- --port 5174`. It labels generated stress topology prominently and never routes it into the product API or production build. Its five-second rAF samples are **local development browser scheduling measurements**, not GPU completion times, Lighthouse results, or production FPS.

| Sample | Result | Interpretation |
| --- | --- | --- |
| [Empty baseline](idle-baseline-performance.json) | Median 16.7ms; p95 17.1ms; max 33.4ms | Valid empty-renderer isolation. |
| [React-only updates](react-baseline-performance.json) | Median 16.7ms; p95/max approximately 1017ms; no long tasks | Long scheduling gaps also occur without Cytoscape or Three.js. Their cause is not established. |
| [300 records with repeated selection](graph-300-performance.json) | p95 approximately 1000ms; one 53ms long task | Fails a smooth-cadence interpretation in this environment. |
| [600 records with repeated selection](graph-600-performance.json) | p95 approximately 1000ms; six long tasks totaling 349ms | Stress result is a concern; it is not a passing performance gate. |
| [300-record viewport interaction](graph-300-viewport-performance.json) | Median 16.7ms; p95 17.1ms; one approximately 1017ms maximum gap; no long tasks | Most sampled intervals were steady; the outlier remains disclosed. |
| [Ref-driven scene with lower target budgets](scene-refined-performance.json) | Median 16.8ms; p95/max approximately 1016ms; no long tasks | Removing per-frame React updates did not establish smoothness in this browser. |

The first purported empty/counter samples did not unmount the renderer. They are retained under `attempts/` and explicitly excluded from the comparison. A native Chrome fallback reached the harness, but the completed measurement was not recovered after the window became minimized; native performance acceptance is **NOT PERFORMED**, not PASS.

The lazy Three.js chunk remains approximately 568kB minified / 142kB gzip and triggers Vite's size warning. The warning has not been suppressed. A controlled foreground production run, frame trace, and cross-browser check remain release gates. No 60fps or production responsiveness guarantee is made.

## Open-source and scope

No additional third-party repository, asset pack, template, or copied site implementation was needed for this iteration. It uses the existing licensed React, Motion, Three.js, Cytoscape.js, TanStack Query, and icon/font dependencies. Implementation guidance was checked against the [official Motion configuration documentation](https://motion.dev/docs/react-motion-config) and [Cytoscape documentation](https://js.cytoscape.org/). The earlier eight-site creative research and six generated original assets remain recorded in [DESIGN.md](../DESIGN.md) and [ASSETS.md](../ASSETS.md).

The desktop implementation refinements are delivered. Remaining release acceptance consists of backend integration, live evidence validation, controlled performance profiling, full accessibility/cross-browser coverage, and the separately deferred mobile review. These are not represented as completed by screenshots or fixtures.
