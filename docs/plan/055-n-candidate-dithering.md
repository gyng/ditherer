# 055 — N-candidate ordered dithering (Yliluoma / Knoll)

## Source

Pekka Väänänen, *Revisiting Yliluoma's ordered dither algorithm*
<https://30fps.net/pages/revisiting-yliluoma-2/> (June 2026). Reference
implementation `color_selection.py` is CC0.

The article reverse-engineers Joel Yliluoma's 2011 "algorithm #2", shows it is an
exponential-moving-average (EMA) candidate search, and derives three simplified
variants. It benchmarks them against Thomas Knoll's algorithm (the Photoshop one).

## What these algorithms are

All are *N-candidate* ordered dithers: for each pixel independently, collect `N`
weighted palette candidates, then emit the one where the cumulative weight
(walked in palette luma order) first crosses a Bayer threshold. No error
diffusion — every pixel is independent, so the family is gather-parallel and fits
a fragment shader.

They differ only in how candidates are picked:

| Algorithm | Candidate rule | Weight |
|---|---|---|
| **Knoll** | closest palette color to `p + error*strength`; then `error += p - r_i` | `+1` per visit |
| **EMA-Sweep** | of all `c_k`, the one whose segment `[x_i, c_k]` passes closest to `p`; `t` found by sweeping 8 fixed fractions | `+t` |
| **EMA-Exact** | same, but `t` solved analytically | `+t` |
| **EMA-Constant** | same, but `t` fixed at 0.3 (optimal `t` is near-zero 97% of the time) | `+t` |

EMA variants maintain a running mean `x_{i+1} = (1-t)x_i + t*r_i`, seeded with
`closest(p)` at weight 1. The analytic solution for the closest point on segment
`[A,B]` to `C` is `t = clamp(dot(C-A, B-A) / dot(B-A, B-A), minT, maxT)`.

Key claim we rely on: **no perceptual color-difference formula is needed.**
Yliluoma-2's luma-weighted distance can be replaced by pre-transforming image
*and* palette (libimagequant's `(0.5, 1, 0.45)` weights at exponent `0.57/0.45455`)
and using plain Euclidean distance. This is what makes the analytic `t` legal.

## Decisions

**One filter, algo ENUM.** A single `nCandidateDither` filter with an `algo` ENUM
(`KNOLL` / `EMA_SWEEP` / `EMA_EXACT` / `EMA_CONSTANT`), mirroring the reference
CLI's `--algo`. Matches the existing `ordered.ts` one-filter-many-modes shape.
Registry exposes palette presets by `displayName`.

**GL-only in the shipped path (`requiresGL: true`).** Gather-parallel, so
AGENTS.md's GL-by-default rule applies, and plan [036](036-drop-js-fallbacks.md)
forbids an in-flight JS fallback once a GL path exists.

**The CPU reference is a test oracle, not a fallback.** It lives in
`test/fixtures/nCandidateReference.ts` — a faithful port of `color_selection.py`,
never imported by `src/`, so it stays out of the bundle. This is how we get an
exact oracle for the shader without reintroducing a dead runtime path.

### Shader constraints

- `MAX_PAL = 64` (**provisional — see below**). Palettes are truncated to the
  first 64 entries.
- `MAX_N = 64` candidate iterations (compile-time loop bound, `u_n` early-exit).
- Worst case `N*K = 4096` inner iterations per pixel; EMA-Sweep multiplies by 8.

### OPEN: where does the palette cap belong?

The EMA weight accumulator is a per-fragment `float weights[MAX_PAL]` array. The
original justification for capping it at 64 — "256 would be brutal on registers"
— was asserted, not measured. Measuring it (640×400, N=32, EMA-Exact) mostly
contradicted it:

| Palette | `MAX_PAL=64` | `MAX_PAL=256` |
|---|---|---|
| K=8 | 57 ms | 68 ms |
| K=16 | 100 ms | 83 ms |
| K=64 | 328 ms | 346 ms |
| K=256 | 343 ms *(26 colors — truncated)* | 949 ms *(163 colors — correct)* |

Raising the cap costs small palettes nothing (the inner loops early-exit on
`u_paletteCount`, so cost tracks *actual* K), it compiles, and K=256 renders
correctly with cost scaling linearly — no cliff.

**But those numbers are from SwiftShader, a CPU rasterizer, which models no
register file or occupancy at all.** The spilling that motivates a cap is exactly
what it cannot show. So the claim remains untested rather than disproven.

Two facts for whoever settles this:

- On uniforms, `MAX_PAL=256` is no worse than what already ships: it needs 512
  vec3 uniforms, identical to `ordered.ts`'s `u_paletteRgb[256]` +
  `u_paletteAux[256]`, already past the ES 3.0 guaranteed minimum of 224. The
  only *new* risk is the weights array.
- The algorithm wants `N ≈ 2K`, but `MAX_N` is 64 — so K > 32 is already outside
  the quality sweet spot regardless of the cap.

`test/e2e/nc-bench.spec.ts` (opt-in, `NC_BENCH=1`) sweeps cap × K and prints the
renderer, so the cap can be set from real-hardware evidence. `maxPal` is a
parameter of `renderNCandidateGL` for that reason; production passes nothing and
gets `MAX_PAL`.

### Benchmarking this shader — three traps, all hit in practice

> Generalized into [docs/gpu-benchmarking.md](../gpu-benchmarking.md) — read that
> first for any GL benchmark. Kept here because it's the evidence behind the
> cap decision below.

1. **The default browser never touches the GPU.** Headless Chrome lands on
   SwiftShader; `--use-angle=vulkan` lands on llvmpipe, because this WSLg box has
   no NVIDIA Vulkan ICD and no dzn driver — only Mesa's software ICDs. Both are
   CPU rasterizers that model no register file, so they cannot answer the only
   question the cap depends on. The GPU route is ANGLE-over-GL with Mesa's d3d12
   Gallium driver (`PLAYWRIGHT_ANGLE=gl PLAYWRIGHT_GPU=1`), which reports
   `ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 3080), OpenGL 4.6)`.
   **Always print `UNMASKED_RENDERER_WEBGL` and read it before trusting a
   number.** This isn't pedantry: `MAX_FRAGMENT_UNIFORM_VECTORS` reads 4096 on
   SwiftShader but **1024** on the real card — believe the software renderer and
   you'd size a uniform array 4× past what the GPU permits.

2. **Wall-clock timing measures the readback, not the shader.** `readoutToCanvas`
   drawImage's the GL canvas into a 2D canvas; forcing that to land costs far
   more than the draw it wraps. A wall-clock sweep produced numbers that
   contradicted themselves — K=64 timing *faster* than K=16 — because the signal
   was smaller than the overhead. Use `EXT_disjoint_timer_query_webgl2`
   (available on this path, no draft flag) to bracket the GL command stream.

3. **Timer queries need the pipeline drained.** Without a `gl.finish()` on both
   sides of the query window the samples come out bimodal — some at the real
   cost, others at a floor that was *identical across different configurations*,
   i.e. the query was timing a window the draw hadn't reached. Discard
   `GPU_DISJOINT_EXT` samples (the spec requires it) and **always report spread**:
   the bad cells had a 5× max/min while their medians looked perfectly
   respectable. A median with no spread beside it is not evidence.

Sanity check any result against physics before believing it: cost must rise
with K.

### Outcome so far: still unmeasured, cap stays at 64

Even with GPU timing, a drained pipeline and 9 reps, this box could not produce a
valid measurement. Two runs of the identical bench on the same RTX 3080
disagreed:

| cap=64 → 128 | K=8 | K=16 | K=64 |
|---|---|---|---|
| run 1 | 7.89 → 9.79 | 9.43 → 12.09 | — |
| run 2 | 8.77 → 11.58 | 10.60 → 26.78 | 12.99 → 9.24 |

Run 1 showed a tidy ~30% step between cap=64 and cap=128 in two independent
columns, which looks exactly like a spill threshold. It did not reproduce. Run 2
also violates physics outright — at cap=128, K=64 measures *cheaper* than K=8;
at cap=256 cost *falls* as K rises — and half the cells still spread 5×.

Conclusion: **the cap remains unjustified by evidence, and stays at 64 because
that is the conservative default, not because it was shown correct.** Do not cite
run 1's step; it was noise that happened to look like signal. Anyone retrying
this should first check what else is using the GPU (an unrelated project's
browser fleet was resident during these runs), and treat a result as real only
if it reproduces across runs *and* rises with K.

**Known bug, independent of where the cap lands:** palettes above the cap are
silently `slice()`d to the first N entries, so a 256-color palette renders with
the wrong colors and no warning (the K=256 row above used 26 distinct colors).
Either reduce properly (median-cut) or surface it.

**Palette is uploaded pre-sorted by working-space luma.** The reference keeps a
separate `luma_order` index array; sorting on the CPU instead makes the shader's
cumulative-weight walk a plain `0..K` loop and drops the array entirely. Both the
working palette (distance/luma) and the original sRGB palette (output) are
permuted together — output is always the untransformed color.

### Working color space

`colorspace` ENUM applies to distance math *and* luma ordering, matching the
reference (which computes `luma` from the already-transformed `input_pal`):

- `SRGB` — plain Euclidean sRGB (the article's default)
- `LINEAR` — sRGB→linear first; best reconstruction when squinting
- `LIQ` — libimagequant luma weighting; the "no complex color difference" path

`lumaWeighted` (BOOL, EMA-Sweep only) restores Yliluoma-2's original
luma-weighted distance for faithful reproduction. The reference restricts this to
sweep, so we gate it with `visibleWhen`.

### Palettes without explicit colors

N-candidate methods need a discrete palette. When the selected palette has no
`options.colors` (i.e. `nearest`/LEVELS mode), synthesize the `levels³` RGB cube,
clamping `levels` to 4 so it fits `MAX_PAL`.

## Parameters

| Option | Default | Notes |
|---|---|---|
| `algo` | `EMA_EXACT` | article's recommended variant |
| `candidates` (N) | 32 | article: `N ≈ 2K` is the sweet spot; N=16 is visibly noisier |
| `strength` | 0.8 | Knoll only (`visibleWhen`); reference CLI default |
| `minT` | 0.2 | sweep/exact only; article's compromise floor |
| `constantT` | 0.3 | constant only |
| `thresholdMap` | Bayer 4×4 | matrices defined locally — filters stay self-contained |
| `colorspace` | `SRGB` | |
| `palette` | user/PICO-8 | needs an explicit-color palette to be interesting |

## Test plan

1. **Unit (vitest)** — the oracle's own math: analytic `t` matches a brute-force
   sweep on random segments; `t` clamping honors `[minT, maxT]`; a palette
   containing the input color exactly returns it; single-color palette is a
   no-op; weights normalize to 1.
2. **Contract (vitest)** — filter registers, `optionTypes` drive controls,
   `visibleWhen` gating.
3. **Browser (playwright, `npm run test:gl`)** — shader compiles, every `algo`
   enum branch issues a real draw, and GL output matches the CPU oracle on a
   small fixture within tolerance. This is the only layer that can compile the
   shader, so the oracle comparison lives here.

## Non-goals

- The article's `offset` baseline dither (naive greyscale-noise offset) — the
  existing `ordered.ts` already covers that shape.
- kd-tree acceleration of Knoll's closest lookup (`O(N log K)`); with `K ≤ 64`
  the linear scan is fine on a GPU.
