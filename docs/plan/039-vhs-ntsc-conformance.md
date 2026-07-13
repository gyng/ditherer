# 039 — VHS / NTSC conformance port

## Objective

Replace the approximate, fused tape stage with a bounded multipass WebGL2
translation whose transfer functions, operation order, field timing, and
random inputs are derived from `ntsc-rs` rather than visual tuning.

The existing three-pass RGBA8 renderer remains the compatibility fallback.
The conformance renderer is selected only after an RGBA16F framebuffer is
created and reported complete.

## Upstream contract

- Sampling rate: `(315 MHz / 88) * 4`.
- Tape profiles:
  - SP: 2.4 MHz luma, 320 kHz chroma, four-sample chroma advance.
  - LP: 1.9 MHz luma, 300 kHz chroma, five-sample chroma advance.
  - EP: 1.4 MHz luma, 280 kHz chroma, six-sample chroma advance.
- Constant-K is three cascaded first-order low-pass sections.
- Butterworth is the upstream second-order biquad.
- Tape order is low-pass, fixed `-1.6` luma restoration, chroma loss, optional
  VHS sharpen, then vertical chroma blend/output filtering.
- Interleaved upper and lower fields are processed separately with frame
  indices `2n` and `2n + 1` before being woven back together.
- Random streams start from the configured seed and mix a pass-specific seed
  and field frame index through upstream SplitMix64 semantics.

## Implementation

1. Generate 65-sample causal FIR approximations by evaluating the exact
   upstream transfer functions. Preserve DC gain after truncation. Split each
   convolution into four 17-tap accumulator passes so every fragment has a
   fixed, compiler-friendly sampling bound.
2. Render signal intermediates to RGBA16F when
   `EXT_color_buffer_float` is present and the framebuffer is complete. Keep
   source upload and final display RGBA8; use the existing renderer when float
   rendering is unavailable.
3. Keep signal operations in distinct stages: composite encode, upstream
   constant-K pre-emphasis, demodulate, pre-tape defects, FIR accumulation,
   fixed tape restoration, chroma loss, sharpen, then vertical blend/RGB
   output. Preserve upstream zero-state versus first-sample initialization per
   stage and per Y/I/Q channel.
4. For interleaved and single-field modes, render half-height upper/lower
   textures independently. Give each field its upstream frame index and weave
   or bob the field outputs only after processing.
5. Generate deterministic CPU noise planes from upstream-compatible
   SplitMix64 stream mixing and simplex gradients. Upload the plane once per
   field/frame and sample it in the relevant stages instead of shader hashes.
6. Test behavior at three levels:
   - pure transfer/noise tests for coefficients, response ordering,
     determinism, and seed separation;
   - signal tests for impulse, step, bars, zone plate, and alternating lines,
     including DC gain, cutoff response, delay, overshoot, and comb rejection;
   - browser WebGL2 tests that compile every stage, exercise float and fallback
     selection, and reject black/transparent/non-finite output.

## Acceptance gates

- Every profile/filter kernel is finite and has unity DC gain within `1e-5`.
- SP retains more high-frequency luma and chroma energy than LP, and LP more
  than EP, for both filter families.
- Chroma peak advance is four/five/six samples for SP/LP/EP.
- Adjacent field noise streams differ while repeated seed/frame inputs match.
- The default render has visible dynamic range and nonzero alpha on ANGLE or a
  hardware WebGL2 implementation.
- Typecheck, lint, unit tests, production build, and the GL smoke suite pass.

## Validation result

Validated against `ntsc-rs` commit
`f76c218c51e6fa7218dcb72f6f19a72d81bcd778` and its 640×480 benchmark
fixture on Chrome/ANGLE SwiftShader:

- RGB MAE: 5.40 (previous port: 21.86).
- Luma MAE: 3.28 (previous port: 10.34).
- PSNR: 25.71 dB (previous port: 17.85 dB).
- WebGL luma effect strength: 12.26 levels versus upstream 12.78 (96%).
- WebGL chroma effect strength: 19.96 average I/Q magnitude versus upstream
  20.09 (99.4%).
- With stochastic defects disabled, the complete default signal/tape chain
  reaches RGB MAE 1.47 and PSNR 40.39 dB. Its luma effect strength is 99.2%
  and its chroma effect strength is 101.1% of upstream.
- Isolating the clean broadcast stage gives 106% of upstream luma strength and
  99.9% of upstream chroma strength. The larger pixel delta in that isolated
  stage is high-frequency luma phase/initialization error which the upstream
  default smear and ringing stages attenuate.
- The browser GL sweep covers 383 cases, including old saved VHS state with
  no `tapeSharpness`; all compile and return opaque, non-flat output.

The remaining default-frame delta is primarily stochastic location fidelity:
noise uses upstream-compatible SplitMix64/simplex inputs, but the browser
planes do not reproduce every recursive FBM/geometric transient event in the
same pixel. The clean broadcast-only residual comes from replacing recursive
IIR tails with 65-sample FIRs and half-float arithmetic; this is largely
removed by the later default luma stages. Field processing uses the correct
independent `2n`/`2n + 1` phase indices but has one progressive source frame,
so temporal motion between captured fields cannot be reconstructed without a
second source frame.
