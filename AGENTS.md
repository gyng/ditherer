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

**Adding a new filter:** Create a new file in `src/filters/`, define `optionTypes`, `defaults`, and the filter function, then register it in `src/filters/index.ts` (both the import and a `filterList` entry with `displayName`/`category`/`description`). If the filter is worker-capable (`mainThread` is not `true`), it must also be present in the `filterIndex` registry in that same file or the browser worker path will silently skip it. The UI controls are generated automatically from `optionTypes`.

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

### Acceleration capability flags (`noGL` / `noWASM`)

Filters can declare on their `defineFilter` export when a backend fundamentally can't accelerate them. The string is the short reason shown in the inline-timing tooltip — so the UI tells you "don't ask us to port this" instead of inviting another optimise request.

```ts
export default defineFilter({
  name: "Floyd-Steinberg",
  func: /* … */,
  noGL: "error diffusion is sequential; GL is gather-only. Use Ordered for parallel dithering.",
});
```

When to set these:

- **`noGL`** — the algorithm has a hard sequential dependency on previous output pixels that a fragment shader can't express (error-diffusion kernels: Floyd-Steinberg, Atkinson, Jarvis, Sierra, Stucki, Burkes, etc.). Anything gather-parallel (per-pixel compute, separable blurs, coordinate remaps, threshold-matrix dither) is GL-friendly and should be ported rather than flagged.
- **`noWASM`** — the filter's hot path is dominated by Canvas2D calls (graphics primitives, `fillRect`, `drawImage` composites) that Rust/WASM can't replace without re-implementing Canvas2D, OR it's so trivial that WASM marshalling overhead dominates.

What's already covered:

- `errorDiffusingFilterFactory.ts` sets `noGL` on every kernel it produces.
- Parallel dithering (Ordered, Halftone) has no `noGL` and is GL-accelerated.

Don't flag a filter just because its GL port hasn't landed yet — only flag when the algorithm fundamentally can't be expressed in a fragment shader.

**New filters: GL-only (`requiresGL: true`) by default.** When the filter is gather-parallel (per-pixel compute, neighborhood reads, coordinate remaps, sampling history textures) write the GL path and skip the JS fallback. A naive JS implementation is too slow for video and just adds dead code paths to maintain. Only ship a JS fallback when the algorithm is genuinely sequential (error diffusion) or trivially cheap, or when the filter must run in environments where WebGL2 is unavailable. The dispatcher renders a "WebGL2 required" stub for `requiresGL` filters on unsupported hardware, so users see why it didn't run.

**WebGL shader validation is a release gate.** `npm run test:gl` launches a real
Chromium WebGL2 context, forces GPU acceleration across the complete filter
registry, and validates every path that compiles or draws. It also requires
`requiresGL` filters to issue an actual draw, initializes temporal GPU state,
and rejects transparent or opaque-black output, preventing silent passthrough
and black-frame regressions.
Run it after adding or changing GLSL; unit/jsdom tests cannot compile shaders.

### Raymarching and ray tracing

The raymarching family treats the loaded image as height, silhouette, material,
emission, or environment data. Its registered filters are Heightfield Raymarch,
Silhouette Extrusion, Voxel Landscape, Glass Surface, Relief Reflections,
Volumetric Light, SDF Melt, Fractal Portal, and Path-Traced Diorama.

The extended worlds/materials suite adds Luminance Caverns, Black Hole Lens,
Thin-Film Iridescence, Subsurface Wax, Cone-Traced AO, Chromatic Prism Tracer,
Portal Hall, Image Fossil, Volumetric Cloud Sculpture, and Raymarched Maze. The
maze uses a connected binary-tree layout and derives a guaranteed route to the
exit in shader; keep that connectivity invariant if its wall logic changes.

- Keep shader loops compile-time bounded and use uniform-controlled early exits.
- Use `src/utils/glSinglePass.ts` only for generic source-backed full-screen
  passes; filters continue to own their shader, controls, and uniforms.
- Filters that evolve procedural samples set `temporal` and `autoAnimate`.
  Path-Traced Diorama accumulates through its per-entry `_prevOutput` history.
- These filters are WebGL2-only and must pass `npm run test:gl`; the browser gate
  is the authoritative shader compile, enum-branch, and real-draw validation.

### Filter Chains

Filters compose into chains (max 16 entries). The chain is the unit of work — `FilterContext` runs each enabled entry sequentially, feeding the output of one as the input to the next, with caching of intermediate canvases. State is serialized to URL hash and localStorage so users can share or save chains.

Curated chain presets live in `src/components/ChainList/presets.ts` (`CHAIN_PRESETS`). To add a preset, append an entry referencing existing filter `displayName`s — no code change needed.

When auditing or pruning presets, run `npm run report:presets` first. The report flags exact duplicate preset signatures and surfaces high-similarity preset pairs so cleanup decisions are based on the current preset data rather than eyeballing the list.

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

Write tests when they protect behavior that could realistically regress. A good
test fails for the bug or missing capability, passes only when the intended
behavior works, and survives harmless refactors.

Write tests first for:

- **Bug fixes** — reproduce the user-visible failure before fixing it.
- **Pure functions** — color math, buffer operations, equalize, quantize, and
  deterministic state generation. Cover boundaries and meaningful branches.
- **Filter logic** — use small known buffers or signal patterns and assert the
  important output property or pixel values.
- **Reducers/state** — test action → externally observable state transitions.
- **Contracts** — verify registries resolve, serialized state round-trips, and
  backends agree where parity is promised.

Do not add a test merely to mirror edited literals or prove that a line of
configuration changed. Avoid assertions tied to private helper calls, exact
internal names, incidental ordering, or a fixed list of hand-picked records
unless that exact shape is a product contract. For data-only edits such as a
preset swapping one registered filter for another, prefer the existing
registry, signature, and end-to-end validation. Add a new test only when the
edit reveals an uncovered invariant worth protecting.

### Testing Pyramid

Keep the suite weighted toward fast, deterministic tests:

1. **Unit tests (most)** — pure utilities, reducers, option normalization,
   deterministic temporal state, and small-buffer filter math.
2. **Integration and contract tests (fewer)** — filter registration, chain
   execution, serialization, worker/main-thread parity, palette passes, and
   CPU/GL/WASM backend agreement.
3. **Browser end-to-end tests (few)** — WebGL shader compilation, real Canvas
   behavior, media playback/export, and critical user workflows that jsdom
   cannot represent.
4. **Visual and performance checks (targeted)** — reference images, signal
   metrics, and benchmarks for effects where appearance or throughput is the
   contract. Use tolerances and document the renderer/hardware.

Before adding an expensive browser test, ask whether a lower layer can protect
the same behavior. Before adding a unit test, ask whether it asserts a durable
outcome rather than restating the implementation. Use the smallest layer that
would have caught the regression.

Use Vitest for unit/integration tests and Playwright for real-browser behavior.
Tests live in `test/` mirroring `src/` structure.

Coverage follows the same pyramid. `npm run test:coverage` measures the Vitest
layer; browser suites emit source-mapped V8 coverage for WebGL, WASM, workers,
media, and React integration; `npm run coverage:merge` combines both. CI uses
`npm run test:coverage:gate`. Do not remove a difficult module from the
denominator to raise the percentage—route it through the browser layer or
extract deterministic decision logic. A “does not throw” sweep is useful smoke
coverage, but it does not replace branch, failure-recovery, or output-contract
tests.

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
- For draggable floating windows that use `position: fixed` + `transform`, compute drag offsets from the element's live `getBoundingClientRect()` at mouse-down time. Using cached position refs can cause a visible snap on the first drag after mount/remount.
- **Reuse the shared chrome tokens for option/section headers.** `controls/styles.module.css` exports `.optionGroup`, `.optionGroupLegend`, and `.subsectionHeader`. Compose them at every section header instead of redefining `font-size` / `font-weight` / `text-transform` locally — that's how header styles drift across panels. If you need different spacing or color, create a local class that *composes* the canonical token.

### Performance

- Image processing is CPU-bound. Keep filter hot loops tight — avoid allocations, use typed arrays.
- WASM for expensive color math (Lab distance). JS fallback must exist.
- Memoize expensive conversions (e.g., `wasmRgba2labaMemo`).
- `requestAnimationFrame` for video frame processing — don't block the main thread.
- **WebGL2 benchmarks in this harness use swiftshader (software renderer)** — GL numbers are slower than real GPU hardware. When benchmarking GL vs WASM, use `_webglAcceleration: false` to isolate the WASM path. The GL fast path is still correct and will outperform WASM on a real GPU; swiftshader results do not indicate a regression for end users.
- **WASM load timing**: `wasmIsLoaded()` returns false until the async WASM init resolves. Benchmarks that run immediately after page load will see JS fallback numbers for all WASM-accelerated filters. Always wait for WASM before measuring (see `bench.ts` for the pattern).

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
