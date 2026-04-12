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
  gain: { type: RANGE, range: [1, 8], step: 0.1, default: 4, desc: "Image intensifier gain multiplier" },
  grain: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Photon noise grain amount" },
  bloomRadius: { type: RANGE, range: [0, 8], step: 1, default: 3, desc: "Glow radius around bright areas" },
  bloomStrength: { type: RANGE, range: [0, 2], step: 0.05, default: 0.6, desc: "Bloom glow intensity" },
  vignette: { type: RANGE, range: [0, 1], step: 0.01, default: 0.7, desc: "Circular edge darkening" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  gain: optionTypes.gain.default,
  grain: optionTypes.grain.default,
  bloomRadius: optionTypes.bloomRadius.default,
  bloomStrength: optionTypes.bloomStrength.default,
  vignette: optionTypes.vignette.default,
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

const nightVision = (
  input,
  options = defaults
) => {
  const {
    gain,
    grain,
    bloomRadius,
    bloomStrength,
    vignette,
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
  const len = buf.length;

  // Per-frame seeded random for scintillation noise
  const rng = mulberry32(frameIndex * 7919 + 31337);

  // --- Step 1: Compute amplified luminance ---
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const L = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
      // Image intensifier: boost dark areas more than bright (non-linear)
      // Normalize to 0-1, apply gain with sqrt curve (amplifies darks), rescale
      const norm = L / 255;
      const amplified = Math.min(1, Math.pow(norm, 1 / gain));
      lum[y * W + x] = amplified;
    }
  }

  // --- Step 2: Bloom on bright pixels (separable box blur) ---
  const r = bloomRadius;
  let bloomed = lum;

  if (r > 0 && bloomStrength > 0) {
    // Extract bright regions for bloom
    const bright = new Float32Array(W * H);
    const bloomThreshold = 0.6;
    for (let j = 0; j < W * H; j++) {
      bright[j] = Math.max(0, lum[j] - bloomThreshold);
    }

    // Horizontal pass
    const blurH = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0;
        let count = 0;
        for (let kx = -r; kx <= r; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          sum += bright[y * W + nx];
          count++;
        }
        blurH[y * W + x] = sum / count;
      }
    }

    // Vertical pass
    const blurHV = new Float32Array(W * H);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let sum = 0;
        let count = 0;
        for (let ky = -r; ky <= r; ky++) {
          const ny = Math.max(0, Math.min(H - 1, y + ky));
          sum += blurH[ny * W + x];
          count++;
        }
        blurHV[y * W + x] = sum / count;
      }
    }

    // Add bloom back to luminance
    bloomed = new Float32Array(W * H);
    for (let j = 0; j < W * H; j++) {
      bloomed[j] = Math.min(1, lum[j] + blurHV[j] * bloomStrength);
    }
  }

  // --- Step 3: Circular tube vignette ---
  const cx = W / 2;
  const cy = H / 2;
  const maxR = Math.min(cx, cy);

  // --- Step 4: Composite with grain, vignette, phosphor color ---
  const outBuf = new Uint8ClampedArray(len);
  // Phosphor color: slightly warm green
  const pR = 20;
  const pG = 255;
  const pB = 20;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const idx = y * W + x;

      let intensity = bloomed[idx];

      // Scintillation grain noise
      if (grain > 0) {
        intensity += (rng() - 0.5) * grain;
      }

      // Circular vignette: hard falloff from center
      if (vignette > 0) {
        const dx = (x - cx) / maxR;
        const dy = (y - cy) / maxR;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Hard circular falloff: ramp from 1.0 at dist=0.8 to 0 at dist=1.0+
        const edge = 1 - vignette * 0.3; // inner edge where falloff begins
        if (dist > edge) {
          const fade = 1 - Math.min(1, (dist - edge) / (1 - edge + 0.001));
          intensity *= fade * fade; // squared for harder edge
        }
        // Complete black outside tube radius
        if (dist > 1) {
          intensity = 0;
        }
      }

      intensity = Math.max(0, Math.min(1, intensity));

      // Map intensity to phosphor green
      const r = Math.round(pR * intensity);
      const g = Math.round(pG * intensity);
      const b = Math.round(pB * intensity);

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Night vision",
  func: nightVision,
  options: defaults,
  optionTypes,
  defaults
});
