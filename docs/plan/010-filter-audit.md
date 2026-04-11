# Plan 010 — Filter & Preset Audit

**Goal:** Consolidate overlapping filters, fix quality issues, and exploit the temporal pipeline for new filters and presets. The project has ~160 filters and 61 chain presets — this plan identifies concrete improvements ordered by impact/effort.

---

## A. Fixes & Quality Improvements

### A1. Serpentine scanning for error diffusion
**File:** `src/filters/errorDiffusingFilterFactory.ts`
**Problem:** The scan loop (`x=0→W`, `y=0→H`) always processes left-to-right. This causes visible directional banding on smooth gradients — a well-documented artifact of raster-order error diffusion.
**Fix:** On odd rows, iterate `x` from `W-1→0` and mirror the kernel X offsets. Add a `serpentine: true` default option.
**Effort:** ~20 lines changed | **Impact:** High — improves all 11 error-diffusion algorithms at once

### A2. Forward temporal options through error diffusion factory
**File:** `src/filters/errorDiffusingFilterFactory.ts`
**Problem:** The factory ignores `_frameIndex`, `_prevOutput`, and `_ema` from the options object. This blocks temporal dither from being layered into error-diffusion filters (needed for A5).
**Fix:** Forward `options._frameIndex` and `options._prevOutput` to the inner loop. No behavior change unless a temporal option is used.
**Effort:** ~5 lines | **Impact:** Prerequisite for B2

### A3. Brightness/Contrast preset forces palette levels=256
**File:** `src/filters/index.ts:562-576`
**Problem:** The filterList entry for "Brightness/Contrast" overrides palette levels to 256, effectively disabling color quantization. Users who chain this before a dither filter and set a custom palette on it see no effect.
**Fix:** Remove the levels override. If the intent was "no quantization by default", use `levels: 256` only in the defaults of the filter itself, not in the filterList entry.
**Effort:** ~3 lines | **Impact:** Low — correctness fix

### A4. Ordered dither: incorrect levels calculation for named maps
**File:** `src/filters/ordered.ts:313-316`
**Problem:** `levels` falls through to `thresholdMap.length * thresholdMap[0].length` when the selected map is a string key (e.g., `"HATCH_2X2"`). Since strings have `.length`, this produces a wrong number. The `thresholdMaps` lookup at line 329 resolves the actual matrix, but `levels` is already computed from the raw string.
**Fix:** Compute `levels` *after* the `thresholdMaps[thresholdMap]` lookup, from `threshold.levels` or the resolved matrix dimensions.
**Effort:** ~5 lines | **Impact:** Medium — affects all ordered dither when palette has a `levels` config

### A5. VHS temporal drift accumulation
**File:** `src/filters/vhs.ts`
**Problem:** VHS uses `_prevOutput` for line persistence but tracking drift resets every frame. Real VHS tracking errors accumulate and correct over time.
**Fix:** Carry drift offset from `_prevOutput` metadata or a module-level accumulator, add a `trackingDriftSpeed` option. Reset on large corrections (simulating head re-lock).
**Effort:** ~25 lines | **Impact:** Low — polish for an already-good filter

---

## B. New Filters & Enhancements (Temporal Pipeline)

All use the existing `_prevOutput`/`_prevInput`/`_ema`/`_frameIndex` infrastructure. Grouped by theme, priority ordered within each group.

### Temporal Dithering

#### B1. Temporal Dither (ordered)
**Category:** Dithering | **~30 lines** | **Modify:** `src/filters/ordered.ts`

Offset the ordered dither threshold map by `_frameIndex % phases` each frame. Over N frames the temporal average converges to true color — the Playdate / 1-bit display technique. On static images with animation, creates a subtle shimmer that perceptually resolves to higher bit depth.

**Implementation:** Add `temporalPhases` option (2–8, default: off/1) to the existing ordered filter. Offset `tix` by `phase * (mapWidth / phases)`:
```ts
const phase = (_frameIndex || 0) % temporalPhases;
const offsetX = Math.floor(phase * thresholdMapWidth / temporalPhases);
// In the inner loop:
const tix = (x + offsetX) % thresholdMapWidth;
```

Add an `animate` ACTION and `animSpeed` option (same pattern as motionDetect).

**Why it matters:** This is the single most impactful temporal addition. It turns every existing ordered dither preset into a temporal variant for free — Gameboy, PICO-8, Amber CRT, and all 15 threshold maps gain temporal smoothing without new filter code. A 1-bit Bayer dither with 4 temporal phases perceptually renders ~4 gray levels on a static image, ~16 on video.

**Presets:**
| Preset | Config | Category |
|---|---|---|
| Temporal Dither | Ordered (Hatch 2×2) + `temporalPhases: 4` | Dithering |
| Playdate | Ordered (Bayer 4×4) + `temporalPhases: 4` + 1-bit palette | Dithering |
| 1-bit Film | Ordered (Bayer 8×8) + `temporalPhases: 8` + 1-bit palette + Film grain | Dithering |
| Gameboy Temporal | Ordered (Gameboy) + `temporalPhases: 4` + Scanline | Dithering |
| Amber Flicker | Ordered (Amber CRT) + `temporalPhases: 2` + Bloom + Scanline | Dithering |

#### B2. Temporal Error Diffusion
**Category:** Dithering | **~30 lines** | **Modify:** `src/filters/errorDiffusingFilterFactory.ts` (after A2)

Carry residual quantization error across frames. Initialize frame N's error buffer from frame N-1's `_prevOutput` error residual. Over multiple frames, details below the quantization threshold emerge — produces animated dithering where the pattern shifts subtly each frame, resolving to the source more accurately than any single frame.

**Implementation:** If `_prevOutput` exists and `temporalBleed` option is > 0:
```ts
// Before the main loop: seed errBuf with residual from previous frame
if (prevOutput && temporalBleed > 0) {
  for (let i = 0; i < errBuf.length; i += 4) {
    errBuf[i]     += (buf[i] - prevOutput[i]) * temporalBleed;
    errBuf[i + 1] += (buf[i + 1] - prevOutput[i + 1]) * temporalBleed;
    errBuf[i + 2] += (buf[i + 2] - prevOutput[i + 2]) * temporalBleed;
  }
}
```

Add `temporalBleed` (0–1, default 0) and `animate`/`animSpeed` options to the factory's `optionTypes`.

**Why it matters:** Like B1, this turns all 11 error-diffusion algorithms into temporal variants. Atkinson on a 1-bit palette with `temporalBleed: 0.5` produces a living, breathing dither pattern that's fundamentally different from any static frame. The classic Mac dithering aesthetic becomes animated.

**Extension note:** If we add temporal decision stabilization beyond residual carryover, it should live here rather than as a standalone `Frame Vote Dither` filter. A vote-based mode belongs to the same user mental model as `temporalBleed`: temporal behavior inside the existing error-diffusion family.

Recommended shape for a later extension:
- add `temporalMode: "off" | "bleed" | "vote"` to the factory
- keep `temporalBleed` as the control for `bleed`
- add `voteWindow` (and only if needed `voteThreshold`) for `vote`

This keeps the filter list smaller and lets users compare temporal carryover vs temporal consensus within the same diffusion algorithms instead of splitting them into separate top-level filters.

`Frame Vote Dither` should therefore be treated as a named temporal mode inside error diffusion, not as its own filter. Product intent:

- `bleed` = living / breathing dither with residual carryover
- `vote` = more stable / consensus-driven dither with reduced shimmer

This is still an active idea, just scoped as an enhancement to the existing diffusion family.

**Presets:**
| Preset | Config | Category |
|---|---|---|
| Temporal Floyd-Steinberg | Floyd-Steinberg + `temporalBleed: 0.5` | Dithering |
| Temporal Atkinson | Atkinson + `temporalBleed: 0.3` | Dithering |
| Living Mac | Atkinson + `temporalBleed: 0.5` + 1-bit palette | Dithering |
| Breathing Dither | Jarvis + `temporalBleed: 0.7` + Gameboy palette | Dithering |

### Motion Analysis

#### B3. Background Subtraction
**Category:** Color | **~40 lines** | **New file:** `src/filters/backgroundSubtraction.ts`

Remove the static background using EMA, keep only the moving foreground. Virtual green screen without a green screen. Practical for video calls, creative compositing, and as a chain input (e.g., subtract background → dither only the subject).

**Options:**
- `threshold` (5–80, default 20) — pixel difference to classify as foreground
- `background` ENUM: Transparent, Solid color, Blurred source
- `bgColor` COLOR (when Solid): default black
- `feather` (0–20, default 5) — soft edge around foreground mask

**Implementation:**
```ts
const diff = (abs(buf[i]-ema[i]) + abs(buf[i+1]-ema[i+1]) + abs(buf[i+2]-ema[i+2])) / 3;
const mask = smoothstep(threshold - feather, threshold + feather, diff);
outR = buf[i] * mask + bgR * (1 - mask);
// alpha channel: mask * 255 when background=transparent
```

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Virtual Greenscreen | Background Subtraction (transparent) | Color |
| Moving Subject Only | Background Subtraction → Pixelate | Stylize |
| Subject Dither | Background Subtraction → Floyd-Steinberg | Dithering |
| Ghost Subject | Background Subtraction → Frame blend → Bloom | Simulate |

#### B4. Motion Heatmap
**Category:** Simulate | **~45 lines** | **New file:** `src/filters/motionHeatmap.ts`

Accumulate motion over time into a persistent heatmap. Unlike Motion Detect (which shows instantaneous motion), this builds up — areas with sustained or repeated movement glow progressively hotter. Useful for analyzing movement patterns, dance visualization, or security aesthetics.

**Options:**
- `accumRate` (0.01–0.2, default 0.05) — how fast heat builds from motion
- `coolRate` (0.001–0.05, default 0.01) — how fast idle areas cool down
- `colorMap` ENUM: Inferno (black→red→yellow→white), Viridis (purple→green→yellow), Hot (black→red→white)

**Implementation:** Encode heat in `_prevOutput` red channel (0–255 mapped to 0.0–1.0 heat). Each frame:
```ts
const motion = (abs(buf[i]-ema[i]) + abs(buf[i+1]-ema[i+1]) + abs(buf[i+2]-ema[i+2])) / 3 / 255;
const prevHeat = prevOutput ? prevOutput[i] / 255 : 0;
const heat = Math.min(1, prevHeat * (1 - coolRate) + motion * accumRate);
// Map heat through chosen colormap
```

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Activity Map | Motion Heatmap (Inferno) → Bloom | Simulate |
| Traffic Flow | Motion Heatmap (Viridis) → Scanline | Simulate |
| Dance Map | Motion Heatmap (Hot) → Bloom → Chromatic aberration | Advanced |

### Temporal Glitch & Distortion

#### B5. Video Feedback
**Category:** Advanced | **~60 lines** | **New file:** `src/filters/videoFeedback.ts`

Simulate pointing a camera at its own monitor. The output feeds back as input, zoomed/rotated slightly, creating infinite recursive tunnels and fractal-like emergent patterns. Classic video art technique from the 1960s–70s (Nam June Paik, Dan Sandin). Unlike other temporal filters, this creates genuine emergent complexity — simple parameter changes produce wildly different outputs.

**Options:**
- `zoom` (1.01–1.2, default 1.05) — scale factor per feedback iteration
- `rotation` (−10°–10°, default 1°) — rotation per iteration
- `offsetX` (−0.2–0.2, default 0) — horizontal drift as fraction of width
- `offsetY` (−0.2–0.2, default 0) — vertical drift
- `mix` (0.3–0.95, default 0.7) — blend ratio of feedback vs fresh input
- `colorShift` (0–30, default 5) — hue rotation degrees per iteration (creates rainbow spirals)

**Implementation:** Each frame:
1. Create scratch canvas, draw `_prevOutput` with `ctx.setTransform()` applying zoom + rotation + translation
2. Read the transformed pixels
3. Hue-rotate if `colorShift > 0`: `h = (h + colorShift) % 360`
4. Blend: `out = feedback * mix + input * (1 - mix)`

The transform accumulates naturally through the feedback loop — each frame's output becomes the next frame's input, so zoom compounds exponentially and rotation spirals.

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Infinite Tunnel | Video Feedback (zoom 1.05, rot 1°) → Bloom | Advanced |
| Kaleidoscope Spiral | Video Feedback (zoom 1.03, rot 5°, colorShift 10) → Bloom | Advanced |
| Fractal Zoom | Video Feedback (zoom 1.1, rot 0°, mix 0.9) → Sharpen | Advanced |
| Rainbow Vortex | Video Feedback (zoom 1.02, rot 3°, colorShift 20) → Bloom → Chromatic aberration | Advanced |

#### B6. Freeze Frame Glitch
**Category:** Glitch | **~35 lines** | **New file:** `src/filters/freezeFrameGlitch.ts`

Random rectangular regions freeze in time while the rest of the image continues. Frozen blocks show `_prevOutput` pixels; unfrozen blocks pass through current. Creates a broken-buffer, corrupted-VRAM aesthetic distinct from datamosh (which displaces blocks) and glitch blocks (which are spatial-only).

**Options:**
- `blockSize` (8–64, default 24) — dimensions of freeze grid cells
- `freezeChance` (0–0.5, default 0.1) — probability per block per frame of freezing
- `thawRate` (0.01–0.2, default 0.05) — probability of a frozen block unfreezing each frame
- `channelIndependent` BOOL (default false) — freeze R/G/B channels independently for color-split glitches

**Implementation:** Module-level `Uint8Array` grid of freeze flags (one per block). Each frame:
```ts
const rng = mulberry32(frameIndex * 7919);
for (let b = 0; b < totalBlocks; b++) {
  if (freezeGrid[b] && rng() < thawRate) freezeGrid[b] = 0;
  else if (!freezeGrid[b] && rng() < freezeChance) freezeGrid[b] = 1;
}
// Per pixel: frozen → copy prevOutput, unfrozen → copy current
```

With `channelIndependent: true`, maintain 3 separate freeze grids — a block might have frozen red but live green/blue, creating color-separation artifacts.

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Frozen Glitch | Freeze Frame Glitch | Glitch |
| Color Freeze | Freeze Frame Glitch (channelIndependent) → Chromatic aberration | Glitch |
| Glitch Tape | Freeze Frame Glitch → VHS emulation → Scanline | Glitch |
| Corrupted Memory | Freeze Frame Glitch → Bit crush → JPEG artifact | Glitch |

#### B7. Slit Scan
**Category:** Distort | **~80 lines** | **New file:** `src/filters/slitScan.ts`

Each column (or row) shows a different point in time. A person walking past becomes a smeared horizontal band. Made famous by 2001: A Space Odyssey's stargate sequence and by smartphone panorama glitches.

**Options:**
- `direction` ENUM: Horizontal (columns = time slices), Vertical (rows = time slices)
- `depth` (2–60, default 30) — how many frames of history to scan across
- `reverse` BOOL (default false) — flip the time direction
- `scanLine` ENUM: Center, Left/Top, Right/Bottom — which column/row captures the live slice

**Implementation:** Module-level ring buffer of column/row slices. Each frame:
1. Extract the `scanLine` column/row from current input, push into ring buffer
2. Assemble output: column `i` reads from ring buffer entry `(current - i * depth/W)`
3. Memory: `depth × columnHeight × 4` bytes in column mode. Auto-cap depth at `40MB / (H × 4)`.

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Time Slice | Slit Scan (H, depth 30) → Sharpen | Distort |
| Panorama Glitch | Slit Scan (H, depth 60) → JPEG artifact | Glitch |
| Temporal Smear | Slit Scan (V, depth 20) → Bloom | Distort |
| Stargate | Slit Scan (H, depth 40) → Chromatic aberration → Bloom | Advanced |

#### B8. Wake Turbulence
**Category:** Distort | **~70 lines** | **New file:** `src/filters/wakeTurbulence.ts`

Moving objects leave rippling distortion in their wake — like heat shimmer or water disturbance behind a jet. Static areas are undisturbed, but where something recently moved, the image warps and settles back over several frames.

**Options:**
- `intensity` (1–20, default 8) — max pixel displacement
- `turbulence` (1–5, default 2) — noise octaves in the warp
- `settleSpeed` (0.02–0.2, default 0.08) — how fast distortion fades after motion stops

**Implementation:** Encode distortion energy in `_prevOutput` alpha channel (or a separate Float32 stored in module-level state). Where EMA detects motion, inject energy. Each frame: energy decays by `settleSpeed`. Displace pixels by `energy × sin(position × turbulence × frameIndex)` in both axes.

```ts
const motion = abs(buf[i] - ema[i]) / 255;
const prevEnergy = prevOutput ? prevOutput[i + 3] / 255 : 0;
const energy = Math.min(1, prevEnergy * (1 - settleSpeed) + motion * 0.5);
const dx = Math.round(energy * intensity * Math.sin(x * turbulence * 0.1 + frameIndex * 0.3));
const dy = Math.round(energy * intensity * Math.cos(y * turbulence * 0.1 + frameIndex * 0.2));
// Sample from (x + dx, y + dy) with bounds clamping
```

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Heat Shimmer | Wake Turbulence (intensity 5, settle 0.04) → Bloom | Distort |
| Motion Ripple | Wake Turbulence (intensity 15, turbulence 4) | Distort |
| Underwater | Wake Turbulence → Chromatic aberration → Bloom | Simulate |

### Temporal Accumulation & Persistence

#### B9. Chronophotography
**Category:** Stylize | **~70 lines** | **New file:** `src/filters/chronophotography.ts`

Overlay multiple exposures of a moving subject, each slightly transparent — Étienne-Jules Marey's stroboscopic photography. Shows the trajectory of motion as a sequence of ghosted copies. Different from Frame Blend (which averages all frames into mush) — this keeps each exposure distinct and sharp.

**Options:**
- `exposures` (3–12, default 6) — number of ghost copies visible
- `interval` (1–10, default 3) — frames between each exposure capture
- `fadeMode` ENUM: Linear (equal opacity), Tail (oldest fades most), Head (newest fades most)
- `isolateSubject` BOOL (default false) — only show the moving parts of each exposure (uses EMA diff to mask out static background)

**Implementation:** Module-level ring buffer of `exposures` full frames captured at `interval`-frame spacing. Composite all frames with mode-dependent alpha:
```ts
// Ring buffer: frames[0] = oldest, frames[n-1] = newest
for (let f = 0; f < exposures; f++) {
  const alpha = fadeMode === 'TAIL' ? (f + 1) / exposures
              : fadeMode === 'HEAD' ? 1 - f / exposures
              : 1 / exposures;
  // Blend frame[f] into output at alpha
}
```

Memory: `exposures × W × H × 4` bytes. At 640×480×6 exposures = ~7MB.

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Stroboscope | Chronophotography (6 exp, interval 3) → Levels → Bloom | Stylize |
| Motion Trail | Chronophotography (12 exp, interval 1, Tail) → Sharpen | Stylize |
| Ghost Dance | Chronophotography (8 exp, isolateSubject) → Bloom → Chromatic aberration | Stylize |

#### B10. After-Image (Negative Persistence)
**Category:** Simulate | **~35 lines** | **New file:** `src/filters/afterImage.ts`

When a bright object moves away, it leaves a complementary-colored ghost — like staring at a light then looking away. Simulates retinal fatigue / cone adaptation. Distinct from Phosphor Decay (which keeps the *same* color persisting) — this inverts the lingering ghost.

**Options:**
- `persistence` (0.01–0.2, default 0.05) — how fast the after-image fades
- `strength` (0.5–2, default 1) — intensity of the negative ghost

**Implementation:**
```ts
const afterR = (255 - prevOutput[i]) * strength;
// Blend: current + lingering negative of what was there before
outR = Math.min(255, buf[i] + Math.max(0, (afterR - buf[i]) * persistence));
```

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Retinal Burn | After-Image (strength 1.5) → Bloom | Simulate |
| Neon Afterglow | Edge glow → After-Image → Bloom | Stylize |
| Flash Blind | After-Image (persistence 0.15, strength 2) → Levels | Simulate |

#### B11. Time Mosaic
**Category:** Stylize | **~60 lines** | **New file:** `src/filters/timeMosaic.ts`

Divide the image into a grid of tiles. Each tile updates at a different rate — some show the current frame, others are delayed by 1–N frames. Creates a staggered, surveillance-wall look where parts of the image are out of sync.

**Options:**
- `tileSize` (8–64, default 24) — tile dimensions
- `maxDelay` (2–30, default 10) — maximum frame delay for any tile
- `pattern` ENUM: Random (each tile gets a random delay), Checkerboard (alternating 0/max), Radial (center is live, edges delayed), Gradient (left=live, right=delayed)

**Implementation:** Per-tile delay assigned deterministically from `(tileX, tileY, pattern)`. Maintain a ring buffer of `maxDelay` frames. Each tile reads from the ring buffer at its delay offset.

Memory: `maxDelay × W × H × 4`. At 640×480×10 = ~12MB.

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Surveillance Wall | Time Mosaic (Random, maxDelay 10) → Scanline → Film grain | Simulate |
| Time Gradient | Time Mosaic (Gradient, maxDelay 20) → Sharpen | Stylize |
| Time Checker | Time Mosaic (Checkerboard, maxDelay 5) → Vignette | Stylize |

**Extension note:** `Temporal Mosaic Stabilizer` should be added as an option or mode on this filter rather than as a separate top-level filter. It should differ from the current fixed-delay behavior by refreshing tiles based on motion activity instead of deterministic age assignment.

Recommended shape for a later extension:
- add a mode such as `behavior: "delayMap" | "stabilizer"`
- keep the current `pattern` + `maxDelay` path for `delayMap`
- for `stabilizer`, add `motionThreshold`, `holdFrames`, and optionally `refreshMode`

Product distinction:
- `delayMap` = parts of the image are intentionally out of sync in time
- `stabilizer` = tiles hold until motion forces them to refresh

That keeps the concept unified under one tile-history filter while still giving the motion-triggered patchwork look its own clear behavior.

#### B12. Temporal Color Cycle
**Category:** Color | **~30 lines** | **New file:** `src/filters/temporalColorCycle.ts`

Hue rotates over time, and moving areas accumulate more rotation than static areas. Static scenes slowly drift through the rainbow; movement creates localized color explosions.

**Options:**
- `baseSpeed` (0–10, default 2) — hue rotation degrees per frame for static areas
- `motionMultiplier` (0–20, default 8) — extra rotation per unit of motion
- `saturationBoost` (0–1, default 0.3) — boost saturation in moving areas

**Implementation:** Convert to HSL, add `baseSpeed + motion * motionMultiplier` to hue, clamp saturation. Use `_ema` for motion detection.

```ts
const motion = ema ? (abs(buf[i]-ema[i]) + abs(buf[i+1]-ema[i+1]) + abs(buf[i+2]-ema[i+2])) / 765 : 0;
const hueShift = baseSpeed + motion * motionMultiplier;
// Convert RGB→HSL, h += hueShift, s = min(1, s + motion * saturationBoost), convert back
```

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Psychedelic | Temporal Color Cycle (base 5, motion 15) → Bloom → Chromatic aberration | Color |
| Acid Trip | Temporal Color Cycle → Solarize → Bloom | Color |
| Color Breath | Temporal Color Cycle (base 1, motion 0) → Posterize | Color |

### Current Shortlist Of Distinct Next Temporal Ideas

These are the temporal ideas that currently look non-redundant relative to the shipped set, with two of them intentionally scoped as extensions of existing filters rather than new top-level entries:

- `Temporal Median`
  Per-pixel median across a short frame window to suppress transient movers and flicker instead of accumulating them.
- `Temporal Poster Hold`
  Posterized tone bands update only when a temporal hysteresis threshold is crossed, producing sticky quantized regions.
- `Temporal Ink Drying`
  New marks appear wet/dark and then dry, shrink, or lighten over time like a physical medium.
- `Temporal Relief`
  Recent change history becomes embossed height/shading so motion reads as surface geometry rather than brightness alone.
- `Keyframe Smear`
  Sparse keyframes are held and smeared/interpolated forward so the image feels compressed or in-betweened rather than simply echoed.
- `Temporal Mosaic Stabilizer`
  Implement as a mode on `Time Mosaic`, using motion-triggered tile refresh instead of fixed delay assignment.
- `Frame Vote Dither`
  Implement as a mode on `Temporal Error Diffusion`, using recent decision consensus instead of residual carryover.

#### B13. Motion Pixelate
**Category:** Stylize | **~40 lines** | **New file:** `src/filters/motionPixelate.ts`

Moving areas become pixelated while static areas stay sharp (or vice versa). Creates a privacy/censorship aesthetic where only the moving subject is obscured, or an artistic effect where stillness is rewarded with detail.

**Options:**
- `blockSize` (4–32, default 12) — pixelation level for affected areas
- `invert` BOOL (default false) — if true, static areas pixelate instead
- `threshold` (5–50, default 15) — motion sensitivity

**Implementation:** Compute per-block motion from EMA diff. For blocks exceeding threshold: average all pixels in the block. Blocks below threshold: pass through unchanged (or vice versa with `invert`).

```ts
// Per block: average motion across all pixels
let blockMotion = 0;
for (pixels in block) blockMotion += abs(buf[i] - ema[i]);
blockMotion /= blockPixelCount * 255;

const shouldPixelate = invert ? (blockMotion < threshold/100) : (blockMotion > threshold/100);
if (shouldPixelate) { /* average block color */ }
else { /* pass through */ }
```

**Presets:**
| Preset | Chain | Category |
|---|---|---|
| Censored | Motion Pixelate (blockSize 16) → Sharpen | Stylize |
| Detail Freeze | Motion Pixelate (invert, blockSize 8) → Vignette | Stylize |
| Privacy Mode | Motion Pixelate (blockSize 24) → Gaussian blur | Simulate |

### Enhancements to Existing Temporal Filters

#### B14. Datamosh: motion vector propagation
**File:** `src/filters/datamosh.ts`

Current datamosh displaces blocks randomly when motion is detected. Real datamosh propagates motion vectors from P-frames — blocks slide *in the direction of motion*, not randomly. Use frame differencing from `_prevInput` to estimate motion direction per block.

**Enhancement:**
```ts
// Estimate motion vector per block by comparing block positions between prevInput and current
// Find the offset (dx, dy) that minimizes SAD between prevInput block and current frame
// Displace the block along (dx, dy) instead of random displacement
```

**Options to add:** `motionEstimation` BOOL (default true) — use directional displacement. When off, falls back to current random displacement behavior.

#### B15. VHS temporal drift accumulation
**File:** `src/filters/vhs.ts`

Tracking drift should accumulate across frames and self-correct. Currently resets every frame. Carry a drift accumulator via module-level state, seeded from `_frameIndex`:

```ts
// Module-level state
let trackingDrift = 0;
// Each frame: drift wanders and occasionally snaps back
trackingDrift += (rng() - 0.5) * driftSpeed;
if (Math.abs(trackingDrift) > maxDrift) trackingDrift *= 0.3; // head re-lock
```

**Options to add:** `trackingDriftSpeed` (0–5, default 1) — how fast tracking wanders between frames

#### B16. Analog Static temporal noise persistence
**File:** `src/filters/analogStatic.ts`

Currently generates independent noise per frame. Add optional temporal blending with `_prevOutput` so static snow has visible persistence — bright dots linger for 1–2 frames before fading, matching real CRT static behavior.

**Options to add:** `persistence` (0–0.5, default 0.15) — blend previous frame's noise into current

---

## C. Consolidation

### C1. Merge Posterize variants
**Filters:** Posterize, Chromatic posterize, Smooth posterize
**Action:** Merge into one "Posterize" filter with a `mode` enum: Uniform (current Posterize), Per-channel (Chromatic posterize), Smooth (Smooth posterize). Keep "Posterize dither" separate — it's a different algorithm (ordered dither-based).
**Effort:** ~60 lines refactored | **Impact:** Medium — reduces filter count by 2, simplifies discovery

### C2. Merge Halftone variants
**Filters:** Halftone, CMYK Halftone
**Action:** Add a `colorModel` enum (RGB / CMYK) to Halftone. CMYK mode uses the existing CMYK separation code. Keep "Color halftone (RGB)" separate — it uses a fundamentally different algorithm (per-channel offset grids).
**Effort:** ~40 lines | **Impact:** Low — both are already categorized clearly

### C3. Merge Edge/Contour variants
**Filters:** Edge trace, Line art
**Action:** Line art is Edge trace + threshold + inversion. Add a `mode` enum (Trace / Line art) to Edge trace. Keep Contour lines and Contour map separate — they're topographic, not Canny-based.
**Effort:** ~30 lines | **Impact:** Low

### C4. Deduplicate near-identical presets
**Presets:** "Faded Film" vs "Vintage Photo"
- Faded Film: Sepia → Light leak → Film grain → Vignette
- Vintage Photo: Sepia → Film grain → Vignette → Light leak

**Action:** Differentiate "Vintage Photo" by using warmer sepia + stronger vignette + no light leak, or replace it with a distinct preset (e.g., "Kodachrome" using the Kodachrome palette + Film grain + Vignette). Same issue with "Data Corruption" vs "Corrupted" — make one use channel-level corruption and the other block-level.
**Effort:** ~10 lines | **Impact:** Low — reduces user confusion

---

## D. New Presets

### D1. New presets using only existing filters

| Preset | Chain | Category | Why |
|---|---|---|---|
| Cyanotype | Grayscale → Invert → Blend (blueprint) → Vignette | Color | Palette exists, no chain |
| Lo-fi Webcam | Pixelate → JPEG artifact → Film grain → Vignette | Simulate | On-trend aesthetic |
| Pop Art | Pop art → Posterize → Bloom | Stylize | Filter exists, no chain |
| X-Ray | Grayscale → Invert → Levels → Bloom | Simulate | Classic medical aesthetic |
| Lenticular Card | Lenticular → Scanline → Bloom | Simulate | Filter exists, no chain |
| Glitch VHS | VHS emulation → Glitch blocks → Chromatic aberration | Glitch | Combines two popular styles |
| Double Exposure | Blend → Bloom → Levels | Photo | Classic film technique |
| Night City | Posterize edges → Chromatic aberration → Bloom | Stylize | Cyberpunk variant |

### D2. New presets requiring new temporal filters

These are listed inline with each B-section filter above. Summary:

| Preset | Chain | Requires | Category |
|---|---|---|---|
| Temporal Dither | Ordered + `temporalPhases: 4` | B1 | Dithering |
| Playdate | Ordered (Bayer 4×4, 1-bit) + `temporalPhases: 4` | B1 | Dithering |
| 1-bit Film | Ordered (Bayer 8×8) + `temporalPhases: 8` + 1-bit + Film grain | B1 | Dithering |
| Gameboy Temporal | Ordered (Gameboy) + `temporalPhases: 4` + Scanline | B1 | Dithering |
| Amber Flicker | Ordered (Amber CRT) + `temporalPhases: 2` + Bloom + Scanline | B1 | Dithering |
| Temporal Floyd-Steinberg | Floyd-Steinberg + `temporalBleed: 0.5` | B2 | Dithering |
| Temporal Atkinson | Atkinson + `temporalBleed: 0.3` | B2 | Dithering |
| Living Mac | Atkinson + `temporalBleed: 0.5` + 1-bit palette | B2 | Dithering |
| Breathing Dither | Jarvis + `temporalBleed: 0.7` + Gameboy palette | B2 | Dithering |
| Virtual Greenscreen | Background Subtraction (transparent) | B3 | Color |
| Subject Dither | Background Subtraction → Floyd-Steinberg | B3 | Dithering |
| Ghost Subject | Background Subtraction → Frame blend → Bloom | B3 | Simulate |
| Activity Map | Motion Heatmap (Inferno) → Bloom | B4 | Simulate |
| Traffic Flow | Motion Heatmap (Viridis) → Scanline | B4 | Simulate |
| Infinite Tunnel | Video Feedback (zoom 1.05, rot 1°) → Bloom | B5 | Advanced |
| Kaleidoscope Spiral | Video Feedback (zoom 1.03, rot 5°, colorShift 10) → Bloom | B5 | Advanced |
| Rainbow Vortex | Video Feedback (zoom 1.02, rot 3°, colorShift 20) → Bloom → Chrom. aberr. | B5 | Advanced |
| Frozen Glitch | Freeze Frame Glitch | B6 | Glitch |
| Color Freeze | Freeze Frame Glitch (channelIndependent) → Chromatic aberration | B6 | Glitch |
| Time Slice | Slit Scan (H, depth 30) → Sharpen | B7 | Distort |
| Panorama Glitch | Slit Scan (H, depth 60) → JPEG artifact | B7 | Glitch |
| Stargate | Slit Scan (H, depth 40) → Chromatic aberration → Bloom | B7 | Advanced |
| Heat Shimmer | Wake Turbulence (intensity 5, settle 0.04) → Bloom | B8 | Distort |
| Underwater | Wake Turbulence → Chromatic aberration → Bloom | B8 | Simulate |
| Stroboscope | Chronophotography (6 exp) → Levels → Bloom | B9 | Stylize |
| Ghost Dance | Chronophotography (8 exp, isolateSubject) → Bloom → Chrom. aberr. | B9 | Stylize |
| Retinal Burn | After-Image (strength 1.5) → Bloom | B10 | Simulate |
| Neon Afterglow | Edge glow → After-Image → Bloom | B10 | Stylize |
| Surveillance Wall | Time Mosaic (Random) → Scanline → Film grain | B11 | Simulate |
| Psychedelic | Temporal Color Cycle → Bloom → Chromatic aberration | B12 | Color |
| Acid Trip | Temporal Color Cycle → Solarize → Bloom | B12 | Color |
| Censored | Motion Pixelate → Sharpen | B13 | Stylize |
| Privacy Mode | Motion Pixelate (blockSize 24) → Gaussian blur | B13 | Simulate |

### D3. Existing presets upgraded with temporal filters

These existing chain presets would benefit from temporal filters swapped in or appended. The original version stays as-is; the temporal variant becomes a new preset or replaces the original where it's strictly better.

| Existing Preset | Current Chain | Temporal Upgrade | Change |
|---|---|---|---|
| **Dream Sequence** | Gaussian blur → Bloom → Light leak → Sepia | Gaussian blur → Bloom → Light leak → Sepia → **Frame blend** | Append Frame blend (blendFactor 0.8) for dreamy temporal smearing — static images unchanged, video gets soft ghosting. Rename to "Lucid Dream" and keep original as "Dream Sequence (static)" |
| **Retro TV** | VHS emulation → CRT emulation → Vignette | VHS emulation → CRT emulation → **Phosphor decay** → Vignette | Swap Vignette to end, insert Phosphor decay. Green persistence + tracking drift (B15) makes this significantly more authentic |
| **VHS Pause** | VHS emulation → Interlace tear → Analog static | VHS emulation → Interlace tear → **Freeze Frame Glitch** → Analog static | Insert Freeze Frame Glitch — a paused VHS has frozen blocks, not just torn fields. Requires B6 |
| **Security Camera** | Grayscale → Motion detect → Scanline → Film grain | Grayscale → Motion detect → **Motion Heatmap** → Scanline → Film grain | Add Motion Heatmap after motion detect to show accumulated movement zones. Requires B4 |
| **Ghost** | Frame blend → Bloom | **Chronophotography** → Bloom | Replace Frame blend with Chronophotography for sharp distinct ghosts instead of averaged mush. Requires B9 |
| **Neon** | Invert → Edge glow → Bloom → Chromatic aberration | Invert → Edge glow → Bloom → Chromatic aberration → **After-Image** | Append After-Image so neon outlines leave colored ghosts when the subject moves. Requires B10 |
| **Melt** | Liquify → Smudge → Pixel drift | Liquify → Smudge → **Wake Turbulence** | Replace Pixel drift with Wake Turbulence for motion-reactive melting instead of static. Requires B8 |
| **Gameboy Screen** | Ordered (Gameboy) → Scanline → Vignette | Ordered (Gameboy, `temporalPhases: 4`) → Scanline → Vignette | Enable temporal dithering — the Gameboy had a slow LCD that naturally created temporal averaging. Requires B1. Keep original for static use |
| **Broadcast Failure** | Datamosh → Channel separation → Scan line shift | Datamosh (motionEstimation) → Channel separation → Scan line shift → **Freeze Frame Glitch** | Upgraded datamosh (B14) + append Freeze Frame Glitch. Requires B6, B14 |
| **Cyberpunk** | Chromatic posterize → Chromatic aberration → Bloom → CRT emulation | Chromatic posterize → Chromatic aberration → Bloom → CRT emulation → **Phosphor decay** | Append Phosphor decay — neon signs should leave phosphor trails on a CRT |
| **Cellular Life** | Cellular automata → Edge glow → Bloom | Cellular automata → Edge glow → Bloom → **Phosphor decay** | Append Phosphor decay so dying cells leave a brief green afterglow. The automata already uses `_prevOutput` for state, and phosphor decay chains after it naturally |
| **Surveillance** | Grayscale → Night vision → Scanline → JPEG artifact | Grayscale → Night vision → **Motion detect** → Scanline → JPEG artifact | Insert Motion detect — real security systems highlight motion. The existing "Security Camera" preset already does this but "Surveillance" doesn't |
| **Matrix** | Levels → Matrix rain | Levels → Matrix rain → **Phosphor decay** | Append Phosphor decay for authentic green CRT persistence on the falling characters. Matrix rain already uses `_ema` for motion; phosphor decay adds visual persistence |
| **Light Painting** | Edge glow → Long exposure | Edge glow → Long exposure → **After-Image** | Append After-Image so light trails leave complementary-color echoes. Requires B10 |
| **Thermal** | Thermal camera → Posterize → Bloom | Thermal camera → Posterize → Bloom → **Motion Heatmap** | Append Motion Heatmap — thermal cameras naturally show heat accumulation over time. Requires B4 |

---

## E. Algorithms Worth Adding (Non-Temporal)

### E1. Blue Noise / Void-and-Cluster threshold map
**Add to:** `src/filters/ordered.ts` as a new threshold map option
**What:** Pre-computed 64×64 blue noise texture. Produces more organic, film-grain-like dithering than Bayer — increasingly popular in game dev and retro art.
**Effort:** ~20 lines (map is pre-computed, just add to `thresholdMaps`)

### E2. Riemersma Dither
**Category:** Dithering | **~80 lines**
Error diffusion along a Hilbert curve instead of raster scan. Eliminates directional artifacts entirely. Visually distinct from all existing dithering — organic, non-directional noise.

### E3. Pattern Dither textures
**Add to:** `src/filters/ordered.ts` or new filter
**What:** Artistic threshold maps — fabric weave, basket, brick, diamond plate. Each is a small matrix (8×8 to 16×16) used the same way as Bayer.
**Effort:** ~30 lines per pattern

---

## Implementation Order

| Phase | Items | New filters | LOC est. |
|---|---|---|---|
| **1 — Fixes** | A1 (serpentine), A2 (temporal forward), A4 (ordered levels) | 0 | ~30 |
| **2 — Core temporal dither** | B1 (temporal ordered), B2 (temporal error diffusion) | 0 (options on existing) | ~60 |
| **2a — Presets** | D2 dithering presets (Playdate, Temporal FS, Living Mac, etc.) + D3 Gameboy Screen upgrade | 0 | ~15 |
| **3 — Temporal filters (high impact)** | B5 (video feedback), B6 (freeze frame glitch), B3 (bg subtraction), B4 (motion heatmap) | 4 | ~180 |
| **3a — Existing enhancements** | B14 (datamosh motion vectors), B15 (VHS drift), B16 (analog static persistence) | 0 | ~60 |
| **3b — Presets** | D2 presets for B3–B6 + D3 upgrades (Retro TV, VHS Pause, Security Camera, Cyberpunk, etc.) | 0 | ~30 |
| **4 — Temporal filters (medium)** | B7 (slit scan), B8 (wake turbulence), B9 (chronophotography), B10 (after-image) | 4 | ~225 |
| **4a — Presets** | D2 presets for B7–B10 + D3 upgrades (Ghost, Neon, Melt, Light Painting, etc.) | 0 | ~20 |
| **5 — Temporal filters (exploration)** | B11 (time mosaic), B12 (temporal color cycle), B13 (motion pixelate) | 3 | ~130 |
| **5a — Presets** | D2 remaining presets + D3 upgrades (Matrix, Thermal, Cellular Life, etc.) | 0 | ~20 |
| **6 — Consolidation** | C1 (posterize), C2 (halftone), C3 (edge), C4 (presets) | −4 (net) | ~140 |
| **7 — Non-temporal presets** | D1 (Cyanotype, Lo-fi Webcam, Pop Art, X-Ray, etc.) | 0 | ~15 |
| **8 — Algorithms** | E1 (blue noise), E2 (Riemersma), E3 (pattern textures) | 1–2 | ~130 |

Phase 1 is prerequisite for Phase 2. Within each phase, items are independent and can be parallelized. Preset sub-phases (2a, 3b, 4a, 5a) should land with their parent phase, not deferred.

---

## Decisions

1. **Temporal dither:** Option on existing Ordered filter (`temporalPhases` + `animate`/`animSpeed`). ~5 lines to the inner loop, no code duplication.

2. **Serpentine scanning:** Default on. Add `serpentine` bool option (default `true`) so users can disable it for the aesthetic artifact.

3. **Blue noise map:** Pre-compute a 64×64 void-and-cluster map and embed as a constant array (~4KB). Runtime generation is too slow (~500ms).

4. **Consolidation:** Phase 5, after temporal work stabilizes. Add alias lookup in chain deserialization so user-saved chains referencing old filter names resolve to the merged filter.

5. **Slit scan memory:** Auto-cap at ~40MB. Compute effective depth from `maxBytes / (W × H × 4)` and clamp. Show the effective depth in the UI.
