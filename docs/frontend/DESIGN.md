# Domino: the causal machine

**Historical first-pass direction.** The current desktop direction, material study, floating workspace dock, timing, and screenshot critique are documented in [Desktop north star](desktop-northstar/DESKTOP_NORTHSTAR.md). The research below remains the source reference register; its original layout and motion descriptions describe the first iteration.

The design joins warm editorial presentation to a precise investigation tool. Ivory and near-black carry the composition; cobalt activates controls and code relationships. Orange identifies propagation and caution. Yellow is reserved for the brand and the final cascade stage. The supplied mascot remains the recognizable mark.

## Research, 30 October 2026

Public pages were inspected using web retrieval and the in-app browser. No paid prompts, templates, source implementations, external site assets, or inaccessible MCP services were used.

| Reference | Observed material | Adopted technique / boundary |
| --- | --- | --- |
| [MotionSites](https://motionsites.ai/) | Public hero/section collection, including EMBER.dsgn, Digital Reality, and the section categories | One strong section-level focal point. No prompt unlocking, source copying, or MotionSites MCP was used. |
| [Motionin](https://motionin.design/) | Public descriptions of Riffle, Lens Bloom, Morph, and other interactions; browser screenshot of gallery | A reversible timeline, deliberate resting state, explicit controls, and teardown. The cascade is original React/CSS/SVG, without scroll capture. |
| [Recent launch videos](https://recent.design/launch-videos) | Public collection and navigation | Short narrative chapters ending in a product entry. No claim to have analyzed inaccessible video playback. |
| [Landbook](https://land-book.com/) and [Landdding](https://landdding.com/) | Public galleries and typography, big-type, software, and motion categories | Strong type scale and sparse chrome. These are directional references; no gallery template is reproduced. |
| [Whipsaw / Composer](https://www.whipsaw.com/work/in-sink-disposal-system-brand-website) | Product-to-brand narrative, interaction explanation, physical and digital identity; browser screenshot | Tactile material study, consistent physical metaphor, and an editorial progression explaining a mechanism. |
| [60fps / CRED ticket slider](https://60fps.design/shots/cred-ticket-pop-on-slider-interaction) | Public interaction entry and micro-interaction collection | Input feedback tied to visible state; direct scrubbing. No external clip is embedded. |
| [Awwwards / Lusion v3](https://www.awwwards.com/sites/lusion-v3) | Browser-inspected official listing, screenshots, palette, reactive-cursor and scroll-animation highlights | Cohesive blue/neutral identity, confident composition, purposeful interaction. No Lusion source/assets were reused. Web retrieval timed out for this listing, but browser inspection succeeded. |

Five concrete decisions: sculptural hero rather than fake UI imagery; editorial chapter pacing; an inspectable history rail; a controllable causal timeline; quiet workspace surfaces with stronger selected paths and provenance beside them. Avoided: preloader tolls, scroll-jacking, particle fields, vanity metrics, generic chat bubbles, and dashboard charts without evidence.

## Visual system

- Paper `#f4f3ee`; ink `#20231f`; cobalt `#1649ed`; orange `#f66924`; yellow `#ffc83c`.
- Space Grotesk variable for display; Manrope variable for UI; IBM Plex Mono for paths, revision identifiers, and compact labels. Fonts are locally hosted under SIL OFL; Latin subsets limit transfers. System fallback handles unsupported scripts.
- Desktop composition: 56px edge grid, 1320px maximum editorial width; workspace sidebar 224px. Mobile uses 20px launch margins, 16px workspace margins, scrollable horizontal navigation, and stacked inspectors.
- Focus rings are explicit. Status color always has text. The graph pairs file rectangles, PR diamonds, contributor hexagons, and issue circles with named types. Observed edges are solid, derived dotted, inferred dashed.

## Motion grammar

Nudge → propagation → focus → reveal → resolution. Launch entrance is 700ms using cubic-bezier(.23,1,.32,1), followed by a composed resting state. The illustrative cascade travels over approximately 3.8 seconds, with meaningful activation thresholds and a play/pause/reset/range interface. It pauses its clock in a hidden tab and cleans up rAF on unmount. A final workspace-entry transition lasts 640ms, with sequential 60ms delays and an immediate skip.

There is no blocking prelude. Keyboard entry and reduced-motion entry go directly to the app. Reduced motion removes spatial entrance/cascade movement, preserves explicit stage selection, and resolves playback immediately. Normal controls respond within 150–200ms; the product does not animate repeated keyboard navigation.

## Workspace structure

Routes are `/app/repositories/:repoId/{history,ask,impact,graph,risk,pr}` with overview at the repository root. `focus`, `job`, and `run` query parameters preserve investigatory context, job lookup, and analysis deep links. Sources remain inspectable next to claims and relationships. No authoritative impact or risk computation runs in the browser.

TanStack Query owns cancellation, bounded caching, and status polling. Cytoscape loads only on the graph route. Query/schema code is isolated from the initial launch bundle. Failed requests stay failures; production cannot opt into development fixtures.
