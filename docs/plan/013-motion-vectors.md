# Plan 013 — Motion Vectors / Arrow Field

**Goal:** Add a new temporal analysis filter that estimates local frame-to-frame motion and renders it as a readable field of arrows. The filter should feel more like a debugging or data-visualization tool than the existing artistic motion filters, while still being visually useful on live video.

**Why a separate filter instead of only extending `Optical Flow`:**
- `src/filters/opticalFlow.ts` already estimates block motion and can render arrows, but its UX is organized around three high-level display modes and a color-wheel aesthetic
- The requested feature wants the arrow field itself to be the primary output, with channel-aware motion sources such as `RGB`, `R`, `G`, `B`, and `Luma`
- Keeping this as a sibling filter avoids turning `Optical Flow` into a kitchen-sink control surface and lets us describe the new filter clearly in the picker

---

## Proposed Filter

**Name:** `Motion Vectors`  
**Category:** `Advanced`  
**Core behavior:** Divide the frame into cells, compare each cell to the previous frame, estimate the best local displacement, and draw an arrow from each cell center in the detected direction.

### v1 output modes

1. `Arrows`
2. `Arrows on source`
3. `Magnitude heat`

The first two cover the main ask. `Magnitude heat` is optional but cheap once vectors exist, and it gives us a second way to verify that the motion estimate is behaving sensibly.

### v1 motion source options

1. `RGB`
2. `Red`
3. `Green`
4. `Blue`
5. `Luma`

**Implementation note:** this should affect the block matching cost function, not just the arrow color. That keeps the filter useful for things like “track only red LED movement” or “ignore chroma noise and follow brightness structure.”

### v1 controls

1. `cellSize`
2. `searchRadius`
3. `threshold`
4. `gain`
5. `display`
6. `sourceMode`
7. `showMagnitude`
8. `arrowColorMode`
9. `backgroundDim`
10. `animSpeed`
11. `animate`

`arrowColorMode` can stay compact in v1:
- `Direction`
- `Source channel`
- `White`

That gives us a useful color story without introducing custom color pickers or too many branches.

### Recommended phased rollout

1. **v1:** clean arrow field with channel-aware matching
2. **v1.5:** temporal smoothing, confidence fade, and optional trails
3. **v2:** alternate glyph styles and more stylized motion-rendering modes

This keeps the initial implementation readable and testable while still aiming at a more distinctive final look.

---

## Cool Variations

These are the strongest follow-up ideas if we want the filter to feel more special than a plain debugging overlay.

### A. Smoother, more cinematic vectors

These improve the base filter without changing its identity.

**Suggested options:**
- `temporalSmoothing` — blend each cell's vector with the previous frame's vector to reduce jitter
- `spatialSmoothing` — lightly average neighboring cell vectors so the field reads as a flow instead of noisy independent arrows
- `confidenceCutoff` — hide weak or ambiguous vectors
- `minMagnitude` — suppress tiny micro-motion that clutters the frame

**Why it helps:**
- makes live webcam and handheld video feel much less flickery
- turns the output from "technical prototype" into something more intentional

### B. Trail and persistence modes

These add time memory and are likely the highest-payoff "cool" feature after the base arrow field.

**Suggested modes:**
1. `Trails` — arrows fade over several frames like a long-exposure wind map
2. `Comets` — vectors render as heads plus tapered streaks
3. `Ghost field` — old arrows decay slowly on top of the current frame

**Implementation note:**
- These can use `_prevOutput` for a simple visual persistence pass
- If we later want true vector persistence instead of image persistence, we can keep a small module-level per-cell vector buffer

### C. Alternate glyph styles

Classic arrows are readable, but swapping the glyph can completely change the personality of the filter.

**Suggested `glyphMode` values:**
1. `Arrow`
2. `Needle`
3. `Line`
4. `Triangle`
5. `Dot + Tail`

**Why it helps:**
- `Line` and `Needle` can feel more elegant and less diagram-like
- `Triangle` reads well at small sizes
- `Dot + Tail` can look more alive in video than rigid arrowheads

### D. Richer color stories

The output gets much more expressive if color communicates different motion properties.

**Suggested `colorMode` values:**
1. `Direction wheel`
2. `Magnitude heat`
3. `Source color`
4. `Channel tint`
5. `Confidence`
6. `Monochrome`

**Extra idea:**
- in `Channel tint`, use a red/green/blue palette to match the selected source mode and make the analysis intent obvious at a glance

### E. Hybrid visualization modes

These can make the filter more legible and more visually distinct.

**Suggested `display` expansions:**
1. `Heat + Arrows`
2. `Contours + Arrows`
3. `Sparse overlay`
4. `Dense field`

`Heat + Arrows` is especially strong because it shows both where motion exists and which direction it goes.

### F. Experimental follow-ups

These are cool, but probably belong after the main filter ships.

1. `Curl / swirl view` — visualize local rotational motion
2. `Divergence view` — highlight expansion and contraction zones
3. `Motion compass` — each cell becomes a little needle or compass rose
4. `Flow particles` — spawn tiny particles that drift along the vector field
5. `Glitch vectors` — render vector heads with RGB separation and digital breakup

These would likely become sibling filters or special render modes rather than default v1 controls.

---

## Technical Approach

### 1. Reuse the temporal pipeline contract

The filter should read:
- `_prevInput`
- `_frameIndex`
- `_isAnimating`

and declare:
- `mainThread: true`

No `FilterContext` architecture changes should be required.

### 2. Start from the existing optical-flow matcher

The block-search logic in `src/filters/opticalFlow.ts` is already close to what we want:
- block-based search over a local neighborhood
- bilinear sampling from the previous frame
- thresholded best-match selection
- arrow rasterization utility

For maintainability, we should extract the shared pieces into a small helper rather than copy-paste the whole file.

**Likely shared helpers:**
- block error function with pluggable channel weighting
- line / arrow drawing helper
- HSV or direction-to-color helper

**Likely location:**
- `src/utils/motionVectors.ts` or `src/filters/sharedMotion.ts`

### 3. Add channel-aware matching

The current optical-flow error metric averages absolute RGB differences. For the new filter, replace that with a mode-aware metric:

- `RGB`: average absolute difference across all three channels
- `Red`: use only red-channel difference
- `Green`: use only green-channel difference
- `Blue`: use only blue-channel difference
- `Luma`: use weighted luminance, ideally `0.2126 / 0.7152 / 0.0722`

This is the main functional addition beyond the existing `Optical Flow` filter.

### 4. Improve arrow readability

The current optical-flow arrows are minimal. For this filter, the arrows should remain legible on noisy video:

- clamp minimum vector magnitude before drawing arrowheads
- keep arrow length proportional to displacement times `gain`
- dim or skip cells below threshold
- optionally vary alpha or brightness with motion strength
- keep cell centers aligned so the field looks stable frame to frame

### 4b. Plan for vector persistence and smoothing

The first version can render vectors directly from the current frame pair, but the coolest follow-up improvements need lightweight state:

- temporal smoothing of per-cell vectors
- confidence-based decay
- motion trails that persist even when the next frame is noisy

**Practical implementation path:**
- v1: stateless render from current best match
- v1.5: optional module-level vector buffer keyed by grid size and frame dimensions
- reuse `mainThread: true` so this state persists across frames

### 5. Register the filter

Touch `src/filters/index.ts` to:
- import/export the new filter
- add it to `filterIndex`
- add a `filterList` entry under `Advanced`

Suggested description:
- `Estimate local motion between frames and render it as an arrow field for debugging, analysis, and stylized overlays`

---

## Testing Plan

### Unit tests

Add focused tests for the reusable helper layer:

1. Channel-mode error metric produces different scores for `R/G/B/Luma` as expected
2. Zero-motion identical blocks return zero displacement or a below-threshold result
3. A translated synthetic block returns the expected displacement within the configured search radius

**Likely file:**
- `test/filters/motionVectors.test.ts`

### Smoke coverage

Add the new filter to smoke coverage if needed through the existing filter smoke tests.

### Manual verification

1. Load a video with a clearly moving subject
2. Verify arrows point in the expected direction
3. Toggle `RGB` vs `R/G/B/Luma` and confirm the field changes meaningfully on channel-biased footage
4. Check first-frame behavior when `_prevInput` is missing
5. Confirm still images degrade gracefully by showing source or a neutral empty field

---

## Risks and Decisions

### Risk: duplicate logic with `Optical Flow`

If we simply fork `src/filters/opticalFlow.ts`, the two filters will drift. The plan should include a small refactor step so both filters share the matcher and arrow drawer.

### Risk: too many options

This feature could easily balloon into a full motion-analysis toolbox. v1 should stay focused on:
- vector estimation
- display mode
- source channel selection
- readable arrows

Leave advanced ideas for later:
- temporal smoothing of vectors
- per-cell confidence rendering
- long-exposure vector trails
- divergence / curl visualization
- separate X and Y motion maps
- particle-based flow rendering
- alternate glyph families beyond arrows

### Decision to make during implementation

We should choose one of these two paths:

1. **Preferred:** create a new `Motion Vectors` filter and extract shared motion-estimation helpers from `Optical Flow`
2. **Fallback:** evolve `Optical Flow` directly if the shared-helper refactor turns out heavier than expected

Path 1 matches the request better and keeps the picker language cleaner.

---

## Likely Files Touched

- `docs/plan/013-motion-vectors.md`
- `src/filters/motionVectors.ts`
- `src/filters/opticalFlow.ts`
- `src/filters/index.ts`
- `src/utils/motionVectors.ts` or similar shared helper
- `test/filters/motionVectors.test.ts`
- `test/smoke/filters.test.ts`

---

## Ship Criteria

The feature is ready when:

1. A new `Motion Vectors` filter appears in the picker
2. It renders stable arrows on animated input
3. `RGB`, `R`, `G`, `B`, and `Luma` materially change the motion estimate
4. First-frame and still-image behavior are graceful
5. Tests cover at least the channel-aware matching and a simple synthetic displacement case

### Nice-to-have stretch criteria

If time allows, one of these should be the first "make it cooler" enhancement:

1. temporal smoothing for less jitter
2. a `Trails` render mode
3. a second glyph mode such as `Line` or `Needle`
