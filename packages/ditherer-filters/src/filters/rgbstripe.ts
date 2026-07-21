import { ACTION, BOOL, ENUM, RANGE, PALETTE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import * as palettes from "../palettes/index";
import { renderRgbStripeGL, paletteShaderLevels } from "./rgbstripeGL";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas } from "../palettes/backend";
import {
  CRT_PROFILE,
  crtProfileDefaults,
  resolveCrtProfileSetting,
  resolveVisibleScanlines,
} from "./crtSimulationContracts";

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
    const r = [1, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];
    const k = [e, e, e, 1];

    return [[r, k, g, k, b, k], [k, b, k, r, k, g]];
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
  tubeProfile: {
    type: ENUM,
    options: [
      { name: "240p arcade / console", value: CRT_PROFILE.ARCADE_240P },
      { name: "525/60 consumer TV", value: CRT_PROFILE.CONSUMER_525 },
      { name: "625/50 consumer TV", value: CRT_PROFILE.CONSUMER_625 },
      { name: "Aperture-grille monitor", value: CRT_PROFILE.APERTURE_GRILLE },
      { name: "Broadcast monitor", value: CRT_PROFILE.BROADCAST },
      { name: "Custom raster", value: CRT_PROFILE.CUSTOM },
    ],
    default: CRT_PROFILE.ARCADE_240P,
    desc: "Physical raster and phosphor-mask family used as the simulation baseline",
  },
  contrast: { type: RANGE, range: [-40, 40], step: 0.1, default: 0, desc: "Video-drive gain around reference mid-gray; 20 units doubles the gain" },
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "Visibility of the phosphor mask after mean-light compensation" },
  brightness: { type: RANGE, range: [-64, 64], step: 1, default: 0, desc: "Black-level offset applied to tube drive voltage" },
  exposure: { type: RANGE, range: [0, 4], step: 0.05, default: 1, desc: "Electron-beam current multiplier in linear light" },
  gamma: { type: RANGE, range: [1.6, 3], step: 0.05, default: 2.4, desc: "CRT electro-optical power exponent; 2.4 matches the reference-display model" },
  phosphorScale: { type: RANGE, range: [1, 6], step: 1, default: 2, desc: "Phosphor triad cell size" },
  includeScanline: { type: BOOL, default: true, desc: "Enable horizontal scan lines" },
  visibleScanlines: { type: RANGE, range: [120, 1200], step: 1, default: 240, desc: "Active raster lines in Custom mode, independent of output resolution", visibleWhen: (options: any) => options.tubeProfile === CRT_PROFILE.CUSTOM },
  scanlineGap: { type: RANGE, range: [1, 12], step: 1, default: 3, desc: "Legacy pixel-row spacing retained for saved-chain compatibility" },
  scanlineStrength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.72, desc: "Depth of the dark gap between Gaussian raster beam centers" },
  beamMinWidth: { type: RANGE, range: [0.08, 0.7], step: 0.01, default: 0.18, desc: "Gaussian raster spot width at low beam current, in line-pitch units" },
  beamMaxWidth: { type: RANGE, range: [0.12, 0.9], step: 0.01, default: 0.42, desc: "Wider raster spot at high beam current from electron-beam blooming" },
  cornerFocus: { type: RANGE, range: [0, 0.4], step: 0.01, default: 0.1, desc: "Additional beam widening toward the deflection extremes" },
  shadowMask: {
    type: ENUM,
    options: [
      { name: "Aperture grille", value: VERTICAL },
      { name: "Delta shadow mask", value: STAGGERED },
      { name: "Inline dot mask", value: LADDER },
      { name: "Slot mask", value: TILED },
      { name: "Staggered slot mask", value: HEX_GAP }
    ],
    default: HEX_GAP,
    desc: "RGB phosphor arrangement pattern",
    visibleWhen: (options: any) => options.tubeProfile === CRT_PROFILE.CUSTOM,
  },
  misconvergence: { type: RANGE, range: [0, 6], step: 0.25, default: 0.25, desc: "Residual RGB convergence error that grows toward screen edges" },
  beamSpread: { type: RANGE, range: [0, 8], step: 1, default: 0, desc: "Horizontal video-bandwidth softness after raster formation" },
  bloom: { type: BOOL, default: true, desc: "Enable bright-area glow" },
  bloomThreshold: { type: RANGE, range: [0, 255], step: 1, default: 190, desc: "Linear-light beam level where faceplate halo begins" },
  bloomRadius: { type: RANGE, range: [1, 20], step: 1, default: 4, desc: "Bloom glow radius" },
  bloomStrength: { type: RANGE, range: [0, 3], step: 0.05, default: 0.22, desc: "Faceplate halo intensity above the bloom threshold" },
  curvature: { type: RANGE, range: [0, 1], step: 0.01, default: 0.08, desc: "Glass and deflection barrel curvature" },
  overscan: { type: RANGE, range: [0, 0.12], step: 0.005, default: 0.025, desc: "Picture cropped beyond the visible raster; broadcast reference maximum is 7%" },
  vignette: { type: RANGE, range: [0, 1], step: 0.01, default: 0.12, desc: "Edge light loss through curved faceplate glass" },
  damperWireStrength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Horizontal grille-stabilizing wires on aperture-grille profiles", visibleWhen: (options: any) => options.tubeProfile === CRT_PROFILE.APERTURE_GRILLE },
  interlace: { type: BOOL, default: false, desc: "Simulate interlaced scanning in Custom mode", visibleWhen: (options: any) => options.tubeProfile === CRT_PROFILE.CUSTOM },
  persistence: { type: RANGE, label: "Phosphor Persistence Afterglow", range: [0, 1], step: 0.01, default: 0, desc: "Phosphor afterglow persistence" },
  flicker: { type: RANGE, range: [0, 0.15], step: 0.005, default: 0, desc: "Frame-to-frame brightness flicker" },
  degauss: {
    type: ACTION,
    label: "Degauss",
    desc: "Trigger the tube's decaying magnetic degauss pulse",
    action: (actions: any, inputCanvas: any) => {
      actions.triggerDegauss(inputCanvas);
    }
  },
  animSpeed: { type: RANGE, range: [1, 60], step: 1, default: 30, desc: "Preview frame rate for flicker, interlace, persistence, and degauss" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Start or stop temporal CRT behavior",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
      }
    }
  },
  blur: { type: BOOL, default: false, desc: "Apply a legacy final Gaussian blur after the physical display model" },
  palette: { type: PALETTE, default: palettes.nearest, desc: "Optional output palette quantization after display encoding" }
};

export const defaults = {
  tubeProfile: optionTypes.tubeProfile.default,
  strength: optionTypes.strength.default,
  contrast: optionTypes.contrast.default,
  brightness: optionTypes.brightness.default,
  exposure: optionTypes.exposure.default,
  gamma: optionTypes.gamma.default,
  phosphorScale: optionTypes.phosphorScale.default,
  includeScanline: optionTypes.includeScanline.default,
  visibleScanlines: optionTypes.visibleScanlines.default,
  scanlineGap: optionTypes.scanlineGap.default,
  scanlineStrength: optionTypes.scanlineStrength.default,
  beamMinWidth: optionTypes.beamMinWidth.default,
  beamMaxWidth: optionTypes.beamMaxWidth.default,
  cornerFocus: optionTypes.cornerFocus.default,
  shadowMask: optionTypes.shadowMask.default,
  misconvergence: optionTypes.misconvergence.default,
  beamSpread: optionTypes.beamSpread.default,
  bloom: optionTypes.bloom.default,
  bloomThreshold: optionTypes.bloomThreshold.default,
  bloomRadius: optionTypes.bloomRadius.default,
  bloomStrength: optionTypes.bloomStrength.default,
  curvature: optionTypes.curvature.default,
  overscan: optionTypes.overscan.default,
  vignette: optionTypes.vignette.default,
  damperWireStrength: optionTypes.damperWireStrength.default,
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
  tubeProfile?: string;
  includeScanline?: boolean;
  visibleScanlines?: number;
  scanlineGap?: number;
  scanlineStrength?: number;
  beamMinWidth?: number;
  beamMaxWidth?: number;
  cornerFocus?: number;
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
  overscan?: number;
  vignette?: number;
  damperWireStrength?: number;
  interlace?: boolean;
  persistence?: number;
  flicker?: number;
  animSpeed?: number;
  blur?: boolean;
  palette?: RgbStripePalette;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
  _isAnimating?: boolean;
  _degaussFrame?: number;
};

const rgbStripe = (input: any, options: RgbStripeOptions = defaults) => {
  const {
    tubeProfile = defaults.tubeProfile,
    includeScanline = defaults.includeScanline,
    visibleScanlines = defaults.visibleScanlines,
    scanlineGap = defaults.scanlineGap,
    scanlineStrength = defaults.scanlineStrength,
    beamMinWidth = defaults.beamMinWidth,
    beamMaxWidth = defaults.beamMaxWidth,
    cornerFocus = defaults.cornerFocus,
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
    overscan = defaults.overscan,
    vignette = defaults.vignette,
    damperWireStrength = defaults.damperWireStrength,
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

  const profile = crtProfileDefaults(tubeProfile);
  const resolvedMask = tubeProfile === CRT_PROFILE.CUSTOM ? shadowMask : profile.mask;
  const profileInterlace = tubeProfile === CRT_PROFILE.CUSTOM ? interlace : profile.interlaced;
  const resolvedInterlace = profileInterlace && options._isAnimating === true;
  const resolvedBeamMinWidth = resolveCrtProfileSetting(beamMinWidth, defaults.beamMinWidth, profile.beamMinSigma);
  const resolvedBeamMaxWidth = resolveCrtProfileSetting(beamMaxWidth, defaults.beamMaxWidth, profile.beamMaxSigma);
  const resolvedCornerFocus = resolveCrtProfileSetting(cornerFocus, defaults.cornerFocus, profile.cornerFocus);
  const resolvedCurvature = resolveCrtProfileSetting(curvature, defaults.curvature, profile.curvature);
  const resolvedOverscan = resolveCrtProfileSetting(overscan, defaults.overscan, profile.overscan);
  const effect = 1 - strength;
  const maskTbl = masks[resolvedMask as keyof typeof masks](effect);
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
  const maskCompensation: [number, number, number] = [0, 1, 2].map((channel) => {
    let total = 0;
    for (let index = channel; index < flat.length; index += 3) total += flat[index]!;
    const mean = total / (mH * mW);
    return Math.min(2.25, 1 / Math.max(0.01, mean));
  }) as [number, number, number];

  const degaussWobbleX = isDegaussing
    ? Math.sin(degaussAge * 1.7) * degaussT * 30
      + Math.sin(degaussAge * 4.1) * degaussT * degaussT * 15
    : 0;
  const degaussWobbleY = isDegaussing
    ? Math.cos(degaussAge * 2.3) * degaussT * 20
      + Math.cos(degaussAge * 5.7) * degaussT * degaussT * 10
    : 0;
  const rendered = renderRgbStripeGL(input, {
    width: W, height: H,
    mask: flat, maskW: mW, maskH: mH, maskCompensation,
    brightness, contrast, exposure, gamma,
    phosphorScale: Math.max(1, Math.round(phosphorScale)),
    visibleScanlines: resolveVisibleScanlines(tubeProfile, visibleScanlines, H),
    scanlineGap: Math.max(1, Math.round(scanlineGap)),
    scanlineStrength,
    beamMinWidth: resolvedBeamMinWidth,
    beamMaxWidth: resolvedBeamMaxWidth,
    cornerFocus: resolvedCornerFocus,
    includeScanline,
    misconvergence,
    curvature: resolvedCurvature,
    overscan: resolvedOverscan,
    vignette,
    damperWires: profile.damperWires,
    damperWireStrength,
    interlace: resolvedInterlace,
    interlaceField: resolvedInterlace ? (frameIndex % 2) : -1,
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
    // Duck-type check — HTMLCanvasElement is undefined in Worker scope,
    // so `instanceof HTMLCanvasElement` would ReferenceError there.
    if (maybeBlurred && typeof (maybeBlurred as { getContext?: unknown }).getContext === "function") {
      output = maybeBlurred as HTMLCanvasElement | OffscreenCanvas;
    }
  }
  logFilterBackend("rgbStripe", "WebGL2", `${tubeProfile} mask=${resolvedMask}${quantizeInShader ? "" : "+palettePass"}${blur ? "+blur" : ""}`);
  return output;
};

export default defineFilter({
  name: "rgbStripe",
  func: rgbStripe,
  optionTypes,
  options: defaults,
  defaults,
  description: "Profiled CRT display model with voltage-to-light transfer, beam-current scanlines, phosphor masks, overscan, convergence, and faceplate bloom",
  requiresGL: true,
  temporal: true,
});
