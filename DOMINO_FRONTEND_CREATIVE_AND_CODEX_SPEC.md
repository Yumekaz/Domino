# DOMINO — FRONTEND CREATIVE + ENGINEERING SPEC

**Project:** Domino — an evidence-backed engineering memory and change-impact product  
**Hackathon:** INNOVISTA, PS06 — The Institutional Amnesia Problem  
**Status:** Frontend implementation brief for Codex  
**Primary implementation reference:** `PROJECT_BRAIN_PS06_MASTER_SPEC.md`  
**Brand source:** `Domino Push Mascot Icon.png` (provided by the team)

> **Ownership boundary:** This brief covers product experience, visual design, UX, client-side architecture, client-side testing, frontend assets, and integration against agreed API contracts. **Do not modify backend services, DB schema, ingestion workers, GitHub Actions, or existing API contracts.** Coordinate missing contracts with backend owners instead of silently creating new endpoints.

## 1. Mission and standard

Build a complete, highly polished, functional Domino frontend that combines:

1. **A flagship product-launch experience** (`/`) with cinematic storytelling and distinctive art direction.
2. **A real engineering workspace** (`/app/...`) exposing every PS06 mandatory feature and every bonus capability through honest, data-driven interfaces.

**Ambition:** Awwwards-level craft in composition, typography, interaction, and restraint, with real engineering utility underneath. This is not a template SaaS dashboard, generic AI chat clone, or static marketing mockup. The website must be memorable *because its interactions explain Domino's core idea*: one change propagates consequences across a codebase, while the product reveals the evidence behind those paths.

A working system is nonnegotiable. Do not sacrifice core flows to ship a visually impressive but inert landing page.

## 2. Ground truth and source files

Before changing code:

- Read `PROJECT_BRAIN_PS06_MASTER_SPEC.md`, especially Sections 1–4, 8–13, 14–15, and 18. It is the backend/product source of truth.
- Inspect `Domino Push Mascot Icon.png` visually. Use the **actual team logo**. It depicts three tilted, rounded blue/orange/yellow bars and a black pushing mascot on an off-white rounded-square field. Do not replace it with an AI-generated lookalike. Preserve shape, proportions and brand recognition. If a reversed/monochrome lockup is needed, create a faithful compatible variant and retain the original.
- Inspect the current `apps/web` structure and shared DTOs (`packages/contracts`). Work within the existing React + TypeScript + Vite baseline; Tailwind and custom components; Cytoscape.js for the canonical graph experience. Prefer integration with existing components over an unrelated rewrite.
- If these source files are absent from the Codex workspace, flag exactly which files need attaching; don't pretend you have inspected them.

## 3. Research first: art-direction references

Actively inspect a focused sample of the following references before committing to a design:

- https://motionsites.ai/ — kinetic web sections; check MCP integration only if already available/authorized.
- https://motionin.design/ — motion mechanics, physics, interactions and implementation details.
- https://recent.design/ and its launch-video collection — editorial launch storytelling.
- https://land-book.com/ — typography, layouts, visual hierarchy and composition.
- https://landdding.com/ — high-quality landing references.
- https://www.whipsaw.com/work-all — product launch case studies, brand craft, narrative.
- https://60fps.design/ — functional micro-interactions and UI motion.
- https://www.awwwards.com/ — creative-web quality benchmark.
- https://github.com/stackedlol/ascii-sharks — optional reference for unusual, performant canvas-based creative coding, **only if relevant**.

Time-box initial reference research. Collect **techniques**, not whole templates. Record 3–5 concrete inspirations and what we adopt or intentionally avoid. Respect access, licenses and attribution. If a reference is unavailable or paywalled, proceed with accessible material without fabricating findings.

## 4. Image generation: use purposefully and extensively

**First check which image-generation plugin/tool is actually connected and available to Codex.** Use it repeatedly, where accessible, to develop:

- Two or three competing visual art-direction explorations for Domino's hero.
- Custom background textures, abstract chain-reaction imagery, graphic compositions and branded supporting visuals.
- Motion storyboard/keyframe concepts for major reveals, where they improve the implementation brief.
- Polished conceptual compositions for historical memory, dependency propagation and engineering time travel.
- Optional mascot-supporting art that respects the exact provided mark.

Select one cohesive direction and refine it. Generated images are **visual assets and references**, not substitutes for real HTML/CSS, accessible UI, graph interaction, text, API responses, or working animation. Avoid fake screenshots presented as working product states. Keep generated assets optimized, appropriately licensed and integrated as local web assets. If image generation is unavailable, record that limitation and proceed with excellent original CSS, SVG, Canvas and code-authored visuals rather than blocking the build.

## 5. Brand and art direction

**Product name:** Domino. (Project Brain is the official PS label, not the customer-facing name.)

**Core brand idea:** A change starts a chain reaction. Domino reveals *why* a code decision happened and *what might be affected next*.

**Voice:** Confident, precise, editorial, technically credible. Slightly playful through the mascot, never childish.

**Potential hero copy, subject to careful editing:**
- Headline: **Understand why code changed. See what falls next.**
- Supporting line: **Domino connects decisions, commits, pull requests and live code relationships so teams can trace the past and understand possible change impact.**
- CTA: **Explore Domino** / **Watch the chain reaction**.

**Color approach:** Take the actual logo as a foundation, but deliberately control visual hierarchy. Investigate one dominant chromatic accent (electric blue is a strong starting hypothesis), neutral surfaces for clarity, and orange/yellow reserved for meaningful cascade/highlight and brand events. Do not make the entire product a rainbow of equally bright cards. Colors used to express evidence classes or warnings must be paired with labels/shapes/patterns and verified accessible contrast. Evaluate light, dark and mixed editorial directions before choosing; do not default to an overused dark-purple SaaS look.

**Typography:** Strong display face paired with legible UI sans; restrained monospace for SHA, file paths and code. Use properly licensed/available fonts. Build a real type scale and spacing system, not ad hoc values.

**Visual character:** Big editorial compositions, deliberate negative space, spatial depth without excess glass, strong focal points, systematic grids, high-quality line work and precise kinetic feedback. Do not use random floating particles, meaningless 3D blobs, unmotivated neon, stock gradient cards, or fake metrics.

## 6. Information architecture and user journey

### A. Product launch (`/`)

An impressive but concise narrative, all leading into the actual app:

1. **Short optional brand prelude:** Domino mascot nudges one bar; a carefully timed chain-reaction transition reveals the hero. First-visit only where reasonable; fast and skippable; skip with reduced motion. Do not block interaction with a long preloader.
2. **Hero:** Bold product claim, accessible CTA, and a signature kinetic scene. Show a visual transformation such as `Issue → PR → Commit → File → Dependents`, not a generic looping 3D asset.
3. **The lost-context problem:** Fragmented issues, commits and developer discussions become a coherent chain. Design this as an editorial story, not a grid of feature cards.
4. **History to evidence:** Explain how Domino reconstructs *documented* decisions. Open a cited, inspectable source reference in a concise interactive example.
5. **The cascade:** A memorable scroll-/interaction-controlled dependency propagation visual. Give users control to scrub/play/pause. Provide a reduced-motion alternative. Demo data must be labelled as illustrative unless connected to actual backend data.
6. **Real workspace reveal:** Visually transition into the genuine app. Ideally show actual product components and real backend results once connected, never fabricated performance figures.
7. **Trust and limits:** Show verified / inferred / historically correlated relationships distinctly, provenance links, index freshness, and what happens when history doesn't answer a question.
8. **Final CTA:** Clear route to import a repository or open an existing public demo workspace.

The landing must work on desktop and mobile. Meaningful animation should reinforce content; it must never prevent access to the product.

### B. Product workspace (`/app` and scoped repo routes)

Design a coherent app shell with repository switcher/import, index status, branch/SHA, coverage, search, navigation and contextual actions. This is an *interactive investigation workspace*, not a chart-filled admin dashboard.

Required end-user flows (all seven official features represented):

**1 — Import / repository overview (M1)**
- Paste a public GitHub URL; validate inline and submit to the import endpoint.
- Show actual phase/status/progress when supplied, source coverage, SHA, partial import warnings and actionable retry/reindex controls.
- Make the active indexed snapshot visible; do not invent progress percentages.
- Show quick entry points into search, history, graph and impact analysis.

**2 — Connected history explorer (M2)**
- Find a file, issue, PR, commit or document; follow real relationship trails and inspect evidence.
- A chronological view can illustrate engineering time travel; preserve context when opening the graph or answer pane.
- Differentiate observed links, derived structural links and inferred/contextual relationships.

**3 — Ask Domino / evidence-based Q&A (M3)**
- Ask why a code decision happened.
- Present evidence-backed answers with source-level citations, claim/support presentation, timestamps and exact links.
- Support documented vs inferred reasoning and an honest no-evidence state.
- Don't turn this into a generic chat shell or invent citations.

**4 — Impact explorer (M4)**
- Select changed file(s) or a proposed diff according to the existing API contract.
- Reveal direct and transitive reverse dependency paths, hop depth, historical co-change signals, source proofs and identified limitations.
- Use color and motion to make the cascade instantly legible while distinguishing *possible impact* from confirmed breakage.
- Show stale snapshot and unresolved dependency warnings prominently.

**5 — Connected-memory graph (B1)**
- Use Cytoscape.js and real graph-neighborhood API data.
- Pan/zoom, fit, focus, bounded expansion, type/date/verification filters, inspectable nodes/edges and evidence drawer.
- Make the graph readable: meaningful grouping, layout control, progressive reveal, hover/focus states, labels, legend and motion tied to real paths.
- Do not render every repository node at once; do not generate fake edges for visual effect.
- Highlight an evidence path and switch between the historical graph and structural graph.

**6 — Knowledge at risk (B3)**
- Display actual single-observed-contributor files, history coverage, per-file authorship and evidence.
- Use elegant concentration/risk visualization where helpful, alongside navigable tables and source details.
- Label the feature accurately: single *observed* contributor does not prove only one person knows the code.

**7 — PR impact checks (B2)**
- Present real PR analysis run status, PR number, base/head SHA, changed files, impacts, limitations, freshness and link to actual GitHub Actions workflow summary.
- Make the opened/synchronized change lifecycle inspectable.
- UI must not imply a PR comment exists when only an Actions run summary is available.

Use route organization that supports deep links and stateful navigation; design the best route structure within React Router or an existing router, without modifying backend route definitions.

## 7. Client implementation rules

- **Keep frontend-only changes:** Prefer `apps/web` and frontend asset/design-document paths. Reuse shared contracts read-only. No backend restructuring, DB migrations, API changes, security shortcuts, or invented API endpoints.
- Read real shared Zod DTOs where available. Create a typed frontend API adapter for endpoints described in master spec Section 13, instead of hardcoding values inside components.
- Key endpoints include repository creation/status/jobs/reindex, search, entity details, graph neighborhood, Q&A, impact, knowledge risk, PR check and analysis status.
- Use TanStack Query or the existing data-fetching layer for caching/refetching and cancellation; handle latency and retries thoughtfully. Use polling for indexing only as permitted by the API; do not pretend the backend streams events.
- If backend services aren't ready, use a strictly isolated, clearly labelled **development-only** mock adapter with fixtures matching real DTOs, and a one-setting switch to the real API. Production and judge-demo modes must not silently show fake or hardcoded analyses.
- Components must cover loading, partial, empty, error, unsupported, stale and success states.
- Provide accessible semantic controls, keyboard navigation, visible focus, readable contrast, tooltips, descriptive source links, reduced motion and screen-reader alternatives for core graph insights.
- Smooth interaction under realistic workloads; lazy-load Cytoscape and heavy hero assets, minimize bundle and animation main-thread work, avoid layout shifts and maintain stable perceived performance on mid-range devices.
- All animations must clean up correctly on route changes and respect prefers-reduced-motion. Avoid scroll-jacking and slow, unskippable reveals.
- Design original reusable primitives, design tokens, and a small well-owned component system. Use shadcn/UI primitives selectively; do not ship the default aesthetic unchanged.

## 8. Motion language: a controlled domino effect

Define a consistent motion grammar, not many unrelated effects:

- **Nudge:** A small input activates a relation.
- **Propagation:** A sequence travels along real dependency/evidence paths.
- **Focus:** Irrelevant entities recede as a selected path becomes readable.
- **Reveal:** Evidence, historical layers, and interpretation unfold progressively.
- **Resolution:** The system settles into a clear, inspectable state.

Prototype the primary signature interaction with exact timings/easing and test it in-browser. Use Motion for component transitions and GSAP only when it gives specific advantage for art-directed sequences. Use Three.js/R3F, shaders, SVG, Canvas or WebGL only when they outperform a simpler, more robust approach. A strong 2D sequence is better than a fragile 3D gimmick.

## 9. Visual QA + engineering acceptance

Codex must actually open the page in a browser, capture screenshots and critically inspect real rendering. Do not stop at successful compilation.

Review at least these states:
- Landing hero at desktop and mobile viewport.
- One mid-page narrative and its transition.
- Repository import / indexing / partial status.
- Evidence Q&A supported and no-evidence views.
- Graph with real data and an expanded evidence path.
- Impact view with multiple dependency hops.
- Knowledge-risk view.
- PR analysis view including real link to Actions.

Inspect typography, proportions, spacing, contrast, asset quality, motion quality, responsive behavior, overflow, loading, empty states and source truthfulness. Fix visible issues, then re-capture. Run build/typecheck/lint and frontend E2E checks where infrastructure permits. Never claim image generation, browser review or API validation happened unless it actually did.

**Frontend definition of done**:
1. Intentional, distinctive visual identity consistent with the supplied Domino logo.
2. Working cinematic launch page and direct path to the usable workspace.
3. Navigable, responsive workspace for M1–M4 and B1–B3.
4. Real backend API contracts integrated or clearly declared development-only stubs with transparent status.
5. Graph drawn from returned nodes/edges and each inspectable relationship linked to real provenance.
6. No fake performance numbers, source citations, code impact results, knowledge-risk counts or PR check claims.
7. Accessible core flows, reduced-motion fallback, and acceptable visual/performance behavior on mobile.
8. Screenshots + self-critique + subsequent refinement, not merely a generated code dump.
9. Clear run instructions and a concise frontend-only handoff listing what works, what's blocked by backend work, tested viewports and unresolved defects.

## 10. Practical build order for parallel integration

1. Read sources / inspect repository and contracts / reference research.
2. Generate multiple visual directions using available image tools; pick and record one coherent direction.
3. Define design tokens, typography, shell, navigation and reusable UI components.
4. Wire typed API adapter and build complete functional workspace route skeletons, including truthfully labelled states.
5. Build actual graph, evidence, impact and risk interactions against DTOs or isolated development fixtures.
6. Build the flagship marketing experience with its signature cascading reveal and original art direction.
7. Integrate with live backend as owners make contracts available; test every feature's client journey.
8. Run visual-review cycles, responsive/a11y/performance checks, fix bugs, and polish the presentation.

**Do not spend the entire budget perfecting the preloader or hero while the core workspace is still inaccessible.** A premium landing page is a multiplier for a real product, not a substitute for it.

## 11. Required reporting at handoff

Deliver:
- Summary of implemented frontend pages, components, animations and asset provenance.
- Explicit list of real endpoints integrated and any development-only mocked interactions.
- Screenshots of launch and application states, and specific visual shortcomings corrected.
- Commands to run and test `apps/web`.
- Any source/reference/license restrictions or unavailable image-generation/MCP/browser tools.
- A focused list of backend contract mismatches for the integrator; do not fix them by editing backend code without coordination.

**North star:** The visual experience should make the engineering itself feel spectacular. The interface is not a decorative layer over Project Brain; it's the way Domino lets someone *see, inspect and understand a chain of evidence and consequences.*
