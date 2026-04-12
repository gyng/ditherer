import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  gateWeave: { type: RANGE, range: [0, 10], step: 0.5, default: 2, desc: "Projector gate weave jitter in pixels" },
  grain: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Film grain noise intensity" },
  dustAmount: { type: RANGE, range: [0, 1], step: 0.01, default: 0.2, desc: "Dust particle density" },
  scratchAmount: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Vertical scratch line density" },
  flicker: { type: RANGE, range: [0, 0.2], step: 0.005, default: 0.05, desc: "Frame-to-frame brightness flicker" },
  vignette: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Edge darkening intensity" },
  warmth: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Warm color cast" },
  bloom: { type: RANGE, range: [0, 2], step: 0.05, default: 0.4, desc: "Highlight bloom strength" },
  bloomRadius: { type: RANGE, range: [1, 15], step: 1, default: 6, desc: "Bloom glow radius" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 18 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 18);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
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
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Simple seeded pseudo-random for deterministic per-frame noise
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const projectionFilm = (
  input,
  options = defaults
) => {
  const {
    gateWeave,
    grain,
    dustAmount,
    scratchAmount,
    flicker,
    vignette,
    warmth,
    bloom,
    bloomRadius,
    palette
  } = options;

  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Per-frame seeded random
  const rng = mulberry32(frameIndex * 7919 + 31337);

  // --- Gate weave: random per-frame horizontal + vertical jitter ---
  const weaveX = gateWeave > 0
    ? Math.round((rng() - 0.5) * gateWeave * 2)
    : 0;
  const weaveY = gateWeave > 0
    ? Math.round((rng() - 0.5) * gateWeave * 2)
    : 0;

  // --- Light flicker: per-frame brightness multiplier ---
  const flickerMul = 1 + (rng() - 0.5) * flicker * 2;

  // --- Scratches: pre-compute vertical scratch positions ---
  const scratchRng = mulberry32(frameIndex * 4391 + 17);
  const scratches: Array<{ x: number; opacity: number }> = [];
  if (scratchAmount > 0) {
    const scratchCount = Math.floor(scratchRng() * 4 * scratchAmount);
    for (let s = 0; s < scratchCount; s++) {
      scratches.push({
        x: Math.floor(scratchRng() * W),
        opacity: 0.3 + scratchRng() * 0.7
      });
    }
  }

  // --- Dust: pre-compute random dust speck positions ---
  const dustRng = mulberry32(frameIndex * 1013 + 7);
  const dustSpecs: Array<{ x: number; y: number; radius: number; opacity: number }> = [];
  if (dustAmount > 0) {
    const dustCount = Math.floor(dustRng() * 30 * dustAmount);
    for (let d = 0; d < dustCount; d++) {
      dustSpecs.push({
        x: Math.floor(dustRng() * W),
        y: Math.floor(dustRng() * H),
        radius: 1 + Math.floor(dustRng() * 2),
        opacity: 0.3 + dustRng() * 0.7
      });
    }
  }

  // --- Vignette: pre-compute center and max distance ---
  const cx = W / 2;
  const cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  // --- Grain RNG (separate seed so grain is independent) ---
  const grainRng = mulberry32(frameIndex * 2731 + 5381);

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
        const noiseVal = (grainRng() - 0.5) * grain * 100;
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

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  // --- Dust specks (white dots) ---
  for (const spec of dustSpecs) {
    for (let dy = -spec.radius; dy <= spec.radius; dy++) {
      for (let dx = -spec.radius; dx <= spec.radius; dx++) {
        if (dx * dx + dy * dy > spec.radius * spec.radius) continue;
        const px = spec.x + dx;
        const py = spec.y + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const di = getBufferIndex(px, py, W);
        const blend = spec.opacity;
        outBuf[di]     = Math.min(255, Math.round(outBuf[di]     + (255 - outBuf[di])     * blend));
        outBuf[di + 1] = Math.min(255, Math.round(outBuf[di + 1] + (255 - outBuf[di + 1]) * blend));
        outBuf[di + 2] = Math.min(255, Math.round(outBuf[di + 2] + (255 - outBuf[di + 2]) * blend));
      }
    }
  }

  // --- Scratches (thin vertical lines) ---
  for (const scratch of scratches) {
    for (let sy = 0; sy < H; sy++) {
      const si = getBufferIndex(scratch.x, sy, W);
      const blend = scratch.opacity;
      outBuf[si]     = Math.min(255, Math.round(outBuf[si]     + (255 - outBuf[si])     * blend));
      outBuf[si + 1] = Math.min(255, Math.round(outBuf[si + 1] + (255 - outBuf[si + 1]) * blend));
      outBuf[si + 2] = Math.min(255, Math.round(outBuf[si + 2] + (255 - outBuf[si + 2]) * blend));
    }
  }

  // --- Projector light bloom: bright areas scatter through the lens ---
  if (bloom > 0) {
    const r = Math.round(bloomRadius);
    const threshold = 160;

    // Extract bright pixels
    const bright = new Float32Array(outBuf.length);
    for (let j = 0; j < outBuf.length; j += 4) {
      bright[j]     = Math.max(0, outBuf[j]     - threshold);
      bright[j + 1] = Math.max(0, outBuf[j + 1] - threshold);
      bright[j + 2] = Math.max(0, outBuf[j + 2] - threshold);
    }

    // Separable box blur — horizontal
    const blurH = new Float32Array(outBuf.length);
    for (let by = 0; by < H; by++) {
      for (let bx = 0; bx < W; bx++) {
        let sr = 0, sg = 0, sb = 0, count = 0;
        for (let kx = -r; kx <= r; kx++) {
          const nx = Math.max(0, Math.min(W - 1, bx + kx));
          const ki = getBufferIndex(nx, by, W);
          sr += bright[ki]; sg += bright[ki + 1]; sb += bright[ki + 2];
          count++;
        }
        const bi = getBufferIndex(bx, by, W);
        blurH[bi] = sr / count; blurH[bi + 1] = sg / count; blurH[bi + 2] = sb / count;
      }
    }

    // Vertical
    const blurHV = new Float32Array(outBuf.length);
    for (let bx = 0; bx < W; bx++) {
      for (let by = 0; by < H; by++) {
        let sr = 0, sg = 0, sb = 0, count = 0;
        for (let ky = -r; ky <= r; ky++) {
          const ny = Math.max(0, Math.min(H - 1, by + ky));
          const ki = getBufferIndex(bx, ny, W);
          sr += blurH[ki]; sg += blurH[ki + 1]; sb += blurH[ki + 2];
          count++;
        }
        const bi = getBufferIndex(bx, by, W);
        blurHV[bi] = sr / count; blurHV[bi + 1] = sg / count; blurHV[bi + 2] = sb / count;
      }
    }

    // Additive composite
    for (let j = 0; j < outBuf.length; j += 4) {
      outBuf[j]     = Math.min(255, outBuf[j]     + blurHV[j]     * bloom);
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
  defaults
});
