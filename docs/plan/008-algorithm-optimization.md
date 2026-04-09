# Plan 008 — Algorithm Optimization

**Goal:** Reduce per-filter latency for the three most expensive filters so typical chains run closer to 30 fps at 640×480. Pipeline overhead is already minimal (~1.3ms getImageData, ~0ms after PNG removal); remaining cost is algorithmic.

**Baseline** (Chrome, 640×480, real-browser bench 2026-04-10):

| Filter | sRGB | Linear | Bottleneck |
|---|---|---|---|
| Floyd-Steinberg | 52ms | 72ms | per-pixel allocations + error kernel |
| Convolve Gaussian 3×3 | 34ms | 58ms | 2D kernel O(pixels × K²) |
| Ordered Bayer | 29ms | — | already optimized |
| 3-filter chain | 94ms | — | sum of individual filters |

---

## Bottleneck Analysis

### Floyd-Steinberg with `nearest` palette (the default)

The benchmark uses the `nearest` palette, whose `getColor` is O(1) arithmetic — **not** O(paletteSize). The bottleneck is not palette lookup but:

1. **`nearest.getColor` allocates per pixel** (`palettes/nearest.ts:22`): `color.map(c => ...)` creates a new 4-element array per pixel (307k allocations at 640×480).

2. **Linear path: `linearPaletteGetColor` allocates 2 arrays per pixel** (`utils/index.ts:117-121`): calls `delinearizeColorF` (returns new array) then `linearizeColorF` (returns another new array) — 614k allocations per frame on top of the palette allocation.

3. **Error diffusion kernel loop** (`errorDiffusingFilterFactory.ts:72-84`): iterates kernel cells per pixel with bounds checks. Floyd-Steinberg kernel is small (4 cells), so this is cheap per pixel but adds up.

### Floyd-Steinberg with user palette (16+ colors)

For user palettes, `getColor` does O(paletteSize) `colorDistance()` calls per pixel. WASM `wasmNearestLabPrecomputed` exists for Lab distance but is only used when `_wasmAcceleration` is enabled and algorithm is `LAB_NEAREST`. RGB/HSV/RGB_APPROX paths are pure JS.

### Convolve

1. **No separable kernel support.** Gaussian 3×3 does 9 multiply-adds per pixel. As a separable kernel it could be done in 6 (1.5x). Gaussian 5×5: 25 → 10 (2.5x).

2. **Per-sample boundary clamping** (`convolve.ts:210,236`): 2× `Math.max` per kernel element per pixel. For 3×3 at 640×480: 5.5M `Math.max` calls per frame.

---

## Phase 1 — Eliminate Per-Pixel Allocations in Palette Matching

**Files:** `src/palettes/nearest.ts:22`, `src/utils/index.ts:46-59,117-121`

**Problem:** Three allocation sites in the hot loop:
- `nearest.getColor` uses `color.map()` → new array per pixel
- `delinearizeColorF` returns `[..., ..., ..., ...]` → new array per pixel
- `linearizeColorF` returns `[..., ..., ..., ...]` → new array per pixel

**Fix:**

1. **`nearest.getColor`**: Replace `color.map()` with a reusable scratch buffer:
   ```ts
   const _out = [0, 0, 0, 0];
   const getColor = (color, options) => {
     const step = 255 / (options.levels - 1);
     _out[0] = Math.round(Math.round(color[0] / step) * step);
     _out[1] = Math.round(Math.round(color[1] / step) * step);
     _out[2] = Math.round(Math.round(color[2] / step) * step);
     _out[3] = color[3];
     return _out;
   };
   ```

2. **`linearPaletteGetColor`**: Use scratch buffers for `delinearizeColorF` and `linearizeColorF`, or inline the conversion to avoid intermediate arrays.

**Expected gain:** Floyd-Steinberg sRGB: 52ms → ~40ms. Linear: 72ms → ~55ms. Exact gain depends on how much GC pressure the allocations were causing vs raw compute.

**Risk:** Low. Same scratch buffer pattern already used successfully in ordered dither and error diffusion hot loops. All call sites consume the return value immediately (verified).

---

## Phase 2 — Separable Convolution Kernels

**File:** `src/filters/convolve.ts:202-249`

**Problem:** All kernels are applied as full 2D convolutions. Gaussian kernels are mathematically separable into two 1D passes (horizontal + vertical), reducing per-pixel work from K² to 2K multiply-adds.

**Fix:**

1. Add `separable?: [number[], number[]]` to kernel definitions for separable kernels.
2. When `kernel.separable` exists, run horizontal pass into a temp buffer, then vertical pass into the output buffer.
3. Non-separable kernels keep the existing 2D path.

**Separable kernels:**
- Gaussian 3×3: `[1,2,1]` × `[1,2,1]` — 9 → 6 ops/pixel (1.5x)
- Gaussian 5×5: `[1,4,6,4,1]` × `[1,4,6,4,1]` — 25 → 10 ops/pixel (2.5x)

**Non-separable kernels (unchanged):** Laplacian, Sobel, Emboss, Outline, Sharpen.

The horizontal pass writes into a freshly allocated temp buffer (same size as input). Allocate per call — the ~0.1ms cost is negligible, and avoiding shared mutable state keeps the code correct and simple.

**Expected gain:** Convolve Gaussian 3×3: 34ms → ~23ms. Gaussian 5×5: proportionally larger.

**Risk:** Low. Purely additive code path; non-separable kernels unaffected.

---

## Phase 3 — Convolve Boundary Elimination

**File:** `src/filters/convolve.ts:210,236`

**Problem:** Every kernel sample does boundary clamping via `Math.max`:
```ts
const ki = (Math.max(0, x + kx - half) + W * Math.max(0, y + ky - half)) * 4;
```
2× `Math.max` per kernel element per pixel. For a 3×3 kernel at 640×480: 5.5M calls.

**Fix:** Split the pixel loop into interior and border regions:
- **Interior** (`half <= x < W-half`, `half <= y < H-half`): no bounds check needed, direct index math. This is ~99% of pixels for 3×3, ~95% for 5×5.
- **Border**: keep the existing clamped version.

This optimization applies to both the 2D path and the separable path (Phase 2). For the separable path, the 1D horizontal and vertical passes each have their own border region.

**Expected gain:** ~10-15% reduction on top of Phase 2 gains. Convolve 3×3: ~23ms → ~20ms.

**Risk:** Low. Well-known optimization. Slightly more code but logic is straightforward.

---

## Phase 4 — WASM Per-Pixel Palette Matching for User Palettes

**File:** `src/palettes/user.ts:1800-1835`, `src/utils/index.ts:422-508`

**Problem:** For user palettes with N colors, `getColor` does O(N) JS `colorDistance()` calls per pixel. WASM `wasmNearestLabPrecomputed` exists but only covers `LAB_NEAREST`. The `RGB_NEAREST`, `RGB_APPROX`, and `HSV_NEAREST` algorithms are pure JS.

**Current WASM coverage:**
- `wasmQuantizeBuffer` (batch, all algorithms) — used in quantize + ordered dither
- `wasmNearestLabPrecomputed` (per-pixel, Lab only) — used in user palette getColor
- **Missing:** per-pixel WASM for RGB/RGB_APPROX/HSV in error diffusion

**Fix:** Add `wasmNearestRgbPrecomputed` and `wasmNearestRgbApproxPrecomputed` to match the existing `wasmNearestLabPrecomputed` pattern. The Rust crate (`wasm/rgba2laba/`) already has the distance math for all algorithms — just needs new exported functions for per-pixel nearest matching.

**Expected gain:** Depends on palette size. With 16-color palette: Floyd-Steinberg sRGB could drop from ~80ms (user palette) to ~50ms. With the `nearest` palette this phase has zero impact (it's O(1) already).

Use per-pixel WASM matching (not post-pass buffer quantize) — post-pass would re-quantize after error diffusion, changing the algorithm's output. Error diffusion's correctness depends on the matched color being exactly what error is computed against.

**Risk:** Medium. Requires Rust changes + WASM rebuild. The per-pixel JS→WASM boundary crossing adds overhead — benefit only materializes with large enough palettes (≥8 colors). Add a user palette benchmark to `bench.html` before starting this work to quantify the opportunity.

---

## Success Criteria

| Filter | Current | Target | Phase |
|---|---|---|---|
| Floyd-Steinberg sRGB (nearest) | 52ms | ~40ms | 1 |
| Floyd-Steinberg linear (nearest) | 72ms | ~55ms | 1 |
| Convolve Gaussian 3×3 sRGB | 34ms | ~20ms | 2 + 3 |
| Convolve Gaussian 5×5 sRGB | (unmeasured) | 2.5x faster | 2 |
| Floyd-Steinberg sRGB (user palette, 16 colors) | (unmeasured) | ~50ms | 4 |
| 3-filter chain (nearest) | 94ms | ~70ms | all |

Measure with `bench.html` (real browser) before and after each phase.

---

## Implementation Order

| Phase | Risk | Effort | Gain | Prerequisite |
|---|---|---|---|---|
| **1 — Palette allocation** | Low | ~20 lines | Medium | None |
| **2 — Separable kernels** | Low | ~60 lines | High | None |
| **3 — Boundary elimination** | Low | ~40 lines | Low-Medium | Best after 2 |
| **4 — WASM palette (user)** | Medium | ~80 lines JS + Rust | High (user palettes only) | None, but lowest priority for default bench |

Phases 1 and 2 are independent and can be done in either order. Phase 1 is the quickest win. Phase 4 only matters for user palettes — measure with a user palette benchmark before committing to the Rust work.

---

## Resolved Decisions

1. **Scratch buffer for `getColor`** — Use a module-level scratch buffer (not caller-provided). All call sites consume the return value immediately — no filter stores `getColor` results across iterations (verified: `errorDiffusingFilterFactory.ts:88-90`, `ordered.ts:366-368`, `binarize.ts:63-68`, `random.ts:61-88`). Scratch is simpler, and single-threaded execution means no re-entrancy risk. This matches the pattern already used in ordered dither (`_orderedOut`) and error diffusion (`_pix`).

2. **Temp buffer in separable convolution** — Allocate per call. The ~0.1ms allocation cost is negligible vs the filter's ~23ms runtime. A module-level pool saves nothing measurable and adds shared mutable state — not worth the correctness risk.

3. **Only Gaussian kernels marked separable** — Gaussian 3×3 and 5×5 only. Sharpen is decomposable (identity + scaled Laplacian) but not trivially separable as a single kernel — the decomposition adds code complexity for a kernel that's already fast at 3×3. Other kernels (Laplacian, Sobel, Emboss, Outline) are genuinely non-separable. Keep them on the existing 2D path.

4. **Per-pixel WASM for error diffusion** — Use per-pixel WASM matching (mirrors `wasmNearestLabPrecomputed`), not a post-pass buffer quantize. Post-pass would re-quantize pixels after error diffusion, changing the algorithm's output — error diffusion's correctness depends on the matched color being exactly what error is computed against. Per-pixel preserves this invariant.

5. **Add user palette benchmarks before Phase 4** — Add a `bench.html` suite with a 16-color CGA palette to quantify the Phase 4 opportunity before committing to Rust work. If the JS path with scratch buffers (Phase 1) is already fast enough for 16 colors, skip Phase 4.

6. **Add convolve linear to benchmarks** — Add linear-path convolve to `bench.html` to track the sRGB-to-linear overhead separately. Separable kernels (Phase 2) will improve both paths proportionally.
