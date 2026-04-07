# Wide Gamut & Perceptual Color Space Support

## Problem

The app assumes sRGB everywhere — canvas creation, color math, palette definitions, WASM conversions. Modern displays (P3, Adobe RGB) and modern cameras/phones produce images in wider gamuts. When a P3 image is loaded into an sRGB canvas, the browser silently clamps out-of-sRGB colors, losing data before any filter runs.

Additionally, all dithering operates in RGB space (even with plan-002's linearization fix). Perceptually uniform color spaces like CIE Lab would produce better dithering and error diffusion, since equal numerical distances correspond to equal perceived color differences.

These are two related but distinct improvements:
1. **Wide gamut** — preserve the full color range of the source image
2. **Perceptual processing** — operate in a space where math matches human perception

## Current State

- All canvases created with default `getContext('2d')` — implicitly sRGB
- `rgba2laba` / `laba2rgba` exist for Lab conversion (JS + WASM), but only used for palette color distance, not filter processing
- WASM Lab conversion hardcodes sRGB primaries in its XYZ matrix
- Palette color distance supports Lab via `LAB_NEAREST` option — already perceptually correct for matching, but dithering error is still computed/diffused in RGB
- HSV conversion exists (`rgba2hsva`) but has no inverse

## Scope

### 1. Wide gamut canvas (Display P3)

**What changes:**
- Every `canvas.getContext('2d')` call adds `{ colorSpace: 'display-p3' }` when supported
- Every `createImageData` and `getImageData` call uses the P3 color space
- Color values remain 0-255 per channel but represent P3 coordinates, not sRGB
- Colors that were previously clamped to sRGB gamut are now preserved

**What doesn't change:**
- Filter logic operates on 0-255 buffers identically
- Linearization (plan-002) still applies — P3 uses the same sRGB transfer function
- Palette matching still works (palette colors need P3 equivalents though)

**Browser support:**
- Chrome 94+, Safari 15.2+: `canvas.getContext('2d', { colorSpace: 'display-p3' })`
- Firefox: not supported (as of 2026) — fallback to sRGB gracefully
- Feature detection: `canvas.getContext('2d', { colorSpace: 'display-p3' })` returns null if unsupported

### 2. Perceptual color processing (Lab-space dithering)

**What changes:**
- Error diffusion computes and distributes error in Lab space, not RGB
- Ordered dithering thresholds against L (lightness) channel
- Color averaging (halftone, pixelate) computed in Lab

**What this requires:**
- Convert entire pixel buffer sRGB → Lab before filter processing
- Filter operates on Lab values (L: 0-100, a: -128 to 127, b: -128 to 127)
- Convert Lab → sRGB after processing
- Internal data representation changes from `Uint8ClampedArray` to `Float32Array` (Lab values are floating point, signed)

**Impact on filter code:**
- Significant — every filter that reads `buf[i]` as 0-255 unsigned now reads floating point signed values
- Error diffusion error calculation becomes more accurate but needs float precision
- Palette `getColor` needs to operate in Lab (already supported via `LAB_NEAREST`)

## Design

### Phase A: Wide gamut canvas (lower effort, high value)

Add P3 color space to canvas creation. This is a mostly-transparent change — filter code doesn't need modification since it still operates on 0-255 buffers.

```javascript
// src/utils/index.js
export const canvasColorSpace = (() => {
  try {
    const test = document.createElement('canvas');
    const ctx = test.getContext('2d', { colorSpace: 'display-p3' });
    return ctx ? 'display-p3' : 'srgb';
  } catch {
    return 'srgb';
  }
})();

export const cloneCanvas = (input, withData) => {
  const canvas = document.createElement('canvas');
  // ...existing logic...
  const ctx = canvas.getContext('2d', { colorSpace: canvasColorSpace });
  // ...
};
```

Update all `getContext('2d')` calls across the codebase to use `{ colorSpace: canvasColorSpace }`.

**Palette consideration:** Built-in palettes (CGA, EGA, NES, etc.) are defined in sRGB. When the working space is P3, palette colors should be interpreted as sRGB-within-P3 (the values are the same, the gamut just doesn't clip). No conversion needed — sRGB is a subset of P3.

**WASM consideration:** The `rgba2laba` WASM module uses sRGB primaries for the XYZ matrix. For P3 input, this produces slightly wrong Lab values. Options:
- Accept the small error (P3 primaries are close to sRGB)
- Add a P3 XYZ matrix to the WASM module
- Do Lab conversion in JS only when in P3 mode

### Phase B: Perceptual Lab-space processing (higher effort, specialized value)

This is a deeper change. Two approaches:

**B1: Lab-space error diffusion only**

Only convert to Lab for the error diffusion step. This is where perceptual uniformity matters most. Other filters stay in RGB.

```javascript
// In errorDiffusingFilterFactory.js
const labBuf = new Float32Array(buf.length);
for (let i = 0; i < buf.length; i += 4) {
  const lab = rgba2laba([buf[i], buf[i+1], buf[i+2], buf[i+3]]);
  labBuf[i] = lab[0]; labBuf[i+1] = lab[1]; labBuf[i+2] = lab[2]; labBuf[i+3] = lab[3];
}
// ... diffuse in Lab space ...
// Convert back to RGB for output
```

Performance concern: `rgba2laba` per pixel is expensive (XYZ conversion involves pow). For a 1920x1080 image that's 2M conversions each way. WASM version helps but still ~50ms. Acceptable for single-shot filtering, marginal for video.

**B2: Full Lab pipeline**

All affected filters operate in Lab space. Requires rewriting filter internals to handle float arrays and signed values. This is a large effort with limited return beyond B1 — most visual improvement comes from Lab error diffusion specifically.

**Recommendation:** Phase A first (easy win), then B1 (Lab error diffusion) if the quality improvement justifies the performance cost. B2 is probably not worth it.

## Implementation Plan

### Phase A: Wide gamut

1. Add `canvasColorSpace` detection to utils
2. Update `cloneCanvas` to use detected color space
3. Audit and update all `getContext('2d')` calls (in filters, App component, FilterContext)
4. Test: load a P3 image, verify colors aren't clamped by comparing canvas pixel values against source
5. Add color space indicator to UI (show "P3" or "sRGB" somewhere)

### Phase B1: Lab error diffusion

1. Add `labifyBuffer` / `delabifyBuffer` utility functions (bulk sRGB → Lab → sRGB via WASM)
2. Modify error diffusion factory to optionally operate in Lab space
3. Add global toggle: "Perceptual dithering (Lab)" or fold into existing linearize toggle as a 3-way option:
   - sRGB (raw) — legacy behavior
   - Linear RGB — plan-002
   - Lab — perceptually uniform
4. Performance benchmark: measure Lab conversion cost for typical image sizes
5. Visual comparison: error diffusion on smooth gradients in RGB vs Lab

## Dependencies

- Phase A has no dependencies — can be done independently
- Phase B1 depends on plan-002 (linearization) being complete, since Lab conversion includes linearization as a sub-step
- Phase B1 benefits from WASM `rgba2laba` for performance

## Browser Support Matrix

| Feature | Chrome | Safari | Firefox |
|---------|--------|--------|---------|
| P3 canvas | 94+ | 15.2+ | No |
| P3 CSS colors | 111+ | 15.4+ | 113+ |
| Wide gamut images | Yes | Yes | Yes |

Fallback: detect P3 support at startup. If unsupported, stay in sRGB. No degradation — the app works exactly as it does today.
