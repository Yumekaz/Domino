# Graph startup performance — 31 October 2026

The reproducible first-opening stall is fixed in the tested production build. This is a frontend scheduling/rendering change; API contracts, graph bounds, actual record/edge data and source provenance are unchanged.

## What caused the stall

A fresh opening of `sindresorhus/ky`, selecting the canonical `source/core/Ky.ts` file, blocked graph creation for 185.9 ms and its first draw for about 102 ms. The initial radial layout added 35 ms. Closed keyboard lists also rendered hundreds of hidden rows. Moving an already complete graph to its worker-computed coordinates then invalidated every curve together, producing a second draw spike in intermediate attempts.

## Changes

| Before | After | Why |
| --- | --- | --- |
| Construct Cytoscape with every element synchronously | Create an empty core; insert actual nodes and edges in bounded batches separated by paint/input opportunities | Prevent one initialization task from monopolizing the browser. |
| Initialize a radial layout, then move the complete graph to spatial coordinates | Use existing preset coordinates while preparing nodes; apply worker coordinates before adding curves | Preserve the spatial layout while avoiding a bulk recalculation of every edge. The worker still receives the full actual topology. |
| Paint an unselected graph, then apply selection styles | Assign the actual selection classes before inserting elements | Avoid rasterizing every label and glyph twice. |
| Render all records/proofs and a closed keyboard list immediately | Progressively reveal source connections/proofs; mount the keyboard list when opened, with explicit pagination | Every returned item stays accessible without creating hundreds of hidden DOM rows at startup. |
| Force every neighboring label to draw at unreadable overview sizes | Reveal neighboring labels at a readable zoom; retain the selected/hovered record and selected relationship label | Reduce clutter and unnecessary text rasterization. Original titles remain in the inspector and keyboard lists. |
| Moving/fitting/rotating/fitting invalidates the same geometry repeatedly | Orient and compact coordinates before applying them once | Keep the existing landscape composition with less rendering work. |

Preparation is explicitly indicated. Route/presentation changes abort pending batches and terminate obsolete layout work. Selection and its source inspector remain connected. No artificial nodes, edges, analysis results or loading percentages were introduced.

## Foreground production measurements

Built-in Chromium 156 on Windows, no concurrent build/test workload. Five-second requestAnimationFrame/Long Tasks samples; the local QA overlay also retained long-animation-frame attribution and bounded graph-stage User Timing measures. Each first-use sample navigated to a fresh graph document and selected a real record, causing the graph module and spatial worker to initialize. Browser HTTP caches were not forcibly cleared. These are scheduling observations, not GPU completion benchmarks or guarantees for every machine.

Repository revision: `3541888878c4d303a8bc2ad61815f4e048f55a5d`. The canonical file ID is `2e8cdccf-47b6-5682-ac45-6e475df17213`. The contributor graph uses the actual stored Sindre Sorhus entity `794d43a3-6835-5562-abda-7158cb27159e`.

| Sample | Viewport | Actual topology | p95 frame interval | Maximum interval | Long tasks |
| --- | --- | --- | --- | --- | --- |
| Reproduced baseline | 1366×768 | 76 records / 239 relationships | 17.0 ms | 316.6 ms | 3, totaling 424 ms |
| Final first opening | 1366×768 | Same 76 / 239 | 16.9 ms | 33.5 ms | 0 |
| Independent fresh-document repeat | 1366×768 | Same 76 / 239 | 17.0 ms | 33.3 ms | 0 |
| Real node-cap neighborhood, depth 3 | 1440×1000 | 200 records / 199 relationships, explicitly truncated | 17.1 ms | 50.0 ms | 0 |
| File neighborhood at depth 3 | 1440×1000 | 79 records / 275 relationships | 17.0 ms | 50.0 ms | 0 |

Synchronous core creation fell to 23.1 / 15.7 ms for the two file samples and 21.6 ms for the 200-record sample. The slow 300+ ms startup task was removed. Intermediate attempts still showed 53–64 ms draw tasks; those failed measurements were retained before the final node-first/curve-batching change.

Local raw artifact IDs under ignored `.domino/review`:

- Baseline: `profile-0d4922c9-e205-4503-8b33-36ce3872f351.json`.
- Final file samples: `profile-64259aac-31d8-4d92-b550-5c514a18cd5d.json`, `profile-83a552f2-ff37-421c-9c51-45d7cf4ad90f.json`.
- Final node-cap sample: `profile-05d64648-6af1-4a06-94bc-b4ffe98d3d4d.json`.
- Final three-hop file sample: `profile-bd6b2cfb-20dc-45a1-9133-9dc04721d177.json`.

## Correctness and visual acceptance

- Web typecheck, lint, **49 tests across 7 files**, production build and fixture-exclusion verification passed. New tests verify element/direction/provenance preservation, cancellation before an obsolete batch can write, destroyed-renderer handling, and selected neighborhood/edge classes.
- Real `ky` depth-3 file graph retained **79 records / 275 relationships**. Keyboard pagination exposed exactly all 79 / 275, and selecting a derived relationship retained its actual co-change provenance.
- Rapid Network → Records → Network changes during initialization recovered with the correct graph. Zooming revealed labels; the original palette, glyphs, spatial presentation, record mode and source inspector remain.
- The actual 200-record neighborhood preserved its bounded/truncated warning. Automated accessibility scans of the expanded graph and its open keyboard list reported zero violations; manual-check items remain explicit.
- The QA overlay and raw artifacts remain local. No model calls, repository reimports, backend changes or deployment were required.

Representative graph bounds remain 200 nodes / 400 edges per API request. The node-cap test contained 199 edges; it does not claim a 400-edge or unbounded repository-wide performance guarantee. Full alternate-engine/screen-reader acceptance and deferred mobile review remain separate gates.
