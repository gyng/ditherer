# Ditherer — Agent Guidelines

## Project Overview

Ditherer is a browser-based image/video processing tool. Users load an image, select a dithering algorithm (or other effect), adjust parameters via a control panel, and apply the filter. The app also supports video frame processing, palette extraction, and state export/import via URL.

**Stack:** React, Vite, TypeScript, Rust/WASM (color space conversions)

> **Note:** The project is undergoing modernization. See [Modernization Interactions](#modernization-interactions) below for how to handle code that is mid-migration.

---

## Architecture

### Component Hierarchy (Atomic Design)

The UI follows an implicit atomic design pattern:

**Tokens** — Design primitives defined in CSS custom properties:
- Colors: `--light-gray`, `--gray`, `--beautiful-blue`, `--bg-color`
- Layout values are inline (no token system yet)

**Atoms** — Leaf control components in `src/components/controls/`. Each renders a single HTML control:
- `Range.jsx` — `<input type="range">` with editable value display
- `Bool.jsx` — `<input type="checkbox">`
- `Enum.jsx` — `<select>` dropdown
- `Stringly.jsx` — `<input type="text">`
- `Textly.jsx` — `<textarea>`

**Molecules** — Composed controls:
- `Palette.jsx` — palette selector + nested atom controls for palette options
- `ColorArray.jsx` — color swatch grid + palette extraction UI (stateful)

**Organisms** — Sections of the app:
- `Controls` (`src/components/controls/index.jsx`) — dispatches to the right atom/molecule based on `optionTypes.type`
- `Exporter` (`src/components/App/Exporter.jsx`) — state export/import panel

**Page** — Single page app:
- `App` (`src/components/App/index.jsx`) — top-level layout: sidebar controls + draggable canvas area

### State Management

App state is managed via React Context + `useReducer` (single reducer, ~13 properties). Components consume state via `useContext`. No external state library.

Key state shape:
- `selected` — current filter + its options
- `inputImage` / `outputImage` — source and processed canvases
- `video` — video element for realtime filtering
- Scale, grayscale, playback settings

### Filter System

Filters are the core domain. Each filter is a self-contained module in `src/filters/` exporting:

```typescript
// Every filter exports this shape
export const optionTypes = {
  paramName: { type: RANGE, range: [0, 255], step: 1, default: 128 }
}

export const defaults = {
  paramName: optionTypes.paramName.default
}

const filterFunc = (input: HTMLCanvasElement, options = defaults) => HTMLCanvasElement

export default { name: "FilterName", func: filterFunc, options: defaults, optionTypes, defaults }
```

The `optionTypes` declaration drives the UI — the Controls component reads it and renders the appropriate atom/molecule for each option. This is a **data-driven UI** pattern: filters declare what controls they need, the framework renders them.

**Control type → component mapping:**

| `optionTypes.type` | Component |
|--------------------|-----------|
| `RANGE` | `Range` |
| `BOOL` | `Bool` |
| `ENUM` | `Enum` |
| `STRING` | `Stringly` |
| `TEXT` | `Textly` |
| `PALETTE` | `Palette` |
| `COLOR_ARRAY` | `ColorArray` |

**Adding a new filter:** Create a new file in `src/filters/`, define `optionTypes`, `defaults`, and the filter function, then register it in `src/filters/index.js`. The UI controls are generated automatically from `optionTypes`.

### WASM Module

`src/wasm/rgba2laba/` contains a Rust crate compiled to WASM for performance-critical color space conversions (RGB to CIE Lab). Loaded via dynamic import with JS fallback if WASM fails to load.

### Directory Structure

```
src/
  components/
    App/              # App organism + Exporter molecule
    controls/         # Atom and molecule UI controls
  filters/            # Filter modules (20+) — the core domain
    wasm/             # Rust/WASM color conversion module
  palettes/           # Color palette definitions and registry
  actions/            # Action creators (async media loading, filter application)
  reducers/           # App state reducer
  constants/          # Enums: control types, color algorithms, action types
  types/              # Type definitions
  utils/              # Color math, buffer ops, canvas helpers, palette generation
  styles/             # Global styles
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

## Modernization Interactions

The project is being modernized per [docs/plan-001-modernization.md](docs/plan-001-modernization.md). This affects how you work on the codebase:

### Current Migration State

Check which phase is complete before writing code. The codebase may be in a transitional state where some conventions apply and others don't yet.

### Phase-Aware Coding Rules

**If Phase 2 (Vite) is not yet complete:**
- Build uses Webpack. Don't add Vite-specific features (e.g., `import.meta.env`).
- CSS files are `.scss` with SCSS variables (`$var`). Don't use CSS custom properties (`--var`).
- Imports may rely on webpack's module resolution. Use the same patterns as existing code.

**If Phase 3 (React modernization) is not yet complete:**
- Redux is still in use. Don't introduce Context/useReducer patterns yet.
- Class components still exist. Don't mix hooks into class components.
- Containers (`src/containers/`) still connect components to Redux.

**If Phase 4 (TypeScript) is not yet complete:**
- Files are `.js/.jsx` with Flow annotations. Don't add TypeScript syntax.
- Use Flow types if adding new typed code. Or use plain JS if the Flow type would be `any`.

### Writing New Code During Migration

- **New filters:** Always follow the existing filter pattern (see [Filter System](#filter-system) above). This pattern survives all migration phases unchanged.
- **New components:** Write as function components with hooks, even if Phase 3 isn't complete. They'll be compatible with both Redux `connect()` and future Context patterns.
- **Bug fixes:** Fix in the current code style. Don't modernize surrounding code as part of a bug fix — that's the modernization plan's job.
- **Tests:** Write in Vitest style if Phase 5 is complete. Otherwise write in Mocha/Chai style to match existing tests, and they'll be migrated later.

### What Not to Do

- Don't partially migrate a phase. Each phase should be completed atomically.
- Don't add new dependencies that are slated for removal (e.g., don't add new Redux actions if Phase 3 is upcoming).
- Don't refactor CSS beyond what the plan specifies — a separate CSS plan is forthcoming.
