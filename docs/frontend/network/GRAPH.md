# Spatial memory graph

31 October 2026. This frontend revision responds to the graph references supplied by the team.

The screenshot showing **Renderer / Records / Measure five seconds** was `/qa/renderer.html`, a development load-test harness. It generates deliberately synthetic stress topology. It was not the Domino product graph, and its grid was never a backend limitation. The harness now has a sticky developer banner, a watermark inside the graph, and an explicit link to the actual workspace. It remains excluded from production.

## Implementation

The product graph now defaults to a circular-node spatial network. It uses the MIT-licensed [fCoSE extension by iVis at Bilkent](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose), version **2.2.0**, with the existing Cytoscape.js renderer. The extension is loaded on demand as a separate chunk. Radial focus, layered paths, circular and grid layouts remain available; Network/Records controls change presentation independently of the returned data.

The contribution uses the actual extension, not copied demo images or a decorative mock graph. The backend, API paths, shared data assumptions, official logo, and analysis behavior were not changed.

- Type-specific colors and glyphs distinguish files, PRs, issues, commits, contributors, and documents. The starting record has an amber ring. Node size reflects incident edges **within the returned visible neighborhood**, not importance, knowledge, risk, or a repository-wide score.
- Labels reveal at readable zoom levels. Selected connections show their relationship labels; users can also enable all relationship labels. Controls support fit, zoom, selected-neighborhood focus, rearrangement, and expanded exploration.
- Source/target direction is retained. Historical `CO_CHANGED_WITH` keeps its dotted class and has no dependency arrow. Inferred edges remain opt-in and dashed.
- Node and edge selection keep the actual evidence inspector. The accessible record/relationship list is retained. Expand-map mode supports Escape and keyboard wrapping. Animated viewport focus is bypassed for reduced motion and keyboard input.
- Small force layouts are rotated to suit the landscape canvas and use a modest coordinate compression. This changes visual placement only. Larger views use reduced pixel density and semantic label thresholds; no production frame-rate guarantee is inferred from those choices.
- The renderer does not create extra records, edges, communities, source links, or impact results to imitate a dense screenshot. The current fixture has seven records at two hops and eight at three hops. A real repository's larger returned neighborhood requires backend data; the spatial appearance does not.

fCoSE reference requested by its project: H. Balci and U. Dogrusoz, “fCoSE: A Fast Compound Graph Layout Algorithm with Constraint Support,” IEEE Transactions on Visualization and Computer Graphics, 28(12), 4582–4593, 2022. See the project's [reference and documentation](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose). License texts for the extension and its two layout dependencies are retained under [third-party](../third-party/).

## Browser review

Actual Chromium screenshots at **1440×1000**, with development data labelled throughout. Intermediate failed visual attempts are retained; they are not acceptance screenshots.

| Before | After | Why |
| --- | --- | --- |
| [Previous record-card graph](../desktop-northstar/screenshots/32-graph-proof-framed.jpg) | [Spatial network](screenshots/07-three-hop-network.jpg) and [focused source inspection](screenshots/08-selected-network.jpg) | Give engineering relationships a spatial representation while retaining evidence. |
| [First force layout](screenshots/02-network-first.jpg) was too distant and vertically framed | [Landscape network](screenshots/07-three-hop-network.jpg) | Improve readable scale and use the actual stage shape. |
| [First expanded frame](screenshots/04-expanded-network.jpg) overflowed the viewport | [Corrected focus frame](screenshots/07-three-hop-network.jpg) | Keep the graph, controls, and legend available together. |
| [Early radial attempt](screenshots/10-radial-focus.jpg) produced poor ranking/spacing | [Clean radial view](screenshots/12-radial-clean.jpg) | Use two radial ranks around the actual starting record and validate after a clean reload. |
| The harness could be mistaken for product output when its header was scrolled away | [Persistent developer labels and product link](screenshots/13-harness-labelled.jpg) | Make the test/product boundary explicit where the synthetic topology is visible. |

Final captures: [full spatial view](screenshots/14-spatial-final.jpg) and [selected import provenance](screenshots/15-spatial-provenance-final.jpg). Both use the small, explicitly labelled development fixture.

The browser review verified direct canvas node selection, selected-neighborhood focus, record/network switching, radial layout, three-hop expansion, inferred opt-in, and keyboard edge selection opening the `session.ts → auth.ts` import proof. Runtime review caught and corrected a data-mapper bypass warning and removed a custom mouse-wheel sensitivity setting; the clean reload produced no captured warnings/errors.

## Validation and limits

Strict TypeScript/build, lint, formatting, existing safety checks, and **33 tests across 4 files** pass. Four new tests ensure the presentation keeps exactly the returned records/edges, preserves edge direction and verification, calculates visible degrees without losing disconnected records, and never inserts a missing focus record.

The previous renderer timing samples in the studio handoff predate this graph revision. Large live graphs, controlled production profiling, live provenance validation, and backend acceptance remain unverified. The pre-existing lazy Three.js size warning remains. No mobile acceptance was performed in this desktop-focused pass.
