# Gamma-Correct Image Processing Pipeline

## Problem

The dithering and filtering pipeline operates on raw sRGB pixel values (0-255). sRGB is a non-linear color space with gamma encoding. Mathematical operations on non-linear values produce incorrect results:

- **Averaging:** sRGB `avg(0, 255) = 128`, but the perceptually correct midpoint (50% luminance) is sRGB 188. All dithering is biased dark.
- **Error diffusion:** Quantization error is computed in non-linear space, so error distribution is unevenly weighted — shadows get too much error, highlights too little.
- **Thresholding:** Fixed thresholds in sRGB space don't correspond to uniform perceptual intervals.

## Current State

- `luminance()` and `luminanceItuBt709()` were fixed to linearize by default, with a `linear` boolean toggle
- A per-pixel `linearize()` function exists in utils (used by luminance)
- Pixelsort has a `linearLuminance` UI toggle
- The WASM Lab conversion (`rgba2laba`) already linearizes internally (sRGB → XYZ → Lab)
- All other filters operate on raw sRGB values

## Scope

### Affected filters

| Filter | Key operations | Priority | Wrappable? |
|--------|---------------|----------|------------|
| Error diffusion (11 variants) | Error subtraction, weighted diffusion | CRITICAL | Yes — factory has single getImageData/putImageData pair |
| Convolution (blur, sharpen, edge) | Kernel weighted sum/difference | CRITICAL | Yes — uses Array.from(buf), outputBuf |
| Brightness/Contrast | Brightness/contrast/gamma math | CRITICAL | Yes — uses outputBuf copy |
| Grayscale | RGB arithmetic mean `(R+G+B)/3` | CRITICAL | Yes |
| Halftone | Block color averaging | CRITICAL | Partial — reads with getImageData, writes with canvas draw ops. Linearize input buffer only |
| Ordered dithering | Threshold + quantization | HIGH | Yes |
| Random dithering | RGB averaging + noise | HIGH | Yes |
| Quantize | Palette distance lookup | HIGH | Yes |
| Binarize | Per-channel threshold | MODERATE | Yes |
| Pixelate | Palette lookup on downsampled pixels | MODERATE | Yes — intermediate buffer only |

### Not affected

| Filter | Why |
|--------|-----|
| Pixelsort | Already has `linearLuminance` toggle |
| Invert | Pure `255 - x`, linearity doesn't matter |
| Channel separation | Pure channel routing |
| Glitch | Byte-level corruption |
| VHS / Scanline / RGB Stripe | CRT emulation, artistic intent |
| Program | User-defined code, can't enforce |

### Special case: Grayscale

Currently uses `(R+G+B)/3` — a naive average that ignores both gamma and human luminance perception. Should be updated to use the existing `luminance()` function (BT.601 weighted average in linear space) as the default, with a toggle for the simple average.

### Special case: Convolution

Linearization is correct for blur (Gaussian, box) and edge detection (Laplacian, Sobel). But for artistic kernels (emboss, sharpen), the non-linear behavior may be part of the expected look. Default to linearized, but the toggle lets users revert.

## Design

### Global toggle, applied at filter boundaries

Add a single `linearize` boolean to the app state, next to the existing `convertGrayscale` toggle. Filters that support linearization receive the flag and wrap their pixel processing.

```
UI:  [x] Linearize (gamma-correct)     ← new global checkbox
     [x] Pre-convert to grayscale      ← existing
```

The flag is passed to each filter call as `options._linearize` (underscore prefix to distinguish from filter-specific options). Each affected filter checks it and wraps accordingly:

```javascript
const filter = (input, options) => {
  const imageData = inputCtx.getImageData(0, 0, w, h);
  if (options._linearize) linearizeBuffer(imageData.data);
  // ... existing filter logic unchanged ...
  if (options._linearize) delinearizeBuffer(imageData.data);
  outputCtx.putImageData(imageData, 0, 0);
};
```

Filters that shouldn't linearize (glitch, VHS, invert, etc.) simply don't check the flag.

**Why global, not per-filter:** One toggle is simpler UX. The flag is conceptually the same as "pre-convert to grayscale" — a pipeline-level setting, not a filter parameter. Filters that ignore it (glitch, VHS) do so silently. Users who want the non-linear artistic look uncheck one box.

## Implementation

### 1. LUT-based utility functions

```javascript
// src/utils/index.js

// Precomputed lookup tables — avoids Math.pow per pixel
const SRGB_TO_LINEAR = new Float32Array(256);
const LINEAR_TO_SRGB = new Uint8Array(256);

for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LINEAR[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
for (let i = 0; i < 256; i++) {
  const l = i / 255;
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.round(Math.max(0, Math.min(1, s)) * 255);
}

// Mutate RGBA buffer in place. Skip alpha channel.
export const linearizeBuffer = (buf) => {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i]     = Math.round(SRGB_TO_LINEAR[buf[i]] * 255);
    buf[i + 1] = Math.round(SRGB_TO_LINEAR[buf[i + 1]] * 255);
    buf[i + 2] = Math.round(SRGB_TO_LINEAR[buf[i + 2]] * 255);
  }
};

export const delinearizeBuffer = (buf) => {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i]     = LINEAR_TO_SRGB[buf[i]];
    buf[i + 1] = LINEAR_TO_SRGB[buf[i + 1]];
    buf[i + 2] = LINEAR_TO_SRGB[buf[i + 2]];
  }
};
```

Note: both LUTs are 256-entry (input is always 0-255 `Uint8ClampedArray`). The `delinearizeBuffer` LUT maps linearized-then-quantized-to-0-255 values back to sRGB. Roundtrip error is ±1 due to quantization.

### 2. Add global state + UI

In `src/reducers/filters.js`, add to `initialState`:
```javascript
linearize: true
```

Add reducer case:
```javascript
case "SET_LINEARIZE":
  return { ...state, linearize: action.value };
```

In `src/context/FilterContext.jsx`, add action:
```javascript
setLinearize: (value) => dispatch({ type: "SET_LINEARIZE", value })
```

In `src/components/App/index.jsx`, add checkbox next to "Pre-convert to grayscale":
```jsx
<input type="checkbox" checked={state.linearize}
  onChange={e => actions.setLinearize(e.target.checked)} />
<span>Linearize (gamma-correct)</span>
```

### 3. Pass flag to filters

In `FilterContext.filterImageAsync` and the realtime filtering path in the reducer, inject the flag into filter options:

```javascript
const filterOpts = { ...filter.options, _linearize: state.linearize };
const output = filterFunc(input, filterOpts);
```

### 4. Wrap each affected filter

**Standard pattern** (errorDiffusion, ordered, random, binarize, quantize, grayscale):
```javascript
const buf = inputCtx.getImageData(0, 0, w, h);
if (options._linearize) linearizeBuffer(buf.data);
// ... existing logic ...
if (options._linearize) delinearizeBuffer(buf.data);
outputCtx.putImageData(buf, 0, 0);
```

**Dual-buffer pattern** (brightnessContrast, convolve — read from input, write to separate output buf):
```javascript
const inputBuf = inputCtx.getImageData(0, 0, w, h).data;
if (options._linearize) linearizeBuffer(inputBuf);
// ... existing logic writes to outputBuf ...
if (options._linearize) delinearizeBuffer(outputBuf);
outputCtx.putImageData(new ImageData(outputBuf, w, h), 0, 0);
```

**Halftone** (reads buffer, writes via canvas draw — per-color delinearize):
```javascript
const buf = inputCtx.getImageData(0, 0, w, h).data;
if (options._linearize) linearizeBuffer(buf);
// ... compute meanColor from buffer (now in linear space) ...
// ... quantize meanColor ...
if (options._linearize) {
  meanColor[0] = LINEAR_TO_SRGB[Math.round(meanColor[0])];
  meanColor[1] = LINEAR_TO_SRGB[Math.round(meanColor[1])];
  meanColor[2] = LINEAR_TO_SRGB[Math.round(meanColor[2])];
}
// ... draw dots with delinearized colors ...
```

### 5. Update Grayscale

When linearized, use weighted luminance instead of naive `(R+G+B)/3`:
```javascript
if (options._linearize) {
  linearizeBuffer(buf);
  for (let i = 0; i < buf.length; i += 4) {
    const gray = Math.round(0.299 * buf[i] + 0.587 * buf[i+1] + 0.114 * buf[i+2]);
    buf[i] = buf[i+1] = buf[i+2] = gray;
  }
  delinearizeBuffer(buf);
} else {
  // existing (R+G+B)/3 path
}
```

### 6. Filters that ignore the flag

These filters don't check `options._linearize` — the underscore-prefixed key is simply ignored:
- Pixelsort (has its own `linearLuminance` toggle already)
- Invert, Channel separation
- Glitch, VHS, Scanline, RGB Stripe
- Program

## Tests

1. **Roundtrip test:** `linearizeBuffer` → `delinearizeBuffer` on a known buffer. Verify max error ≤ 1 per channel.
2. **Known-value test:** sRGB 128 → linear ~0.216 → Math.round(0.216 * 255) = 55. Verify `linearizeBuffer([128, 128, 128, 255])` produces `[55, 55, 55, 255]`.
3. **Per-filter toggle test:** Run each affected filter with `linearize: true` and `linearize: false`, verify outputs differ.
4. **Visual regression:** Compare error diffusion output on a smooth gradient with and without linearization. Linearized version should have more uniform dot density across the gradient.

## Execution order

1. Add `linearizeBuffer`/`delinearizeBuffer` to utils + roundtrip/known-value tests
2. Add `linearize` to app state, reducer, context, and UI checkbox
3. Pass `_linearize` flag through filter call sites
4. Add to error diffusion factory (covers all 11 variants at once — biggest impact)
5. Add to convolution and grayscale
6. Add to ordered dithering + random dithering
7. Add to binarize, quantize, pixelate, brightnessContrast
8. Add to halftone (special case — per-color delinearization)
9. Visual testing with sample images

## Performance

- LUT lookup: O(n) with zero `Math.pow` calls, no branches
- Two buffer passes add ~1ms for 1920x1080 (8.3M channel lookups)
- `Uint8ClampedArray` access is already fast — LUT is 256 bytes, fits in L1 cache
- For video realtime filtering: the two passes add ~2ms per frame, negligible vs filter computation
