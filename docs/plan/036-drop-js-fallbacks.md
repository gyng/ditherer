# 036 — Drop redundant JS fallbacks

## Rule

Each filter keeps exactly **one** implementation:

- GL path exists → delete WASM and JS paths from the filter wrapper
- WASM path exists (no GL) → delete JS path
- Neither (tagged `noGL` + `noWASM`, or a `mainThread: true` temporal filter with no fast path) → keep JS

## Current state (as of commit `4af078a`)

Audit script: `docs/plan/036-audit.sh` produces this breakdown.

| Category | Count | Action |
|---|---:|---|
| **GL-only** (no WASM code in wrapper) | 173 | delete JS body |
| **GL+WASM** (both paths in wrapper) | 27 | delete WASM + JS bodies |
| **WASM-only** (no GL code) | 0 | — |
| **JS-only** tagged `noGL` + `noWASM` | 8 | keep JS, out of scope |
| **JS-only** tagged `noGL` only | 5 | keep JS, out of scope |
| **JS-only** untagged, all `mainThread: true` temporal filters | 30 | keep JS, out of scope (separate GL-porting project) |
| **Total filters** | 243 | |

"Delete" means strip the WASM/JS dispatch blocks from the filter wrapper `.ts` — not delete any file. `*GL.ts` files stay; `utils/index.ts` WASM exports that no caller uses after this get pruned.

## Partial-GL filters (5)

These gate the GL path on an option combo and currently fall through for the rest — they need resolving before mechanical deletion of the JS body:

| Filter | GL gated on… | Options |
|---|---|---|
| `facet` | `fillMode === CENTER` | Expand shader to compute per-cell average via two-pass FBO reduction, OR remove AVERAGE from the enum |
| `halftoneLine` | palette is identity | Apply standard `applyPalettePassToCanvas` after readout (other filters already do this; this one just missed the pattern) |
| `pixelate` | palette is identity AND `!_linearize` | Route non-identity via palette pass; inline sRGB↔linear for `_linearize` |
| `triangleDither` | `!palette.options.colors` (LEVELS only) | Upload custom-colour palette as RGBA8 texture + nearest-colour search in shader, OR restrict to LEVELS in the UI |
| `crossStitch` | palette identity OR `threadColor === SOURCE` | Apply palette to thread texel only in shader (leave fabric raw) |

Every resolution either expands the GL shader or trims a UI option — no in-flight JS fallback allowed after Phase 1.

## Pre-flight decisions

### 1. GL-unavailable devices

`glAvailable()` returns `false` on: WebGL2-disabled browsers, blacklisted GPUs, context-creation OOM, inside a Safari worker where `OffscreenCanvas` + WebGL2 is unreliable. Today, `renderFooGL` returns `null` and the filter silently falls through to WASM/JS. After deletion, a GL-only filter has nothing to fall through to.

**Recommendation:** Phase 0 adds `requiresGL: boolean` to `FilterDefinition` and renders an explicit error tile ("WebGL2 required") when unavailable. The library browser greys out `requiresGL` rows on unsupported devices.

### 2. Worker compatibility

`getGLCtx()` uses `OffscreenCanvas` in workers when available. Works today — no blocker. The existing worker → main-thread fallback in `FilterContext` catches worker failures generically.

### 3. Palette pass

`applyPalettePassToCanvas` is a shared post-GL-readout primitive with its own WASM + JS paths. Out of scope. Don't touch it.

### 4. Test suite

Golden-image tests may diff against JS output. Audit `src/test/`; accept golden regeneration where GL output intentionally differs.

## Execution

### Phase 0 — GL-required plumbing (1 day)

1. Add `requiresGL?: boolean` to `FilterDefinition` in `src/filters/types.ts`.
2. Add a `glUnavailableStub(canvas)` helper in `src/utils` that renders a "WebGL2 required" message onto a canvas. Keeps the pipeline output shape-correct.
3. In the filter dispatcher (both `filterOnMainThread` in `FilterContext.tsx` and the worker entry point): if `filter.requiresGL === true && !glAvailable()`, call the stub instead of the filter function. Log once per filter per session.
4. Add a UI hint in `ChainList` / library browser: disabled row + tooltip when `requiresGL && !glAvailable()`. Surface a top-level "WebGL2 required but unavailable" banner once.
5. Leave `requiresGL` unset on every existing filter — it's opt-in and only set during Phase 2 deletion.

### Phase 1 — resolve the 5 partial-GL filters (2–3 days)

One commit per filter. Each either expands the shader or trims an option. Order by risk:
1. `halftoneLine` (trivial — apply palette pass after readout like others).
2. `pixelate` (apply palette pass + inline sRGB↔linear).
3. `crossStitch` (palette-texture sampling for thread only).
4. `triangleDither` (palette-texture + nearest-colour search, OR remove custom-colour UI).
5. `facet` (two-pass FBO for AVERAGE, OR remove AVERAGE).

### Phase 2 — mechanical JS/WASM deletion in GL-ported filters (1–2 days, scripted)

For each of the 200 filters in GL-only (173) + GL+WASM (27):

```
const foo = (input, options) => {
  const rendered = renderFooGL(input, W, H, …);
  if (!rendered) return glUnavailableStub(W, H);
  return identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
};
```

Delete:
- WASM dispatch block (for GL+WASM cases)
- JS loop body
- `_wasmAcceleration` plumbing
- Now-unused imports (`wasmFooBuffer`, `fillBufferPixel`, `getBufferIndex`, `rgba`, `paletteGetColor`, `clamp`, etc.)

Set `requiresGL: true` in each `defineFilter(...)` call.

Script the transform — the edit is mechanical per file. Land as one large PR; review as a diff-of-deletions.

### Phase 3 — skip

0 WASM-only filters; nothing to do.

### Phase 4 — delete dead Rust/WASM kernels (1 day)

For the 27 filters that had WASM (which is now deleted from the wrapper), the Rust kernel is dead code. Enumerate `utils/index.ts` WASM exports, grep callers, drop unreferenced functions. Likely candidates:

```
wasmAnimeColorGradeBuffer  wasmBokehBuffer      wasmFacetBuffer
wasmGrainMergeBuffer       wasmMedianFilterBuffer
wasmScanlineWarpBuffer     wasmTriangleDitherBuffer
wasmVintageTvBuffer
```

Check each against `src/wasm/rgba2laba/src/lib.rs`. Delete the Rust function, the JS wrapper, the `utils/index.ts` export. Rebuild the `.wasm`; compare size.

### Phase 5 — delete unused JS helpers (≤ ½ day)

`src/utils/index.ts` helpers likely only used by now-deleted JS paths:

- `getBufferIndex`, `fillBufferPixel`, `rgba`
- `srgbPaletteGetColor`, `linearPaletteGetColor`, `paletteGetColor` (check — palette pass may still use them)
- `clamp`

Grep each, delete the ones with zero callers.

### Phase 6 — test + bench (1 day)

- Full test suite; regenerate golden images where GL output differs.
- Diff bundle size (JS + `.wasm`).
- First-paint on a representative chain (GL + palette pass).
- Stress chain (20+ GL filters) in worker + main thread.

## Risk register

| Risk | Mitigation |
|---|---|
| GL-unavailable users get silently broken filters | Phase 0 error tile + `requiresGL` UI badge + banner |
| Partial-GL shader rewrites change output visibly | Land each Phase 1 commit with before/after screenshots on a canonical image |
| Dead Rust code hard to detect | Manually enumerate `wasm*` exports, cross-reference callers post-Phase 2 |
| Test suite hardcoded to JS output | Accept golden regeneration as part of this migration |
| Worker GL fails on Safari edge cases | Keep existing worker → main-thread fallback in `FilterContext` untouched |
| Someone deletes a `_wasmAcceleration` option that a URL-serialized preset relied on | Grep presets/URLs for `_wasmAcceleration`; these are internal escape hatches, safe to drop |

## Scope estimate

- ~200 filter `.ts` wrappers lose half their body (≈ 3–5k LOC JS deleted)
- ≈ 8 Rust functions + helpers removed (few hundred LOC, meaningful `.wasm` size win)
- ≈ 5–8 helpers in `src/utils/index.ts` pruned
- Zero `*GL.ts` files touched
- Zero `mainThread: true` temporal filters touched (out of scope — separate effort to port those to GL)

## Out of scope but worth noting

30 temporal filters (`aba*`, `after-image`, `cellular-automata`, `crt-degauss`, `video-feedback`, etc.) are all `mainThread: true` and have only a JS implementation. They carry state across frames (`_prevOutput`, `_prevInput`, `_ema`) and often use `dispatch`. GL-porting them is feasible but requires routing previous-frame state into shader as a texture plus threading dispatch differently — a separate, larger project. This plan doesn't touch them.

## Sequencing

1. Phase 0 (unblocks everything, low risk, mergeable immediately).
2. Phase 1 commits for the 5 partial-GL filters, one at a time with visual-diff review.
3. Phase 2 mechanical deletion as one PR.
4. Phases 4–6 as independent PRs after Phase 2 lands.
