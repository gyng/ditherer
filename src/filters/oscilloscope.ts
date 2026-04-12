import { ACTION, BOOL, ENUM, RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const PHOSPHOR_GREEN = "GREEN";     // P1/P31 classic
const PHOSPHOR_BLUE = "BLUE";       // P11
const PHOSPHOR_AMBER = "AMBER";     // P12 long persistence
const PHOSPHOR_WHITE = "WHITE";     // P4

const phosphorColors = {
  [PHOSPHOR_GREEN]: [32, 255, 32],
  [PHOSPHOR_BLUE]:  [64, 128, 255],
  [PHOSPHOR_AMBER]: [255, 176, 32],
  [PHOSPHOR_WHITE]: [210, 225, 255],
};

export const optionTypes = {
  phosphor: {
    type: ENUM,
    options: [
      { name: "P1/P31 Green", value: PHOSPHOR_GREEN },
      { name: "P11 Blue", value: PHOSPHOR_BLUE },
      { name: "P12 Amber", value: PHOSPHOR_AMBER },
      { name: "P4 White", value: PHOSPHOR_WHITE }
    ],
    default: PHOSPHOR_GREEN,
    desc: "CRT phosphor color"
  },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 80, desc: "Signal threshold for trace visibility" },
  intensity: { type: RANGE, range: [0.5, 4], step: 0.1, default: 1.5, desc: "Beam brightness" },
  bloom: { type: RANGE, range: [0, 10], step: 1, default: 3, desc: "Phosphor bloom/glow radius" },
  bloomStrength: { type: RANGE, range: [0, 3], step: 0.05, default: 0.8, desc: "Bloom glow intensity" },
  persistence: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Phosphor afterglow persistence" },
  graticule: { type: BOOL, default: true, desc: "Show grid overlay" },
  graticuleDivs: { type: RANGE, range: [4, 16], step: 1, default: 8, desc: "Number of graticule grid divisions" },
  scanlines: { type: BOOL, default: true, desc: "Show horizontal scan lines" },
  scanlineSpacing: { type: RANGE, range: [2, 8], step: 1, default: 3, desc: "Pixel gap between scan lines" },
  noiseFloor: { type: RANGE, range: [0, 0.1], step: 0.005, default: 0.015, desc: "Background electronic noise level" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
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
  phosphor: optionTypes.phosphor.default,
  threshold: optionTypes.threshold.default,
  intensity: optionTypes.intensity.default,
  bloom: optionTypes.bloom.default,
  bloomStrength: optionTypes.bloomStrength.default,
  persistence: optionTypes.persistence.default,
  graticule: optionTypes.graticule.default,
  graticuleDivs: optionTypes.graticuleDivs.default,
  scanlines: optionTypes.scanlines.default,
  scanlineSpacing: optionTypes.scanlineSpacing.default,
  noiseFloor: optionTypes.noiseFloor.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type OscilloscopePalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type OscilloscopeOptions = FilterOptionValues & {
  phosphor?: string;
  threshold?: number;
  intensity?: number;
  bloom?: number;
  bloomStrength?: number;
  persistence?: number;
  graticule?: boolean;
  graticuleDivs?: number;
  scanlines?: boolean;
  scanlineSpacing?: number;
  noiseFloor?: number;
  animSpeed?: number;
  palette?: OscilloscopePalette;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
};

// Simple seeded PRNG
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const oscilloscope = (
  input: any,
  options: OscilloscopeOptions = defaults
) => {
  const {
    phosphor = defaults.phosphor,
    threshold = defaults.threshold,
    intensity = defaults.intensity,
    bloom = defaults.bloom,
    bloomStrength = defaults.bloomStrength,
    persistence = defaults.persistence,
    graticule = defaults.graticule,
    graticuleDivs = defaults.graticuleDivs,
    scanlines = defaults.scanlines,
    scanlineSpacing = defaults.scanlineSpacing,
    noiseFloor = defaults.noiseFloor,
    palette = defaults.palette,
  } = options;

  const prevOutput = options._prevOutput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const len = buf.length;

  const pColor = phosphorColors[phosphor as keyof typeof phosphorColors] || phosphorColors[PHOSPHOR_GREEN];
  const rng = mulberry32(frameIndex * 3571 + 41);

  // Step 1: Convert to luminance intensity — how bright the beam is at each pixel
  const intensityMap = new Float32Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const i = getBufferIndex(x, y, W);
      const luma = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;

      // Threshold: only bright areas become traces
      const above = Math.max(0, luma - threshold) / (255 - threshold);

      // Apply intensity curve — beam brightness is non-linear
      const beamIntensity = Math.pow(above, 1 / intensity);

      // Add noise floor (faint electron noise on the screen)
      const noise = noiseFloor > 0 ? rng() * noiseFloor : 0;

      intensityMap[y * W + x] = Math.min(1, beamIntensity + noise);
    }
  }

  // Step 2: Bloom — bright traces bleed light (separable box blur on intensity)
  let bloomed = intensityMap;
  if (bloom > 0) {
    const r = Math.round(bloom);
    // Horizontal
    const blurH = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, count = 0;
        for (let kx = -r; kx <= r; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          sum += intensityMap[y * W + nx];
          count++;
        }
        blurH[y * W + x] = sum / count;
      }
    }
    // Vertical
    const blurHV = new Float32Array(W * H);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let sum = 0, count = 0;
        for (let ky = -r; ky <= r; ky++) {
          const ny = Math.max(0, Math.min(H - 1, y + ky));
          sum += blurH[ny * W + x];
          count++;
        }
        blurHV[y * W + x] = sum / count;
      }
    }
    // Additive composite: original trace + bloom halo
    bloomed = new Float32Array(W * H);
    for (let j = 0; j < W * H; j++) {
      bloomed[j] = Math.min(1, intensityMap[j] + blurHV[j] * bloomStrength);
    }
  }

  // Step 3: Beam speed brightness — the beam lingers at bright→dark transitions,
  // making edges brighter (slower sweep = more photons hitting phosphor)
  const beamSpeed = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cur = bloomed[y * W + x];
      const prev = x > 0 ? bloomed[y * W + x - 1] : cur;
      // Large intensity change = beam slowing down = brighter
      const delta = Math.abs(cur - prev);
      beamSpeed[y * W + x] = 1 + delta * 0.8;
    }
  }

  // Step 4: Render phosphor color with raster scan lines
  const outBuf = new Uint8ClampedArray(len);
  const bgR = 2, bgG = 3, bgB = 2; // Very dark green-black background
  const spacing = Math.max(2, Math.round(scanlineSpacing));
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const i = getBufferIndex(x, y, W);
      let val = bloomed[y * W + x] * beamSpeed[y * W + x];

      // Raster scan lines: Gaussian beam profile across scan line height
      // The beam has a bright center and falls off above/below
      if (scanlines) {
        const posInLine = y % spacing;
        const center = spacing / 2;
        const dist = Math.abs(posInLine - center) / center; // 0 at center, 1 at edge
        // Gaussian-ish falloff: bright center, dark gaps between lines
        const scanGain = Math.exp(-dist * dist * 3);
        val *= scanGain;
      }

      val = Math.min(1, val);

      // Phosphor color * intensity, with slight saturation boost at high intensity
      const sat = val > 0.7 ? 1 + (val - 0.7) * 1.5 : 1;
      const r = bgR + val * (pColor[0] * sat - bgR);
      const g = bgG + val * (pColor[1] * sat - bgG);
      const b = bgB + val * (pColor[2] * sat - bgB);

      const color = paletteGetColor(palette, rgba(
        Math.min(255, r),
        Math.min(255, g),
        Math.min(255, b),
        255
      ), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  // Step 4: Graticule — overlay faint grid lines
  if (graticule) {
    const divs = Math.max(2, Math.round(graticuleDivs));
    const cellW = W / divs;
    const cellH = H / divs;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const onVertical = Math.abs((x % cellW) - 0) < 1 || Math.abs(x - W + 1) < 1;
        const onHorizontal = Math.abs((y % cellH) - 0) < 1 || Math.abs(y - H + 1) < 1;
        // Centre cross tick marks every ~20% of cell
        const tickSpacing = Math.max(4, Math.round(cellW / 5));
        const onCentreH = Math.abs(y - H / 2) < 1 && x % tickSpacing < 2;
        const onCentreV = Math.abs(x - W / 2) < 1 && y % tickSpacing < 2;

        if (onVertical || onHorizontal || onCentreH || onCentreV) {
          const i = getBufferIndex(x, y, W);
          // Faint phosphor-colored grid
          outBuf[i]     = Math.min(255, outBuf[i] + pColor[0] * 0.12);
          outBuf[i + 1] = Math.min(255, outBuf[i + 1] + pColor[1] * 0.12);
          outBuf[i + 2] = Math.min(255, outBuf[i + 2] + pColor[2] * 0.12);
        }
      }
    }
  }

  // Step 5: Phosphor persistence — blend with previous frame
  if (persistence > 0 && prevOutput && prevOutput.length === outBuf.length) {
    const keep = persistence;
    const fresh = 1 - keep;
    for (let j = 0; j < outBuf.length; j += 4) {
      // Persistence is additive-ish: take max of decayed prev and current
      const pR = prevOutput[j] * keep;
      const pG = prevOutput[j + 1] * keep;
      const pB = prevOutput[j + 2] * keep;
      outBuf[j]     = Math.min(255, Math.max(outBuf[j] * fresh, pR) + outBuf[j] * (1 - fresh));
      outBuf[j + 1] = Math.min(255, Math.max(outBuf[j + 1] * fresh, pG) + outBuf[j + 1] * (1 - fresh));
      outBuf[j + 2] = Math.min(255, Math.max(outBuf[j + 2] * fresh, pB) + outBuf[j + 2] * (1 - fresh));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Oscilloscope",
  func: oscilloscope,
  options: defaults,
  optionTypes,
  defaults,
  mainThread: true
});
