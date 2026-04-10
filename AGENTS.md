# Ditherer — Agent Guidelines

## Project Overview

Ditherer is a browser-based image/video processing tool. Users load an image, select a dithering algorithm (or other effect), adjust parameters via a control panel, and apply the filter. The app also supports video frame processing, palette extraction, and state export/import via URL.

**Stack:** React 19, Vite, TypeScript, Rust/WASM (color space conversions), cmdk + Radix UI for the filter picker.

**Quick reference:** `npm run dev` (dev server) · `npm run build` (production build to `build/`) · `npm run test` (Vitest) · `npm run lint` (eslint).

---

## Architecture

### Component Hierarchy (Atomic Design)

The UI follows an implicit atomic design pattern:

**Tokens** — Design primitives defined in CSS custom properties:
- Colors: `--light-gray`, `--gray`, `--beautiful-blue`, `--bg-color`
- Layout values are inline (no token system yet)

**Atoms** — Leaf control components in `src/components/controls/`. Each renders a single HTML control:
- `Range.tsx` — `<input type="range">` with editable value display
- `Bool.tsx` — `<input type="checkbox">`
- `Enum.tsx` — `<select>` dropdown
- `Stringly.tsx` — `<input type="text">`
- `Textly.tsx` — `<textarea>`

**Molecules** — Composed controls:
- `Palette.tsx` — palette selector + nested atom controls for palette options
- `ColorArray.tsx` — color swatch grid + palette extraction UI (stateful)

**Organisms** — Sections of the app:
- `Controls` (`src/components/controls/index.tsx`) — dispatches to the right atom/molecule based on `optionTypes.type`
- `ChainList` (`src/components/ChainList/index.tsx`) — filter chain editor, presets, drag/drop reordering
- `Exporter` (`src/components/App/Exporter.tsx`) — URL/JSON state export panel
- `SaveAs` (`src/components/SaveAs/index.tsx`) — image/video file export dialog (uses MediaRecorder for video)

**Page** — Single page app:
- `App` (`src/components/App/index.tsx`) — top-level layout: sidebar controls + draggable canvas area

### State Management

App state is managed via React Context + `useReducer` in `src/reducers/filters.ts`. Components consume state via `useFilter()` (`src/context/useFilter.ts`). No external state library.

Key state shape:
- `chain` — array of `ChainEntry { id, displayName, filter, enabled }` (max 16 entries)
- `activeIndex` — which chain entry is selected for editing
- `selected` — compat shim derived from `chain[activeIndex]`
- `inputImage` / `outputImage` — source and processed canvases
- `video` — video element for realtime filtering
- Scale, grayscale, playback, linearize, wasmAcceleration

`FilterContext.tsx` owns the chain execution: temporal pipeline buffers (`prevOutputMapRef`, `prevInputMapRef`, `emaMapRef`), worker offload, and frame loop scheduling. The reducer is pure data shape; the context handles side effects.

### Filter System

Filters are the core domain (~160 filters). Each filter is a self-contained module in `src/filters/` exporting:

```typescript
// Every filter exports this shape
export const optionTypes = {
  paramName: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "What this controls" }
}

export const defaults = {
  paramName: optionTypes.paramName.default
}

const filterFunc = (input: HTMLCanvasElement, options = defaults) => HTMLCanvasElement

export default {
  name: "FilterName",
  func: filterFunc,
  options: defaults,
  optionTypes,
  defaults,
  description: "One-line user-facing summary",
  mainThread: true   // optional — only if the filter needs the temporal pipeline (see below)
}
```

The `optionTypes` declaration drives the UI — the Controls component reads it and renders the appropriate atom/molecule for each option. This is a **data-driven UI** pattern: filters declare what controls they need, the framework renders them. Every option should have a `desc` so users get tooltips.

**Control type → component mapping:**

| `optionTypes.type` | Component |
|--------------------|-----------|
| `RANGE` | `Range` |
| `BOOL` | `Bool` |
| `ENUM` | `Enum` |
| `STRING` | `Stringly` |
| `TEXT` | `Textly` |
| `COLOR` | color picker |
| `COLOR_ARRAY` | `ColorArray` |
| `PALETTE` | `Palette` |
| `ACTION` | button (e.g., `animate` for play/stop) |

**Adding a new filter:** Create a new file in `src/filters/`, define `optionTypes`, `defaults`, and the filter function, then register it in `src/filters/index.ts` (both the import and a `filterList` entry with `displayName`/`category`/`description`). The UI controls are generated automatically from `optionTypes`.

### Temporal Pipeline

Filters can read state from previous frames via injected options:

| Option | Type | Description |
|---|---|---|
| `_prevOutput` | `Uint8ClampedArray \| null` | This filter's output pixels from the previous frame |
| `_prevInput` | `Uint8ClampedArray \| null` | This filter's input pixels from the previous frame |
| `_ema` | `Float32Array \| null` | Exponential moving average of input pixels (α=0.1, ~10-frame window) |
| `_frameIndex` | `number` | Global frame counter |
| `_isAnimating` | `boolean` | Whether the animation loop is running |
| `_linearize` | `boolean` | User has gamma-correct mode on |
| `_wasmAcceleration` | `boolean` | User has WASM accel on |

These are populated by `FilterContext` and persist across calls in main-thread refs.

**`mainThread: true` flag.** Filters that read `_prevOutput`/`_prevInput`/`_ema`, hold module-level state across calls (ring buffers, accumulators), or use `dispatch` MUST declare `mainThread: true` on their default export. Without it the filter chain runs in a Web Worker where the temporal state and module state don't persist, and the filter silently does nothing.

`FilterContext.chainNeedsMainThread` checks this flag — there is no central name list. Adding a new temporal filter only requires setting the flag on its export.

Existing temporal filters: motion detect, motion heatmap, motion pixelate, long exposure, frame blend, temporal edge, temporal color cycle, phosphor decay, after-image, chronophotography, slit scan, time mosaic, freeze frame glitch, video feedback, wake turbulence, background subtraction, datamosh, e-ink (ghosting), VHS (line persistence), oscilloscope (phosphor), reaction-diffusion, cellular automata, matrix rain, the error-diffusion factory (when `temporalBleed > 0`), and analog static (when `persistence > 0`).

### WASM Module

`src/wasm/rgba2laba/` contains a Rust crate compiled to WASM for performance-critical color space conversions (RGB to CIE Lab). Loaded via dynamic import with JS fallback if WASM fails to load.

### Filter Chains

Filters compose into chains (max 16 entries). The chain is the unit of work — `FilterContext` runs each enabled entry sequentially, feeding the output of one as the input to the next, with caching of intermediate canvases. State is serialized to URL hash and localStorage so users can share or save chains.

Curated chain presets live in `src/components/ChainList/index.tsx` (`CHAIN_PRESETS`). To add a preset, append an entry referencing existing filter `displayName`s — no code change needed.

### Directory Structure

```
src/
  components/
    App/              # App organism, Exporter, SaveAs export dialog
    ChainList/        # Filter chain editor + presets
    controls/         # Atom and molecule UI controls
    FilterCombobox.tsx # Searchable filter picker (cmdk + Radix popover)
  filters/            # ~160 filter modules — the core domain
    blueNoise64.ts    # Generated 64×64 void-and-cluster threshold map
    errorDiffusingFilterFactory.ts  # Builds Floyd-Steinberg, Atkinson, etc.
  context/            # FilterContext — state, chain execution, temporal pipeline
  reducers/           # App state reducer
  palettes/           # Color palette definitions and registry
  constants/          # Enums: control types, color algorithms, action types
  utils/              # Color math, buffer ops, canvas helpers, palette generation
  wasm/rgba2laba/     # Rust/WASM color conversion module
  styles/             # Global styles
docs/plan/            # Numbered implementation plans (010 = filter audit, etc.)
```

---

## Best Practices

### Test-Driven Development

Write tests first for:
- **Bug fixes** — reproduce the bug in a test before fixing. This prevents regressions.
- **Pure functions** — color math, buffer operations, equalize, quantize. These are easy to test and critical to get right.
- **Filter logic** — test with known input buffers and verify output pixel values.
- **Reducers/state** — test action → state transitions.

Use Vitest. Tests live in `test/` mirroring `src/` structure.

### Code Style

- **No premature abstraction.** Three similar lines > one clever helper.
- **Filters are self-contained.** Don't create cross-filter dependencies. Shared logic goes in `utils/`.
- **Data-driven UI.** Declare controls via `optionTypes`, don't create custom UI per filter.
- **Mutate buffers in place** for performance (image processing operates on `Uint8ClampedArray`). Clone canvases when you need a clean copy.
- **Keep filter functions pure** where possible — take a canvas, return a canvas. Side effects (async dispatch) are the exception, not the rule.

### Component Guidelines

- Atoms are **stateless function components**. They receive a value and an `onChange`-style callback.
- Molecules compose atoms and may hold local UI state (e.g., ColorArray's extract mode toggle).
- The Controls dispatcher (`controls/index.jsx`) is a **switch on type** — keep it flat, don't nest logic.
- CSS Modules for component styles. Global styles only in `src/styles/`.

### Performance

- Image processing is CPU-bound. Keep filter hot loops tight — avoid allocations, use typed arrays.
- WASM for expensive color math (Lab distance). JS fallback must exist.
- Memoize expensive conversions (e.g., `wasmRgba2labaMemo`).
- `requestAnimationFrame` for video frame processing — don't block the main thread.

---

## Plans

Implementation plans live in [docs/plan/](docs/plan/). Numbered chronologically:

- 001 — modernization (complete)
- 002 — gamma-correct pipeline
- 003 — wide-gamut color
- 004 — js → ts migration (complete)
- 005 — realtime perf
- 006 — filter list organization
- 007 — filter chaining
- 008 — algorithm optimization
- 009 — temporal filters (pipeline shipped, several filters built)
- 010 — filter audit (descriptions, blue noise, 11 new temporal filters, presets)
- 011 — export dialog (SaveAs)

When making non-trivial changes, write a plan first under `docs/plan/NNN-name.md` and reference it from the commit.
