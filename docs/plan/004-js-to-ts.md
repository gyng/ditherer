# Plan 004: JS to TypeScript Conversion

## Current State

The project is post plan-001 modernization (phases 1-3 complete). The project now uses:

- **React 19** with Context + `useReducer` (no Redux)
- **Vite 8** as build tool, **Vitest 4** for testing
- **TypeScript 6** installed, `tsconfig.json` configured (`strict: false`, `noEmit: true`, `jsx: react-jsx`)
- **ESLint 9** with typescript-eslint (flat config, already handles `.js/.jsx/.ts/.tsx`)

There are **zero `.ts/.tsx` source files** -- the codebase is entirely `.js/.jsx` plus one WASM-generated `.d.ts`. No Flow annotations, no PropTypes, no `require()` calls. All source files use ESM.

### File Inventory (42 source + 4 test files)

| Category | Count | Files |
|----------|-------|-------|
| Constants | 3 | `color.js`, `controlTypes.js`, `optionTypes.js` |
| Utils | 1 | `utils/index.js` |
| Palettes | 3 | `palettes/index.js`, `nearest.js`, `user.js` |
| Filters | 18 | `index.js`, `errorDiffusingFilterFactory.js`, `errorDiffusing.js`, `binarize.js`, `brightnessContrast.js`, `channelSeparation.js`, `convolve.js`, `glitchblob.js`, `grayscale.js`, `halftone.js`, `invert.js`, `jitter.js`, `ordered.js`, `pixelate.js`, `pixelsort.js`, `program.js`, `quantize.js`, `random.js`, `scanline.js`, `rgbstripe.js`, `vhs.js` |
| Reducer | 1 | `reducers/filters.js` |
| Context | 1 | `context/FilterContext.jsx` |
| Components | 10 | `App/index.jsx`, `App/Exporter.jsx`, `controls/index.jsx`, `controls/Bool.jsx`, `controls/Enum.jsx`, `controls/Range.jsx`, `controls/Stringly.jsx`, `controls/Textly.jsx`, `controls/Palette.jsx`, `controls/ColorArray.jsx` |
| Entry | 1 | `index.jsx` |
| Tests | 4 | `test/utils/utils.test.js`, `test/actions/actions.test.js`, `test/reducers/filters.test.js`, `test/smoke/filters.test.js` |

---

## Strategy: Incremental, Bottom-Up, `strict: false`

Since `tsconfig.json` has `strict: false`, files can be renamed to `.ts/.tsx` and will compile without requiring full type annotations. The approach:

1. **Rename in dependency order** -- leaf modules first, consumers after
2. **Create shared type definitions** before renaming any files
3. **Add real types progressively** -- annotate function signatures as files are renamed
4. **Avoid `any` where possible** -- use proper types, mark deferred typing with `// TODO: type`
5. **Test after each phase** -- run `npx tsc --noEmit` and `npm test`

---

## Phase 1: Foundation -- Type Definitions

Create `src/types/index.ts` with shared types extracted from observed patterns:

- `ColorRGBA`, `ColorHSVA`, `ColorLABA` -- tuple types `[number, number, number, number]`
- `ControlType` -- string union
- `OptionType` -- discriminated union of `RangeOptionType`, `BoolOptionType`, `EnumOptionType`, etc.
- `Palette` -- interface with `name`, `getColor`, `options`, `optionTypes`, `defaults`
- `Filter` -- interface with `name`, `func`, `optionTypes`, `options`, `defaults`
- `FilterFunc` -- `(input: HTMLCanvasElement, options?: Record<string, unknown>, dispatch?: (action: FilterAction) => void) => HTMLCanvasElement | string | void`
- `FilterAction` -- discriminated union of all reducer action types
- `FilterState` -- full reducer state shape

Create `src/types/css.d.ts` for CSS module imports:
```typescript
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
```

---

## Phase 2: Constants (Trivial)

Rename 3 files. These export only string constants and plain objects.

**Order:** `color.ts` -> `optionTypes.ts` -> `controlTypes.ts`

| File | Notes |
|------|-------|
| `constants/color.js` -> `.ts` | 6 string constants. Add `as const`. |
| `constants/optionTypes.js` -> `.ts` | 2 exports + 1 object. Imports from `color`. |
| `constants/controlTypes.js` -> `.ts` | 7 constants + 2 config objects. Type with `EnumOptionType`. |

---

## Phase 3: Utils (Moderate)

Convert `src/utils/index.js` -> `src/utils/index.ts` (~610 lines).

Contains color math, buffer operations, canvas helpers, palette generation, WASM wrappers, math utilities, serialization, and memoization. This is the most-imported module.

**Key challenge:** Functions use `.map()` on `ColorRGBA` tuples, returning `number[]` not the tuple. Solutions:
- `as ColorRGBA` assertions on `.map()` results
- Or a typed `mapColor` helper

---

## Phase 4: Palettes (Low)

**Order:** `nearest.ts` -> `user.ts` -> `index.ts`

| File | Notes |
|------|-------|
| `palettes/nearest.js` -> `.ts` | Small file. Type with `Palette` interface. |
| `palettes/user.js` -> `.ts` | `THEMES` is mutated at runtime (localStorage). Type as `Record<string, ColorRGBA[]>`. |
| `palettes/index.js` -> `.ts` | Barrel file. |

---

## Phase 5: Filters (Low to High -- 18 files)

All filters follow the same pattern: import control types/utils, export `optionTypes`, `defaults`, filter function, and default object. This uniformity makes batch conversion straightforward.

### 5a: Filter foundation
- `errorDiffusingFilterFactory.js` -> `.ts` (Moderate -- factory function, type error matrix param)
- `errorDiffusing.js` -> `.ts` (Low -- uses factory for 11 named filters)

### 5b: Simple filters
- `grayscale.js`, `invert.js`, `quantize.js` (Trivial/Low)

### 5c: Standard filters
- `binarize.js`, `scanline.js`, `jitter.js`, `channelSeparation.js`, `brightnessContrast.js`, `pixelate.js`, `random.js`, `halftone.js` (Low)

### 5d: Complex filters
- `convolve.js` (Moderate -- large kernel map)
- `ordered.js` (Moderate -- large threshold map)
- `pixelsort.js` (High -- ~548 lines, iterators, enums, sort maps)
- `rgbstripe.js` (Moderate -- function-valued masks)
- `vhs.js` (Low -- composes other filters)
- `program.js` (Moderate -- uses `eval()`)
- `glitchblob.js` (High -- async, pako, binary PNG parsing)

### 5e: Barrel
- `filters/index.js` -> `.ts` (last, imports all filters)

---

## Phase 6: Reducer (Moderate)

Convert `src/reducers/filters.js` -> `.ts`. Type with `FilterAction` discriminated union and `FilterState`. May need `{}` wrapping on switch cases.

---

## Phase 7: Context (Moderate)

Convert `src/context/FilterContext.jsx` -> `.tsx`. Type the context value, define `FilterActions` interface. `createContext` needs type assertion for default value.

---

## Phase 8: Components (Low to Moderate)

### 8a: Atom controls
`Bool.jsx`, `Enum.jsx`, `Range.jsx`, `Stringly.jsx`, `Textly.jsx` -> `.tsx` (Trivial -- define `Props` interface for each)

### 8b: Molecule controls
- `Palette.jsx` -> `.tsx` (Low)
- `ColorArray.jsx` -> `.tsx` (Moderate -- **only remaining class component**, recommend converting to function component with `useState`)

### 8c: Compound components
- `controls/index.jsx` -> `.tsx` (Low-Moderate -- switch-on-type dispatcher)
- `App/Exporter.jsx` -> `.tsx` (Trivial)
- `App/index.jsx` -> `.tsx` (Moderate -- ~355 lines, many refs/effects, `MediaRecorder`/`captureStream` need type assertions)

### 8d: Entry point
- `src/index.jsx` -> `src/index.tsx` (Trivial -- update `index.html` `<script>` tag)

---

## Phase 9: Tests (Low)

Rename 4 test files from `.test.js` to `.test.ts`. Add parameter types to test helpers.

---

## Phase 10: Strictness Progression (Future)

After all files are `.ts/.tsx`:

1. Enable strict flags incrementally: `strictNullChecks` -> `noImplicitAny` -> `strictFunctionTypes` -> full `strict: true`
2. Remove `@typescript-eslint/no-explicit-any: "off"` from ESLint config
3. Add `@typescript-eslint/strict-type-checked`

---

## Files NOT to Convert

| File | Reason |
|------|--------|
| `eslint.config.js` | ESLint 9 expects `.js` for flat config |
| `vite.config.js` | Works as-is, no benefit from `.ts` |
| `src/wasm/rgba2laba/wasm/rgba2laba.js` | Auto-generated by wasm-bindgen, has `.d.ts` companion |

---

## Key Challenges

1. **ColorRGBA tuple vs `number[]`** -- `.map()` returns `number[]`, need `as ColorRGBA` or typed helper
2. **CSS Module imports** -- handled by `src/types/css.d.ts`
3. **Mutable THEMES object** -- type as `Record<string, ColorRGBA[]>` not frozen const
4. **eval() in program.js** -- variables used inside eval'd string must remain as `let` in scope
5. **Async filter dispatch** -- `glitchblob.js` calls dispatch asynchronously, `FilterFunc` must allow optional dispatch param
6. **No additional `@types` packages needed** -- React 19, pako 2.x, react-draggable 4.x all ship own types

---

## Execution Summary

| Phase | Files | Complexity | Est. Time |
|-------|-------|------------|-----------|
| 1. Type definitions | 2 new | Foundation | 30 min |
| 2. Constants | 3 renames | Trivial | 15 min |
| 3. Utils | 1 rename + annotate | Moderate | 45 min |
| 4. Palettes | 3 renames | Low | 20 min |
| 5. Filters | 18 renames | Low-High | 2-3 hrs |
| 6. Reducer | 1 rename | Moderate | 30 min |
| 7. Context | 1 rename | Moderate | 30 min |
| 8. Components | 10 renames | Low-Moderate | 1.5 hrs |
| 9. Tests | 4 renames | Low | 20 min |
| 10. Strictness | Config only | Incremental | Future |
| **Total** | **43 renames + 2 new** | | **~7-8 hrs** |

**Verify after each phase:** `npx tsc --noEmit && npm test`

**Final cleanup:** Update `index.html` script tag, remove `.js`-specific ESLint overrides, update `CLAUDE.md` and `AGENTS.md`.
