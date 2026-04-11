# 017 — Physical Dot Display (Flip-Dot) Filter

## Goal
Add a filter that emulates electromechanical flip-dot signage: coarse circular dots, two stable states (on/off), limited per-frame flipping, and slight mechanical imperfections.

## Product Intent
This should feel different from `Dot Matrix` and `Halftone`:
- `Dot Matrix` reads like print impact on paper.
- This new filter should read like a board of physical bi-stable dots (bus signs/train boards), especially in motion.

## Proposed Filter
Working name: `Flip-Dot Display`

Core visual model:
1. Divide frame into cells.
2. Sample luminance per cell and decide target state (`on`/`off`).
3. Apply hysteresis so dots do not chatter at threshold boundaries.
4. Limit how many dots can flip per frame (mechanical throughput cap).
5. Render each dot with slight shading/noise so it feels physical, not flat vector art.

## v1 Controls
- `cellSize` (`RANGE`, 4-24, default 10): Pixel size of each mechanical dot cell.
- `threshold` (`RANGE`, 0-255, default 128): Luminance threshold for on/off decision.
- `hysteresis` (`RANGE`, 0-64, default 12): Deadband around threshold to prevent rapid toggling.
- `maxFlipRate` (`RANGE`, 0.01-1, step 0.01, default 0.2): Fraction of cells allowed to change per frame.
- `flipPriority` (`ENUM`: `errorFirst`, `random`, `scanline`; default `errorFirst`): Which cells get flip budget first.
- `dotRoundness` (`RANGE`, 0-1, step 0.05, default 1): Circle-to-square disc shape.
- `gap` (`RANGE`, 0-4, step 0.5, default 1): Spacing between dot faces.
- `onColor` (`COLOR`, default `#F2C230`): Typical yellow face.
- `offColor` (`COLOR`, default `#1B1B1B`): Back/black face.
- `boardColor` (`COLOR`, default `#101215`): Panel background between dots.
- `specular` (`RANGE`, 0-1, step 0.05, default 0.2): Highlight amount for plastic/paint sheen.
- `stuckDotRate` (`RANGE`, 0-0.2, step 0.005, default 0): Fraction of dots that ignore flips.
- `jitter` (`RANGE`, 0-1, step 0.05, default 0.1): Per-dot brightness variation for realism.

All options include `desc` strings for control tooltips.

## Temporal Behavior
The filter should be temporal and must set `mainThread: true`.

State kept across frames (module-level):
- `stateBits`: current on/off state per cell.
- `stuckMask`: deterministic mask for stuck dots.
- `frameSeed`: stable pseudo-random source for repeatable jitter/order.
- cached grid geometry for current output size.

Reset state when:
- frame dimensions change,
- `cellSize` changes,
- animation restarts from static image mode,
- filter instance/options change in a way that invalidates grid topology.

## Rendering Details (v1)
Per cell:
1. Compute sampled luminance from source region (mean RGB -> luma).
2. Decide `targetOn` using threshold + hysteresis relative to current state.
3. If `targetOn !== currentOn`, enqueue candidate flip.
4. Choose up to `maxFlipRate * numCells` candidates by selected priority.
5. Apply flips except where `stuckMask` is set.
6. Render dot face:
   - base color from on/off state,
   - radial shading + slight edge darkening,
   - optional subtle directional specular,
   - jitter modulation.

## File-Level Implementation Plan
### Phase 1 (this implementation start)
1. Add `src/filters/flipDotDisplay.ts` with:
   - cell luminance sampling,
   - hysteresis state machine,
   - per-frame flip budget,
   - dot rendering with board gap + basic shading,
   - deterministic stuck-dot and jitter masks.
2. Register in `src/filters/index.ts`:
   - import/export,
   - `filterIndex` registration,
   - `filterList` entry (`displayName: "Flip-Dot Display"`, category `Stylize`).
3. Add initial tests for deterministic output and flip-rate limiting.

### Phase 2 (quality pass)
1. Tune defaults against real sign references (transit, stadium, destination boards).
2. Add optional line/column scan timing mode (left-to-right or top-to-bottom flip waves).
3. Add one curated preset chain (e.g., “Transit Board”).

### Phase 3 (stretch)
1. Optional audible-tick event hook for UI (if app-level audio system is added later).
2. Optional per-module subcell tilt model for more realistic off-angle highlights.

## Testing Plan
Add `test/filters/flipDotDisplay.test.ts` covering:
1. Output dimensions and alpha preservation.
2. Deterministic output for static frame with fixed options.
3. Hysteresis behavior (no flip when input oscillates inside deadband).
4. Flip budget cap respected per frame.
5. `stuckDotRate` prevents expected percentage of flips (within tolerance).

Manual QA:
1. Static image: verify crisp board look at multiple `cellSize`.
2. Video: confirm gradual flip-wave behavior with low `maxFlipRate`.
3. Option sweeps: ensure no UI/runtime errors and responsive controls.

## Risks
- Too much temporal state can cause stale buffers if reset conditions are incomplete.
- High-resolution frames with tiny `cellSize` can be expensive; keep loops allocation-free.
- Realism can become over-stylized; defaults should stay believable and restrained.

## Acceptance Criteria
1. Filter is discoverable in filter picker and fully configurable through generated controls.
2. Visual output clearly reads as electromechanical flip-dot hardware.
3. Motion exhibits limited flipping throughput (not instant full-frame toggles).
4. Build and tests pass (`npm run build`, `npm run test` for relevant suites).

## Current Status

Completed.

- filter module landed in `src/filters/flipDotDisplay.ts`
- registry wiring landed in `src/filters/index.ts`
- test coverage landed in `test/filters/flipDotDisplay.test.ts`
- the filter is discoverable in the picker and configurable through generated controls

## Outcome

`Flip-Dot Display` now ships as a temporal stylization filter that emulates electromechanical signage with:

- coarse cell-based luminance sampling
- hysteresis-driven on/off state decisions
- capped per-frame flip throughput
- deterministic per-dot jitter and stuck-dot behavior
- mechanical response delay across frames
- board/gap rendering with shaded dot faces

This plan can now be treated as an implemented record. Future work should be considered follow-up polish rather than baseline delivery.
