# 059 — JS and WASM disagree about Lab, and the LUT is why

`c5c1a1e` fixed both Lab conversions reading fractional channels as black. That
repaired the catastrophic case and exposed a smaller one underneath: with the JS
fallback now producing sensible output, it can be compared against the Rust kernel
for the first time — and on error diffusion the two disagree on **38–54% of pixels**.

This records what was measured and the decision it needs. Nothing here is a bug in
the sense of wrong output; both backends produce a valid dither. They produce
*different* valid dithers, and `wasmAcceleration` is a user-facing toggle.

## What diverges

Stucki, 256×256 gradient, custom 16-colour palette, `_linearize: false`. Pixels
whose output colour differs between the JS loop and the Rust kernel:

| algorithm | Stucki 256×256, 16-colour |
|---|---:|
| RGB | 0 / 65536 |
| RGB_APPROX | 0 / 65536 |
| HSV | 0 / 65536 |
| LEVELS | 0 / 65536 |
| **OKLAB** | **10052 / 65536 (15%)** |
| **LAB** | **34244 / 65536 (52%)** |

Only the two algorithms that go through the sRGB→linear LUT diverge. That is the
whole finding — see the mechanism below.

## Two different causes, don't conflate them

**Lab: a different conversion on each side.** JS `rgba2laba` reads the f32 LUT at
`round(channel)`. Rust `rgba2lab_inline` — the one error diffusion and Riemersma
call — linearises the *exact* float with `powf` and never touches the LUT. So the
two compute genuinely different values for a fractional channel. Measured against
an exact f64 reference: the LUT-and-round answer is off by up to **0.2554 L\***
(worst around channel 23.5). Roughly a quarter of a just-noticeable difference,
so every individual decision is a near-tie — but error diffusion cascades them.

Note `quantize_buffer_lab` (whole-buffer) uses `rgba2lab_via_lut`, which *does*
read the LUT. So Rust has both shapes, and which one you get depends on which
kernel you land in. That path is fine: integral channels only, where LUT and exact
`powf` agree to **1.65e-6 L\*** across all 256 greys.

**OKLab: the same conversion, amplified.** Both sides round-and-clamp into the
same f32 LUT — that mirroring is deliberate (`ed56fb8`). They still diverge,
for a subtler reason: JS accumulates diffused error in **f64** (`readF32` widens
out of the `Float32Array`, and the arithmetic runs as JS numbers) while the Rust
kernel accumulates in **f32**. Those differ in the last bits.

Last-bit differences are normally harmless. The LUT is what makes them matter: it
quantizes the channel to an integer index, which is a *hard threshold at every .5
boundary*. A last-bit difference straddling a boundary picks a different palette
entry, and error diffusion propagates it. RGB/RGB_APPROX/HSV compare distances
against palette entries instead, where a last-bit difference cannot flip a winner
short of an exact tie — which is why they sit at 0.

## The cascade is why the numbers look inconsistent

Divergence grows with image size, same fixture and palette throughout
(Floyd-Steinberg, Lab, 6 colours):

| size | pixels differing |
|---|---:|
| 12×9 | 7.41% |
| 24×18 | 26.62% |
| 48×36 | 37.79% |
| 64×64 | 38.21% |
| 128×128 | 41.43% |

One flipped near-tie changes the error pushed to its neighbours, which flips
more. A small fixture badly understates it — 12×9 reads as a 7% curiosity, and the
same code at realistic sizes is a different image.

**This is a trap for tests.** `oklabErrorDiffusionParity` asserts exact JS/WASM
equality on a 12×9 fixture and passes; the same assertion for Stucki at 256×256
fails. That test guards the wiring and the rounding rule, which is what it was
written for, but it does not certify the backends as interchangeable, and its
comment was corrected to stop implying it does.

## Resolved — Lab is now 0%, and the fix is narrower than either option

Direction given: parity is wanted, 100% is not required. In the event it cost
nothing to get there for Lab.

Neither option below was taken as written. Both asked "which shape is canonical,
the LUT or the exact float?" — and the answer is *both, depending on the caller*,
because Rust has one of each. `rgba2laba` now branches on integrality: an integral
in-range channel reads the LUT (matching `rgba2lab_via_lut`, which is all
`quantize_buffer_lab` ever sees), and anything fractional or out-of-range
linearises exactly (matching `rgba2lab_inline`, which is all error diffusion and
Riemersma ever see). Each caller lands on its own counterpart's shape.

| case | before | after |
|---|---:|---:|
| FS 12×9, 6-colour | 7.41% | **0%** |
| FS 48×36, 6-colour | 37.79% | **0%** |
| FS 128×128, 6-colour | 41.43% | **0%** |
| FS 64×64, 16-colour | 54.13% | **0%** |
| Stucki 256×256, 16-colour | 52.25% | **0%** |

Lab beat OKLab the moment it stopped touching the LUT, which is the mechanism
above confirming itself: no LUT means no `.5` threshold for a last-bit f64/f32
difference to trip, and a distance comparison alone cannot flip on one.

OKLab then got the same treatment, for a reason that turned out to be much
stronger than parity — see below. It is now 0% too, including Stucki 256×256,
where it had sat at 15.34%.

Cost: nothing measurable. The whole-buffer JS fallback pays a `Number.isInteger`
per channel — palette scan 517,503 hz against 522,078 before, inside the ±0.65%
noise. The integral path never pays a `powf` to move an answer by 1.6e-6, and the
bit-parity grid against `quantize_buffer_lab` is untouched.

Pinned by `test/filters/errorDiffusionBackendParity.test.ts` at 128×128 and
Stucki 256×256 — sizes chosen because 12×9 reported 7% for this same fault and
would have read as a rounding curiosity.

## The LUT was never a parity question — it cost 15-66% dither quality

Filed above as "worth a look later, unmeasured", with the OKLab gap waved through
as sub-JND near-ties where "both outputs are valid dithers". That was wrong, and
measuring it was what showed it.

Both sides rounding into the same LUT does make them agree — but it also means
the *error signal* gets quantized to 8 bits before every palette match. Error
diffusion exists to carry sub-LSB error forward; discarding it at the match is
not a near-tie, it is throwing away the mechanism.

Same-algorithm A/B, JS path, 128×128, blurred RMS against the source (a dither is
meant to be integrated by the eye, so quality is how close the *blurred* result
lands). RGB and Lab were identical across both runs, which is the control — the
change only touched OKLab:

| case | LUT | exact | |
|---|---:|---:|---:|
| FS / CGA16 / skin tones | 18.541 | 6.289 | **−66%** |
| Stucki / CGA16 / ramp | 21.919 | 12.838 | **−41%** |
| FS / CGA16 / ramp | 18.763 | 11.379 | **−39%** |
| Atkinson / CGA16 / ramp | 19.068 | 16.288 | −15% |
| FS / 6-colour / ramp | 24.721 | 21.185 | −14% |
| FS / black+white / grey ramp | 4.482 | 4.596 | +2.5% |

The one regression is a 2-colour palette on a grey ramp — no colour to choose, so
there is nothing for a perceptual space to be right about. Everything else moves
one way, hardest where a palette has to pick between near neighbours, which is
exactly where discarded error hurts.

So OKLab now mirrors Lab exactly: `rgba2oklaba` branches on integrality,
`oklab_from_f32` always linearises the exact float (only error diffusion and
Riemersma reach it), and `quantize_buffer_oklab` keeps the LUT because integral
channels are all it ever sees. Parity came along for free: 15.34% → 0%.

The caution from `ed56fb8` — that the LUT mirroring was "deliberate and
load-bearing" — was right about `quantize_buffer_oklab` and wrong about the
error-diffusion path. Mirroring is only a virtue when the thing being mirrored is
correct for the caller.

**Checked, and clean:** the same question for *ordered*, which inlines its own
OKLab in GLSL and pre-converts its palette with a JS copy (`rgbToOklabJs`).
Nothing to fix. Ordered biases a pixel by its threshold and then quantizes to the
levels grid — `quant = jsRoundV(jsRoundV((src255 + bias) / step255) * step255)` —
*before* the palette match. That rounding is the algorithm, not an artifact: a
threshold map is a fixed bias, not accumulated error, so there is no sub-LSB
signal for the match to throw away. Both conversions already linearise with `pow`
and read no LUT, so ordered was never on the wrong side of this.

## Known gaps — `_linearize: true`, still open

Everything above is `_linearize: false`. Linearize mode is a *different*
configuration, not a variation on it: both sides round to an integral u8 before
matching, so it exercises the LUT half of the branch where the rest of this doc
exercises the exact half. It went untested long enough to hide a 21% gap.

Stucki 256×256, 16-colour, JS vs WASM:

| algo | before | now |
|---|---:|---:|
| RGB | 0 | 0 |
| HSV | 0 | 0 |
| LEVELS | 0 | 0 |
| Lab | 13988 (21%) | **0** |
| OKLab | 8941 (14%) | 4335 (6.6%) |
| RGB_APPROX | 5286 (8%) | 5286 (8%) |

Lab took two fixes, and neither alone moved the number:

1. `rgba2lab_inline` had to learn the same integrality branch as JS. Without it,
   JS read the LUT and Rust used `powf`.
2. **The two sRGB→linear LUTs were not the same table.** Rust built its in f32
   throughout (`i as f32 / 255.0`, then `powf` on f32, rounding at every step);
   JS builds its in f64 and rounds to f32 once, at the `Float32Array` store. 214
   of 256 entries differed, worst 1.8e-7 at index 217. Rust now mirrors JS.

Why that hid for so long is the useful part. A 1.8e-7 difference only flips a
pixel sitting that close to the *bisector* between two palette entries. Over a
76,800-pixel whole-buffer quantize that is ~0.008 expected flips — zero — which
is exactly why `quantizeBufferParity` passed bit-for-bit the whole time. Error
diffusion cascades one flip into thousands. The same fault is invisible in one
kernel and 21% in the other.

(This also kills the "1.65e-6 is far below the 1.3e-3 gap between palette
entries, so nothing can flip" argument, which appears in earlier commit messages
here and is wrong. The distance that matters is pixel-to-bisector, and that can
be arbitrarily small.)

**Still open, diagnosed, not fixed:**

- **OKLab, 4335/65536 (6.6%).** Halved by the LUT fix, so part of it was the
  table. The remainder is unexplained — both sides read the same LUT and do f64
  matrix maths from there. Not chased further.
- **RGB_APPROX, 5286/65536 (8%).** Untouched by any of this, and it reads no LUT
  at all, so it is a different fault. Likely arithmetic width: the Rust kernel
  computes the red-mean distance in f32 (`lib.rs`, `PAL_MODE_RGB_APPROX`), JS
  computes it in f64. Unverified.

Neither is asserted in `errorDiffusionBackendParity` — they would fail. Recorded
here instead, because leaving them undocumented is precisely how the Lab gap
survived this long.

## The decision (superseded — kept for the reasoning)

Both fixes change shipped output, which is why neither was taken at the time:

**A. Rust `rgba2lab_inline` reads the LUT like JS does.** Aligns Lab, and makes
Rust internally consistent (`rgba2lab_via_lut` already does this). Changes the
WASM Lab dither — the default path, what users actually see today.

**B. JS `rgba2laba` linearises the exact float like Rust does.** Aligns Lab by
moving the *fallback* to match the primary path, so current default output is
untouched. Costs 3 `powf` per pixel on a path that is already the slow one. But
`rgba2laba` is shared with the whole-buffer JS fallback, where inputs are integral
— that would swap a LUT read for a `powf` to change the answer by 1.65e-6, i.e.
pay for nothing, and risk the bit-parity grid against `quantize_buffer_lab`.

Neither closes OKLab's 15%, because that is the f64-vs-f32 accumulation, not the
conversion. Closing that means JS doing `Math.fround` through the error
accumulation, which is a third decision with its own cost.

**Recommendation: B, scoped.** Give error diffusion an exact-float Lab entry point
rather than changing `rgba2laba` for every caller — it is the only path handing
fractional channels to a conversion built for integers, and the whole-buffer path
has no problem to fix. Left undone pending a call on whether backend determinism
is worth it at all, given every individual disagreement is a sub-JND near-tie and
both outputs are valid dithers.

## What is NOT worth doing

Asserting the current divergence as a pinned number. It is a cascade — it moves
with size, kernel, and palette, so any pinned figure is a fixture artifact, and
pinning freezes whichever side happens to be canonical before that is decided.
