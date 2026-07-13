# 038 - VHS/NTSC WebGL Signal Model

## Goal

Improve the existing stylized VHS effect and add a separate WebGL2-only
VHS/NTSC filter derived from the signal-processing structure used by
`ntsc-rs`.

The new filter ports the browser-relevant image pipeline, not the upstream
desktop application, codecs, CLI, or editor plugins.

## Existing VHS Changes

- Make row tracking evolve smoothly between frames instead of reseeding into
  unrelated geometry every frame.
- Generate dropout streak and static-bar geometry once on the CPU and pass the
  exact state to WebGL so the CPU and GL paths agree.
- Make fractional dropout/static rates work at their defaults.
- Process luma and chroma in YIQ in the shader, including horizontal chroma
  bandwidth loss, vertical chroma blending, chroma phase noise, asymmetric
  luma smear, and a short same-frame RF echo.
- Apply temporal ghosting after dropout/static synthesis in both backends.
- Apply the palette after temporal blending in both backends.
- Raise the default chroma-bandwidth loss so the default preset reads as tape
  rather than a generic RGB glitch.

## New VHS/NTSC Filter

Add a GL-only, animated filter with three passes:

1. **Composite encode/transmit**
   - Convert RGB to YIQ.
   - Band-limit input chroma.
   - Modulate I/Q onto a four-pixel NTSC carrier.
   - Apply field selection, edge wave, head switching, tracking disturbance,
     composite noise, and snow to the scalar composite signal.
2. **Composite decode**
   - Recover luma/chroma with selectable notch, one-line comb, or two-line
     comb behavior.
   - Reconstruct signed YIQ into an intermediate texture.
3. **Tape/decode output**
   - Apply SP/LP/EP luma and chroma bandwidth profiles and chroma delay.
   - Apply vertical chroma blending, chroma loss, phase error/noise, luma
     smear/ringing, and separate luma/chroma noise.
   - Convert YIQ back to RGB.

The filter exposes the important upstream concepts without reproducing all 62
advanced settings. Settings are expressed in Ditherer's data-driven control
system and the filter remains chain-composable.

## Testing

- Add pure tests for fractional event counts and smooth tracking state.
- Assert the new filter metadata, GL requirement, defaults, and registry entry.
- Use the existing registry tests to protect worker lookup/deserialization.
- Compile the shaders in the existing WebGL2 browser smoke test.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run test -- test/filters/vhsNtsc.test.ts test/filters/filterRegistry.test.ts`
- `npm run test`
- `npm run build`
- `npm run test:e2e:gl`

## Upstream Validation and Known Delta

Validated against `ntsc-rs` commit
`f76c218c51e6fa7218dcb72f6f19a72d81bcd778`:

- The upstream core passes all 66 library tests.
- Default LP tape settings agree on the important signal parameters: 1.9 MHz
  luma cutoff, 300 kHz chroma cutoff, five-sample chroma delay, Butterworth
  filtering, notch demodulation, interleaved fields, 180-degree scanline
  phase, vertical chroma blend, and the default noise/loss probabilities.
- A 640x480 reference render of the upstream benchmark image was compared to
  this WebGL filter at frame zero. The final browser candidate measured RGB
  MAE 21.86, luma MAE 10.34, and PSNR 17.85 dB against the upstream output.
  Relative to the source, WebGL changed luma by 4.99 levels and chroma by
  8.91 YIQ units; upstream changed them by 12.78 and 20.09 respectively.
- The comparison ran on ANGLE's Vulkan SwiftShader renderer and took 149 ms.
  This is a correctness reference, not a hardware-GPU performance result.

The remaining delta is intentional and documented:

- `ntsc-rs` uses recursive constant-K/Butterworth transfer functions. WebGL
  fragment shaders cannot carry scanline recursion between fragments, so the
  port uses bounded gather kernels (up to 17 taps). This makes the default
  result milder and avoids the upstream filter's left-edge initialization
  stripe.
- Composite and YIQ intermediates use portable RGBA8 render targets, adding
  quantization that the upstream float planes do not have.
- Field phase and comb stride are reproduced, but the shader does not split
  the image into two separately processed field buffers as upstream does.
  Both field parities therefore share disturbance state within a frame.
- Noise uses deterministic shader hashes/sine FBM rather than upstream
  SplitMix64/simplex noise, so defect locations are not pixel-identical.
- The browser filter exposes the signal/tape controls relevant to this app,
  not every desktop/plugin setting or the upstream codec/editor integrations.
