# 059 — Why JS and WASM disagreed about Lab, and where the floor is

**Outcome first.** `c5c1a1e` fixed both Lab conversions reading fractional
channels as black, which made the JS fallback comparable to the Rust kernel for
the first time. It turned out the two disagreed on 38–54% of pixels in error
diffusion. Four faults, all one shape — **one side rounding where the other did
not** — plus a floor that no amount of care removes:

1. JS rounded a fractional channel into an f32 LUT built for integers; the kernel
   linearised exactly. → `rgba2laba`/`rgba2oklaba` branch on integrality.
2. The two sRGB→linear LUTs were not the same table (Rust f32 throughout, JS f64
   rounded once; 214/256 entries differed). → matched.
3. JS computed the diffused-error products in f64, the kernel in f32. →
   `Math.fround` in the JS loop.
4. RGB/RGB_APPROX scored distance in f32 while everything else used f64. →
   widened.
5. **`Math.cbrt` and Rust `f64::cbrt` disagree by 1 ULP on 8.4% of inputs.** Not
   fixable by width discipline. This is the floor.

Result: 11 of 12 configurations are bit-identical at 1024×1024, up from divergence
at 12×9. The twelfth is (5).

Neither backend was ever *wrong* — both produce a valid dither. But
`wasmAcceleration` is a user-facing toggle, and the JS loop is the only oracle
the kernel has.

**What follows is chronological, including three wrong turns**, because the wrong
turns are the transferable part: each one was a real measurement read at a fixture
size too small to show the phenomenon. Sections below marked superseded are kept
for the mechanism, not the numbers. The authoritative results are in "Resolved:
the widths were matched, and the floor is libm".

## What diverges (superseded — see the outcome above)

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

## Two different causes, don't conflate them (superseded — there were four)

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

## Resolved — Lab is now 0% (superseded: 0% at 256x256, not at 768x768)

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

## Resolved: the widths were matched, and the floor is libm

Every intermediate that JS and the kernel computed at different widths has been
matched. Stucki, 16-colour, JS vs WASM, **1024×1024** — larger than anything that
had been measured:

| algo | `_linearize: false` | `_linearize: true` |
|---|---:|---:|
| RGB | 0 | 0 |
| RGB_APPROX | 0 | 0 |
| HSV | 0 | 0 |
| Lab | 0 | 0 |
| LEVELS | 0 | 0 |
| **OKLab** | 0 | **12.43%** |

Three faults, all of the same shape — one side rounding where the other did not:

1. **The error arithmetic.** JS computed `er`, `scale`, `weight * scale` and
   `er * weight` in f64; the kernel does each in f32. The *store* already
   agreed (both write a `Float32Array`, and an f32+f32 sum computed in f64 and
   rounded once is bit-equal to an f32 add), so only the products were wide. JS
   now `Math.fround`s each. Nothing was lost: the next store discarded that
   precision anyway.
2. **The two sRGB→linear LUTs.** Rust built its in f32 throughout, JS in f64
   rounded once. 214/256 entries differed. Now identical — verified 0/256.
3. **RGB and RGB_APPROX scored distance in f32**, while HSV, Lab and all five
   whole-buffer quantizers use f64, as does the JS `colorDistance` they mirror.
   Widened to f64. (Not narrowed in JS: `colorDistance` is shared with the
   whole-buffer fallback, whose counterpart is f64 and already bit-parity-clean.)

That took the onset from ~12×9 to beyond 1024² for eleven of the twelve
configurations. It is a property now, not a threshold — there is no last-bit
difference left for the cascade to amplify.

**OKLab in linearize mode is the exception, and it cannot be fixed this way.**
`Math.cbrt` and Rust's `f64::cbrt` are different libm implementations and
disagree by up to 1 ULP (1.1e-16) on **1032 of 12288** of the l/m/s values OKLab
actually feeds them — 8.4%. `cbrt` is not a correctly-rounded operation under
IEEE-754, so both are entitled to their answers. No width discipline reaches
this; closing it means implementing `cbrt` identically on both sides.

Note what that implies for the 0%s above: OKLab's `linearize: false` is 0 at
1024² but is subject to the same 1-ULP disagreement, so it is a threshold that
has not fired rather than a guarantee. Lab's `powf` is likely in the same
position. **Exact JS/WASM parity for error diffusion is not achievable while both
sides call their own transcendentals** — the systematic differences are gone, and
what remains is a floor.

**This document made the "small fixture" mistake three times while being
written**, which is why the numbers above are at 1024² and the surviving gap is
stated as a mechanism rather than a percentage. A fixture too small to reach the
phenomenon reports its absence.

The tests run at 256×256 for speed and are honest regression guards —
deterministic, and they fail loudly against every fault found here. They do not
prove the backends interchangeable at any size, and the OKLab/linearize row above
is the standing proof that they cannot.

## Known gaps — `_linearize: true`

Historical; superseded by the section above, which closed all of these except
OKLab. Kept for the mechanism, which is the useful part.

Linearize mode is a *different* configuration, not a variation: both sides round
to an integral u8 before matching, so it exercises the LUT half of the
integrality branch where the rest of this doc exercises the exact half. It went
untested long enough to hide a 21% gap.

Stucki 256×256, 16-colour, before any of the width fixes:

| algo | linearize=false | linearize=true |
|---|---:|---:|
| RGB | 0 | 0 |
| HSV | 0 | 0 |
| LEVELS | 0 | 0 |
| Lab | 0 | 13988 (21%) |
| OKLab | 0 | 8941 (14%) |
| RGB_APPROX | 0 | 5286 (8%) |

Why it hid is the useful part. A 1.8e-7 LUT difference only flips a pixel sitting
that close to the *bisector* between two palette entries. Over a 76,800-pixel
whole-buffer quantize that is ~0.008 expected flips — zero — which is exactly why
`quantizeBufferParity` passed bit-for-bit the whole time. Error diffusion cascades
one flip into thousands. The same fault is invisible in one kernel and 21% in the
other.

(This also killed the "1.65e-6 is far below the 1.3e-3 gap between palette
entries, so nothing can flip" argument, which appears in earlier commit messages
here and is wrong. The distance that matters is pixel-to-bisector, and that can
be arbitrarily small.)

One diagnosis recorded because it was wrong and nearly filed as a bug:
RGB_APPROX's divergence was attributed to the Rust kernel computing the red-mean
distance in f32 against JS's f64. That *was* the cause — but the disproof offered
at the time (modelling the f32 arithmetic with `Math.fround` and comparing argmin
over 76,368 pixels, finding zero flips) was itself wrong, because it sampled a
coarse grid rather than the error-diffused values the kernel actually sees. The
flip rate is far below 1/76,368 per pixel and only shows up under cascade. A
negative result on the wrong input distribution proves nothing.

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
