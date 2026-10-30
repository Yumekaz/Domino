# Domino desktop north star

This is the previous desktop iteration. See the [current investigation studio handoff](../studio/HANDOFF.md) for the subsequent product flow, source inspection, revision bridge, motion changes, and current performance evidence.

Current direction, reviewed 31 October 2026 (Asia/Kolkata). This supersedes the first-pass visual direction in `../DESIGN.md` and its first-pass QA record. The earlier captures remain as iteration evidence. The user's latest instruction prioritizes desktop presentation before backend work; mobile acceptance was explicitly deferred for this revision.

## Direction and decisions

**A physical chain reaction becomes an inspectable engineering connection.** Midnight surfaces give the cobalt geometry space, orange identifies the initiating move, and yellow marks the terminal brand event. Off-white appears as a deliberate editorial pause and as readable evidence paper. The actual supplied Domino mark is unchanged.

The user's reel references reinforced accent hierarchy and foreground/background contrast. We adopted those principles within Domino's existing palette. We did not add the reels' pink palettes, copy their layouts, or distribute their imagery.

- Launch: an asymmetric typographic opening and an original, interactive Three.js material study. Machined dark edges, cobalt faces, warm key light, a reflective floor, and a curved chain replace the earlier flat cream composition. The result resolves into five named records and branching relations. It is visibly labelled illustrative throughout.
- Story: scattered historical papers assemble on request; selecting a paper changes the source explanation. The dependency chapter separates structural paths from historical association. This is conceptual storytelling, not evidence about a repository.
- Workspace: an investigation stage with a floating desktop navigation dock, a bounded graph, and a contextual source inspector. Bright evidence panels contrast with the dark exploration canvas. No decorative metrics were added.
- Repository search: Ctrl/Command K opens a native dialog; the existing search endpoint returns records. Arrow keys, Enter, Escape, cancellation, empty results, and request failures are supported. Results from an obsolete debounced term cannot be selected.
- Impact: an SVG atlas is built only from returned structural paths. Changed file → possible dependent is the visual direction; the proof preserves the original importer → imported direction. Historical co-change has its own rail. Four additional tests protect this boundary.

Space Grotesk carries display typography; Manrope carries the interface; IBM Plex Mono carries paths and revisions. Desktop body copy was enlarged, important control labels are 11–14px, and compact metadata has a 10px reading scale in the refined components. The opening retains intentional small art-direction annotations.

## Motion and implementation

The initial scene assembles over 1.1s. A first-visit-only cue starts 1.8s after scene readiness and traverses the illustrative timeline in approximately 4.5s. Taking manual control cancels the optional cue. Play, pause, reset, scrubbing, and named stage controls remain available. The final 28% resolves physical slabs into the connection model. The workspace entry transition is 850ms and has a skip control; keyboard and reduced-motion entry bypass it.

The Three.js renderer is lazy-loaded, caps device pixel ratio at 1.5, skips unchanged frames, stops rendering outside its viewport/when hidden, and disposes its renderer, geometry, materials, environment, observers, and reflection target on unmount. Its render scheduling is capped around 30fps; this is implementation intent, not a measured frame-rate result. WebGL failure displays the original generated midnight artwork with an unavailable label. The loading composition uses the same dark art, avoiding a cream flash.

Cytoscape is lazy-loaded and uses only returned nodes and edges. Its resize observer checks destruction, connection, dimensions, and available nodes before relayout. A React root is retained through development hot updates to prevent duplicate-root warnings.

## Screenshot critique and refinement

All linked images are actual Chromium viewport captures. The principal review uses **1440×1000 CSS pixels**; the presentation-height review uses **1366×768**. They are not generated product mockups.

| Before | After | Why |
| --- | --- | --- |
| [Initial midnight materials](screenshots/01-opening-first-render.jpg) lacked convincing physical edges | [Final opening](screenshots/10-opening-final.jpg): layered enamel faces, machined chassis, reflection and controlled light | Give the brand metaphor material presence and one clear focal point. |
| [First history inspector](screenshots/05-history-source.jpg) inherited pale text onto white paper | [Refined history](screenshots/17-history-refined.jpg) scopes paper ink and secondary colors explicitly | Original records must remain readable in the mixed-surface system. |
| [Overview before compaction](screenshots/14-overview-refined.jpg) pushed much of the graph below the fold | [Compact overview](screenshots/23-overview-compact.jpg) removes duplicate identity and reduces stage height | Put the complete bounded neighborhood into the first desktop view. |
| [Early report](screenshots/06-reasoning-report.jpg) gave too much space to a completed question | [Refined reasoning](screenshots/18-reasoning-refined.jpg) compacts input and enlarges answer/claim copy | Let the answer and its sources carry the visual weight after submission. |
| [Connection art before correction](screenshots/24-connect-live.jpg) had weak light-on-light text | [Corrected import/error state](screenshots/26-live-api-gap.jpg) uses midnight art, an explicit text scrim, and normal image blending | Maintain readable copy and connect import to the launch identity. |
| [1366×768 opening](screenshots/27-presentation-before.jpg) left controls below the first view | [Presentation-height refinement](screenshots/28-presentation-refined.jpg) scales vertical spacing, type, and scene as a unit | Headline, physical mechanism, playback controls, and explanation now fit in one desktop frame. Measured explanation bottom: 735px in a 768px viewport. |

Also inspect [resolved chain](screenshots/11-resolved-chain.jpg), [assembled history](screenshots/13-memory-assembled.jpg), [keyboard search](screenshots/16-search-result.jpg), [no evidence](screenshots/19-no-evidence.jpg), [final impact proof](screenshots/29-impact-final.jpg), [framed graph proof](screenshots/32-graph-proof-framed.jpg), [contribution evidence](screenshots/21-risk-evidence.jpg), and [PR state](screenshots/22-pr-stale.jpg).

The screenshot directory preserves intermediate attempts, including scrolled views and a capture taken before a search result painted. Those are not all final acceptance images. The table and explicit links above identify the reviewed states.

## Current verification

| Check | Result and limit |
| --- | --- |
| Strict TypeScript + production build | PASS. Three.js chunk still triggers Vite's >500kB minified warning. |
| ESLint and Prettier source/config check | PASS. |
| Vitest | PASS: 29 tests in 3 files. Includes transport/schema safety, fixture isolation, source/citation integrity, and impact path boundaries. |
| Production fixture exclusion | PASS: production JS contains no fixture adapter or synthetic evidence markers. |
| Desktop launch | Reviewed resting and resolved chain states, direct scrubbing, connected-memory interaction, and real application entry. |
| Search/history | Ctrl K, ArrowDown, Enter to `history?focus=auth`, Escape dismissal, and the focused source inspector verified. DEVELOPMENT FIXTURE ONLY. |
| Q&A | Exact supported example returns source-linked claims; an unrelated question returns not-found without citations. DEVELOPMENT FIXTURE ONLY. |
| Impact | One- and two-hop paths, selected dependent, original import direction, and separate co-change inspected. DEVELOPMENT FIXTURE ONLY. |
| Graph | Two-hop bounded expansion, inferred opt-in, accessible relationship selection, and relationship provenance inspected. DEVELOPMENT FIXTURE ONLY. |
| Knowledge at risk | Single-observed-contributor filter toggled; contribution evidence opened. DEVELOPMENT FIXTURE ONLY. |
| PR checks | PR 12 → returned run ID, base/head/event, completed-but-stale example, unavailable Actions summary. DEVELOPMENT FIXTURE ONLY. |
| Live import | Unsupported host rejected inline. Valid GitHub URL reached live adapter and displayed `INVALID_RESPONSE` while backend was absent. No fixture substitution. |
| Runtime smoke check | Clean reload followed by impact → graph selection produced no captured console warnings/errors. This is a sampled check; expected live API failures are separate. |

Latest measured production JS: initial launch **417.74kB / 134.75kB gzip**, workspace **189.54kB / 53.53kB gzip**, Cytoscape **440.84kB / 139.99kB gzip**, Three.js scene **568.12kB / 142.22kB gzip**. These are build artifact sizes, not a network or performance score. The large scene is a remaining optimization target; the warning was not hidden.

## Remaining acceptance

This is a desktop visual and frontend interaction north star. It is not a validated live engineering intelligence system. There is no backend or shared DTO package in this repository. All successful repository analysis screenshots use isolated, prominently labelled development fixtures; provisional client decoders remain subject to the backend owner's actual DTOs. See [integration handoff](../INTEGRATION.md) for endpoint-by-endpoint wiring and specific gaps.

NOT PERFORMED for this revision: mobile visual acceptance, physical-phone testing, a full accessibility audit, OS reduced-motion toggling, high-volume graph benchmarking, Lighthouse/frame-time profiling, cross-browser QA, live source validation, real Git ingestion, actual impact computation, contributor analysis, or GitHub Actions execution. No award, hackathon result, performance score, or 9+/10 quality claim is implied by this record.
