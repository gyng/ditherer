import { ACTION, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
} from "../utils/index";
import { applyPalettePassToCanvas } from "../palettes/backend";
import {
  projectionFilmGLAvailable,
  renderProjectionFilmGL,
  type DustSpec,
  type ScratchSpec,
} from "./projectionFilmGL";
import {
  filmDensityNoise,
  filmGrainAmplitude,
  projectionArtifactCounts,
} from "./analogFilmQualityContracts";

export const optionTypes = {
  gateWeave: {
    type: RANGE,
    range: [0, 10],
    step: 0.5,
    default: 2,
    desc: "Projector gate weave jitter in pixels",
  },
  grain: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.15,
    desc: "Film grain noise intensity",
  },
  dustAmount: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.2,
    desc: "Area-scaled dark dust and gate-debris density",
  },
  scratchAmount: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.15,
    desc: "Vertical emulsion-scratch density — nonzero settings retain at least one line",
  },
  flicker: {
    type: RANGE,
    range: [0, 0.2],
    step: 0.005,
    default: 0.05,
    desc: "Frame-to-frame brightness flicker",
  },
  vignette: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.3,
    desc: "Edge darkening intensity",
  },
  warmth: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Warm color cast" },
  bloom: { type: RANGE, range: [0, 2], step: 0.05, default: 0.4, desc: "Highlight bloom strength" },
  bloomRadius: { type: RANGE, range: [1, 15], step: 1, default: 6, desc: "Bloom glow radius" },
  animSpeed: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 18,
    desc: "Projection frame rate for weave, grain, dust, scratches, and flicker",
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Animate the mechanical projector and frame-specific film artifacts",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 18);
      }
    },
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  gateWeave: optionTypes.gateWeave.default,
  grain: optionTypes.grain.default,
  dustAmount: optionTypes.dustAmount.default,
  scratchAmount: optionTypes.scratchAmount.default,
  flicker: optionTypes.flicker.default,
  vignette: optionTypes.vignette.default,
  warmth: optionTypes.warmth.default,
  bloom: optionTypes.bloom.default,
  bloomRadius: optionTypes.bloomRadius.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

// Simple seeded pseudo-random for deterministic per-frame noise
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type ProjectionFilmOptions = Partial<typeof defaults> & {
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

const projectionFilm = (input: any, options: ProjectionFilmOptions = defaults) => {
  const {
    gateWeave = defaults.gateWeave,
    grain = defaults.grain,
    dustAmount = defaults.dustAmount,
    scratchAmount = defaults.scratchAmount,
    flicker = defaults.flicker,
    vignette = defaults.vignette,
    warmth = defaults.warmth,
    bloom = defaults.bloom,
    bloomRadius = defaults.bloomRadius,
    palette = defaults.palette,
  } = options;

  const frameIndex = options._frameIndex ?? 0;
  const W = input.width;
  const H = input.height;

  // Per-frame seeded random. The GL path samples `rng` just enough to
  // produce the same weave + flicker + scratch/dust positions as the CPU
  // path (grain is hash-based per-pixel there), so the visual output tracks.
  const rng = mulberry32(frameIndex * 7919 + 31337);

  // --- Gate weave: random per-frame horizontal + vertical jitter ---
  const weaveX = gateWeave > 0 ? Math.round((rng() - 0.5) * gateWeave * 2) : 0;
  const weaveY = gateWeave > 0 ? Math.round((rng() - 0.5) * gateWeave * 2) : 0;

  // --- Light flicker: per-frame brightness multiplier ---
  const flickerMul = 1 + (rng() - 0.5) * flicker * 2;

  // --- Scratches: pre-compute vertical scratch positions ---
  const scratchRng = mulberry32(frameIndex * 4391 + 17);
  const dustRng = mulberry32(frameIndex * 1013 + 7);
  const artifactCounts = projectionArtifactCounts(
    W,
    H,
    dustAmount,
    scratchAmount,
    dustRng(),
    scratchRng(),
  );
  const scratches: ScratchSpec[] = [];
  if (artifactCounts.scratches > 0) {
    const boundedScratchAmount = Math.min(
      1,
      Math.max(0, Number.isFinite(scratchAmount) ? scratchAmount : defaults.scratchAmount),
    );
    const severity = 0.45 + 0.55 * Math.sqrt(boundedScratchAmount);
    for (let s = 0; s < artifactCounts.scratches; s++) {
      const fullHeight = scratchRng() < 0.55;
      const yStart = fullHeight ? 0 : Math.floor(scratchRng() * H * 0.25);
      const yEnd = fullHeight
        ? H - 1
        : Math.min(H - 1, Math.floor(yStart + H * (0.55 + scratchRng() * 0.35)));
      const darkBaseScratch = scratchRng() < 0.45;
      scratches.push({
        x: Math.floor(scratchRng() * W),
        opacity: (0.28 + scratchRng() * 0.45) * severity,
        polarity: darkBaseScratch ? -(0.45 + scratchRng() * 0.55) : 0.2 + scratchRng() * 0.8,
        width: (0.45 + scratchRng() * 0.9) * (0.55 + 0.45 * Math.sqrt(boundedScratchAmount)),
        yStart,
        yEnd,
        wobble: scratchRng() * 1.4 * severity,
        phase: scratchRng() * Math.PI * 2,
      });
    }
  }

  // --- Dust: pre-compute random dust speck positions ---
  const dustSpecs: Array<{ x: number; y: number; radius: number; opacity: number }> = [];
  if (artifactCounts.dust > 0) {
    const defectScale = Math.max(0.75, Math.sqrt((W * H) / (640 * 480)));
    for (let d = 0; d < artifactCounts.dust; d++) {
      dustSpecs.push({
        x: Math.floor(dustRng() * W),
        y: Math.floor(dustRng() * H),
        radius: Math.min(6, 1 + Math.floor(dustRng() * 2 * defectScale)),
        opacity: 0.3 + dustRng() * 0.7,
      });
    }
  }

  // --- Vignette: pre-compute center and max distance ---
  const cx = W / 2;
  const cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  const grainSeed = frameIndex * 2731 + 5381;

  // GL fast path. Per-pixel composite + bloom all live in shaders; dust and
  // scratch positions are built here on the CPU (they need the seeded RNG
  // sequence used by the JS reference) and uploaded as uniform arrays.
  if (
    projectionFilmGLAvailable() &&
    (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const dust: DustSpec[] = dustSpecs.map((d) => ({
      x: d.x,
      y: d.y,
      radius: d.radius,
      opacity: d.opacity,
    }));
    const scr: ScratchSpec[] = scratches;
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest
      ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256)
      : 256;
    const rendered = renderProjectionFilmGL(input, W, H, {
      weaveX,
      weaveY,
      warmth,
      flickerMul,
      grain,
      grainSeed,
      vignette,
      dust,
      scratches: scr,
      bloom,
      bloomRadius,
      levels,
    });
    if (rendered) {
      const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend(
          "Projection film",
          "WebGL2",
          `weave=${gateWeave} dust=${dust.length} scratches=${scr.length} bloom=${bloom}${isNearest ? "" : "+palettePass"}`,
        );
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Sample from gate-weave-shifted position
      const srcX = Math.max(0, Math.min(W - 1, x + weaveX));
      const srcY = Math.max(0, Math.min(H - 1, y + weaveY));
      const srcI = getBufferIndex(srcX, srcY, W);

      let r = buf[srcI];
      let g = buf[srcI + 1];
      let b = buf[srcI + 2];

      // --- Warm color cast ---
      if (warmth > 0) {
        r = r + (255 - r) * warmth * 0.12;
        g = g + (255 - g) * warmth * 0.04;
        b = b * (1 - warmth * 0.08);
      }

      // --- Light flicker ---
      r *= flickerMul;
      g *= flickerMul;
      b *= flickerMul;

      // --- Film grain ---
      if (grain > 0) {
        const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const noiseVal = filmDensityNoise(x, y, grainSeed) * filmGrainAmplitude(luma, grain) * 255;
        r += noiseVal;
        g += noiseVal;
        b += noiseVal;
      }

      // --- Vignette ---
      if (vignette > 0) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const vigFactor = 1 - dist * dist * vignette;
        r *= vigFactor;
        g *= vigFactor;
        b *= vigFactor;
      }

      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      const alpha = buf[srcI + 3];
      const color = paletteGetColor(palette, rgba(r, g, b, alpha), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], alpha);
    }
  }

  // --- Gate dust and debris: occludes projected light ---
  for (const spec of dustSpecs) {
    for (let dy = -spec.radius; dy <= spec.radius; dy++) {
      for (let dx = -spec.radius; dx <= spec.radius; dx++) {
        if (dx * dx + dy * dy > spec.radius * spec.radius) continue;
        const px = spec.x + dx;
        const py = spec.y + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const di = getBufferIndex(px, py, W);
        const blend = spec.opacity;
        outBuf[di] = Math.max(0, Math.round(outBuf[di] * (1 - blend)));
        outBuf[di + 1] = Math.max(0, Math.round(outBuf[di + 1] * (1 - blend)));
        outBuf[di + 2] = Math.max(0, Math.round(outBuf[di + 2] * (1 - blend)));
      }
    }
  }

  // --- Scratches (thin vertical lines) ---
  for (const scratch of scratches) {
    for (let sy = scratch.yStart; sy <= scratch.yEnd; sy++) {
      const center = scratch.x + Math.sin(sy * 0.055 + scratch.phase) * scratch.wobble;
      const minX = Math.max(0, Math.floor(center - scratch.width - 1));
      const maxX = Math.min(W - 1, Math.ceil(center + scratch.width + 1));
      for (let sx = minX; sx <= maxX; sx++) {
        const distance = Math.abs(sx - center);
        const coverage = Math.max(0, Math.min(1, scratch.width + 1 - distance));
        if (coverage <= 0) continue;
        const si = getBufferIndex(sx, sy, W);
        const blend = scratch.opacity * coverage;
        if (scratch.polarity < 0) {
          const strength = blend * Math.abs(scratch.polarity);
          outBuf[si] = Math.round(outBuf[si] * (1 - strength));
          outBuf[si + 1] = Math.round(outBuf[si + 1] * (1 - strength));
          outBuf[si + 2] = Math.round(outBuf[si + 2] * (1 - strength));
        } else {
          const target = [
            190 + 65 * scratch.polarity,
            175 + 80 * scratch.polarity,
            155 + 100 * scratch.polarity,
          ];
          outBuf[si] = Math.min(255, Math.round(outBuf[si] + (target[0] - outBuf[si]) * blend));
          outBuf[si + 1] = Math.min(
            255,
            Math.round(outBuf[si + 1] + (target[1] - outBuf[si + 1]) * blend),
          );
          outBuf[si + 2] = Math.min(
            255,
            Math.round(outBuf[si + 2] + (target[2] - outBuf[si + 2]) * blend),
          );
        }
      }
    }
  }

  // --- Projector light bloom: bright areas scatter through the lens ---
  if (bloom > 0) {
    const r = Math.round(bloomRadius);
    const threshold = 160;

    // Extract bright pixels
    const bright = new Float32Array(outBuf.length);
    for (let j = 0; j < outBuf.length; j += 4) {
      bright[j] = Math.max(0, outBuf[j] - threshold);
      bright[j + 1] = Math.max(0, outBuf[j + 1] - threshold);
      bright[j + 2] = Math.max(0, outBuf[j + 2] - threshold);
    }

    // Separable box blur — horizontal
    const blurH = new Float32Array(outBuf.length);
    for (let by = 0; by < H; by++) {
      for (let bx = 0; bx < W; bx++) {
        let sr = 0,
          sg = 0,
          sb = 0,
          count = 0;
        for (let kx = -r; kx <= r; kx++) {
          const nx = Math.max(0, Math.min(W - 1, bx + kx));
          const ki = getBufferIndex(nx, by, W);
          sr += bright[ki];
          sg += bright[ki + 1];
          sb += bright[ki + 2];
          count++;
        }
        const bi = getBufferIndex(bx, by, W);
        blurH[bi] = sr / count;
        blurH[bi + 1] = sg / count;
        blurH[bi + 2] = sb / count;
      }
    }

    // Vertical
    const blurHV = new Float32Array(outBuf.length);
    for (let bx = 0; bx < W; bx++) {
      for (let by = 0; by < H; by++) {
        let sr = 0,
          sg = 0,
          sb = 0,
          count = 0;
        for (let ky = -r; ky <= r; ky++) {
          const ny = Math.max(0, Math.min(H - 1, by + ky));
          const ki = getBufferIndex(bx, ny, W);
          sr += blurH[ki];
          sg += blurH[ki + 1];
          sb += blurH[ki + 2];
          count++;
        }
        const bi = getBufferIndex(bx, by, W);
        blurHV[bi] = sr / count;
        blurHV[bi + 1] = sg / count;
        blurHV[bi + 2] = sb / count;
      }
    }

    // Additive composite
    for (let j = 0; j < outBuf.length; j += 4) {
      outBuf[j] = Math.min(255, outBuf[j] + blurHV[j] * bloom);
      outBuf[j + 1] = Math.min(255, outBuf[j + 1] + blurHV[j + 1] * bloom);
      outBuf[j + 2] = Math.min(255, outBuf[j + 2] + blurHV[j + 2] * bloom);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default defineFilter({
  name: "Projection film",
  func: projectionFilm,
  options: defaults,
  optionTypes,
  defaults,
  description:
    "Mechanical 16/35 mm projection with gate weave, density grain, area-scaled dark debris, emulsion scratches, lamp flicker, and lens bloom",
  temporal: true,
});
