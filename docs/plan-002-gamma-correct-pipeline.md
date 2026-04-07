# Gamma-Correct Image Processing Pipeline

## Problem

The dithering and filtering pipeline operates on raw sRGB pixel values (0-255). This is technically incorrect — sRGB is a non-linear color space with gamma encoding. Operations like color averaging, error diffusion, and distance calculations produce different (and often visually worse) results in non-linear space than in linear space.

**Example:** Averaging sRGB 0 and sRGB 255 gives 128, but the perceptually correct midpoint in linear light is sRGB 188 (~50% luminance). This bias causes dithering patterns to be too dark and error diffusion to spread errors unevenly.

## Current State

- `luminance()` and `luminanceItuBt709()` in `src/utils/index.js` were fixed to linearize by default (Phase 1), with a `linear` boolean toggle
- `linearize()` function exists in utils for sRGB → linear conversion
- Pixelsort has a `linearLuminance` UI toggle
- All other filters operate on raw sRGB values without linearization
- The WASM Lab color conversion (`rgba2laba`) already linearizes internally (sRGB → XYZ → Lab), so Lab-based distance calculations are correct

## Scope

### Affected filters (operate on pixel values directly)

| Filter | Operations affected |
|--------|-------------------|
| Error diffusion (11 variants) | Error calculation and distribution |
| Ordered dithering | Threshold comparison against Bayer matrix |
| Random dithering | Threshold comparison |
| Binarize | Threshold comparison |
| Quantize | Level quantization |
| Brightness/Contrast | Brightness/contrast math |
| Halftone | Mean color calculation per grid cell |
| Pixelate | Mean color calculation per block |

### Not affected (already correct or N/A)

| Filter | Why |
|--------|-----|
| Pixelsort | Fixed — `linearLuminance` toggle added |
| Grayscale | Operates on channel weights (same formula as luminance, could benefit) |
| Invert | Pure `255 - x`, linearity doesn't matter |
| Channel separation | Pure channel manipulation |
| Glitch | Byte-level corruption, linearity irrelevant |
| VHS / Scanline / RGB Stripe | CRT emulation effects, artistic |
| Convolution | Kernel operations — linearizing would change behavior, debatable |
| Program | User-defined, can't enforce |

## Design

### Option A: Linearize at filter boundaries (recommended)

Add `linearize`/`delinearize` steps at the entry and exit of each affected filter function:

```javascript
const filter = (input, options) => {
  const buf = getImageData(input);
  if (options.linearize) linearizeBuffer(buf);  // sRGB → linear
  // ... existing filter logic unchanged ...
  if (options.linearize) delinearizeBuffer(buf); // linear → sRGB
  putImageData(output, buf);
};
```

**Pros:** Minimal change to filter logic. Each filter opts in. Toggle per filter.
**Cons:** Two full-buffer passes for linearization. Repeated if filters are chained.

### Option B: Global linearize in pipeline

Linearize once before filtering, delinearize once after:

```
input canvas → linearize → filter → delinearize → output canvas
```

Done in `FilterContext.filterImageAsync()`.

**Pros:** Single linearization pass. All filters get it for free.
**Cons:** Filters that shouldn't linearize (glitch, VHS) need an opt-out. Less granular control.

### Recommendation: Option A with a shared toggle

- Add a `linearize: { type: BOOL, default: true }` option to each affected filter's `optionTypes`
- Add `linearizeBuffer()` and `delinearizeBuffer()` utility functions to `src/utils/index.js`
- Each filter calls these at entry/exit when `options.linearize` is true
- Users can toggle per-filter for artistic preference
- Default `true` for correctness

## Implementation

### 1. Add utility functions

```javascript
// src/utils/index.js

const SRGB_TO_LINEAR_LUT = new Float32Array(256);
const LINEAR_TO_SRGB_LUT = new Uint8Array(65536);

// Precompute LUTs for performance (avoid per-pixel Math.pow)
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LINEAR_LUT[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
for (let i = 0; i < 65536; i++) {
  const l = i / 65535;
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  LINEAR_TO_SRGB_LUT[i] = Math.round(s * 255);
}

// Mutates buffer in place. Operates on RGBA — skips alpha channel.
export const linearizeBuffer = (buf) => {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i]     = Math.round(SRGB_TO_LINEAR_LUT[buf[i]] * 255);
    buf[i + 1] = Math.round(SRGB_TO_LINEAR_LUT[buf[i + 1]] * 255);
    buf[i + 2] = Math.round(SRGB_TO_LINEAR_LUT[buf[i + 2]] * 255);
    // buf[i + 3] alpha unchanged
  }
};

export const delinearizeBuffer = (buf) => {
  for (let i = 0; i < buf.length; i += 4) {
    // Scale 0-255 linear → 0-65535 for LUT lookup
    buf[i]     = LINEAR_TO_SRGB_LUT[Math.round(buf[i] / 255 * 65535)];
    buf[i + 1] = LINEAR_TO_SRGB_LUT[Math.round(buf[i + 1] / 255 * 65535)];
    buf[i + 2] = LINEAR_TO_SRGB_LUT[Math.round(buf[i + 2] / 255 * 65535)];
  }
};
```

### 2. Add option to each affected filter

Add to each filter's `optionTypes`:
```javascript
linearize: { type: BOOL, default: true }
```

### 3. Wrap filter logic

In each affected filter, add linearize/delinearize around the pixel processing:
```javascript
const buf = inputCtx.getImageData(0, 0, w, h);
if (options.linearize) linearizeBuffer(buf.data);
// ... existing logic ...
if (options.linearize) delinearizeBuffer(buf.data);
outputCtx.putImageData(buf, 0, 0);
```

### 4. Tests

- Test `linearizeBuffer` / `delinearizeBuffer` roundtrip (should be near-lossless, ±1 for rounding)
- Test affected filters produce different output with `linearize: true` vs `linearize: false`
- Visual comparison tests: verify dithering patterns are more even in linear mode

## Execution order

1. Add LUT-based `linearizeBuffer`/`delinearizeBuffer` to utils + tests
2. Add `linearize` option to error diffusion factory (covers all 11 variants at once)
3. Add to ordered dithering
4. Add to remaining filters (binarize, quantize, random, halftone, pixelate, brightness/contrast)
5. Update grayscale to optionally linearize
6. Visual testing with sample images

## Performance notes

- LUT-based linearization is O(n) with no `Math.pow` calls — fast
- Two extra buffer passes (~1ms for a 1920x1080 image)
- Can be optimized further with WASM if needed
