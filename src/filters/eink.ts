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

const EINK_GRAYSCALE = "GRAYSCALE";
const EINK_COLOR = "COLOR";
const REFRESH_FULL = "FULL";
const REFRESH_PARTIAL = "PARTIAL";

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Grayscale (16-level)", value: EINK_GRAYSCALE },
      { name: "Color (Kaleido/Gallery)", value: EINK_COLOR }
    ],
    default: EINK_GRAYSCALE,
    desc: "E-ink display type to emulate"
  },
  refreshMode: {
    type: ENUM,
    options: [
      { name: "Full (flash clear)", value: REFRESH_FULL },
      { name: "Partial (fast, more ghosting)", value: REFRESH_PARTIAL }
    ],
    default: REFRESH_PARTIAL,
    desc: "Screen refresh method — real devices typically use partial updates and occasional full clears"
  },
  fullRefreshEvery: {
    type: RANGE,
    range: [6, 240],
    step: 1,
    default: 72,
    desc: "In Full mode with video input, run a full flash cycle every N frames instead of every update"
  },
  contrast: { type: RANGE, range: [0.5, 2], step: 0.05, default: 1.2, desc: "Display contrast multiplier" },
  paperWhite: { type: RANGE, range: [180, 255], step: 1, default: 230, desc: "Brightest displayable value" },
  inkBlack: { type: RANGE, range: [0, 80], step: 1, default: 15, desc: "Darkest displayable value" },
  ghosting: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "Previous-frame ghosting intensity" },
  pixelGrid: { type: BOOL, default: true, desc: "Show subtle pixel grid lines" },
  texture: { type: RANGE, range: [0, 0.3], step: 0.01, default: 0.06, desc: "Paper surface texture grain" },
  pageRefresh: {
    type: ACTION,
    label: "Page refresh",
    action: (actions: any, inputCanvas: any) => {
      // Run enough frames to guarantee we pass through all flash phases
      // and end on a normal render (refreshCycle=6 for full, 2 for partial)
      actions.triggerBurst(inputCanvas, 10, 4);
    }
  },
  refreshRate: { type: RANGE, range: [1, 8], step: 1, default: 2, desc: "Screen refresh speed (frames per second)" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.refreshRate || 2);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  refreshMode: optionTypes.refreshMode.default,
  fullRefreshEvery: optionTypes.fullRefreshEvery.default,
  contrast: optionTypes.contrast.default,
  paperWhite: optionTypes.paperWhite.default,
  inkBlack: optionTypes.inkBlack.default,
  ghosting: optionTypes.ghosting.default,
  pixelGrid: optionTypes.pixelGrid.default,
  texture: optionTypes.texture.default,
  refreshRate: optionTypes.refreshRate.default,
  palette: { ...optionTypes.palette.default, options: { levels: 16 } }
};

type EinkPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type EinkOptions = FilterOptionValues & {
  mode?: string;
  refreshMode?: string;
  fullRefreshEvery?: number;
  contrast?: number;
  paperWhite?: number;
  inkBlack?: number;
  ghosting?: number;
  pixelGrid?: boolean;
  texture?: number;
  refreshRate?: number;
  palette?: EinkPalette;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
  _isAnimating?: boolean;
  _hasVideoInput?: boolean;
};

// Simple seeded pseudo-random
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Compute the target e-ink pixel value (no animation, no ghosting)
const computePixel = (
  buf: Uint8ClampedArray, i: number,
  isColor: boolean, contrast: number,
  inkBlack: number, range: number,
  texNoise: number
): [number, number, number] => {
  const luma = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
  const contLuma = Math.max(0, Math.min(255, 128 + (luma - 128) * contrast));
  const mappedLuma = inkBlack + (contLuma / 255) * range;

  if (isColor) {
    const colorSat = 0.35;
    const cR = buf[i] - luma;
    const cG = buf[i + 1] - luma;
    const cB = buf[i + 2] - luma;
    return [
      Math.max(0, Math.min(255, Math.round((mappedLuma + cR * colorSat + texNoise) / 64) * 64)),
      Math.max(0, Math.min(255, Math.round((mappedLuma + cG * colorSat + texNoise) / 64) * 64)),
      Math.max(0, Math.min(255, Math.round((mappedLuma + cB * colorSat + texNoise) / 64) * 64))
    ];
  }

  // Grayscale: 16 levels
  const mapped = mappedLuma + texNoise;
  const step = range / 15;
  const quantized = inkBlack + Math.round((mapped - inkBlack) / step) * step;
  const v = Math.max(0, Math.min(255, quantized));
  return [v, v, v];
};

const eink = (
  input: any,
  options: EinkOptions = defaults
) => {
  const {
    mode,
    refreshMode,
    contrast,
    paperWhite,
    inkBlack,
    fullRefreshEvery,
    ghosting,
    pixelGrid,
    texture,
    palette
  } = options;

  const prevOutput = options._prevOutput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const isAnimLoop = Boolean(options._isAnimating);
  const hasVideoInput = Boolean(options._hasVideoInput);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rng = mulberry32(frameIndex * 6131 + 997);
  const isColor = mode === EINK_COLOR;
  const range = paperWhite - inkBlack;
  const isFullRefresh = refreshMode === REFRESH_FULL;
  const videoRefreshInterval = Math.max(3, Math.round(fullRefreshEvery || 72));

  // Refresh phases (only during animation/burst)
  // Full refresh: 0=white, 1=black, 2=invert, 3+=settle to target
  // Partial refresh: skip flashes, go straight to target (more ghosting)
  const refreshCycle = isFullRefresh ? 6 : 2;
  let phase = refreshCycle; // non-anim = normal
  if (isAnimLoop) {
    if (isFullRefresh && hasVideoInput) {
      // Video on real e-ink tends to use fast partial updates and only
      // occasional global clears, not full flashing every frame.
      const p = frameIndex % videoRefreshInterval;
      phase = p < 3 ? p : refreshCycle;
    } else {
      phase = frameIndex % refreshCycle;
    }
  }

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const i = getBufferIndex(x, y, W);

      // Full refresh flash phases: drive all particles to one extreme
      if (isFullRefresh && isAnimLoop) {
        if (phase === 0) {
          // Drive white — push all white particles to surface
          fillBufferPixel(outBuf, i, paperWhite, paperWhite, paperWhite, 255);
          continue;
        }
        if (phase === 1) {
          // Drive black — push all black particles to surface
          fillBufferPixel(outBuf, i, inkBlack, inkBlack, inkBlack, 255);
          continue;
        }
      }

      const texNoise = texture > 0 ? (rng() - 0.5) * texture * range : 0;
      const [r, g, b] = computePixel(buf, i, isColor, contrast, inkBlack, range, texNoise);

      // During settle phase (phase 2): particles transitioning — show partially settled
      // Pixels that are mid-transition appear slightly wrong
      if (isAnimLoop && isFullRefresh && phase === 2) {
        // Invert — real e-ink briefly shows inverted before settling
        fillBufferPixel(outBuf, i,
          Math.max(0, paperWhite - (r - inkBlack)),
          Math.max(0, paperWhite - (g - inkBlack)),
          Math.max(0, paperWhite - (b - inkBlack)),
          255);
        continue;
      }

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  // Pixel grid: darken pixel boundaries
  if (pixelGrid) {
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (x % 3 === 0 || y % 3 === 0) {
          const i = getBufferIndex(x, y, W);
          outBuf[i]     = Math.round(outBuf[i] * 0.92);
          outBuf[i + 1] = Math.round(outBuf[i + 1] * 0.92);
          outBuf[i + 2] = Math.round(outBuf[i + 2] * 0.92);
        }
      }
    }
  }

  // Ghosting: incomplete particle transitions leave residual previous image
  // Stronger in partial refresh mode (particles don't fully reset)
  if (ghosting > 0 && prevOutput && prevOutput.length === outBuf.length) {
    // Full refresh flash phases clear ghosting (that's the whole point)
    const isClearing = isAnimLoop && isFullRefresh && phase < 2;
    if (!isClearing) {
      const ghostAmount = refreshMode === REFRESH_PARTIAL ? ghosting * 1.5 : ghosting;
      const keep = Math.min(1, ghostAmount);
      const fresh = 1 - keep;
      for (let j = 0; j < outBuf.length; j += 4) {
        outBuf[j]     = Math.min(255, outBuf[j] * fresh + prevOutput[j] * keep);
        outBuf[j + 1] = Math.min(255, outBuf[j + 1] * fresh + prevOutput[j + 1] * keep);
        outBuf[j + 2] = Math.min(255, outBuf[j + 2] * fresh + prevOutput[j + 2] * keep);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "E-ink",
  func: eink,
  options: defaults,
  optionTypes,
  defaults,
  mainThread: true
});
