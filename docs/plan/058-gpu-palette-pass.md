# 058 — Can the palette pass run on the GPU?

The whole-buffer WASM quantizers ([057](057-linearize-is-live.md) era work) took the
palette pass from 1411ms to 88ms at 1080p. That is still CPU-shaped work, and 88ms
alone caps 1080p video at ~11fps. 91 GL filters render on the GPU, read back to a 2D
canvas, and then quantize on the CPU, so the obvious next move is to quantize in a
shader instead.

`orderedGL` has done exactly that since it landed — 256 colours, all five modes — and
`PALETTE_NEAREST_GLSL` in `palettes/backend.ts` was written to be inlined by these
very filters. Nothing inlines it.

## What was tried

Lift orderedGL's palette-match block into a shared `gl/palettePass.ts` and call it
from `applyPalettePassToCanvas` — the one function all 91 filters already funnel
through. That reaches every filter with zero call-site edits.

## Result: reverted. The shader is correct and it still loses.

Real GPU (`ANGLE / D3D12 / NVIDIA RTX 3080`, `MAX_FRAGMENT_UNIFORM_VECTORS` 1024),
1920×1080, 16-colour CGA, median of 3, WASM **on** for the CPU side:

| algo | CPU (wasm) | GPU | speedup | px differing | maxΔ |
|---|---:|---:|---:|---:|---:|
| RGB | 137.3 ms | 168.2 ms | **0.8×** | 0.00% | 0 |
| RGB_APPROX | 212.4 ms | 181.5 ms | 1.2× | 0.00% | 0 |
| HSV | 227.4 ms | 198.9 ms | 1.1× | 0.06% | 170 |
| LAB | 638.1 ms | 160.7 ms | **4.0×** | 0.00% | 0 |
| LEVELS(8) | 62.7 ms | 210.6 ms | **0.3×** | 0.00% | 0 |

**GPU time is ~160–210ms regardless of algorithm.** RGB and LAB cost the same
although LAB does far more work per fragment. The shader is not the cost; the
round-trip is. Called from `applyPalettePassToCanvas` the pass sits *after* the
readback, so it doesn't remove a GPU→CPU copy — it adds one, then adds a second
CPU→CPU copy to honour the in-place contract callers depend on. That fixed tax
swamps the win everywhere except LAB, which was merely slow enough to hide behind it.

LEVELS regresses 3×, which was predictable: `nearest` already resolves to a WASM
channel LUT, and a LUT is close to free. GL has to beat it *and* pay the transfers.

The convenience — no call-site edits — is exactly what makes it lose. Sitting at the
chokepoint means sitting on the wrong side of the readback.

## Two things worth keeping from the attempt

**The shader is right.** With an opaque fixture it agrees with the CPU path exactly on
four of five modes; HSV flips 0.06% of pixels, which is genuine f32-vs-f64 tie-breaking
on near-equidistant colours. The pre-emptive worry that GL parity would be too loose to
test was wrong — it's tight enough to assert on.

**Alpha is a real hazard, not a fixture artifact.** The first run reported 98.44% of
pixels differing with maxΔ 170. The cause was a fixture randomising alpha: canvases
store premultiplied alpha, so any canvas with alpha < 255 has its RGB mangled through
a texture round-trip, while the CPU path's `getImageData` is exact. This is not
fixable through a canvas round-trip — un-premultiplying is lossy, and reading exact
bytes means `getImageData`, which is the cost being avoided. Any future GPU palette
work must either prove its inputs are opaque or accept corruption on translucent ones.

(Suspect the measurement first: 98.44% was the fixture, and the same instinct that
caught the five false positives in 057 applies here.)

## The path that would actually work

Move the palette match *before* the readout, not after: filters keep their pixels on
the GPU, apply the palette as a second pass (or inline `PALETTE_NEAREST_GLSL` into
their existing shader), and read out once. Then the palette costs a shader and nothing
else — the transfers were already being paid.

That means changing `renderXGL` to take a palette and defer readout, across 91
filters. Mechanical but broad. Unproven that it's worth it: the prize is bounded by
what quantization costs *once transfers are free*, which this bench never isolated —
every GPU number here is dominated by transfers.

Also unresolved: `applyPalettePassToCanvas` has no `webglAcceleration` parameter, so
any GPU palette work must thread the `_webglAcceleration` escape hatch through those
91 call sites, or turning GL off for a filter would still quantize on the GPU.

## Not worth chasing

LAB alone is a genuine 4× (638ms → 161ms) and could be enabled selectively. Rejected
for now: it buys one algorithm the alpha hazard and a backend split, and LAB's CPU
cost is already the target of cheaper work (a Lab palette LUT, or OKLab, which is
substantially less maths per pixel).

### Addendum — "substantially less maths" was 1.27×

That last clause was doing real work in this rejection and was never measured. The
whole-buffer bench now covers every algorithm (`test/perf/colorDistanceBench.bench.ts`;
it only had RGB when this was written, which is why the claim went unchecked).
76,800 pixels, 16-colour CGA, one WASM call:

| algo | mean | vs LAB |
|---|---:|---:|
| RGB | 2.14 ms | 6.4× |
| HSV | 3.69 ms | 3.7× |
| RGB_APPROX | 3.86 ms | 3.5× |
| **OKLAB** | **10.68 ms** | **1.27×** |
| LAB | 13.60 ms | — |

So OKLab is cheaper than Lab, but by 27% — not enough to stand in for a 4× GPU win.
The reasoning above assumed OKLab made the GPU path redundant for LAB; it doesn't.
If a selective GPU LAB is ever revisited, this rejection should be re-argued on the
alpha hazard and the backend split alone, which are the parts that still hold.

Also unchecked at the time, and worse: the `LAB_NEAREST (WASM precomputed Lab)`
figure that suggested the precomputed path was slower than plain JS. That bench was
calling `nearest_lab_precomputed` with the wrong arity, so wasm-bindgen marshalled a
number as the palette slice and the Rust looped zero times. Corrected, it is **4.5×
faster than the JS scan** (2,324,240 hz vs 522,078 hz), so `user.ts`'s gating of Lab
onto it is an optimization rather than the pessimization the old number implied.
