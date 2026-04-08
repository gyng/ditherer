# Plan 005 — Realtime Video Performance

**Goal:** Reduce per-frame latency so realtime video filtering runs at or near 30fps for typical image sizes (≤720p).

---

## Current Bottlenecks

### Per-frame allocations (all on main thread)

| Allocation | Where | Size (720p) |
|---|---|---|
| `cloneCanvas()` — new HTMLCanvasElement | every filter | — |
| `getImageData()` — Uint8ClampedArray | every filter | ~4MB |
| `srgbBufToLinearFloat()` — Float32Array | linearized path | ~16MB |
| error buffer `Array.from(…)` | errorDiffuse | ~4MB |
| `new ImageData(…)` wrapper | every filter | negligible |
| `canvas.toBlob()` → Image.src → LOAD_IMAGE | FilterContext | encodes entire frame |

### Main thread blocking

`requestAnimationFrame → toBlob → Image.onload → dispatch(LOAD_IMAGE) → filter() → putImageData()` is entirely synchronous. Any filter exceeding ~16ms drops a frame.

### Hot loop per-pixel allocations

- `errorDiffusingFilterFactory`: creates `[errBuf[i], errBuf[i+1], errBuf[i+2], errBuf[i+3]]` array per pixel
- `convolve`: 4-element array literals in triple-nested loop
- No buffer reuse between frames

### Video frame pipeline overhead

`canvas.toBlob()` compresses to PNG/JPEG and back before processing. Unnecessary encode/decode round-trip every frame.

---

## Profiling / Benchmarking Harness

Before optimising, establish a reproducible baseline.

### Phase 1 — Benchmarking harness

**1a. Synthetic filter benchmark (Vitest)**

Create `test/perf/filterBench.ts`. For each major filter:
- Allocate a fixed 640×480 canvas filled with noise
- Run filter 30 iterations (warmup 5, measure 25)
- Report median ms/frame and MB/s throughput
- Assert p95 < threshold (start with a generous threshold, tighten later)

```ts
// test/perf/filterBench.ts
import { bench, describe } from 'vitest';
import errorDiffuse from 'src/filters/errorDiffusingFilterFactory';
// …one bench() per filter
```

**1b. Frame pipeline benchmark**

Measure the full `loadFrame → LOAD_IMAGE → filter → putImageData` cycle:
- Use a static video element (loop a 1-second MP4)  
- Record `performance.now()` at RAF start and after `putImageData`
- Log rolling 60-frame window of frame times to console
- Expose as a debug flag: `?perf=1` in URL enables the overlay

**1c. Allocation profiling**

Use Chrome DevTools Memory tab with `?perf=1` active. Baseline heap growth rate before any optimisation. Re-measure after each phase.

---

## Optimisation Phases

### Phase 2 — Eliminate toBlob round-trip

**Problem:** `FilterContext.tsx` line 45 calls `canvas.toBlob()` to create an Image for LOAD_IMAGE. This encodes and decodes the frame unnecessarily.

**Fix:** Pass the raw canvas directly instead of converting to blob. Change LOAD_IMAGE to accept `HTMLCanvasElement | HTMLImageElement`. Filters already receive a canvas — skip the Image intermediary entirely for video frames.

```ts
// Before
canvas.toBlob(blob => {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  img.onload = () => dispatch({ type: 'LOAD_IMAGE', image: img, … });
});

// After
dispatch({ type: 'LOAD_IMAGE', image: canvas, … });
```

Expected gain: eliminates ~1–5ms encode/decode per frame and one async hop.

### Phase 3 — Buffer pooling

**Problem:** Every filter allocates fresh Uint8ClampedArray, Float32Array, and HTMLCanvasElement per frame.

**Fix:** Create a `FrameBufferPool` in `src/utils/frameBufferPool.ts`:
- Pool of 2 canvases per size (input + output, double-buffered)
- Pool of Float32Array per size
- `acquire(width, height)` / `release(buf)` API
- Resets buffer content but doesn't reallocate

Apply to:
- `cloneCanvas()` — return pooled canvas
- `srgbBufToLinearFloat()` — accept optional output Float32Array
- Error buffer in `errorDiffusingFilterFactory` — reuse across frames

### Phase 4 — Eliminate per-pixel allocations in hot loops

**errorDiffusingFilterFactory:**
- Replace `[errBuf[i], errBuf[i+1], errBuf[i+2], errBuf[i+3]]` array with 4 scalar locals
- Replace error array subtraction with 4 scalar delta computations
- Replace error kernel accumulation with unrolled writes for common kernels (Floyd-Steinberg is 4 neighbours — unroll completely)

**convolve:**
- Replace 4-element array literals with 4 scalar accumulators
- Pre-flatten the kernel to a Float32Array before the hot loop

Expected gain: reduces GC pressure significantly; avoids allocation stalls.

### Phase 5 — Web Worker offload

**Problem:** All filter work blocks the main thread.

**Fix:** Move filter execution to a Worker.
- `src/workers/filterWorker.ts` receives `{ imageData, filterName, options }` via postMessage with `Transferable` (transfers ImageData buffer — zero copy)
- Worker runs filter, posts back result ImageData
- Main thread puts result to output canvas

Start with error-diffusion (slowest). Other filters can follow.

**Constraint:** WASM module must be re-initialized in worker context. `rgba2laba_bg.wasm` supports this.

### Phase 6 — OffscreenCanvas for output

Once Worker is in place, pass an OffscreenCanvas to the worker so it can `putImageData` directly without transferring data back to main thread.

---

## Success Criteria

| Metric | Baseline (measure first) | Target |
|---|---|---|
| Floyd-Steinberg 640×480 | TBD | < 16ms |
| Floyd-Steinberg 1280×720 | TBD | < 33ms |
| Frame pipeline overhead (no filter) | TBD | < 2ms |
| Heap growth rate (60s video) | TBD | < 10MB/min |

---

## Implementation Order

1. **Phase 1** (harness) — do this first, before any code changes
2. **Phase 2** (toBlob) — high reward, 2–3 lines changed
3. **Phase 4** (hot loop scalars) — high reward, low risk
4. **Phase 3** (buffer pooling) — moderate complexity, good reward
5. **Phase 5** (Worker) — high complexity, highest reward
6. **Phase 6** (OffscreenCanvas) — polish

Do not skip Phase 1. Optimising without a baseline is guessing.
