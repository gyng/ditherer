# Plan 009 — Temporal Filters

**Goal:** Leverage the new `_prevInput`, `_ema`, and `_prevOutput` pipeline to create video-aware filters that respond to motion, accumulate over time, or blend across frames.

## Pipeline (implemented)

Every filter now receives via options during animation:

| Option | Type | Description |
|---|---|---|
| `_prevInput` | `Uint8ClampedArray` | Previous frame's input pixels (for this filter's position in the chain) |
| `_prevOutput` | `Uint8ClampedArray` | Previous frame's output pixels from this filter |
| `_ema` | `Float32Array` | Exponential moving average of input pixels (α=0.1, ~10 frame window) |
| `_frameIndex` | `number` | Global frame counter |
| `_isAnimating` | `boolean` | Whether animation loop is active |

Motion detection pattern:
```ts
const motion = abs(currentPixel - ema[i]) / 255;  // 0 = static, 1 = max change
```

---

## Filter Ideas

### 1. Motion Blur / Echo
**Difficulty:** Low
**Description:** Blend current frame with previous frames for a ghosting/echo trail effect. Pixels that moved leave afterimages.
**Implementation:** Weighted blend of `_prevOutput` and current output. Decay factor controls trail length.

### 2. Motion Detect
**Difficulty:** Low
**Description:** Visualize motion as bright pixels on dark background. Classic security camera motion overlay.
**Implementation:** `abs(input - _ema)` per channel, threshold, output as white-on-black or heatmap.

### 3. Background Subtraction
**Difficulty:** Low
**Description:** Remove static background, keep only moving foreground. Green-screen effect without a green screen.
**Implementation:** Where `abs(input - _ema) < threshold`, output transparent/solid color. Where motion exceeds threshold, output the source pixel.

### 4. Temporal Dither
**Difficulty:** Medium
**Description:** Distribute dither error across time instead of space. Each frame uses a different dither phase, and the temporal average converges to the true color. Works best at high frame rates.
**Implementation:** Use `_frameIndex % N` to offset the dither threshold map. Over N frames, the perceived color is the average.

### 5. Long Exposure
**Difficulty:** Low
**Description:** Simulate long exposure photography — accumulate bright pixels over many frames. Moving lights leave trails, static scenes brighten.
**Implementation:** Max-blend or additive blend with `_prevOutput`. Bright pixels persist, dark pixels fade.

### 6. Optical Flow Visualization
**Difficulty:** High
**Description:** Estimate per-pixel motion vectors between frames, visualize as color-coded arrows or streamlines.
**Implementation:** Block matching between `_prevInput` and current input. Color-code direction (hue) and magnitude (brightness). Expensive but visually striking.

### 7. Frame Differencing Glitch
**Difficulty:** Low
**Description:** Only update pixels that changed — static pixels freeze in place, creating a datamosh-like effect where old frames bleed through.
**Implementation:** If `abs(input - _prevInput) < threshold`, keep `_prevOutput` pixel. Otherwise, output current filter result.

### 8. Slit Scan
**Difficulty:** Medium
**Description:** Each column (or row) shows a different time slice. Creates surreal stretching of moving subjects.
**Implementation:** Store a ring buffer of N columns from previous frames. Assemble output by picking column i from frame (current - i).

---

## Implementation Order

| Filter | Effort | Impact | Dependencies |
|---|---|---|---|
| **Motion Detect** | ~30 lines | High — demonstrates EMA | None |
| **Long Exposure** | ~30 lines | High — visually dramatic | None |
| **Frame Diff Glitch** | ~30 lines | Medium — datamosh aesthetic | None |
| **Background Subtraction** | ~40 lines | High — practical utility | None |
| **Motion Blur / Echo** | ~30 lines | Medium | None |
| **Temporal Dither** | ~50 lines | Medium — quality improvement | Dither filters |
| **Slit Scan** | ~80 lines | High — unique effect | Ring buffer (new state) |
| **Optical Flow** | ~200 lines | High — complex but striking | Block matching |

Start with Motion Detect and Long Exposure — both are trivial to implement and immediately demonstrate the temporal pipeline.
