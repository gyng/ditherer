# Plan 005 — Realtime Video Performance

**Goal:** Reduce per-frame latency so realtime video filtering runs at or near 30 fps for typical input sizes (≤720p). Establish a reproducible benchmark so improvements can be verified.

---

## Root Cause Analysis

### The video frame pipeline (current)

```
RAF → loadFrame() → canvas.drawImage(video)
    → canvas.toBlob()          ← PNG encode, async
        → URL.createObjectURL()
        → new Image().onload   ← PNG decode, async
            → dispatch(LOAD_IMAGE)
                → reducer: filter.func(inputCanvas)  ← synchronous, main thread
                    → cloneCanvas()                  ← new HTMLCanvasElement
                    → getImageData()                 ← new Uint8ClampedArray ~4MB
                    → srgbBufToLinearFloat()         ← new Float32Array ~16MB
                    → Array.from(linearBuf)          ← JS Array copy ~16MB
                    → pixel loop + kernel diffusion  ← O(W×H×K²)
                    → putImageData()
                → state.outputImage = canvas
                    → useEffect redraws output canvas
```

**Every frame** goes through a PNG encode + decode round-trip (`toBlob` / `Image.onload`) with two async hops before any filtering starts. This alone adds 5–20ms on top of filter time.

The filter itself runs synchronously in the reducer, blocking the main thread.

### Per-frame allocations (Floyd-Steinberg at 720p, 1280×720 = 921,600 pixels)

| Allocation | Type | Size |
|---|---|---|
| `cloneCanvas()` | HTMLCanvasElement | — |
| `getImageData()` | Uint8ClampedArray | ~3.5 MB |
| `srgbBufToLinearFloat()` (linear path) | Float32Array | ~14 MB |
| `Array.from(linearBuf)` | JS Array | ~28 MB (boxed) |
| per-pixel `[errBuf[i], …]` array | JS Array | 921,600 × alloc |
| per-pixel `[pixel[0]-color[0], …]` error array | JS Array | 921,600 × alloc |
| `new ImageData(buf, w, h)` | ImageData | negligible |

The JS `Array.from(linearBuf)` in `errorDiffusingFilterFactory.ts:49-50` converts a typed Float32Array into a boxed JS Array. This is the largest single allocation and also the slowest to GC.

### Hot loop micro-allocations (`errorDiffusingFilterFactory.ts:59-61`)

```ts
const pixel = [errBuf[i], errBuf[i+1], errBuf[i+2], errBuf[i+3]]; // alloc every pixel
const color = paletteGetColor(…);                                   // alloc inside
const error = [pixel[0]-color[0], pixel[1]-color[1], …];           // alloc every pixel
```

At 720p this is ~1.8 million small array allocations per frame, creating sustained GC pressure.

Same issue in `convolve.ts:205-224`: `rgba(0,0,0,0)`, `rgba(…)`, `scale()`, `add()` each allocate per pixel-kernel-step.

---

## Phase 1 — Benchmarking Harness

**Do this before any code changes.** Optimising without a baseline is guessing.

### 1a. Synthetic filter benchmark

Create `test/perf/filterBench.ts` using Vitest's `bench()`:

```ts
import { bench, describe } from 'vitest';
import { errorDiffusingFilter } from 'filters/errorDiffusingFilterFactory';
import * as palettes from 'palettes';

// Shared 640×480 noise canvas — allocated once
const makeNoiseCanvas = (w: number, h: number): HTMLCanvasElement => { … };

describe('errorDiffuse 640×480', () => {
  const filter = errorDiffusingFilter('fs', floydSteinberg, { palette: palettes.nearest });
  const input = makeNoiseCanvas(640, 480);
  bench('linear path', () => { filter.func(input, { palette: palettes.nearest, _linearize: true }); });
  bench('sRGB path',   () => { filter.func(input, { palette: palettes.nearest, _linearize: false }); });
});
```

Run with `vitest bench`. Add one `describe` per major filter (convolve, ordered, binarize).

Record baseline numbers **before merging any Phase 2+ changes**.

### 1b. In-browser frame timer

Add a `?perf` URL flag that overlays a rolling frame-time display on the output canvas window. Implementation in `src/components/App/index.tsx`:

- Store a `frameTimesRef = useRef<number[]>([])` ring buffer (last 60 frames)
- Record `performance.now()` before and after `drawToCanvas(outputCanvasRef, …)` in the draw `useEffect`
- Render `<div className={s.perfOverlay}>` showing min/avg/max ms when `?perf` is in the URL

This gives live feedback without opening DevTools.

### 1c. Allocation baseline

With `?perf` active, open Chrome DevTools → Memory → Allocation instrumentation on timeline. Record 10 seconds of video playback. Note heap growth rate (MB/min). Re-measure after each phase.

---

## Phase 2 — Eliminate the toBlob Round-Trip

**File:** `src/context/FilterContext.tsx:39-57`

**Current:** `canvas.drawImage(video) → canvas.toBlob() → URL.createObjectURL → new Image().onload → dispatch(LOAD_IMAGE, image: HTMLImageElement)`

**Problem:** PNG encode + decode + two async hops (~5–20ms) before any filtering. The resulting `Image` is immediately drawn back to the inputCanvas in the reducer anyway.

**Fix:** Dispatch the raw canvas directly. Change `LOAD_IMAGE` to accept `HTMLCanvasElement | HTMLImageElement`.

```ts
// FilterContext.tsx — loadFrame(), new version
const loadFrame = () => {
  if (!video.paused && video.src !== '') {
    ctx.drawImage(video, 0, 0);
    requestAnimationFrame(loadFrame);
    dispatch({ type: 'LOAD_IMAGE', image: canvas, time: video.currentTime, video, dispatch });
  }
};
```

**Reducer change** (`src/reducers/filters.ts:127-133`): `state.inputImage` will now be an `HTMLCanvasElement` when in video mode. Confirm nothing downstream requires `HTMLImageElement` specifically — `drawImage()` accepts both, so canvas drawing is unaffected.

**Expected gain:** Eliminates 5–20ms latency and removes one RAF-to-filter async hop. The pipeline becomes fully synchronous: RAF → dispatch → filter → output.

---

## Phase 3 — Replace JS Array with Float32Array for Error Buffer

**File:** `src/filters/errorDiffusingFilterFactory.ts:48-50`

**Current:**
```ts
const errBuf = useLinear
  ? Array.from(linearBuf)  // JS boxed Array — 28 MB, slow GC
  : Array.from(buf);       // JS boxed Array — 14 MB
```

**Fix:** Use typed arrays throughout.

```ts
const errBuf = useLinear
  ? new Float32Array(linearBuf)  // typed copy — 14 MB, fast, no GC boxing
  : new Float32Array(buf.length); // for sRGB path, keep as float for accumulation
```

For the sRGB non-linear path, also replace `Array.from(buf)` with a typed copy:
```ts
: Float32Array.from(buf);  // or just new Float32Array(buf) which copies
```

This halves the allocation size and eliminates boxed-array GC overhead.

---

## Phase 4 — Eliminate Per-Pixel Array Allocations in Hot Loops

### 4a. errorDiffusingFilterFactory (linear path)

**File:** `src/filters/errorDiffusingFilterFactory.ts:59-61`

**Current:**
```ts
const pixel = [errBuf[i], errBuf[i+1], errBuf[i+2], errBuf[i+3]];
const color = paletteGetColor(palette, pixel, palette.options, true);
const error = [pixel[0]-color[0], pixel[1]-color[1], pixel[2]-color[2], 0];
```

**Fix:** 4 scalar locals, no allocations. Requires `paletteGetColor` to either accept scalars or return a reusable typed buffer. Simplest approach: pass array but use a module-level scratch buffer:

```ts
// module level — allocated once
const _pixelScratch = new Float32Array(4);
const _colorScratch = new Float32Array(4);

// inside loop
_pixelScratch[0] = errBuf[i]; _pixelScratch[1] = errBuf[i+1];
_pixelScratch[2] = errBuf[i+2]; _pixelScratch[3] = errBuf[i+3];
// paletteGetColor needs to write into _colorScratch rather than allocating
const er = _pixelScratch[0] - _colorScratch[0];
const eg = _pixelScratch[1] - _colorScratch[1];
const eb = _pixelScratch[2] - _colorScratch[2];
// use er/eg/eb scalars directly in kernel diffusion
```

`paletteGetColor` in `src/utils/index.ts:99-107` also allocates (calls `linearizeColorF` / `delinearizeColorF`, each returning a new 4-element array). Add an `out: Float32Array` parameter to write into the caller's buffer.

### 4b. errorDiffusingFilterFactory (sRGB path)

**File:** `src/filters/errorDiffusingFilterFactory.ts:88-106`

Replace `rgba()`, `sub()`, `scale()` calls with scalar operations. `addBufferPixel` already writes in-place; the issue is `scale(error, weight)` allocates a temporary array per kernel cell.

Inline as:
```ts
const er = errBuf[i] - color[0], eg = errBuf[i+1] - color[1], eb = errBuf[i+2] - color[2];
for (let h = 0; h < kernelHeight; h++) {
  for (let w = 0; w < kernelWidth; w++) {
    const weight = errorMatrix.kernel[h][w];
    if (weight != null) {
      const ti = getBufferIndex(x + w + errorMatrix.offset[0], y + h + errorMatrix.offset[1], output.width);
      errBuf[ti]   += er * weight;
      errBuf[ti+1] += eg * weight;
      errBuf[ti+2] += eb * weight;
    }
  }
}
```

### 4c. convolve hot loop

**File:** `src/filters/convolve.ts:205-224`

Replace `rgba()`, `scale()`, `add()` calls with 4 scalar accumulators:

```ts
let cr = 0, cg = 0, cb = 0;
for (let kx = 0; …) {
  for (let ky = 0; …) {
    const ki = …;
    const kf = matrix[ky][kx] || 0;
    cr += (floatBuf[ki]   || 0) * kf;
    cg += (floatBuf[ki+1] || 0) * kf;
    cb += (floatBuf[ki+2] || 0) * kf;
  }
}
fillBufferPixel(outFloat, i, cr, cg, cb, floatBuf[i+3]);
```

---

## Phase 5 — Buffer Pooling

After Phases 3–4, the remaining large allocations per frame are:
- `getImageData()` — Uint8ClampedArray (unavoidable; browser API)
- `new Float32Array(buf.length)` for linear/error buffers (poolable)
- `cloneCanvas()` output canvas (poolable)

### Pool design

Create `src/utils/frameBufferPool.ts`:

```ts
// Two-slot pool keyed by byte length
const floatPool = new Map<number, Float32Array[]>();
const canvasPool: HTMLCanvasElement[] = [];

export const acquireFloat = (length: number): Float32Array => {
  const slot = floatPool.get(length);
  return slot?.pop() ?? new Float32Array(length);
};

export const releaseFloat = (buf: Float32Array) => {
  const arr = floatPool.get(buf.length) ?? [];
  arr.push(buf);
  floatPool.set(buf.length, arr);
};

export const acquireCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = canvasPool.pop() ?? document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};

export const releaseCanvas = (c: HTMLCanvasElement) => canvasPool.push(c);
```

Apply in `errorDiffusingFilterFactory` and `cloneCanvas`. Filters must call `releaseCanvas(output)` after their result is consumed — wire this up in the reducer's LOAD_IMAGE handler after `outputImage` is replaced.

**Note:** Only add pooling after confirming Phases 3–4 gains with the benchmark. Pooling adds complexity; it may not be necessary if typed arrays already eliminate GC pressure.

---

## Phase 6 — Web Worker Offload

**Problem:** Filter execution blocks the main thread. At 720p, even a well-optimised Floyd-Steinberg may take 20–40ms.

**Architecture:**

```
Main thread                          Worker
loadFrame()
  → dispatch(LOAD_IMAGE)
      → if realtimeFiltering:
          inputCanvas.getImageData() → ImageData
          worker.postMessage({ imageData, filterName, opts }, [imageData.data.buffer])
                                                          ↑ transfer (zero-copy)
                                         filter(imageData, opts) → outputImageData
          ← postMessage(outputImageData, [outputImageData.data.buffer])
          outputCtx.putImageData(outputImageData)
```

**Files to create:**
- `src/workers/filterWorker.ts` — receives message, imports filter by name, runs it, posts result
- `src/context/workerBridge.ts` — wraps Worker, manages pending requests, exposes `applyFilter(imageData, filterName, opts): Promise<ImageData>`

**Constraints:**
- Worker cannot access the DOM — filters must accept `ImageData` directly rather than `HTMLCanvasElement`. This requires a filter API shim in the worker.
- WASM module (`rgba2laba`) must be re-initialised inside the worker via `?init` import.
- The `canvas.toBlob` fix (Phase 2) is a prerequisite — otherwise frame dispatch is already async and worker benefits are harder to measure.

**Scope:** Start with `errorDiffusingFilter` only. Measure improvement. Extend to `convolve` and other slow filters if needed.

---

## Success Criteria

| Metric | How to measure | Baseline (2026-04-10) |
|---|---|---|
| Floyd-Steinberg 640×480 ms/frame | `vitest bench` | ~48ms (sRGB), ~48ms (linear) |
| Convolve 3×3 640×480 ms/frame | `vitest bench` | ~29ms (sRGB), ~58ms (linear) |
| Ordered Bayer 640×480 ms/frame | `vitest bench` | ~77ms (sRGB) |

---

## Implementation Order

| Phase | Status | Notes |
|---|---|---|
| **1 — Harness** | ✅ Done | `test/perf/filterBench.bench.ts`, `colorDistanceBench.bench.ts`, always-on perf stats in sidebar |
| **2 — toBlob** | ✅ Done | Video frames dispatch canvas directly |
| **3 — Float32 errBuf** | ✅ Done | `errBuf` is `Float32Array`, no boxed JS arrays |
| **4 — Scalar hot loop** | ✅ Done | Scratch buffers + scalar `er/eg/eb`, no per-pixel allocations |
| **5 — Buffer pool** | Skipped | Benchmarks after Phases 3–4 show remaining bottleneck is algorithmic cost, not allocation. Typed arrays eliminated GC pressure. Remaining per-frame allocations are unavoidable (`getImageData`) or cheap (`Float32Array` copy). Worker offload (Phase 6) further isolates GC from the UI thread. |
| **6 — Worker** | ✅ Done | `src/workers/filterWorker.ts` + `workerRPC.ts`, full chain support with main-thread fallback |
