# 056 — Serpentine scanning was not re-aiming the kernel

## The bug

Serpentine scanning alternates each row's direction to break up the directional
artefacts error diffusion otherwise leaves. Reversing the scan requires
re-aiming the kernel, so its taps still point at pixels the scan hasn't reached
yet. Both backends mirrored the kernel index **and** multiplied by the reversed
step:

```
kx = reverse ? (kernelWidth - 1 - w) : w
tx = x + (kx + offsetX) * xStep          // xStep = -1 on reverse rows
```

Those two cancel. Effective `dx` on a reverse row is `-(kw - 1 - w + ox)`, which
for any **centred** kernel — `ox == (1 - kw) / 2`, true of Floyd-Steinberg's
`(kw=3, ox=-1)` — equals `w + ox`: exactly the forward `dx`.

So the kernel was never re-aimed. On right-to-left rows the same-row 7/16 tap
still pointed at `x+1` — a pixel already quantised and emitted — and that error
was silently dropped.

Serpentine is **on by default**, so this affected every error-diffusion filter:
Floyd-Steinberg, Atkinson, Jarvis, all three Sierras, Stucki, Burkes.

## Why nothing caught it

- The JS conformance test forced `_wasmAcceleration: false`; the WASM test
  mocked the kernel away and asserted argument positions. Neither looked at
  output.
- The one serpentine assertion was `straight != snake`. The un-aimed kernel
  _does_ produce a different image, so it passed.
- JS and WASM shared the same convention, so backend-parity checks agreed —
  both were wrong in the same way.

## How it was measured

A **global** mean does not detect it. Flat mid-grey came out 127.50 straight vs
128.50 serpentine — the dropped error averages away, and that reading initially
led to the wrong conclusion that the effect was negligible.

Local mean is the actual promise: error diffusion claims the result resembles
the source when blurred. Mean `|blur(dithered) - blur(source)|` on a 64×64
gradient, box radius 4:

|                           |    before |    after |
| ------------------------- | --------: | -------: |
| straight (serpentine off) |      2.87 |     2.87 |
| **serpentine on**         | **12.98** | **2.79** |
| textbook reference        |      2.79 |     2.79 |

Serpentine was **4.5× worse than straight scanning** — i.e. worse than not
serpentining at all — and is now indistinguishable from it, as it should be.
1614 of 4096 pixels changed.

## The fix

`dx_rev = -dx_fwd` in both backends:

- `wasm/rgba2laba/src/lib.rs` — `error_diffuse_buffer`
- `filters/errorDiffusingFilterFactory.ts` — both the linear and sRGB loops

**`wasm/rgba2laba_bg.wasm` is a checked-in build artefact.** Changing the Rust
alone ships nothing; it must be rebuilt or JS and WASM silently disagree (which
is how this was confirmed — the parity test failed against the stale binary):

```bash
cd packages/ditherer-filters/src/wasm/rgba2laba
wasm-pack build --target web --out-dir wasm --release
```

## What now pins it

- `serpentine_matches_the_reference` — against a textbook FS reference that
  models the mirroring, not just "output differs".
- `serpentine_reproduces_local_mean_as_well_as_straight_scanning` — the metric
  above, as a regression guard.
- `test/filters/errorDiffusionOracle.test.ts` — JS↔WASM parity with serpentine
  on, for all 8 kernels.

## Note

This changes the output of every error-diffusion filter at its default settings.
The change is an improvement by the metric error diffusion exists to satisfy, and
the new output matches the published algorithm — but saved chains will render
differently than before.
