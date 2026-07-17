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

## The decision

Both fixes change shipped output, which is why neither was taken:

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
