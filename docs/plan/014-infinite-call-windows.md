# Plan 014 — Infinite Call Windows Filter

**Goal:** Add a temporal filter that mimics recursive video-call self-view windows, but with a distinctly digital UI aesthetic instead of analog/fractal feedback. The result should feel like a conferencing app imploding into nested panes: tiled windows, subtle compression artifacts, UI chrome hints, and controllable recursion depth.

**Working name:** `Infinite Call Windows`  
**Category:** `Advanced`  
**Closest existing filter:** `Video feedback` (temporal recursive transform), but this new filter should bias toward crisp pane geometry and interface-like composition.

## Refinement (Execution Spec)

### Concrete v1 option defaults

1. `layout`: `Center stack`
2. `depth`: `5` (range `1..12`, step `1`)
3. `scalePerDepth`: `0.84` (range `0.60..0.98`, step `0.01`)
4. `drift`: `0.018` (range `0.00..0.08`, step `0.002`)
5. `mix`: `0.72` (range `0.10..0.95`, step `0.05`)
6. `uiChrome`: `true`
7. `digitalDegrade`: `0.35` (range `0..1`, step `0.05`)
8. `accentHue`: `205` (range `0..360`, step `1`)
9. `animSpeed`: `15` (range `1..30`, step `1`)
10. `animate`: existing temporal toggle pattern (`Play / Stop`)

### File-level implementation checklist

1. Add `src/filters/infiniteCallWindows.ts`
2. Register in `src/filters/index.ts`:
- import
- named export
- include in `filterIndex`
- include in `filterList` as `Infinite call windows`
3. Add preset in `src/components/ChainList/index.tsx`:
- `Meeting Meltdown` using `Infinite call windows` (+ finishing filters)
4. Update `src/components/SaveAs/index.tsx` temporal detection:
- include `"Infinite Call Windows"` in `TEMPORAL_FILTERS`
5. Add smoke coverage in `test/smoke/filters.test.ts`:
- registration and fallback behavior check

### Rendering choices locked for v1

1. Blend mode remains normal alpha composite (no blend-mode enum in v1)
2. Digital artifacts are one grouped control (`digitalDegrade`)
3. Pane chrome is intentionally minimal and non-themable in v1
4. `3x3` layout ships only if perf is acceptable at default depth

---

## Product Intent

`Video feedback` currently delivers a camera-at-monitor vibe via transformed previous output and color drift. For this feature we want:

1. Rectangular window recursion over spiral/tunnel recursion
2. Digital-conferencing visual language (panes, borders, title-bar strip, optional status LED dot)
3. Stable composition that reads clearly at a glance in both stills and motion
4. A compact option set that is expressive without becoming a kitchen sink

Success means users can get a recognizable “infinite meeting window” look from a single filter, then style it further with existing chain filters.

---

## Proposed v1 Behavior

Each frame:

1. Start with current input as base layer
2. Pull `_prevOutput` (if present)
3. Place N transformed copies of `_prevOutput` into a layout of window tiles
4. Apply light digital degradation to recursive layers (block quantization / scanline cadence / chroma offset)
5. Composite recursive windows over base input using a configurable blend mode
6. Draw optional minimal UI chrome per window (header strip + border + optional mute/rec dot)

If `_prevOutput` is unavailable (first frame / reset), return input unchanged.

`mainThread: true` is required.

---

## Control Surface (v1)

1. `layout` (ENUM)
- `Center stack` (single nested self-view stack)
- `2x2 grid`
- `3x3 grid`
- `Picture-in-picture`

2. `depth` (RANGE, integer)
- How many recursion generations to render (example range 1 to 12)

3. `scalePerDepth` (RANGE)
- Shrink factor applied each generation (example 0.65 to 0.98)

4. `drift` (RANGE)
- Pixel/fractional offset growth per generation for “UI drift”

5. `mix` (RANGE)
- Recursive layer blend amount vs fresh input

6. `uiChrome` (BOOL)
- Draws pane border/title strip and tiny status indicators

7. `digitalDegrade` (RANGE)
- Strength of digital artifacts on recursive layers

8. `accentHue` (RANGE)
- Tint accent used by window chrome and subtle highlights

9. `animSpeed` (RANGE)
10. `animate` (ACTION)

All options should include `desc` for tooltip quality.

---

## Visual System Details

### Layout engine

Implement a deterministic tile generator per mode:

- `Center stack`: repeated centered rectangles with depth scaling
- `2x2` / `3x3`: each generation picks a tile path (for example cyclic index) to create self-within-self nesting
- `Picture-in-picture`: dominant full-frame pane + anchored corner recursive pane

Keep coordinates integer-rounded at draw time to reduce subpixel shimmer.

### Pane chrome

For each pane (optional):

1. Header strip (flat fill, low alpha)
2. Border stroke (1 px device-aware)
3. Tiny icon dots (left side) or status LED (right side)

Chrome should be subtle and configurable only by existing options (avoid adding many style toggles in v1).

### Digital degradation pass

Apply only to recursive layers (not base input):

1. Chroma micro-offset (R/B channel offset by 1 to 2 px)
2. Macroblock quantization on a small block grid
3. Optional line cadence (every Nth row dimmed slightly)

Bind all three to one `digitalDegrade` control in v1 for UX simplicity.

---

## Technical Approach

### 1. New filter module

Create `src/filters/infiniteCallWindows.ts` with standard filter export shape:

- `optionTypes`
- `defaults`
- filter function
- `mainThread: true`
- concise `description`

### 2. Reuse proven pieces from `videoFeedback`

Borrow robust parts from `src/filters/videoFeedback.ts`:

- `_prevOutput` fallback behavior
- frame-buffer handling and `cloneCanvas` usage
- animation action wiring pattern

But do not reuse its spiral transform as the primary composition model.

### 3. Compositing pipeline

Suggested internal steps:

1. Build a temp canvas from `_prevOutput`
2. For depth level `d`:
- compute destination rect from layout engine
- draw transformed previous frame into rect
- apply per-depth alpha falloff and degrade amount
- optionally draw pane chrome
3. Blend recursive result over current frame according to `mix`

Prefer canvas draw operations for geometry, then pixel-buffer pass for degradation where needed.

### 4. Performance constraints

- Keep default `depth` conservative (for example 4 to 6)
- Early-exit when pane rect is below a minimum size (for example < 8 px dimension)
- Reuse allocated `ImageData` buffers where practical
- Avoid per-pixel expensive math in nested loops when degradation is 0

---

## Registration and Discoverability

1. Add import and `filterList` entry in `src/filters/index.ts`
- Display name: `Infinite call windows`
- Category: `Advanced`
- Description should mention “recursive meeting panes”

2. Add at least one curated preset in `src/components/ChainList/index.tsx`
- Example preset name: `Meeting Meltdown`
- Suggested chain: `Infinite call windows` + `JPEG artifact` + `Sharpen` (or `Bloom` for neon variant)

3. Ensure `SaveAs` animated-filter detection includes this filter if needed by current detection strategy.

---

## Testing Plan

### Unit and smoke coverage

1. `test/smoke/filters.test.ts`
- Filter is registered and callable
- First-frame behavior without `_prevOutput` returns usable output

2. New focused tests (for pure helpers if extracted)
- Layout rect generation is deterministic for each mode
- Depth falloff / rect clipping respects bounds

3. Optional pixel-level regression fixture (small canvas)
- Verify recursive composition modifies expected regions when `_prevOutput` is provided

### Manual QA checklist

1. Webcam live mode: effect remains stable at default depth
2. Static image mode: first apply does not crash and remains visually coherent
3. `animate` toggles correctly and stops cleanly
4. URL export/import preserves options
5. Performance remains acceptable on 720p input with default settings

---

## Rollout Phases

### Phase 1 (ship)

1. Core layouts (`Center stack`, `2x2`, `Picture-in-picture`)
2. Depth + scale + mix controls
3. Basic chrome and unified digital degrade
4. Filter registration + one preset

### Phase 2 (follow-up)

1. `3x3 grid` and alternate nesting paths
2. Additional blend modes (screen/add/multiply)
3. Optional participant-name text stubs or timestamp overlay
4. Stronger artifact styles (packet-loss blocks, temporal freeze tiles)

---

## Risks and Mitigations

1. Risk: Visual clutter at high depth
- Mitigation: clamp defaults, size cutoffs, alpha falloff

2. Risk: Frame-time spikes on high-resolution video
- Mitigation: early exits, avoid degradation pass when strength is 0, keep chrome cheap

3. Risk: Overlap with `Video feedback` identity
- Mitigation: prioritize tiled pane layout and UI chrome, minimize psychedelic color drift

---

## Acceptance Criteria

1. New filter `Infinite call windows` is available in picker and chain editor
2. Default settings immediately produce a recognizable recursive video-call window effect
3. Effect works for stills and video; animation controls function like existing temporal filters
4. Filter declares `mainThread: true` and correctly uses temporal state
5. At least one curated preset demonstrates the intended “digital meeting recursion” aesthetic
