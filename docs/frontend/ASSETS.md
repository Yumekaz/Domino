# Original assets and provenance

## Supplied brand

`Domino Push Mascot Icon.png` remains untouched at the repository root. Its faithful 160×160 scaled copy is `apps/web/public/assets/domino-mark.png`. It was resized with Pillow; no generative editing, shape substitution, recoloring, or redrawing was performed. The separate supplied `domino-svg.svg` also remains untouched.

## Generated art

The connected built-in **image_gen.imagegen** tool was checked and used for six original outputs across the iterations: three initial direction studies, a motion storyboard, a texture, and a midnight composition. No fallback API key, alternative model CLI, stock-image service, MotionSites MCP, or Firecrawl MCP was used. Firecrawl tools were not available in this session; web retrieval and the in-app browser supplied reference research.

| Asset | Exploration / selected use | Optimized size |
| --- | --- | --- |
| `apps/web/public/assets/direction-a.webp` | Direction A: warm causal machine; repository connection composition | 65,872 bytes |
| `apps/web/public/assets/blueprint.webp` | Direction B: dark blueprint; supporting connected-memory chapter | 180,296 bytes |
| `apps/web/public/assets/domino-hero.webp` | Refined warm direction; first-pass hero retained for the earlier direction | 62,394 bytes |
| `docs/frontend/v2/domino-motion-storyboard.png` | Four-panel visual development for the physical-to-connected reveal | 1,942,533 bytes |
| `apps/web/public/assets/porcelain-texture.webp` | Quiet stage microtexture, 512×512, very low-opacity overlay | 7,586 bytes |
| `apps/web/public/assets/domino-midnight.webp` | Current import art and static hero fallback; the interactive hero is real Three.js geometry | 149,556 bytes |

PNG originals remain in the tool's generated-image directory. The initial WebP copies were produced with Pillow quality 88; the midnight composition uses quality 90. The assets were inspected visually. They are conceptual product art, never screenshots or evidence of working software. All actual UI, animation, text, graph rendering, and API presentation are implemented in code.

## Prompt set (built-in tool)

### Direction A

Use case: stylized-concept. Asset type: art-direction exploration for Domino engineering intelligence product. Create a polished 16:9 editorial product-photography scene, no text, no logos, no UI. Direction A: THE CAUSAL MACHINE. An elegant single winding chain of tall rounded rectangular domino monoliths with machined cobalt-blue enamel faces, dark aluminum edges, a few orange and golden-yellow faces, standing on a warm off-white matte architectural plane. A few at left lean into the next, while the final upright blue slab catches a hard pool of warm daylight. Unusual low-angle macro camera, precise architectural shadows, tactile microtexture, understated futuristic industrial design, world-class design studio art direction. Arrange the chain in the right two thirds with empty cream space at left for real HTML typography. Controlled palette cobalt #1649ed, tangerine #ff641c, golden yellow #ffc33c, black #161817, ivory #f4f3ed. No dots on the dominoes, no casino motifs, no particles, no gradients, no extra objects.

### Direction B

Use case: stylized-concept. Asset type: competing art-direction exploration for Domino, engineering memory and change impact. Direction B: BLUEPRINT OF A CHAIN REACTION. Design a cinematic 16:9 conceptual editorial illustration, near-black charcoal background with extremely subtle technical paper grain, large thin porcelain rectangular slabs standing and leaning along a dramatic curved trajectory viewed overhead, precise hairline blue connective tracks continuing from each slab into a network of small cobalt squares, one single tangerine slab activates golden traces. Sparse numeric index markings but absolutely no readable text or UI. Intellectually rigorous Swiss graphic design crossed with premium architectural model photography. Sharp white rimlight, restrained cobalt illumination, no purple, no neon clouds, no particles, no blobs, no logos. Leave negative space at upper left. This is conceptual art only, not a working product screenshot.

### Selected warm refinement

Use case: stylized-concept. Asset type: final original Domino website supporting art, refined Direction A. Create a premium 16:9 architectural studio product photograph: seven tall rounded rectangular monoliths, like unmarked domino slabs, standing along an ascending diagonal from bottom-left to top-right. Five are vivid cobalt-blue lacquer on solid machined black aluminum, one vivid orange, one yellow. First three leaning into one another, final four upright. Warm off-white seamless stage and background #f3f1e9. Hard afternoon light from upper left casts long beautiful geometric shadows towards lower right. Precise machined edges and subtle satin microtexture. Main objects grouped across right 70% of composition, with huge calm blank ivory area in upper left. Emphasis on sculptural silhouette, rich deep cobalt, minimal industrial material palette, a quiet expressive product-launch photograph, not a busy graphic. Wide cinematic crop, objects entirely inside frame. Absolutely no text, no logo, no domino pips, no UI, no humans, no particles. Photo is conceptual branded art, not evidence or software.

The final image produced fewer slabs than the prompt's requested count; it was selected for its composition, not as a literal data visualization. The code-authored three-stage cascade explains the actual interaction model.

## Later generation briefs

The following summarize the later generation requests; they are briefs rather than purported verbatim transcripts.

- **Motion storyboard:** explore four keyframes of a Domino chain reaction, from a first nudge through propagation to an organized connected-record state. Porcelain/ivory stage, cobalt slabs, orange initiating slab, yellow terminal accent, architectural shadows. Used as a visual development sheet, not as working animation. Original output `exec-5692239b-9e90-458f-8450-015e79e9dc92.png`; copied into `docs/frontend/v2`.
- **Porcelain texture:** a restrained seamless off-white material study with subtle natural micrograin, avoiding visible objects, text, or strong variation. Optimized to 512×512 and applied only at very low opacity. Original output `exec-2b555b7f-2912-4a08-98b1-f10fb5b6439b.png`.
- **Midnight composition:** a high-end cinematic 16:9 Domino composition on a near-black `#090d16` stage, machined cobalt `#1649ed` slabs arranged in an arc across the right side, one larger orange `#ff702e` initiating slab, a yellow terminal slab, and fine engraved branching tracks. Keep the left 35% calm for real HTML typography. No UI, logos, particles, pips, pseudo-code, purple, or neon clouds. Original output `exec-18971a14-4be4-4834-a483-1ea0b03a44b0.png`; selected as import art and static WebGL fallback.

The original outputs are in the session's generated-image directory. The current WebGL scene is code-authored: it does not animate a generated UI screenshot. The official logo was excluded from all generation requests and remains the supplied asset.

## Source and font boundaries

No third-party reference imagery, template, or implementation is distributed. Dependency versions are exact and locked in `apps/web/package-lock.json`; package license declarations are recorded separately. Fontsource distributes the included fonts under SIL OFL. The user-supplied brand is treated as the team's asset. Generated imagery is original output, not a license to imitate reference-site artwork or marks.
