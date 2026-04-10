# Plan 012 — More Filters and Presets

**Goal:** Add a second wave of high-value filters and chain presets, with a bias toward effects that are visibly distinct, compose well with the existing library, and fit the current architecture without bespoke UI work unless the payoff is clearly worth it.

Plan 010 established the temporal pipeline and shipped a large first batch of temporal filters. Since then, several ideas that were originally only proposed now exist in the codebase, so this revision turns Plan 012 into an execution-focused backlog rather than a speculative wish list.

**Current baseline (April 2026):**
- `src/filters/index.ts` registers about 192 filter entries
- `src/components/ChainList/index.tsx` contains 89 curated chain presets
- The temporal pipeline is proven and already powers filters such as background subtraction, motion heatmap, slit scan, video feedback, wake turbulence, chronophotography, after-image, and time mosaic

**This plan should optimize for:**
1. New output looks that users cannot already get from a short existing chain
2. Filters that strengthen weak categories in the current library: photo finishing, geometric remapping, stylized tessellation, and time-domain analysis
3. Presets that demonstrate new capabilities immediately after the feature ships
4. Implementation paths that preserve saved-chain compatibility and keep the controls data-driven

---

## Scope Rules

### Include
- New self-contained filters in `src/filters/`
- Small control-system extensions when the payoff is high and local
- Chain presets using new or existing filters
- Shared utilities that reduce duplicated sampling / ring-buffer code
- Tests for pure helpers and reducer / option-shape changes

### Avoid
- Broad UI redesign work
- New architecture for plugin-style filters
- Heavy WASM work unless a JS prototype proves the feature is valuable
- Duplicating an existing filter under a new name when a new option on the existing filter would do

### Selection rubric

An item is a good fit for this plan when most of these are true:
- The result reads clearly in a thumbnail
- The option surface can stay under roughly 4 to 6 controls
- It can be explained in one sentence in the filter picker
- It is compatible with still images first, with video support as a bonus
- It composes into at least 2 or 3 interesting presets

---

## Status Snapshot

The following ideas from older drafts are already shipped and should no longer be tracked as new work in Plan 012:

- `Video feedback`
- `Freeze frame glitch`
- `Background subtraction`
- `Motion heatmap`
- `Slit scan`
- `Wake turbulence`
- Presets such as `Infinite Tunnel`, `Rainbow Vortex`, `Virtual Greenscreen`, `Time Slice`, `Panorama Glitch`, and `Stargate`

Plan 012 should focus on what is still missing, plus follow-up improvements to newly landed temporal filters.

---

## Workstream A — Photo and Tone Controls

These fill practical editing gaps. The library has many stylize and glitch filters, but fewer "finish the image" tools beyond Levels, CLAHE, Dodge/Burn, and basic color balance.

### A1. Curves
**Category:** Color  
**Priority:** P1  
**Effort:** Medium  
**Why:** Levels handles endpoints and gamma, but not arbitrary tonal shaping. Curves is the most obvious missing photo control.

**Implementation shape:**
- New filter: `src/filters/curves.ts`
- Add a new control type for editing a 256-entry curve, or a compact point-editor that serializes to a list of control points
- Support channel modes: `RGB`, `R`, `G`, `B`, `Luma`
- Precompute a 256-entry LUT per active channel on each call

**Options:**
- `channel` ENUM
- `points` custom control value

**Acceptance criteria:**
- Can create an S-curve and visibly lift shadows while compressing highlights
- Works on still images without animation
- Saved state survives URL export/import
- Presets can use it without custom glue code

**Notes:**
- This is the one item in this plan that justifies a new control type
- If the editor cost grows too much, ship RGB master curve first and defer per-channel editing

**Likely files touched:**
- `src/filters/curves.ts`
- `src/constants/controlTypes.ts`
- `src/components/controls/index.tsx`
- new control component under `src/components/controls/`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

**Suggested v1 storage format:**
- Store `points` as a JSON-serializable array of normalized pairs, for example `[[0,0],[0.25,0.18],[0.75,0.82],[1,1]]`
- Build a 256-entry LUT inside the filter from those points
- Avoid storing raw 256-value curves in exported state unless the UI truly edits per-sample values

### A2. Levels linear-light correctness
**Category:** Color  
**Priority:** P1  
**Effort:** Small  
**Why:** If `_linearize` is enabled, levels should honor that mode instead of still applying the adjustment in sRGB space.

**Implementation shape:**
- Modify `src/filters/levels.ts`
- Respect `_linearize` when computing black / white / gamma adjustment

**Acceptance criteria:**
- Dark tones do not shift asymmetrically when gamma-correct mode is on
- Existing saved chains continue to render acceptably in non-linear mode

**Likely files touched:**
- `src/filters/levels.ts`
- `test/linearize/linearize.test.ts`
- `test/smoke/filters.test.ts`

### A3. Median-cut and octree quantization
**Category:** Dithering / Color  
**Priority:** P2  
**Effort:** Large  
**Why:** The app has `kmeans` and palette workflows, but no classic image-quantization families with different bias and failure modes.

**Implementation shape:**
- Prefer integrating as new quantization algorithms rather than standalone filters if that keeps the UX simpler
- If integration becomes messy, ship as dedicated filters first and consolidate later

**Acceptance criteria:**
- Can quantize to a fixed palette size with visibly different output from `kmeans`
- Runtime is acceptable on normal still images
- Option descriptions make the tradeoff legible to users

**Likely files touched:**
- `src/filters/quantize.ts` or new sibling modules in `src/filters/`
- `src/utils/` quantization helpers if extracted
- `src/filters/index.ts`
- `test/utils/utils.test.ts`
- `test/smoke/filters.test.ts`

---

## Workstream B — Geometric Remapping and Tessellation

This group adds output shapes that stand apart from the current square-pixel, Voronoi, and stained-glass looks.

### B1. Polar / Inverse Polar Transform
**Category:** Distort  
**Priority:** P1  
**Effort:** Small to medium

**Options:**
- `mode` ENUM: `Rect -> Polar` / `Polar -> Rect`
- `centerX`, `centerY`
- `angle`
- `interpolation` ENUM: `Nearest` / `Bilinear`

**Implementation notes:**
- Depends on a shared bilinear sampler if we extract one
- Good candidate for early delivery because it is compact and visually obvious

**Acceptance criteria:**
- A rectangular image can be wrapped into a circular/tunnel layout
- The inverse mode is stable enough to round-trip simple test imagery without severe tearing

**Likely files touched:**
- new `src/filters/polarTransform.ts`
- optional `src/utils/sampling.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### B2. Hex Pixelate
**Category:** Stylize  
**Priority:** P1  
**Effort:** Medium

**Why:** Square pixelation already exists; hexagonal cells read differently at a glance and pair well with posterize / bloom.

**Options:**
- `cellSize`
- `outline`
- `outlineColor`

**Acceptance criteria:**
- Cell boundaries are visually stable, not noisy from pixel to pixel
- Output differs meaningfully from square `Pixelate`

**Likely files touched:**
- new `src/filters/hexPixelate.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### B3. Triangle Pixelate
**Category:** Stylize  
**Priority:** P2  
**Effort:** Medium

**Note:** Ship this after Hex Pixelate unless the shared math makes both nearly free. Triangle mode is more niche and more likely to expose aliasing problems.

**Likely files touched:**
- new `src/filters/trianglePixelate.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### B4. Mode 7 / Perspective Floor
**Category:** Distort  
**Priority:** P2  
**Effort:** Medium

**Options:**
- `horizon`
- `tilt`
- `fov`
- `tile`

**Acceptance criteria:**
- Produces a convincing receding plane from ordinary source imagery
- Horizon placement is intuitive
- Tiling avoids obvious seams on repeat

**Likely files touched:**
- new `src/filters/mode7.ts`
- optional `src/utils/sampling.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### B5. Triangulated Wireframe
**Category:** Stylize  
**Priority:** P2  
**Effort:** Small to medium

**Why:** Existing `Delaunay` fills triangles. A line-only companion is distinct enough to justify a sibling filter.

**Options:**
- `pointDensity`
- `lineColor`
- `bgColor`
- `lineThickness`

**Likely files touched:**
- new `src/filters/triangulatedWireframe.ts`
- maybe shared geometry from `src/filters/delaunay.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### B6. Halftone hex-grid option
**Category:** Stylize  
**Priority:** P2  
**Effort:** Small

**Why:** This is probably better as an enhancement to `src/filters/halftone.ts` than as a separate filter.

**Acceptance criteria:**
- Existing square behavior is unchanged by default
- Hex mode reads as a deliberate grid, not just offset circles

**Likely files touched:**
- `src/filters/halftone.ts`
- `src/filters/index.ts` only if display metadata changes
- `test/smoke/filters.test.ts`

### B7. Pixelate shape consolidation
**Category:** Refactor / UX  
**Priority:** P3  
**Effort:** Medium

**Decision:** Do not start here. First ship `Hex Pixelate` as a standalone filter for discoverability and to avoid breaking saved chains. Revisit shape consolidation only after usage proves the feature family is worth folding into `Pixelate`.

---

## Workstream C — Stylize Filters With Clear Visual Identity

These are less "utility" oriented and more about signature looks.

### C1. Anaglyph 3D
**Category:** Stylize  
**Priority:** P1  
**Effort:** Small

**Options:**
- `strength`
- `mode`
- `depthSource`

**Why:** Cheap to implement, easy to explain, strong preset value.

**Likely files touched:**
- new `src/filters/anaglyph.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### C2. Cross-stitch / Embroidery
**Category:** Stylize  
**Priority:** P2  
**Effort:** Medium

**Options:**
- `stitchSize`
- `threadColor`
- `fabricColor`
- `gapBetween`

**Risk:** This can drift into "mini renderer" territory. Keep version 1 simple: colored X stitches over a flat fabric tint, no elaborate thread shading.

**Likely files touched:**
- new `src/filters/crossStitch.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### C3. Halftone line / hatch cell
**Category:** Stylize  
**Priority:** P2  
**Effort:** Medium

**Why:** Distinct from both circular halftone and the existing full-image `Crosshatch`.

**Likely files touched:**
- new `src/filters/halftoneLine.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### C4. Pixel-font render
**Category:** Stylize  
**Priority:** P2  
**Effort:** Medium to large

**Why:** The current ASCII filter is luminance-driven. This would use bitmap similarity and a fixed pixel font, producing a more legible low-res text mosaic.

**Implementation notes:**
- Bake one bitmap font into constants
- Reuse logic later for an ASCII bitmap-match mode if the code paths align

**Likely files touched:**
- new `src/filters/pixelFontRender.ts`
- optional font constants under `src/utils/` or `src/filters/`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### C5. ASCII bitmap-match mode
**Category:** Enhancement  
**Priority:** P3  
**Effort:** Small to medium

**Decision:** Do this only after Pixel-font render if substantial code can be shared.

**Likely files touched:**
- `src/filters/ascii.ts`
- shared glyph-matching helper if extracted
- `test/smoke/filters.test.ts`

### C6. Caustics
**Category:** Distort / Stylize  
**Priority:** P3  
**Effort:** Medium

**Why:** Attractive, but lower priority because the library already has `Wave`, `Turbulence`, `Ripple`, `Bloom`, and `Wake turbulence`. It needs to feel clearly different to earn its place.

**Likely files touched:**
- new `src/filters/caustics.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

---

## Workstream D — Temporal Analysis and Time-Domain Effects

The temporal pipeline is one of the project’s strongest differentiators. This plan should add a second batch, but stay selective and avoid shipping multiple filters that read as tiny variations on motion detect.

### D1. Background Reconstruction
**Category:** Color / Temporal  
**Priority:** P1  
**Effort:** Medium

**Why:** Background subtraction already isolates moving subjects. The inverse view, where the scene converges toward the static background, is a useful and legible companion.

**Options:**
- `learnRate`
- `mode` ENUM: `EMA` / `Median`

**Acceptance criteria:**
- Static scene structure becomes clearer as moving subjects fade
- EMA mode works without large memory overhead
- Median mode may be deferred if frame-history cost is too high

**Likely files touched:**
- new `src/filters/backgroundReconstruction.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D2. Cinemagraph
**Category:** Stylize / Temporal  
**Priority:** P1  
**Effort:** Medium

**Options:**
- `mode`
- `motionThreshold`
- `frozenFrame`
- `feather`

**Why:** Strong user appeal and clear preset value.

**Likely files touched:**
- new `src/filters/cinemagraph.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D3. Stop Motion
**Category:** Stylize / Temporal  
**Priority:** P1  
**Effort:** Small

**Why:** Very cheap relative to its visual payoff.

**Acceptance criteria:**
- Holds frames predictably for `holdFrames`
- Does not drift or accumulate stale buffers when dimensions change

**Likely files touched:**
- new `src/filters/stopMotion.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D4. Shutter Drag
**Category:** Simulate / Temporal  
**Priority:** P2  
**Effort:** Medium

**Why:** Different enough from `Frame Blend` and `Long Exposure` to justify inclusion if it behaves like a true rolling average.

**Likely files touched:**
- new `src/filters/shutterDrag.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D5. Frame Difference Highlight
**Category:** Analysis / Temporal  
**Priority:** P2  
**Effort:** Small

**Why:** This is the minimal, precise counterpart to EMA-based motion views. Good for debugging and for technical presets.

**Likely files touched:**
- new `src/filters/frameDifferenceHighlight.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D6. Echo Combiner
**Category:** Color / Temporal  
**Priority:** P2  
**Effort:** Small

**Why:** Worth doing only if it preserves the source image more than `Motion detect` does. If it merely looks like "motion detect but blended," skip it.

**Likely files touched:**
- new `src/filters/echoCombiner.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D7. Time-warp Displacement
**Category:** Distort / Temporal  
**Priority:** P2  
**Effort:** Medium to large

**Risk:** Easy to overbuild. Keep v1 to same-position sampling from a ring buffer, with delay driven by luminance or X/Y position.

**Likely files touched:**
- new `src/filters/timeWarpDisplacement.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D8. Persistence-of-vision bands
**Category:** Stylize / Temporal  
**Priority:** P3  
**Effort:** Medium

**Why:** Interesting, but probably less broadly useful than Cinemagraph or Stop Motion.

**Likely files touched:**
- new `src/filters/povBands.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D9. Optical Flow Visualization
**Category:** Advanced / Temporal  
**Priority:** P3  
**Effort:** Large

**Why:** Great showcase, but expensive and specialized. Treat as an experimental capstone, not an early-phase deliverable.

**Likely files touched:**
- new `src/filters/opticalFlow.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### D10. Datamosh motion-vector mode
**Category:** Glitch / Temporal  
**Priority:** P3  
**Effort:** Large

**Why:** High cool factor, but it overlaps with exploratory research. Ship only after simpler P1/P2 temporal filters are done.

**Likely files touched:**
- `src/filters/datamosh.ts`
- maybe shared block-matching helper
- `test/smoke/filters.test.ts`

---

## Workstream E — Shared Utilities and Infrastructure

These are the supporting items that make the filter work more maintainable.

### E1. Bilinear sampling helper
**Priority:** P1  
**File:** new `src/utils/sampling.ts`

Extract shared sampling used by distort / remap filters. Good early foundation for Polar and Mode 7.

**Acceptance criteria:**
- Covered by tests on edge and subpixel cases
- Existing filters can adopt it incrementally

**Likely files touched:**
- new `src/utils/sampling.ts`
- `test/utils/utils.test.ts` or a new `test/utils/sampling.test.ts`

### E2. Temporal module-state lifecycle convention
**Priority:** P2  
**Why:** Several temporal filters now reset module-level state on dimension or option changes in slightly different ways.

**Deliverable:**
- A short documented pattern for resetting ring buffers / accumulators
- Optional tiny helper if it meaningfully reduces duplication

**Likely files touched:**
- `AGENTS.md`
- optional helper under `src/utils/`
- a small sweep over temporal filters only if the helper proves genuinely simpler

### E3. Color-space/WASM extensions
**Priority:** P3  
**Why:** Potentially useful for Curves or FFT, but not a prerequisite for landing the user-facing features in this plan.

**Decision:** Prototype in JS first. Only extend WASM once a concrete feature is bottlenecked by color conversion.

---

## Workstream F — Additional Filter Candidates

This section is the overflow queue for good ideas that are plausible within the current architecture but are not part of the core Phase 1 to Phase 3 spine. These should be treated as curated candidates, not guaranteed scope.

### F1. Toon / Cel Shade
**Category:** Stylize  
**Priority:** P2  
**Effort:** Medium

**Why:** The app already has `Posterize edges`, but a dedicated cel-shade filter could push flatter fills, cleaner ink outlines, and more animation-style color blocking than the current comic-photo look.

**Options:**
- `levels`
- `edgeThreshold`
- `lineColor`
- `lineWidth`

**Why it is not redundant:**
- `Posterize edges` is a broad comic treatment
- `Toon / Cel Shade` should bias toward cleaner shapes and flatter regional color

**Likely files touched:**
- new `src/filters/toon.ts`
- maybe shared logic from `posterizeEdges.ts` or `lineArt.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F2. Stamp / Rubber Stamp
**Category:** Stylize / Simulate  
**Priority:** P2  
**Effort:** Small

**Why:** A bold binary stamp look would fill the space between `Woodcut`, `Photocopier`, and `Line art` while staying visually obvious and chain-friendly.

**Options:**
- `threshold`
- `inkColor`
- `paperColor`
- `roughness`

**Likely files touched:**
- new `src/filters/stamp.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F3. Screen Print / Misregistration
**Category:** Simulate / Color  
**Priority:** P2  
**Effort:** Medium

**Why:** The project has risograph and CMYK halftone variants, but not a simple silkscreen-style effect that leans into plate offset and flat spot-color layering.

**Options:**
- `plates`
- `offset`
- `angleJitter`
- `paperColor`

**Likely files touched:**
- new `src/filters/screenPrint.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F4. Relief Map / Faux Normal Lighting
**Category:** Advanced / Stylize  
**Priority:** P3  
**Effort:** Medium

**Why:** There is emboss and contour work already, but nothing that really treats luminance like a height field and relights it like a fake 3D surface.

**Options:**
- `lightAngle`
- `height`
- `specular`
- `baseColorMode`

**Likely files touched:**
- new `src/filters/reliefMap.ts`
- maybe shared gradient code from `utils/edges`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F5. Duplex / Offset Print
**Category:** Color / Simulate  
**Priority:** P2  
**Effort:** Small to medium

**Why:** `Duotone` exists, but a print-oriented duplex filter with under/overprint behavior and slight paper interaction would feel more physical and less like pure recoloring.

**Options:**
- `inkA`
- `inkB`
- `mixCurve`
- `paperColor`

**Likely files touched:**
- new `src/filters/duplexPrint.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F6. Facet / Crystalize Grid
**Category:** Stylize  
**Priority:** P2  
**Effort:** Medium

**Why:** `Voronoi` and `Stained glass` are more organic. A flatter faceted treatment with regularized planes and seams would fill a different niche.

**Options:**
- `facetSize`
- `jitter`
- `lineColor`
- `fillMode`

**Likely files touched:**
- new `src/filters/facet.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F7. Isometric Extrude
**Category:** Distort / Stylize  
**Priority:** P3  
**Effort:** Medium to large

**Why:** This could create stacked isometric slabs from posterized or high-contrast imagery, which the current library does not really cover.

**Options:**
- `depth`
- `direction`
- `shadowColor`
- `fillMode`

**Caveat:**
- Keep this on the bubble unless it works on more than just narrowly prepared source images

**Likely files touched:**
- new `src/filters/isometricExtrude.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F8. Luma Matte Cutout
**Category:** Color / Utility  
**Priority:** P2  
**Effort:** Small

**Why:** A luminance-driven matte is a useful chain building block on both stills and video, and is more general-purpose than `Background subtraction`.

**Options:**
- `threshold`
- `feather`
- `invert`
- `backgroundMode`

**Likely files touched:**
- new `src/filters/lumaMatte.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F9. Selective Color Pop
**Category:** Color  
**Priority:** P2  
**Effort:** Small

**Why:** This is a familiar, easy-to-understand filter that the app does not currently expose directly. It also has strong preset value.

**Options:**
- `targetHue`
- `hueWidth`
- `desaturateOthers`
- `softness`

**Likely files touched:**
- new `src/filters/colorPop.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F10. Ink Bleed / Newsprint Spread
**Category:** Simulate  
**Priority:** P2  
**Effort:** Small to medium

**Why:** `Newspaper`, `Photocopier`, and `Fax machine` all exist, but none of them is a general-purpose physical print degradation layer that makes ink spread and soften on cheap stock.

**Options:**
- `spread`
- `absorbency`
- `paperTint`
- `grain`

**Likely files touched:**
- new `src/filters/inkBleed.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F11. Palette Mapper by Hue Bands
**Category:** Color / Utility  
**Priority:** P3  
**Effort:** Medium

**Why:** Existing palette workflows are mostly nearest-color or quantization based. A hue-band remapper would let users intentionally author how hue families map into palette slots.

**Options:**
- `mappingMode`
- `bandCount`
- `palette`
- `preserveLuma`

**Likely files touched:**
- new `src/filters/paletteMapper.ts`
- maybe shared palette helpers
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F12. Kaleido Slice Offset
**Category:** Distort  
**Priority:** P3  
**Effort:** Small to medium

**Why:** `Mirror / Kaleidoscope` is already present, but giving slices per-segment offset or rotation could unlock a different motion-graphics flavor without introducing a whole new geometry family.

**Decision:** Prefer extending `Mirror / Kaleidoscope` rather than adding a separate filter unless the option set becomes too confusing.

**Likely files touched:**
- `src/filters/mirror.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F13. Pixel Outline / Sprite Border
**Category:** Stylize  
**Priority:** P2  
**Effort:** Small to medium

**Why:** This was in the older draft and still looks worthwhile. It pairs naturally with `Pixelate`, `Scale2x`, and game-like preset chains.

**Options:**
- `outlineColor`
- `outlineWidth`
- `mergeThreshold`

**Likely files touched:**
- new `src/filters/pixelOutline.ts`
- `src/filters/index.ts`
- `test/smoke/filters.test.ts`

### F14. Frequency Filter
**Category:** Advanced  
**Priority:** P3  
**Effort:** Large

**Why:** The original draft mentioned FFT. It still belongs as a placeholder candidate, but should remain clearly marked as experimental and deferred behind simpler, more visual wins.

**Decision:** Keep on deck, not in the near-term promised scope.

---

## Preset Expansion

Every new filter should ship with at least one preset. High-value additions should ship with two or three.

### Presets using only existing filters

These are cheap wins and can land independently of new filter work:

| Preset | Chain | Category |
|---|---|---|
| Tape Loop | VHS emulation -> Frame blend -> Bloom -> Vignette | Simulate |
| Skate Video | VHS emulation -> Film grain -> Light leak -> Vignette -> Levels | Simulate |
| Y2K | Pixelate -> Chromatic aberration -> Scan line shift -> JPEG artifact | Glitch |
| Dial-Up Webcam | Pixelate -> JPEG artifact -> Bit crush -> Scanline | Simulate |
| Newspaper Photo | Grayscale -> CLAHE -> Newspaper -> Sharpen -> Vignette | Simulate |
| Fax Roll | Photocopier -> Fax machine -> Film grain | Simulate |
| Beach Postcard | Polaroid -> CLAHE -> Light leak -> Vignette | Photo |
| Camcorder Memory | VHS emulation -> Frame blend -> Light leak -> Sepia -> Vignette | Simulate |

### Presets unlocked by this plan

| Preset | Chain | Depends on |
|---|---|---|
| Photo Pro | Levels -> Curves -> Sharpen | A1 |
| Shop Photo | Curves -> CLAHE -> Vignette | A1 |
| Hex World | Hex pixelate -> Bloom | B2 |
| Triangle World | Triangle pixelate -> Sharpen | B3 |
| F-Zero Floor | Mode 7 -> Bloom -> Vignette | B4 |
| Anaglyph Comic | Posterize -> Anaglyph 3D -> Sharpen | C1 |
| Embroidery Hoop | Cross-stitch -> Vignette | C2 |
| Etching | Halftone line -> Sepia -> Vignette | C3 |
| Pixel Quote | Pixel-font render | C4 |
| Cel Panel | Toon / Cel Shade -> Vignette | F1 |
| Protest Poster | Stamp / Rubber Stamp -> Paper tint | F2 |
| Misprint | Screen Print / Misregistration -> Film grain | F3 |
| Bas Relief | Relief Map / Faux Normal Lighting -> Sepia | F4 |
| Zine Cover | Duplex / Offset Print -> Film grain | F5 |
| Crystal Poster | Facet / Crystalize Grid -> Bloom | F6 |
| Cutout | Luma Matte Cutout -> Duotone | F8 |
| Red Coat | Selective Color Pop -> Vignette | F9 |
| Ink Spread | Ink Bleed / Newsprint Spread -> Sharpen | F10 |
| Sprite Sheet | Pixelate -> Pixel Outline / Sprite Border -> Posterize | F13 |
| Empty Room | Background reconstruction | D1 |
| Living Photo | Cinemagraph -> Vignette | D2 |
| Spider-Verse | Stop motion -> Posterize | D3 |
| Long Exposure | Shutter drag -> Levels | D4 |
| Motion Detector | Frame difference highlight | D5 |
| Time Mirror | Time-warp displacement -> Bloom | D7 |
| Optical Flow | Optical flow visualization -> Bloom | D9 |

**Preset acceptance criteria:**
- Names are short and memorable
- Descriptions explain the effect in one sentence
- Chains do not rely on brittle defaults from unrelated filters

---

## Phased Delivery

The original draft tried to cover too much at once. This revised order keeps the early phases compact and user-visible.

### Phase 1 — Low-risk wins
- `Polar / Inverse Polar`
- `Anaglyph 3D`
- `Hex Pixelate`
- `Bilinear sampling helper`
- 4 to 6 presets using existing filters or the new P1 filters

**Exit criteria:**
- At least 3 new filters shipped
- At least 1 shared utility landed with tests
- Preset count increases without adding picker clutter or broken chains

**Concrete deliverables:**
- Registry entries added in `src/filters/index.ts`
- Preset entries added in `src/components/ChainList/index.tsx`
- Smoke coverage passes for all new filters

### Phase 2 — Photo essentials
- `Curves`
- `Levels` linear-light correctness
- `Photo Pro` and `Shop Photo` presets

**Exit criteria:**
- The app gains one serious finishing control missing today
- Saved-state serialization for the new curve control is stable

**Concrete deliverables:**
- New control type added to `src/constants/controlTypes.ts`
- Control renderer updated in `src/components/controls/index.tsx`
- At least one direct test or smoke assertion around curve serialization shape

### Phase 3 — Temporal companions
- `Background Reconstruction`
- `Cinemagraph`
- `Stop Motion`
- `Frame Difference Highlight`

**Exit criteria:**
- Each filter clearly differs from existing `Motion detect`, `Frame blend`, and `Background subtraction`
- Module-level state resets correctly on dimension changes

**Concrete deliverables:**
- Each temporal filter exports `mainThread: true`
- Each filter has a documented reset condition for size / history changes
- At least one preset per shipped temporal filter

### Phase 4 — Stylize expansion
- `Triangle Pixelate`
- `Mode 7`
- `Cross-stitch`
- `Halftone line`
- `Shutter Drag`
- one of `Toon / Cel Shade`, `Stamp`, or `Screen Print`, whichever produces the best demo output

**Exit criteria:**
- At least 3 of these survive quality review and earn presets
- Anything that feels redundant gets cut instead of forced in

**Concrete deliverables:**
- Before adding presets, compare each new stylize filter against an equivalent 2-to-3 filter chain
- Cut any item that does not earn a distinct visual identity

### Phase 5 — Exploratory / advanced
- `Median-cut` / `Octree`
- `Time-warp Displacement`
- `Optical Flow Visualization`
- `Datamosh motion-vector mode`
- selected `F4/F6/F7/F11/F14`

**Exit criteria:**
- Prototype first, then decide go / no-go based on quality and runtime
- Items may remain intentionally unshipped if the complexity is not paying off

**Concrete deliverables:**
- Short benchmark notes in the PR or commit message for heavy items
- Keep experimental algorithms behind conservative defaults

---

## Decisions

1. **Prefer new options over duplicate filters when the mental model is the same.**  
   `Halftone` hex-grid belongs as an option, not a sibling filter. `Pixelate` shapes should stay separate until we know the feature family is worth consolidating.

2. **Do not let Plan 012 become a control-panel rewrite.**  
   `Curves` is the only planned feature that justifies a new control type. Everything else should fit the existing control primitives.

3. **Treat advanced temporal analysis as experimental.**  
   `Optical Flow` and motion-vector datamosh are showcase items, not the backbone of this plan.

4. **Prototype expensive math in JS before reaching for WASM.**  
   Only promote an algorithm into Rust/WASM if the prototype is clearly valuable and the bottleneck is measured, not assumed.

5. **Presets are part of the feature, not post-processing.**  
   If a new filter cannot produce a good preset, that is a signal to cut or simplify it.

6. **Keep saved chains stable.**  
   Avoid renaming existing filters or folding new behaviors into old filters in a way that changes defaults for old URLs.

7. **Prefer still-image correctness before realtime polish.**  
   A filter should produce good single-frame output first. Animation controls and temporal extras come second.

8. **Do not add a filter if a preset already covers the idea well.**  
   `Crystal Ball`-style ideas are better as presets unless there is a genuinely reusable standalone algorithm.

9. **Prefer one representative filter per aesthetic family.**  
   If `Stamp` lands well, we probably do not also need separate near-duplicates like `Linocut`, `Rubber Print`, and `Zine Xerox` in the same plan.

---

## Risks and Cut List

If scope needs to shrink, cut in this order:

1. `Optical Flow Visualization`
2. `Datamosh motion-vector mode`
3. `Median-cut / Octree`
4. `Caustics`
5. `Persistence-of-vision bands`
6. `Triangle Pixelate` if Hex Pixelate already covers the tessellation need well enough
7. `Isometric Extrude`
8. `Palette Mapper by Hue Bands`
9. `Frequency Filter`

The core of this plan is still successful if it ships:
- `Curves`
- `Polar / Inverse Polar`
- `Hex Pixelate`
- `Anaglyph 3D`
- `Background Reconstruction`
- `Cinemagraph`
- `Stop Motion`
- a strong batch of presets

---

## Testing Strategy

Tests should stay proportional to the type of work:

### Pure helper tests
- Put pure math / sampling tests under `test/utils/`
- Good targets: bilinear sampling, curve LUT generation, quantizer helpers, glyph matching

### Smoke coverage
- Every new filter should be registered and exercised by `test/smoke/filters.test.ts`
- This is the baseline guardrail for "does not throw" and "returns a canvas"

### Linearization coverage
- Any filter that explicitly branches on `_linearize` should either extend `test/linearize/linearize.test.ts` or add a focused regression test nearby

### Reducer / serialization coverage
- If Plan 012 adds a new option shape that is unusual, especially `Curves`, add a reducer or serialization regression test so URL / localStorage round-tripping stays stable

### Visual spot checks
- No goldens are required for v1, but each major filter should be manually spot-checked on:
  - portrait photo
  - landscape photo
  - high-contrast graphic
  - short webcam/video input for temporal filters

---

## Execution Notes by Item

These notes are meant to reduce false starts when implementation begins.

### Curves
- Start with a master RGB curve only if the editor is the critical path
- Keep the filter implementation independent from the editor component so the control can evolve later
- Favor monotonic interpolation; disallow point crossover in the UI

### Polar / Mode 7
- Implement shared coordinate mapping first, then the filter wrappers
- Clamp aggressively in nearest mode and sample safely in bilinear mode to avoid edge garbage

### Hex / Triangle Pixelate
- Compute cell ownership deterministically from destination coordinates
- Sample one representative source color per cell in v1; do not attempt expensive per-cell averaging unless quality is clearly lacking

### Cinemagraph / Stop Motion / Shutter Drag
- Reset module state whenever dimensions change
- If behavior depends on parameters like depth or hold count, reset when those options change too

### Background Reconstruction
- Ship EMA mode first
- Only add median mode if memory and complexity stay under control

### Optical Flow / Datamosh motion vectors
- Prototype in a standalone helper first
- If block matching does not produce stable, legible output quickly, cut scope rather than tuning forever

### Toon / Stamp / Screen Print
- Compare against existing 2-to-3 filter chains before committing to standalone versions
- Favor bold, legible output over overly accurate physical simulation in v1

### Luma Matte / Selective Color Pop
- Keep these chain-friendly and simple
- Their value comes from how often they become building blocks for presets and export workflows

---

## Proposed Breakdown Into Follow-up Plans or PRs

If Plan 012 is executed over multiple PRs, this split should keep each step reviewable:

1. Utility groundwork
   - `E1` bilinear sampling helper
   - optional tests

2. Phase 1 filters
   - `B1` Polar
   - `B2` Hex Pixelate
   - `C1` Anaglyph 3D
   - first preset batch

3. Photo controls
   - `A1` Curves
   - `A2` Levels linear-light correctness

4. Temporal companions
   - `D1` Background Reconstruction
   - `D2` Cinemagraph
   - `D3` Stop Motion
   - `D5` Frame Difference Highlight

5. Stylize expansion
   - selected `B3/B4/B5/B6`
   - selected `C2/C3/C4`
   - selected `F1/F2/F3/F13`

6. Experimental batch
   - selected `A3/D7/D9/D10`
   - selected `F4/F6/F7/F11/F14`

This keeps each PR small enough to test and demo, while still aligning with the phased roadmap above.

---

## Definition of Done

Plan 012 is complete when:
- The library gains a small, high-quality second wave of filters rather than a large inconsistent batch
- Each shipped filter has clear option descriptions and at least one good preset
- Shared utilities are tested where practical
- Temporal filters correctly declare `mainThread: true` when required
- The preset list grows thoughtfully, without dumping dozens of weak near-duplicates into the picker
