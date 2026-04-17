import { ACTION, BOOL, ENUM, RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import * as palettes from "palettes";
import { renderRgbStripeGL, paletteShaderLevels } from "./rgbstripeGL";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas } from "palettes/backend";

import convolve, {
  GAUSSIAN_3X3_WEAK,
  defaults as convolveDefaults
} from "./convolve";

export const VERTICAL = "VERTICAL";
export const STAGGERED = "STAGGERED";
export const LADDER = "LADDER";
export const TILED = "TILED";
export const HEX_GAP = "HEX_GAP";

const masks = {
  [VERTICAL]: (e: number) => [[[1, e, e, 1], [e, 1, e, 1], [e, e, 1, 1]]],
  [STAGGERED]: (e: number) => {
    const r = [0.9, e, e, 1];
    const r2 = [0.8, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];
    const k = [e, e, e, 1];

    return [[r, k, g, k, b, k], [k, b, k, r2, k, g]];
  },
  [LADDER]: (e: number) => {
    const r = [1, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];

    return [[r, g, b], [g, b, r], [b, r, g]];
  },
  [TILED]: (e: number) => {
    const r = [1, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];
    const k = [e, e, e, 1];

    return [
      [r, g, b, r, g, b],
      [r, g, b, k, k, k],
      [r, g, b, r, g, b],
      [k, k, k, r, g, b]
    ];
  },
  [HEX_GAP]: (e: number) => {
    const r = [1, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];
    const k = [e, e, e, 1];

    return [[r, g, b, k], [b, k, r, g]];
  }
};

export const optionTypes = {
  contrast: { type: RANGE, range: [-40, 40], step: 0.1, default: 4, desc: "CRT contrast adjustment" },
  strength: { type: RANGE, range: [-1, 1], step: 0.05, default: 0.7, desc: "Phosphor mask visibility" },
  brightness: { type: RANGE, range: [-255, 255], step: 1, default: 40, desc: "Overall brightness offset" },
  exposure: { type: RANGE, range: [0, 4], step: 0.05, default: 1.5, desc: "Exposure multiplier" },
  gamma: { type: RANGE, range: [0, 4], step: 0.05, default: 2.2, desc: "Gamma correction curve" },
  phosphorScale: { type: RANGE, range: [1, 6], step: 1, default: 2, desc: "Phosphor triad cell size" },
  includeScanline: { type: BOOL, default: true, desc: "Enable horizontal scan lines" },
  scanlineGap: { type: RANGE, range: [1, 12], step: 1, default: 3, desc: "Spacing between scan lines" },
  scanlineStrength: { type: RANGE, range: [-2, 2], step: 0.05, default: 0.75, desc: "Scan line darkness" },
  shadowMask: {
    type: ENUM,
    options: [
      { name: "Vertical", value: VERTICAL },
      { name: "Staggered", value: STAGGERED },
      { name: "Ladder", value: LADDER },
      { name: "Tiled", value: TILED },
      { name: "Hex", value: HEX_GAP }
    ],
    default: HEX_GAP,
    desc: "RGB phosphor arrangement pattern"
  },
  misconvergence: { type: RANGE, range: [0, 6], step: 0.5, default: 1, desc: "Color channel misalignment" },
  beamSpread: { type: RANGE, range: [0, 8], step: 1, default: 2, desc: "Electron beam blur radius" },
  bloom: { type: BOOL, default: true, desc: "Enable bright-area glow" },
  bloomThreshold: { type: RANGE, range: [0, 255], step: 1, default: 140, desc: "Brightness level where bloom starts" },
  bloomRadius: { type: RANGE, range: [1, 20], step: 1, default: 4, desc: "Bloom glow radius" },
  bloomStrength: { type: RANGE, range: [0, 3], step: 0.05, default: 0.6, desc: "Bloom glow intensity" },
  curvature: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "CRT screen barrel curvature" },
  vignette: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Edge darkening from curvature" },
  interlace: { type: BOOL, default: false, desc: "Simulate interlaced scanning" },
  persistence: { type: RANGE, label: "Phosphor Persistence Afterglow", range: [0, 1], step: 0.01, default: 0, desc: "Phosphor afterglow persistence" },
  flicker: { type: RANGE, range: [0, 0.15], step: 0.005, default: 0, desc: "Frame-to-frame brightness flicker" },
  degauss: {
    type: ACTION,
    label: "Degauss",
    action: (actions: any, inputCanvas: any) => {
      actions.triggerDegauss(inputCanvas);
    }
  },
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
  blur: { type: BOOL, default: true, desc: "Apply light Gaussian blur for softness" },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  contrast: optionTypes.contrast.default,
  brightness: optionTypes.brightness.default,
  exposure: optionTypes.exposure.default,
  gamma: optionTypes.gamma.default,
  phosphorScale: optionTypes.phosphorScale.default,
  includeScanline: optionTypes.includeScanline.default,
  scanlineGap: optionTypes.scanlineGap.default,
  scanlineStrength: optionTypes.scanlineStrength.default,
  shadowMask: optionTypes.shadowMask.default,
  misconvergence: optionTypes.misconvergence.default,
  beamSpread: optionTypes.beamSpread.default,
  bloom: optionTypes.bloom.default,
  bloomThreshold: optionTypes.bloomThreshold.default,
  bloomRadius: optionTypes.bloomRadius.default,
  bloomStrength: optionTypes.bloomStrength.default,
  curvature: optionTypes.curvature.default,
  vignette: optionTypes.vignette.default,
  interlace: optionTypes.interlace.default,
  persistence: optionTypes.persistence.default,
  flicker: optionTypes.flicker.default,
  animSpeed: optionTypes.animSpeed.default,
  blur: optionTypes.blur.default,
  palette: optionTypes.palette.default
};

type RgbStripePalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type RgbStripeOptions = FilterOptionValues & {
  includeScanline?: boolean;
  scanlineGap?: number;
  scanlineStrength?: number;
  shadowMask?: string;
  brightness?: number;
  contrast?: number;
  exposure?: number;
  gamma?: number;
  strength?: number;
  phosphorScale?: number;
  misconvergence?: number;
  beamSpread?: number;
  bloom?: boolean;
  bloomThreshold?: number;
  bloomRadius?: number;
  bloomStrength?: number;
  curvature?: number;
  vignette?: number;
  interlace?: boolean;
  persistence?: number;
  flicker?: number;
  animSpeed?: number;
  blur?: boolean;
  palette?: RgbStripePalette;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
  _degaussFrame?: number;
};

const rgbStripe = (input: any, options: RgbStripeOptions = defaults) => {
  const {
    includeScanline = defaults.includeScanline,
    scanlineGap = defaults.scanlineGap,
    scanlineStrength = defaults.scanlineStrength,
    shadowMask = defaults.shadowMask,
    brightness = defaults.brightness,
    contrast = defaults.contrast,
    exposure = defaults.exposure,
    gamma = defaults.gamma,
    strength = defaults.strength,
    phosphorScale = defaults.phosphorScale,
    misconvergence = defaults.misconvergence,
    beamSpread = defaults.beamSpread,
    bloom = defaults.bloom,
    bloomThreshold = defaults.bloomThreshold,
    bloomRadius = defaults.bloomRadius,
    bloomStrength = defaults.bloomStrength,
    curvature = defaults.curvature,
    vignette = defaults.vignette,
    interlace = defaults.interlace,
    persistence = defaults.persistence,
    flicker = defaults.flicker,
    blur = defaults.blur,
    palette = defaults.palette,
  } = options;

  const prevOutput = options._prevOutput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const degaussFrame = Number(options._degaussFrame ?? -Infinity);

  // Degauss: decaying wobble over 45 frames (~1.5s)
  const DEGAUSS_DURATION = 45;
  const degaussAge = frameIndex - degaussFrame;
  const isDegaussing = degaussAge >= 0 && degaussAge < DEGAUSS_DURATION;
  const degaussT = isDegaussing ? 1 - degaussAge / DEGAUSS_DURATION : 0;

  const W = input.width;
  const H = input.height;

  // Non-nearest palettes bypass the shader quantize — render at 256 levels and
  // apply the shared CPU palette pass on readback.
  const shaderLevels = paletteShaderLevels(palette);
  const quantizeInShader = shaderLevels !== null;
  const levelsForShader = shaderLevels ?? 256;

  const effect = 1 - strength;
  const maskTbl = masks[shadowMask as keyof typeof masks](effect);
  const mH = maskTbl.length;
  const mW = maskTbl[0].length;
  const flat = new Float32Array(mH * mW * 3);
  for (let y = 0; y < mH; y += 1) {
    for (let x = 0; x < mW; x += 1) {
      const cell = maskTbl[y][x];
      flat[(y * mW + x) * 3]     = cell[0];
      flat[(y * mW + x) * 3 + 1] = cell[1];
      flat[(y * mW + x) * 3 + 2] = cell[2];
    }
  }

  const degaussMisconvergence = isDegaussing
    ? misconvergence + degaussT * degaussT * 50
    : 0;
  const degaussWobbleX = isDegaussing
    ? Math.sin(degaussAge * 1.7) * degaussT * 30
      + Math.sin(degaussAge * 4.1) * degaussT * degaussT * 15
    : 0;
  const degaussWobbleY = isDegaussing
    ? Math.cos(degaussAge * 2.3) * degaussT * 20
      + Math.cos(degaussAge * 5.7) * degaussT * degaussT * 10
    : 0;
  void degaussMisconvergence;

  const rendered = renderRgbStripeGL(input, {
    width: W, height: H,
    mask: flat, maskW: mW, maskH: mH,
    brightness, contrast, exposure, gamma,
    phosphorScale: Math.max(1, Math.round(phosphorScale)),
    scanlineGap: Math.max(1, Math.round(scanlineGap)),
    scanlineStrength,
    includeScanline,
    misconvergence,
    curvature, vignette,
    interlace,
    interlaceField: interlace ? (frameIndex % 2) : -1,
    flicker,
    frameIndex,
    isDegaussing,
    degaussAge,
    degaussT,
    degaussWobbleX,
    degaussWobbleY,
    beamSpread: Math.round(beamSpread),
    bloom,
    bloomThreshold, bloomRadius, bloomStrength,
    persistence,
    paletteLevels: levelsForShader,
    prevOutput,
  });
  if (!rendered) return input;

  let output: HTMLCanvasElement | OffscreenCanvas = rendered;
  if (!quantizeInShader) {
    const quantized = applyPalettePassToCanvas(output, W, H, palette);
    if (quantized) output = quantized;
  }
  if (blur) {
    const maybeBlurred = convolve.func(output, { ...convolveDefaults, kernel: GAUSSIAN_3X3_WEAK });
    if (maybeBlurred instanceof HTMLCanvasElement) output = maybeBlurred;
  }
  logFilterBackend("rgbStripe", "WebGL2", `mask=${shadowMask}${quantizeInShader ? "" : "+palettePass"}${blur ? "+blur" : ""}`);
  return output;
};

export default defineFilter({
  name: "rgbStripe",
  func: rgbStripe,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  requiresGL: true,
});
