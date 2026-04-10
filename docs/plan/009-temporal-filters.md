# Plan 009 — Temporal Filters

**Goal:** Create video-aware filters that respond to motion, accumulate over time, or blend across frames. The temporal pipeline (`_prevInput`, `_prevOutput`, `_ema`) is implemented and proven by Matrix Rain's motion-reactive mode.

---

## Pipeline (implemented)

Every filter receives these temporal options during animation:

| Option | Type | Description |
|---|---|---|
| `_prevInput` | `Uint8ClampedArray \| null` | Previous frame's input pixels for this filter's chain position |
| `_prevOutput` | `Uint8ClampedArray \| null` | Previous frame's output pixels from this filter |
| `_ema` | `Float32Array \| null` | Exponential moving average of input pixels (α=0.1, ~10 frame window) |
| `_frameIndex` | `number` | Global frame counter |
| `_isAnimating` | `boolean` | Whether animation loop is active |

**Motion detection pattern** (used by Matrix Rain):
```ts
// Per-pixel: how much this pixel differs from the running average
const motion = Math.abs(currentPixel - ema[i]) / 255;  // 0 = static, 1 = max change
```

**Frame differencing pattern** (used by datamosh):
```ts
// Per-pixel: did this pixel change since last frame?
const changed = Math.abs(input[i] - prevInput[i]) > threshold;
```

**Temporal accumulation pattern** (new):
```ts
// Blend current output with previous output for persistence
output[i] = prevOutput[i] * decay + current[i] * (1 - decay);
```

---

## Existing Temporal Filters

These already use `_prevOutput` or `_frameIndex`:

| Filter | Temporal Feature |
|---|---|
| **Datamosh** | Frame differencing — freezes unchanged blocks, displaces changed ones |
| **Cellular Automata** | `_prevOutput` as cell state for Conway's Game of Life |
| **Reaction-Diffusion** | `_prevOutput` encodes chemical concentrations across frames |
| **Matrix Rain** | `_ema` for motion-reactive rain, `_frameIndex` for animation |
| **E-ink** | `_prevOutput` for partial refresh simulation |
| **VHS** | `_prevOutput` for tracking line persistence |
| **Oscilloscope** | `_prevOutput` for waveform persistence (phosphor decay) |

---

## New Filters

### 1. Motion Detect
**Category:** Simulate | **Difficulty:** Low (~40 lines)

Visualize motion as bright pixels on dark background. Useful for debugging, security camera aesthetic, or as a chain input for other effects.

**Options:**
- `threshold` (0–50, default 10) — minimum pixel difference to register
- `colorMode` — White-on-black, Heatmap (cold→hot), or Source (show moving pixels in original color)
- `showEma` (bool) — toggle showing the background model instead of motion

**Implementation:**
```ts
const diff = abs(buf[i] - ema[i]);
const motion = diff > threshold ? Math.min(1, diff / 80) : 0;
// White-on-black: output = motion * 255
// Heatmap: map motion to blue→red gradient
// Source: output = motion > 0 ? buf[i] : 0
```

**Chain opportunities:** Motion Detect → Bloom → Color shift creates a "heat vision" effect.

---

### 2. Long Exposure / Light Trails
**Category:** Simulate | **Difficulty:** Low (~35 lines)

Simulate long exposure photography. Bright pixels accumulate and persist across frames. Moving lights leave trails, stars streak, headlights blur.

**Options:**
- `decay` (0.01–0.3, default 0.05) — how fast trails fade (lower = longer trails)
- `mode` — Max (keep brightest), Additive (accumulate), Average (running mean)
- `brightnessThreshold` (0–255, default 50) — only accumulate pixels above this luminance

**Implementation:**
```ts
// Max mode: keep the brighter of prev and current
out[i] = Math.max(prevOutput[i] * (1 - decay), buf[i]);
// Additive: accumulate light
out[i] = Math.min(255, prevOutput[i] * (1 - decay) + buf[i] * 0.3);
```

**Chain opportunities:** Neon edge detection → Long Exposure creates light painting. Starfield generation → Long Exposure creates star trails.

---

### 3. Frame Blend / Echo
**Category:** Blur & Edges | **Difficulty:** Low (~30 lines)

Smooth temporal blend between frames. Creates motion blur for video, ghosting/echo for animation. Simple but dramatically different from spatial blur.

**Options:**
- `blendFactor` (0.1–0.95, default 0.7) — weight of previous frame (higher = longer echo)

**Implementation:**
```ts
out[i] = prevOutput[i] * blendFactor + buf[i] * (1 - blendFactor);
```

**Note:** Distinct from spatial Gaussian blur. This is purely temporal — a static image produces no effect, only movement creates blur.

---

### 4. Background Subtraction
**Category:** Color | **Difficulty:** Low (~40 lines)

Remove the static background and keep only moving foreground. Virtual green screen without a green screen.

**Options:**
- `threshold` (5–80, default 20) — pixel difference to classify as foreground
- `background` — Transparent, Solid color, or Blurred source
- `feather` (0–20, default 5) — soft edge around foreground mask

**Implementation:**
```ts
const diff = (abs(buf[i]-ema[i]) + abs(buf[i+1]-ema[i+1]) + abs(buf[i+2]-ema[i+2])) / 3;
const mask = smoothstep(threshold - feather, threshold + feather, diff);
out[i] = buf[i] * mask + bgColor * (1 - mask);
```

**Chain opportunities:** Background Subtraction → Pixelate creates a "moving subject only" pixel art effect.

---

### 5. Slit Scan
**Category:** Distort | **Difficulty:** Medium (~80 lines)

Each column (or row) shows a different point in time. Creates surreal temporal stretching — a person walking past becomes a smeared horizontal band. Made famous by 2001: A Space Odyssey stargate sequence.

**Options:**
- `direction` — Horizontal (columns = time slices) or Vertical (rows = time slices)
- `depth` (2–60, default 30) — how many frames of history to scan across
- `reverse` (bool) — flip the time direction

**Implementation:** Module-level ring buffer of N column/row slices. Each frame, push the latest column/row. Output assembles column i from frame (current - i * depth/W).

**State:** Requires a ring buffer stored outside the filter function (module-level), since `_prevOutput` only gives one frame back. Approximately `W * H * 4 * depth` bytes for column mode — at 640×480×30 frames ≈ 37MB. Consider downsampling or limiting depth for large images.

---

### 6. Temporal Dither
**Category:** Dithering | **Difficulty:** Medium (~50 lines)

Distribute dithering noise across time. Each frame uses a different phase of the ordered dither threshold map. Over N frames, the temporal average converges to the true color — achieving higher perceived color depth than any single frame.

**Options:**
- `phases` (2–8, default 4) — number of temporal phases in the cycle
- Inherits ordered dither options (threshold map, levels, palette)

**Implementation:**
```ts
// Offset the threshold map by frameIndex
const phase = _frameIndex % phases;
const offsetX = phase * (thresholdMapWidth / phases);
// Apply ordered dither with shifted threshold...
```

**Note:** Most effective for video or animated playback. On a static image with animation, it creates a subtle shimmer that resolves to the true color perceptually. This is the technique used by 1-bit displays (e.g., Playdate) to achieve grayscale.

---

### 7. Freeze Frame Glitch
**Category:** Glitch | **Difficulty:** Low (~35 lines)

Random rectangular regions freeze in time while the rest of the image continues. Creates a broken-buffer, corrupted-VRAM aesthetic different from datamosh (which displaces blocks).

**Options:**
- `blockSize` (8–64, default 24) — size of frozen blocks
- `freezeChance` (0–0.5, default 0.1) — probability per block per frame of freezing
- `thawRate` (0.01–0.2, default 0.05) — probability of a frozen block unfreezing

**Implementation:** Maintain a grid of freeze flags (module-level). Each frame, randomly freeze new blocks and thaw old ones. Frozen blocks output `_prevOutput` pixels; unfrozen blocks output current filtered pixels.

---

### 8. Time Mosaic
**Category:** Stylize | **Difficulty:** Medium (~60 lines)

Divide the image into a grid of tiles. Each tile updates at a different rate — some show the current frame, others are delayed by 1–N frames. Creates a staggered, surveillance-wall look where parts of the image are out of sync.

**Options:**
- `tileSize` (8–64, default 24) — tile dimensions
- `maxDelay` (2–30, default 10) — maximum frame delay for any tile
- `pattern` — Random, Checkerboard, Radial (center is live, edges delayed)

**Implementation:** Per-tile delay assigned deterministically. Store a ring buffer of `maxDelay` frames (or just the EMA at different alphas). Each tile reads from `_prevOutput` offset by its delay, or maintains a per-tile mini-buffer.

---

### 9. Phosphor Decay
**Category:** Simulate | **Difficulty:** Low (~40 lines)

Simulate CRT phosphor persistence — bright pixels glow and fade slowly, leaving colored afterimages. Different from generic echo because each RGB channel decays at a different rate (matching real P22 phosphors: green lingers longest, blue fades fastest).

**Options:**
- `redDecay` (0.01–0.3, default 0.15) — red channel persistence
- `greenDecay` (0.01–0.3, default 0.05) — green channel persistence (slowest)
- `blueDecay` (0.01–0.3, default 0.2) — blue channel persistence (fastest)

**Implementation:**
```ts
outR = Math.max(buf[i], prevOutput[i] * (1 - redDecay));
outG = Math.max(buf[i+1], prevOutput[i+1] * (1 - greenDecay));
outB = Math.max(buf[i+2], prevOutput[i+2] * (1 - blueDecay));
```

**Chain opportunities:** CRT emulation → Phosphor Decay → Scanline for authentic retro monitor feel.

---

### 10. Motion Heatmap
**Category:** Simulate | **Difficulty:** Low (~45 lines)

Accumulate motion over time into a persistent heatmap. Unlike Motion Detect (which shows instantaneous motion), this builds up — areas with sustained or repeated movement glow hotter. Useful for analyzing movement patterns in security footage or dance.

**Options:**
- `accumRate` (0.01–0.2, default 0.05) — how fast heat builds up
- `coolRate` (0.001–0.05, default 0.01) — how fast idle areas cool down
- `colorMap` — Inferno, Viridis, Hot (white-yellow-red-black)

**Implementation:** Maintain a heat buffer in `_prevOutput`. Each frame: `heat = heat * (1 - coolRate) + motion * accumRate`. Map heat to a colormap.

---

### 11. Chronophotography
**Category:** Stylize | **Difficulty:** Medium (~70 lines)

Inspired by Étienne-Jules Marey — overlay multiple exposures of a moving subject, each slightly transparent. Shows the trajectory of motion as a sequence of ghosted copies, like stroboscopic photography.

**Options:**
- `exposures` (3–12, default 6) — number of ghost copies visible
- `interval` (1–10, default 3) — frames between each exposure
- `fadeMode` — Linear (equal opacity), Tail (oldest fades most), Head (newest fades most)

**Implementation:** Ring buffer of N frames at intervals. Composite all frames with decreasing opacity: `alpha[i] = 1 / (exposures - i)`.

---

### 12. Temporal Edge Detection
**Category:** Blur & Edges | **Difficulty:** Low (~35 lines)

Detect edges in time rather than space. Highlights pixels that are changing between frames — moving edges glow while static edges are invisible. The opposite of spatial edge detection.

**Options:**
- `threshold` (5–50, default 15) — minimum temporal change to show
- `accumulate` (bool, default false) — build up edges over time vs instantaneous

**Implementation:**
```ts
const temporalEdge = Math.abs(buf[i] - prevInput[i]);
// Optionally accumulate: edge = prevOutput[i] * 0.9 + temporalEdge * 0.3
```

**Chain opportunities:** Temporal Edge → Bloom creates neon-traced motion outlines.

---

### 13. Video Feedback
**Category:** Advanced | **Difficulty:** Medium (~60 lines)

Simulate pointing a camera at its own monitor. The output feeds back as input, zoomed/rotated slightly, creating infinite recursive tunnels and fractal-like emergent patterns. A classic video art technique from the 1960s–70s (Nam June Paik, Dan Sandin).

**Options:**
- `zoom` (1.01–1.2, default 1.05) — scale factor per feedback iteration
- `rotation` (−10°–10°, default 1°) — rotation per iteration
- `offsetX/Y` (−0.2–0.2, default 0) — translation drift
- `mix` (0.3–0.95, default 0.7) — blend ratio of feedback vs fresh input
- `colorShift` (0–30, default 5) — hue rotation per iteration (creates rainbow spirals)

**Implementation:** Each frame: take `_prevOutput`, apply affine transform (zoom + rotate + translate) via canvas `drawImage` with transform matrix, blend with current input. The transform accumulates naturally through the feedback loop.

**Why it's special:** Unlike other temporal filters, this creates genuine emergent complexity — simple parameters produce wildly unpredictable visuals. Tiny parameter changes dramatically alter the output.

---

### 14. After-Image (Negative Persistence)
**Category:** Simulate | **Difficulty:** Low (~35 lines)

When a bright object moves away, it leaves a complementary-colored ghost — like staring at a light then looking away. Simulates retinal fatigue / cone adaptation.

**Options:**
- `persistence` (0.01–0.2, default 0.05) — how fast the after-image fades
- `strength` (0.5–2, default 1) — intensity of the negative ghost

**Implementation:**
```ts
// After-image is the complement of what was there before
const afterR = (255 - prevOutput[i]) * strength;
// Blend: show current image + lingering after-image of what left
outR = buf[i] + (afterR - buf[i]) * persistence;
```

**Chain opportunities:** Works beautifully with high-contrast filters — Binarize → After-Image creates stark negative echoes.

---

### 15. Motion Pixelate
**Category:** Stylize | **Difficulty:** Low (~40 lines)

Moving areas become pixelated while static areas stay sharp (or vice versa). Creates a privacy/censorship aesthetic where only the moving subject is obscured, or an artistic effect where stillness is rewarded with detail.

**Options:**
- `blockSize` (4–32, default 12) — pixelation level for affected areas
- `invert` (bool, default false) — if true, static areas pixelate instead
- `threshold` (5–50, default 15) — motion threshold

**Implementation:** Compute per-block motion from EMA diff. For blocks exceeding threshold, average all pixels in the block. For blocks below, pass through unchanged.

---

### 16. Wake Turbulence
**Category:** Distort | **Difficulty:** Medium (~70 lines)

Moving objects leave rippling distortion in their wake — like heat shimmer or water disturbance. Static areas are undisturbed, but where something recently moved, the image warps and settles back over several frames.

**Options:**
- `intensity` (1–20, default 8) — max pixel displacement
- `turbulence` (1–5, default 2) — number of noise octaves in the warp
- `settleSpeed` (0.02–0.2, default 0.08) — how fast distortion fades

**Implementation:** Maintain a distortion energy buffer (in `_prevOutput` or module-level). Where EMA detects motion, inject energy. Each frame, energy decays by `settleSpeed`. Displace pixels by energy × sin(position × turbulence) in both axes.

---

### 17. Temporal Color Cycle
**Category:** Color | **Difficulty:** Low (~30 lines)

Hue rotates over time, and moving areas accumulate more rotation than static areas. Static scenes slowly shift through the rainbow; movement creates localized color explosions.

**Options:**
- `baseSpeed` (0–10, default 2) — hue rotation degrees per frame for static areas
- `motionMultiplier` (0–20, default 8) — extra rotation per unit of motion
- `saturationBoost` (0–1, default 0.3) — boost saturation in moving areas

**Implementation:** Convert to HSV, add `baseSpeed + motion * motionMultiplier` to hue, convert back. Moving areas cycle faster, creating rainbow trails while static areas drift slowly.

---

### 18. Optical Flow Visualization
**Category:** Advanced | **Difficulty:** High (~200 lines)

Estimate motion direction and speed per block, visualize as color-coded vectors. Hue encodes direction (red=right, cyan=left, green=down, magenta=up), brightness encodes speed.

**Options:**
- `blockSize` (4–16, default 8) — motion estimation block size
- `searchRange` (1–8, default 4) — pixels to search for matching blocks
- `display` — Color wheel, Arrows, or Streamlines

**Implementation:** Block matching between `_prevInput` and current input — find the displacement that minimizes SAD (sum of absolute differences) for each block. Map displacement vector (dx, dy) to HSV color.

**Performance:** O(W × H × searchRange² / blockSize²). At 640×480, blockSize=8, searchRange=4: ~19k blocks × 81 comparisons = ~1.5M SAD operations. Should be <30ms.

---

## Implementation Order

| Phase | Filter | Effort | Visual Impact | Category |
|---|---|---|---|---|
| **1** | Motion Detect | ~40 lines | High — proves pipeline | Simulate |
| **1** | Long Exposure | ~35 lines | High — dramatic trails | Simulate |
| **1** | Frame Blend | ~30 lines | Medium — temporal blur | Blur & Edges |
| **1** | Temporal Edge | ~35 lines | Medium — motion outlines | Blur & Edges |
| **1** | Phosphor Decay | ~40 lines | Medium — retro CRT | Simulate |
| **2** | Background Subtraction | ~40 lines | High — practical | Color |
| **2** | Freeze Frame Glitch | ~35 lines | Medium — unique glitch | Glitch |
| **2** | Motion Heatmap | ~45 lines | High — analytical | Simulate |
| **3** | Temporal Dither | ~50 lines | Medium — quality | Dithering |
| **3** | Chronophotography | ~70 lines | High — art reference | Stylize |
| **3** | Slit Scan | ~80 lines | High — unique/surreal | Distort |
| **3** | After-Image | ~35 lines | Medium — perceptual | Simulate |
| **3** | Motion Pixelate | ~40 lines | Medium — privacy/art | Stylize |
| **3** | Temporal Color Cycle | ~30 lines | Medium — psychedelic | Color |
| **4** | Time Mosaic | ~60 lines | Medium — surveillance | Stylize |
| **4** | Video Feedback | ~60 lines | Very high — emergent | Advanced |
| **4** | Wake Turbulence | ~70 lines | High — physics feel | Distort |
| **5** | Optical Flow | ~200 lines | High — technical showcase | Advanced |

Phase 1 filters are independent and can be implemented in parallel. Each is self-contained and ≤40 lines.

---

## Presets (to add alongside filters)

| Preset | Chain | Category |
|---|---|---|
| Heat Vision | Motion Detect → Bloom → Color shift | Simulate |
| Light Painting | Edge glow → Long Exposure | Simulate |
| Time Slice | Slit Scan → Sharpen | Distort |
| Ghost | Frame Blend → Bloom | Blur & Edges |
| Security Camera | Grayscale → Motion Detect → Scanline → Film grain | Simulate |
| Virtual Greenscreen | Background Subtraction | Color |
| Retro Monitor | CRT emulation → Phosphor Decay → Scanline | Simulate |
| Motion Neon | Temporal Edge → Bloom → Chromatic aberration | Blur & Edges |
| Stroboscope | Chronophotography → Levels → Bloom | Stylize |
| Activity Map | Motion Heatmap → Bloom | Simulate |
| Infinite Tunnel | Video Feedback → Bloom | Advanced |
| Psychedelic | Temporal Color Cycle → Bloom → Chromatic aberration | Color |
| Censored | Motion Pixelate → Sharpen | Stylize |
| Heat Shimmer | Wake Turbulence → Bloom | Distort |

---

## Open Questions

1. **Slit scan memory** — 37MB ring buffer at 640×480×30 frames. Cap at `depth * W * 4` bytes (column mode) and warn or auto-reduce depth for large images? Or downsample the stored slices?

2. **EMA alpha as a filter option?** — Currently hardcoded at 0.1 in FilterContext. Some filters (e.g., background subtraction) may want a different adaptation rate. Options: (a) keep global, (b) per-filter override via `_emaAlpha` option, (c) filters maintain their own EMA internally. Recommend (a) for now — global alpha is simpler and 0.1 works for most cases.

3. **Temporal filters on static images** — Most temporal filters need animation to be meaningful. Should they show a "start animation" hint when applied to a static image without the anim loop running? Or just render a static pass?
