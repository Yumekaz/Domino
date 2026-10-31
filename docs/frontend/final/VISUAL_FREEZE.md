# Desktop frontend freeze

31 October 2026. The launch and workspace visual direction are ready for backend integration. This is a presentation baseline, not a claim that live backend acceptance has passed. Mobile remains deferred at the user's request.

## What is complete

The launch has the original Domino mark, an interactive Three.js domino-to-record reveal, controllable playback, an interactive history assembly, a four-stage consequence explanation, and a connection doorway using the actual repository form. The workspace has ingestion/status interfaces, connected history, claim-to-source Q&A, a structural impact atlas, Cytoscape spatial exploration, an observed-contributor ledger, and a base/head PR report. These screens call the master specification's API paths. Successful analysis previews are explicitly isolated development fixtures.

The final pass closes result-display gaps without changing an API contract:

| Before | After | Why |
| --- | --- | --- |
| Any non-co-change result could receive a direct/transitive label | Valid structural paths, associations, and unknown/incomplete signals have separate presentations | An unknown signal must not become a dependency claim because it has a depth number. |
| A file name alone selected an impact result | Selection also keeps the signal | A file can appear under structural and historical analyses independently. |
| Structural drawings accepted incomplete paths | Only structurally classified paths with consistent endpoints and hop counts enter the cascade | Presentation must not fill missing proof with arrows. This is a rendering guard, not backend verification. |
| Co-change showed no sampling disclosure | Sample size and observation window explicitly say unavailable | The provisional decoder contains no such metadata. Shared contracts must add the real fields before the UI displays values. |
| History/graph filters listed a subset of entity kinds | All eleven canonical kinds and unknown returned kinds remain selectable | Decisions, modules, repository records, and discussion comments must survive integration. |
| Several dense source/context labels were small | Source, history, and context metadata received targeted size/contrast adjustments | Preserve the composition while improving source inspection. |

## Actual desktop review

Chromium in-app browser, launch at 1366×768 and workspace at 1440×1000. Captures are actual browser output; fixture captures are not real repository results.

- [Launch at presentation laptop size](screenshots/04-launch-laptop.jpg)
- [Transitive mechanism chapter](screenshots/05-mechanism.jpg)
- [Shared repository connection doorway](screenshots/06-product-doorway.jpg)
- [Signature investigation workspace](screenshots/07-investigation.jpg)
- [Expanded spatial graph](screenshots/03-expanded-network.jpg)
- [Unknown impact result](screenshots/01-unknown-impact.jpg)
- [Co-change metadata disclosure](screenshots/02-cochange-disclosure.jpg)

The review exercised real UI selection of unknown and co-change results, three-hop graph expansion, the canonical filter vocabulary, and the transitive launch chapter. No warnings/errors were captured after the clean local preview restart in the reviewed routes. An initial stale tab could not connect because the local servers had stopped; the servers were restarted before review. Earlier attempts and performance limitations remain documented in the [studio handoff](../studio/HANDOFF.md) and [spatial graph revision](../network/GRAPH.md).

## Verification

- Strict TypeScript and production build: PASS.
- ESLint, changed-source Prettier check, and whitespace diff check: PASS.
- Vitest: 38 tests across 5 files PASS. Five added tests cover signal presentation, structural path guards, and canonical kind preservation.
- Production fixture/harness exclusion: PASS with `npm run verify:production`.
- The lazy Three.js chunk is 568.16 kB minified / 142.21 kB gzip and still produces Vite's 500 kB warning. Its size warning has not been hidden.

## What follows during integration

There is no further planned aesthetic rewrite before the backend begins. Preserve this design. Necessary contract bindings, server states, and real metadata can be integrated without waiting for the original frontend author.

Shared Zod contracts, live public-repository evidence, real ingestion, computed paths, contributor changes, and automatic GitHub Actions summaries still need backend implementation and acceptance. Dense representative graph review, controlled foreground production motion profiling, complete cross-browser/accessibility verification, and deployment checks remain integration/release gates. Existing timing observations do not establish a passing frame-rate gate. This document does not upgrade them to PASS. Mobile acceptance is NOT PERFORMED.

The [API assumptions](../INTEGRATION.md) list the contract gaps. The team handoffs at the repository root allocate those gates to backend and integration owners.
