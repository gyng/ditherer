# Plan 007 — Filter Chaining

**Goal:** Let users build an ordered pipeline of filters that execute
sequentially on a single input image, with independent per-filter controls,
non-destructive editing, and shareable URLs.

---

## Problem

The app applies one filter at a time. Combining effects (e.g., Grayscale →
Ordered dither → Chromatic aberration → Scanline) requires manually applying
each filter, copying output back to input, and repeating. This workflow is
slow, lossy (re-encoded per pass), and impossible to tweak non-destructively.

---

## Design

### 1. State Shape

```ts
type ChainEntry = {
  id: string;            // crypto.randomUUID() — stable key for React lists,
                         // option scoping, and per-entry temporal state
  displayName: string;   // e.g. "Ordered (Gameboy)"
  filter: FilterObject;  // { name, func, optionTypes, options, defaults }
  enabled: boolean;      // toggle without removing
};

// State (in reducers/filters.ts)
chain: ChainEntry[];     // ordered pipeline — minimum length 1
activeIndex: number;     // which entry's controls are visible in the sidebar
```

**Backward compat during migration**: compute `selected = chain[activeIndex]`
in the reducer so existing consumers (`App`, `Controls`, `Exporter`) continue
to work without a rewrite. Remove this shim once all consumers read from
`chain` directly.

**Invariants**:
- `chain.length >= 1` — removing the last entry is prevented in the UI
- `0 <= activeIndex < chain.length`
- Duplicate filter types are allowed (e.g. two Floyd-Steinberg with different
  palettes); entries are distinguished by `id`, not by `filter.name`

### 2. Execution Pipeline

```
inputCanvas
  → grayscale.func(canvas)         // once, only if convertGrayscale
  → chain[0].func(canvas, opts0)   // skipped if !enabled
  → chain[1].func(canvas, opts1)
  → ...
  → outputImage
```

Each filter receives the previous step's `HTMLCanvasElement` directly — no
intermediate PNG encoding or `toDataURL` between steps.

**Linearization** — pass `_linearize` to each filter individually. Every
filter that supports it does its own `srgbBufToLinearFloat` →  process →
`linearFloatToSrgbBuf` round-trip internally. Do NOT pre-linearize at
chain boundaries: filters expect sRGB `Uint8ClampedArray` and would
double-convert. This means repeated quantization at each sRGB↔linear
boundary — correct for now, fixable later with a `Float32Array` pipeline
refactor (separate project).

**Grayscale pre-conversion** — restructure the current approach in
`App/index.tsx` (lines 125–127) which wraps the filter function. Instead,
pre-process the input canvas once before passing it to the chain loop.

### 3. Intermediate Result Caching

When the user adjusts filter 3 of 5, only re-run filters 3–5.

```ts
// In FilterContext (ref, not state — canvases aren't serializable)
const cachedOutputs = useRef<Map<string, HTMLCanvasElement>>(new Map());
```

- Keyed by chain entry `id`
- Input to filter N = `cachedOutputs[chain[N-1].id]` (or source canvas for N=0)
- **Invalidation**: when entry N's options change, delete cache for N and all
  entries after it. When chain order/membership changes, clear entire map.
- **Disabled during animation**: temporal filters produce different output each
  frame, so caching is bypassed when `_isAnimating` is true.

### 4. Temporal Filters (CRT, VHS, Datamosh, E-ink, Oscilloscope)

These filters read `_prevOutput` (their own previous frame's output),
`_frameIndex`, and `_isAnimating`.

**Per-entry `_prevOutput`**: A single global `prevOutputRef` breaks when a
temporal filter is mid-chain — datamosh at position 2 of 4 would compare its
input against the final chain output from the previous frame, producing wrong
motion detection. Fix: store per-entry.

```ts
// In FilterContext
const prevOutputMap = useRef<Map<string, Uint8ClampedArray>>(new Map());
```

After each filter runs, extract its output via `getImageData` and store under
its `id`. On the next frame, pass that entry's stored buffer as `_prevOutput`.

**Invalidation**: clear the map on chain reorder, add, or remove (positional
context changed). Clear a single entry when it's toggled off.

**`_frameIndex`**: global counter, shared. Fine as-is.

**`_degaussFrame`**: global for now. If users chain multiple CRT filters,
degauss triggers all of them simultaneously — acceptable behavior.

**`animSpeed`**: the animation loop reads FPS from the first chain entry that
has an `animSpeed` option. If none do, default to 15 fps. Per-filter FPS
would require running chain segments at different rates — not worth the
complexity.

### 5. Reducer Actions

All mutations carry explicit target identifiers. No action relies on the
current `activeIndex` for deciding *which entry to modify*.

| Action | Payload | Effect |
|--------|---------|--------|
| `CHAIN_ADD` | `{ displayName, filter }` | Append with new `id`; set `activeIndex` to new entry |
| `CHAIN_REMOVE` | `{ id }` | Remove entry; clamp `activeIndex`; no-op if last entry |
| `CHAIN_REORDER` | `{ fromIndex, toIndex }` | Splice; `activeIndex` follows the active entry |
| `CHAIN_SET_ACTIVE` | `{ index }` | Update `activeIndex` |
| `CHAIN_TOGGLE` | `{ id }` | Flip `enabled` flag |
| `CHAIN_REPLACE` | `{ id, displayName, filter }` | Swap a filter in-place (e.g. from dropdown) |
| `SET_FILTER_OPTION` | `{ chainIndex, optionName, value }` | Mutate `chain[chainIndex].filter.options` |
| `SET_FILTER_PALETTE_OPTION` | `{ chainIndex, optionName, value }` | Mutate nested `.palette.options` |
| `ADD_PALETTE_COLOR` | `{ chainIndex, color }` | Push to `.palette.options.colors` |
| `SELECT_FILTER` | `{ name, filter }` | **Compat shim**: reset chain to single entry |

`SET_FILTER_OPTION` / `SET_FILTER_PALETTE_OPTION` / `ADD_PALETTE_COLOR` fall
back to `activeIndex` when `chainIndex` is omitted, so existing Controls
callsites work during migration.

### 6. Serialization

Versioned format for forward compatibility:

```json
{
  "v": 2,
  "chain": [
    { "n": "Grayscale", "o": {} },
    { "n": "Ordered", "d": "Ordered (Gameboy)", "o": { "palette": {"options":{"colors": [...]}} } }
  ],
  "g": false, "l": true, "w": true
}
```

Short keys (`v`, `n`, `d`, `o`, `g`, `l`, `w`) minimize URL length.
`d` (displayName) is only included when it differs from `n` (filter name) —
i.e., for presets. `o` (options) uses **delta encoding**: only options that
differ from `filter.defaults` are serialized. On deserialization, merge
deltas onto defaults looked up via `filterIndex[name]`.

**Compression**: pipe JSON through `pako.deflateRaw` → base64 → URL hash.
`pako` is already a dependency. Typical 50–70% size reduction. If the
compressed URL still exceeds 2000 characters, show a warning suggesting
JSON export instead.

**Legacy compat** (`LOAD_STATE`):
- No `v` field: legacy v1 format with `selected` → wrap as single-entry chain
- `v: 2`: deserialize chain array
- Disabled entries are serialized with `"e": false`; omitted means enabled.

### 7. UI

**Chain length = 1** (default): the UI looks identical to the current app.
The filter dropdown works as before (selecting replaces the single entry via
`CHAIN_REPLACE`). A small `[+]` button next to the dropdown is the only new
element, inviting users to add a second filter and enter chain mode.

**Chain length > 1**: the dropdown is replaced by a chain list:

```
┌──────────────────────────────────┐
│  Filter Chain              [+]   │
├──────────────────────────────────┤
│  ☑  1. Grayscale            [×]  │
│  ☑  2. Ordered (Gameboy)    [×]  │
│  ☑  3. Scanline          ●  [×]  │  ← active (controls below)
│  ☑  4. Bloom                [×]  │
├──────────────────────────────────┤
│  Scanline                        │
│  ─────────────────────────────── │
│  Gap: ████████░░ 3               │
│  Palette: Nearest ▼              │
└──────────────────────────────────┘
```

| Interaction | Gesture | Action |
|-------------|---------|--------|
| Add filter | Click [+] | Opens grouped `<select>` picker; dispatches `CHAIN_ADD` |
| Remove | Click [×] | `CHAIN_REMOVE` (disabled when chain.length = 1) |
| Reorder | Drag handle | `CHAIN_REORDER` via HTML Drag and Drop API |
| Edit controls | Click entry | `CHAIN_SET_ACTIVE` → controls panel updates |
| Toggle | Click checkbox | `CHAIN_TOGGLE` |
| Swap filter | Double-click entry name | Inline dropdown to replace that entry's filter |

### 8. Performance

#### Memory budget

Each filter allocates at least 2 canvases internally (`cloneCanvas` for
input + output). At 1400×1400 (the desktop `MAX_PIXELS` cap), one RGBA
canvas = ~7.5 MB. Per chain step:

| Allocation | Size (1400×1400) | Lifetime |
|------------|-----------------|----------|
| Filter internal canvases (2) | ~15 MB | GC'd after step completes |
| `cachedOutputs` entry (§3) | ~7.5 MB | Persists until invalidated |
| `prevOutputMap` entry (§4) | ~7.5 MB | Persists until chain mutation |

A 5-filter chain with caching and temporal state: ~75 MB resident
(5 × 7.5 cached + 5 × 7.5 prevOutput). At 1400×1400 this is fine for
desktop. On mobile (`MAX_PIXELS` = 500K, ~700×700), each canvas is ~1.9 MB,
so a 5-filter chain is ~19 MB — also fine.

**Hard cap**: limit chain length to 16 entries. Beyond that, memory grows
linearly and UX value diminishes. Show the [+] button as disabled with a
tooltip when at the cap.

#### CPU — main thread blocking

Every filter runs synchronously on the main thread. Currently this is one
filter per `requestAnimationFrame`; chaining makes it N filters. Typical
single-filter times at 1400×1400:

| Filter type | Typical time |
|-------------|-------------|
| Simple pixel-map (Invert, Grayscale) | 2–5 ms |
| Error diffusion (Floyd-Steinberg, Atkinson) | 15–40 ms |
| Convolution (Kuwahara, Bloom) | 30–80 ms |
| Iterative (Reaction-diffusion, K-means) | 100–500 ms |

A 5-filter chain of mid-weight filters: ~100–200 ms total. Acceptable for
a one-shot apply, but causes dropped frames during real-time filtering.

**Mitigations (in priority order)**:

1. **Intermediate caching** (§3): when the user tweaks filter 3 of 5, only
   filters 3–5 re-execute. This is the single biggest win — most edits
   touch one filter at a time.

2. **Debounced auto-filter**: replace the `requestAnimationFrame` in the
   auto-filter `useEffect` with a 32ms debounce. Prevents stacking during
   rapid slider drags. The debounce is longer than one frame (16ms) to
   coalesce multiple React state updates into one filter pass.

3. **Frame dropping during animation**: when `_isAnimating` and the chain
   takes longer than the frame interval (1000/fps), skip the next frame
   rather than queuing. The animation loop already measures elapsed time
   (`timestamp - animLastTimeRef`); just let it naturally skip.

4. **Adaptive real-time toggle**: if total chain time exceeds 200ms, flash
   a brief status message ("Chain too slow for real-time — apply manually")
   and auto-disable `realtimeFiltering`. The user can re-enable it or
   reduce the chain.

5. **`toDataURL` bottleneck**: the final step converts the output canvas to
   a PNG data URL for the output `Image` element. This is ~10–30ms and
   happens once regardless of chain length, so it doesn't scale with N.
   Not a chain-specific concern.

#### GC pressure

Each filter step creates 2+ canvases that become garbage after the step
completes. A 5-filter chain creates ~10 short-lived canvases per execution.
At 60fps animation this is 600 canvases/second — significant GC pressure.

**Mitigation**: canvas pooling (future optimization, not Phase 1). Allocate
a pool of reusable canvases, resize as needed, return to pool after use.
This is a meaningful optimization but not required for launch — modern
browsers handle canvas GC reasonably well, and the animation loop already
has frame-dropping as a safety valve.

### 9. UX

#### Discoverability

The [+] button next to the filter dropdown is the entry point to chaining.
To make it discoverable without being intrusive:

- **First-time hint**: on first visit (localStorage flag), show a subtle
  tooltip on the [+] button: "Add another filter to build a chain". Dismiss
  on click or after 5 seconds. Never show again.
- **Shared URL landing**: when a user opens a URL with a multi-filter chain,
  the chain list is immediately visible — they see the feature by example.
- **Empty state**: no special onboarding flow. The feature is additive;
  users who never click [+] see no difference from today.

#### Chain list interactions (detailed)

```
 ☑  ☰  2. Ordered (Gameboy)  1.2ms  [×]
 │   │  │                      │      │
 │   │  │                      │      └ remove (disabled if last)
 │   │  │                      └ per-step frame time (dim, non-interactive)
 │   │  └ display name (click → set active; double-click → swap dropdown)
 │   └ drag handle (cursor: grab)
 └ enable/disable checkbox
```

**Active entry highlight**: the active entry gets a left border accent
(reuse the app's existing highlight color token). All other entries are
visually subdued.

**Disabled entries**: unchecked entries are rendered at 50% opacity with
strikethrough on the name. Their controls are still accessible (click to
activate and edit) but they are skipped during execution.

**Keyboard navigation** (accessibility):
- `↑` / `↓` when the chain list is focused: move `activeIndex`
- `Delete` or `Backspace` on active entry: `CHAIN_REMOVE` (with confirmation
  if the entry has non-default options)
- `Space` on active entry: `CHAIN_TOGGLE`
- Drag-and-drop also works via keyboard: `Alt+↑` / `Alt+↓` to reorder

#### Error handling

If a filter in the chain throws during execution:

1. Catch the error; log to console with filter name and stack
2. Show a red error badge (!) on the chain entry
3. **Skip the failed filter** — pass its input canvas through as output
4. Continue executing the rest of the chain
5. The error badge persists until the user changes that filter's options
   (which might fix it) or removes the entry

This fail-forward approach means one broken filter doesn't block the
entire chain. It matches the existing single-filter behavior (errors are
caught in `filterImageAsync`).

#### Mobile layout

On mobile (≤768px), the sidebar stacks vertically above the canvas.
The chain list must be compact:

- Entries show only: checkbox, number, truncated name (no frame time)
- Max visible height: 120px with scroll if chain exceeds ~4 entries
- The [+] button and controls remain below the list
- Drag-and-drop uses touch events (`touchstart`/`touchmove`/`touchend`)
  with a long-press to initiate (avoids conflict with scroll)

#### Undo considerations

Chain mutations (remove, reorder) are destructive — there's no undo stack.
This is acceptable because:

- Remove: the user can re-add the same filter (options reset to defaults,
  but this matches the "undo" mental model for a creative tool)
- Reorder: easily reversible by dragging back
- The JSON export captures full chain state, serving as a manual save point
- Adding a full undo stack is significant complexity for a low-frequency
  interaction. Defer unless user feedback demands it.

#### Status bar

Extend the existing frame time display to show chain info:

- Single filter: `Floyd-Steinberg  12ms` (same as today)
- Chain: `3 filters  48ms (12 + 22 + 14)` — total and per-step breakdown
- During animation: `3 filters  48ms  15fps`

### 10. URL Hash Sync

The existing `useEffect` in `FilterContext.tsx` (lines 58–77) that syncs
state to the URL hash is updated to serialize the chain using the v2 format.
`history.replaceState` continues to be used (no history pollution).

For single-entry chains with default options, emit a compact URL that is
indistinguishable from the current v1 format — old bookmarks continue to
work, and simple shares stay short.

---

## Implementation Phases

### Phase 1 — State & Reducer

Add `chain` and `activeIndex` to state. Implement all `CHAIN_*` actions.
Keep `selected = chain[activeIndex]` as a computed compat shim. Add
`chainIndex` to option-mutation actions with `activeIndex` fallback.
Update `LOAD_STATE` to handle v1 and v2.

**Files**: `src/reducers/filters.ts`

**Verify**: existing app works identically (single-entry chain = same
behavior). Run `npm test` — all smoke tests pass.

### Phase 2 — Execution Pipeline

Update `filterImageAsync` to loop over enabled chain entries. Move
grayscale pre-conversion out of the filter-function wrapper and into a
pre-processing step. Implement per-entry `prevOutputMap`. Update
`getExportUrl` / `exportState` to emit v2.

**Files**: `src/context/FilterContext.tsx`

**Verify**: manually add a second entry to `initialState`, confirm both
filters apply in sequence. Confirm temporal filters (CRT, VHS) still
work correctly at various chain positions.

### Phase 3 — UI: Chain List Component

Build `ChainList` component with add/remove/reorder/toggle/select. Show
the chain list when `chain.length > 1`; show the classic dropdown + [+]
button when `chain.length === 1`. Wire the [+] button to the filter picker.

**Files**: `src/components/ChainList/index.tsx` (new),
`src/components/ChainList/styles.module.css` (new),
`src/components/App/index.tsx`

**Verify**: add/remove/reorder filters in the UI. Confirm controls panel
updates on entry click. Confirm single-filter mode matches current UX.

### Phase 4 — Controls Integration

Pass `chainIndex` from the chain list through to `Controls`. Update
Controls to forward `chainIndex` in all `SET_FILTER_OPTION` /
`SET_FILTER_PALETTE_OPTION` / `ADD_PALETTE_COLOR` dispatches. Remove the
`selected` compat shim once all consumers read `chain[activeIndex]`.

**Files**: `src/components/controls/index.tsx`,
`src/components/App/index.tsx`

**Verify**: change options for filter 2 in a 3-filter chain. Confirm
only filter 2's options change; other filters' outputs are unaffected.

### Phase 5 — Serialization & URL Sync

Implement v2 serialization with short keys, delta encoding, and pako
compression. Update URL hash sync. Backward-compat for v1 URLs.

**Files**: `src/context/FilterContext.tsx`, `src/reducers/filters.ts`

**Verify**: build a multi-filter chain, copy URL, open in new tab —
chain restores correctly. Test with a v1 URL — loads as single-entry chain.

### Phase 6 — Intermediate Caching

Add `cachedOutputs` ref. Invalidate on option change (N..end), chain
mutation (all). Bypass during animation. Display per-step timing.

**Files**: `src/context/FilterContext.tsx`

**Verify**: in a 5-filter chain, change filter 3's option. Confirm
filters 1–2 are not re-executed (measure via `performance.now` or
console logging).

---

## Files Summary

| File | Change |
|------|--------|
| `src/reducers/filters.ts` | `chain`, `activeIndex`, all `CHAIN_*` actions, `LOAD_STATE` v2 |
| `src/context/FilterContext.tsx` | Chain execution loop, `prevOutputMap`, `cachedOutputs`, URL sync v2, serialization |
| `src/components/App/index.tsx` | Chain list integration, grayscale pre-processing restructure, auto-filter deps |
| `src/components/controls/index.tsx` | Accept + forward `chainIndex` prop |
| `src/components/ChainList/index.tsx` | **New** — chain list with drag-and-drop, toggle, select |
| `src/components/ChainList/styles.module.css` | **New** — chain list styles |

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Per-filter linearization (no chain-boundary conversion) | Filters expect sRGB input; pre-linearizing would cause double-conversion. Quantization error per step is acceptable. |
| Per-entry `_prevOutput` via Map | Mid-chain temporal filters (datamosh, CRT phosphor, VHS ghost) need their own previous output, not the final chain output. |
| Minimum chain length of 1 | Avoids "empty pipeline" edge case; simpler reducer logic and UI. |
| Explicit `chainIndex` in action payloads | Prevents bugs from action/state race conditions; reducer is deterministic regardless of `activeIndex` timing. |
| Versioned serialization with short keys + pako | URLs must stay under ~2000 chars for social media sharing; delta encoding + compression makes 5-filter chains viable. |
| Incremental migration via `selected` compat shim | Existing code (Controls, App, Exporter) continues to work during phased rollout; shim is removed in Phase 4. |
| Intermediate caching keyed by entry `id` | Re-running the entire chain on every slider drag is O(N); caching makes it O(chain.length − changedIndex). |
| Single-filter UI identical to current app | Users who never chain filters see zero UI changes. The [+] button is the only new affordance. |
| Hard cap at 16 chain entries | Memory scales linearly (~15 MB/entry at max resolution); 16 is generous for creative use without runaway resource consumption. |
| Fail-forward on filter errors | A throwing filter is skipped (input passed through); red badge shown. One broken filter doesn't block the rest of the chain. |
| 32ms debounce on auto-filter | Coalesces rapid slider changes into one chain execution. Longer than 16ms (one frame) to batch React state updates. |

## Future Work (out of scope)

- **Float32Array pipeline**: pass linear float buffers between filters to
  eliminate per-step sRGB quantization. Requires changing every filter's
  function signature — large refactor.
- **Canvas pooling**: reuse canvas objects across chain steps and frames to
  reduce GC pressure during animation. Measurable win at 5+ filters @ 60fps.
- **Chain presets**: built-in named chains (e.g. "Retro TV", "Lo-fi Print").
  Nice for discoverability; defer until chaining is stable.
- **Per-step thumbnail previews**: 64px-wide preview of each step's output
  in the chain list. Useful for understanding the pipeline, but doubles
  rendering cost.
- **Web Worker execution**: run the chain off the main thread via
  OffscreenCanvas. Would unblock the UI during long chains but requires
  filter functions to work without DOM access.
- **Undo/redo stack**: track chain mutations for undo. Low priority unless
  user feedback demands it — JSON export serves as manual save points.
