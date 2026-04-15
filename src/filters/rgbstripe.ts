// Not ported to WASM. Attempted a full pipeline port (misconvergence
// pre-pass + main loop + beam spread + bloom + persistence) with bit-exact
// parity. Net result was ~0.77-0.95x at 1280x720 across defaults/variants.
//
// The blocker: the reference pipeline calls `paletteGetColor` per-pixel in
// the main loop (default palette is `nearest` with levels=2, which heavily
// quantizes), and the post-passes (beam spread / bloom) run on that
// palette-quantized output. To preserve bit-parity we had to split the
// WASM into pre-palette and post-palette halves, bouncing through a JS
// per-pixel palette loop between them. That loop (~W*H callbacks) plus two
// wasm-bindgen boundary crossings (each copying the buffer in and out) ate
// the speedup of the main loop, which V8 already JITs competently.
//
// Making it a net win would require porting all palettes to Rust
// (src/palettes/ includes a large user.ts with many named tables) or
// special-casing the default nearest palette in WASM and falling back to JS
// for anything else — both were more invasive than the gains justified.

import { ACTION, BOOL, ENUM, RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import * as palettes from "palettes";
import { renderRgbStripeGL, rgbStripeGLAvailable, paletteShaderLevels } from "./rgbstripeGL";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  scale,
  contrast as contrastFunc,
  brightness as brightnessFunc,
  gamma as gammaFunc,
  paletteGetColor
} from "utils";

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
  // R G B
  [VERTICAL]: (e: number) => [[[1, e, e, 1], [e, 1, e, 1], [e, e, 1, 1]]],
  // R_G_B_
  // _B_R_G
  [STAGGERED]: (e: number) => {
    const r = [0.9, e, e, 1];
    const r2 = [0.8, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];
    const k = [e, e, e, 1];

    return [[r, k, g, k, b, k], [k, b, k, r2, k, g]];
  },
  // G B R
  // B R G
  // R G B
  [LADDER]: (e: number) => {
    const r = [1, e, e, 1];
    const g = [e, 1, e, 1];
    const b = [e, e, 1, 1];

    return [[r, g, b], [g, b, r], [b, r, g]];
  },
  // R G B R G B
  // R G B _ _ _
  // R G B R G B
  // _ _ _ R G B
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
  // R G B _ R G B _
  // B _ R G B _ R G
  // R G B _ R G B _
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

// One-shot logger so flipping the GL fast path on/off shows up clearly in
// the console without spamming every frame.
let _lastGLLog: string | null = null;
const logGLPathOnce = (label: string): void => {
  if (_lastGLLog === label) return;
  _lastGLLog = label;
  console.info(`[filter:rgbStripe] ${label}`);
};

// Newton's method to invert barrel distortion: r_dst = r_src * (1 + k * r_src^2)
const invertRadius = (rDst: number, k: number): number => {
  if (rDst === 0) return 0;
  let r = rDst;
  for (let n = 0; n < 8; n += 1) {
    const r2 = r * r;
    const f = r * (1 + k * r2) - rDst;
    const fp = 1 + 3 * k * r2;
    if (fp === 0) break;
    r -= f / fp;
  }
  return r;
};

// Clamp-safe buffer read
const readBuf = (buf: Uint8ClampedArray, x: number, y: number, W: number, H: number): [number, number, number, number] => {
  const cx = Math.max(0, Math.min(W - 1, x));
  const cy = Math.max(0, Math.min(H - 1, y));
  const i = getBufferIndex(cx, cy, W);
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
};

const rgbStripe = (
  input: any,
  options: RgbStripeOptions = defaults
) => {
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
  const degaussT = isDegaussing ? 1 - degaussAge / DEGAUSS_DURATION : 0; // 1→0 decay

  let output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Misconvergence: pre-split channels with per-channel offset that grows toward edges
  // During degauss: massively boost misconvergence with oscillating wobble
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

  // GL fast path: if the WebGL renderer is available and the palette is
  // either identity or `nearest` (the only one the shader implements), run
  // the full pipeline on the GPU. Anything that requires palette logic the
  // shader can't reproduce falls through to the JS path below.
  const accelOpts = options as { _wasmAcceleration?: boolean; _webglAcceleration?: boolean };
  const _wasmAcceleration = accelOpts._wasmAcceleration;
  const _webglAcceleration = accelOpts._webglAcceleration;
  const paletteLevels = paletteShaderLevels(palette);
  if (
    _wasmAcceleration !== false
    && _webglAcceleration !== false
    && paletteLevels !== null
    && rgbStripeGLAvailable()
  ) {
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
      paletteLevels,
      prevOutput,
    });
    if (rendered) {
      output = rendered;
      if (blur) {
        const maybeBlurred = convolve.func(output, { ...convolveDefaults, kernel: GAUSSIAN_3X3_WEAK });
        if (maybeBlurred instanceof HTMLCanvasElement) output = maybeBlurred;
      }
      logGLPathOnce("WebGL2 (gpu)");
      return output;
    }
  } else if (_wasmAcceleration !== false) {
    if (paletteLevels === null) logGLPathOnce("JS (palette not shader-portable)");
    else if (!rgbStripeGLAvailable()) logGLPathOnce("JS (WebGL2 unavailable)");
  }

  const effectiveMisconvergence = misconvergence + degaussMisconvergence;
  let rBuf = buf, gBuf = buf, bBuf = buf;
  const hasMisconvergence = effectiveMisconvergence > 0;
  if (hasMisconvergence) {
    rBuf = new Uint8ClampedArray(buf.length);
    gBuf = new Uint8ClampedArray(buf.length);
    bBuf = new Uint8ClampedArray(buf.length);
    const halfW = W / 2;
    const halfH = H / 2;
    for (let x = 0; x < W; x += 1) {
      for (let y = 0; y < H; y += 1) {
        const i = getBufferIndex(x, y, W);
        // Offset grows radially from center
        const dx = (x - halfW) / halfW;
        const dy = (y - halfH) / halfH;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const offset = Math.round(effectiveMisconvergence * dist);
        // R shifts outward, B shifts inward, G gets degauss wobble
        const rOff = Math.round(dx * offset + degaussWobbleX);
        const rOffY = Math.round(dy * offset * 0.3 + degaussWobbleY);
        const bOff = Math.round(-dx * offset - degaussWobbleX * 0.7);
        const bOffY = Math.round(-dy * offset * 0.3 - degaussWobbleY * 0.7);
        const gOffX = Math.round(degaussWobbleX * 0.3);
        const gOffY = Math.round(degaussWobbleY * 0.5);
        const rPx = readBuf(buf, x + rOff, y + rOffY, W, H);
        const gPx = readBuf(buf, x + gOffX, y + gOffY, W, H);
        const bPx = readBuf(buf, x + bOff, y + bOffY, W, H);
        rBuf[i] = rPx[0]; rBuf[i + 1] = rPx[1]; rBuf[i + 2] = rPx[2]; rBuf[i + 3] = rPx[3];
        gBuf[i] = gPx[0]; gBuf[i + 1] = gPx[1]; gBuf[i + 2] = gPx[2]; gBuf[i + 3] = gPx[3];
        bBuf[i] = bPx[0]; bBuf[i + 1] = bPx[1]; bBuf[i + 2] = bPx[2]; bBuf[i + 3] = bPx[3];
      }
    }
  }

  const outputBuf = new Uint8ClampedArray(buf.length);
  const effect = 1 - strength;
  const mask = masks[shadowMask as keyof typeof masks](effect);
  const maskH = mask.length;
  const maskW = mask[0].length;
  const pScale = Math.max(1, Math.round(phosphorScale));
  const gap = Math.max(1, Math.round(scanlineGap));

  // Beam flicker: per-frame brightness jitter
  const flickerAmount = flicker > 0 ? 1 - flicker + flicker * (Math.sin(frameIndex * 7.3 + Math.cos(frameIndex * 3.1)) * 0.5 + 0.5) : 1;

  // Curvature setup
  const hasCurvature = curvature > 0;
  const cx = W / 2;
  const cy = H / 2;
  const rNorm = Math.sqrt(cx * cx + cy * cy);
  const k = curvature * 2;

  // Vignette setup
  const hasVignette = vignette > 0;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  // Interlace: determine which field is active this frame
  const interlaceField = interlace ? (frameIndex % 2) : -1;

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);

      // Interlace: on inactive scanlines, use previous frame data
      if (interlace && (y % 2) !== interlaceField) {
        if (prevOutput && prevOutput.length === buf.length) {
          fillBufferPixel(outputBuf, i, prevOutput[i], prevOutput[i + 1], prevOutput[i + 2], prevOutput[i + 3]);
        } else {
          // No previous frame — darken to simulate the missing field
          const si = getBufferIndex(x, y, W);
          fillBufferPixel(outputBuf, si, 0, 0, 0, buf[si + 3]);
        }
        continue;
      }

      // Apply barrel distortion to find source pixel
      let srcX = x;
      let srcY = y;
      if (hasCurvature) {
        const nx = (x - cx) / rNorm;
        const ny = (y - cy) / rNorm;
        const rDst = Math.sqrt(nx * nx + ny * ny);
        const rSrc = invertRadius(rDst, k);
        const s = rDst > 0 ? rSrc / rDst : 1;
        srcX = Math.round(cx + nx * s * rNorm);
        srcY = Math.round(cy + ny * s * rNorm);
      }

      // Degauss geometric warp — oscillating magnetic field warps the raster
      if (isDegaussing) {
        const warpFreqX = 3.5 + degaussAge * 0.15;
        const warpFreqY = 2.8 + degaussAge * 0.12;
        const warpAmp = degaussT * degaussT * 40;
        // Horizontal wave distortion (dominant — like the AC field sweeping)
        srcX += Math.round(Math.sin(y / H * Math.PI * warpFreqY + degaussAge * 1.9) * warpAmp);
        // Vertical wobble (subtler)
        srcY += Math.round(Math.sin(x / W * Math.PI * warpFreqX + degaussAge * 2.7) * warpAmp * 0.5);
      }

      // Out of bounds — black
      if (srcX < 0 || srcX >= W || srcY < 0 || srcY >= H) {
        fillBufferPixel(outputBuf, i, 0, 0, 0, 255);
        continue;
      }

      const srcI = getBufferIndex(srcX, srcY, W);

      // Read per-channel from misconvergence-split buffers
      let srcR = hasMisconvergence ? rBuf[getBufferIndex(srcX, srcY, W)] : buf[srcI];
      let srcG = hasMisconvergence ? gBuf[getBufferIndex(srcX, srcY, W) + 1] : buf[srcI + 1];
      let srcB = hasMisconvergence ? bBuf[getBufferIndex(srcX, srcY, W) + 2] : buf[srcI + 2];
      const srcA = buf[srcI + 3];

      // Degauss hue rotation — magnetized shadow mask sends beams to wrong phosphors,
      // creating rainbow color shifts that vary across the screen
      if (isDegaussing) {
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        // Hue angle varies by position and oscillates with the AC field
        const hueAngle = degaussT * degaussT * Math.PI * 1.5
          * Math.sin(dx * 2.5 + degaussAge * 1.3)
          * Math.cos(dy * 2.0 + degaussAge * 0.9);
        const cos = Math.cos(hueAngle);
        const sin = Math.sin(hueAngle);
        // Approximate RGB hue rotation matrix
        const r = srcR * (0.213 + 0.787 * cos - 0.213 * sin)
                + srcG * (0.715 - 0.715 * cos - 0.715 * sin)
                + srcB * (0.072 - 0.072 * cos + 0.928 * sin);
        const g = srcR * (0.213 - 0.213 * cos + 0.143 * sin)
                + srcG * (0.715 + 0.285 * cos + 0.140 * sin)
                + srcB * (0.072 - 0.072 * cos - 0.283 * sin);
        const b = srcR * (0.213 - 0.213 * cos - 0.787 * sin)
                + srcG * (0.715 - 0.715 * cos + 0.715 * sin)
                + srcB * (0.072 + 0.928 * cos + 0.072 * sin);
        srcR = Math.max(0, Math.min(255, r));
        srcG = Math.max(0, Math.min(255, g));
        srcB = Math.max(0, Math.min(255, b));
      }

      // Mask R/G/B alternating, scaled by phosphorScale
      const maskxIdx = Math.floor(x / pScale) % maskW;
      const maskyIdx = Math.floor(y / pScale) % maskH;
      const masked = rgba(
        srcR * mask[maskyIdx][maskxIdx][0],
        srcG * mask[maskyIdx][maskxIdx][1],
        srcB * mask[maskyIdx][maskxIdx][2],
        srcA
      );

      // Bring up brightness as we've masked off too much
      const brightnessAdjusted = brightnessFunc(masked, brightness, exposure);
      const contrastAdjusted = contrastFunc(brightnessAdjusted, contrast);
      const gammaAdjusted = gammaFunc(contrastAdjusted, gamma);

      // Scanlines at configurable gap, scaled by phosphor scale
      const scanlineRow = Math.floor(y / pScale);
      const scanlineScale =
        includeScanline && scanlineRow % gap === 0 ? scanlineStrength : 1;
      const scanlined = scale(gammaAdjusted, scanlineScale);

      // Degauss brightness flash — bright pulse that decays
      let degaussed = scanlined;
      if (isDegaussing) {
        const flash = 1 + degaussT * 1.2 * Math.abs(Math.sin(degaussAge * 0.8));
        degaussed = scale(scanlined, flash);
      }

      // Beam flicker
      const flickered = flicker > 0 ? scale(degaussed, flickerAmount) : degaussed;

      // Vignette — darken edges
      let vignetted = flickered;
      if (hasVignette) {
        const ddx = x - cx;
        const ddy = y - cy;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy) / maxDist;
        const vFactor = 1 - vignette * dist * dist;
        vignetted = scale(flickered, Math.max(0, vFactor));
      }

      const color = paletteGetColor(palette, vignetted, palette.options, false);

      fillBufferPixel(outputBuf, i, color[0], color[1], color[2], srcA);
    }
  }

  // Horizontal beam spread: blur only horizontally to simulate beam width
  if (beamSpread > 0) {
    const r = Math.round(beamSpread);
    const temp = new Uint8ClampedArray(outputBuf.length);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let sr = 0, sg = 0, sb = 0, count = 0;
        for (let kx = -r; kx <= r; kx += 1) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ki = getBufferIndex(nx, y, W);
          // Gaussian-ish weight: center pixels count more
          const w = 1 - Math.abs(kx) / (r + 1);
          sr += outputBuf[ki] * w;
          sg += outputBuf[ki + 1] * w;
          sb += outputBuf[ki + 2] * w;
          count += w;
        }
        const bi = getBufferIndex(x, y, W);
        temp[bi] = sr / count;
        temp[bi + 1] = sg / count;
        temp[bi + 2] = sb / count;
        temp[bi + 3] = outputBuf[bi + 3];
      }
    }
    outputBuf.set(temp);
  }

  // Phosphor bloom: extract bright masked pixels, blur, additive blend
  if (bloom) {
    const threshold = bloomThreshold;
    const r = bloomRadius;
    const str = bloomStrength;

    const bright = new Float32Array(outputBuf.length);
    for (let j = 0; j < outputBuf.length; j += 4) {
      bright[j]     = Math.max(0, outputBuf[j]     - threshold);
      bright[j + 1] = Math.max(0, outputBuf[j + 1] - threshold);
      bright[j + 2] = Math.max(0, outputBuf[j + 2] - threshold);
      bright[j + 3] = outputBuf[j + 3];
    }

    // Separable box blur — horizontal
    const blurH = new Float32Array(outputBuf.length);
    for (let by = 0; by < H; by += 1) {
      for (let bx = 0; bx < W; bx += 1) {
        let sr = 0, sg = 0, sb = 0, count = 0;
        for (let kx = -r; kx <= r; kx += 1) {
          const nx = Math.max(0, Math.min(W - 1, bx + kx));
          const ki = getBufferIndex(nx, by, W);
          sr += bright[ki]; sg += bright[ki + 1]; sb += bright[ki + 2];
          count += 1;
        }
        const bi = getBufferIndex(bx, by, W);
        blurH[bi] = sr / count; blurH[bi + 1] = sg / count; blurH[bi + 2] = sb / count;
        blurH[bi + 3] = bright[bi + 3];
      }
    }

    // Vertical
    const blurHV = new Float32Array(outputBuf.length);
    for (let bx = 0; bx < W; bx += 1) {
      for (let by = 0; by < H; by += 1) {
        let sr = 0, sg = 0, sb = 0, count = 0;
        for (let ky = -r; ky <= r; ky += 1) {
          const ny = Math.max(0, Math.min(H - 1, by + ky));
          const ki = getBufferIndex(bx, ny, W);
          sr += blurH[ki]; sg += blurH[ki + 1]; sb += blurH[ki + 2];
          count += 1;
        }
        const bi = getBufferIndex(bx, by, W);
        blurHV[bi] = sr / count; blurHV[bi + 1] = sg / count; blurHV[bi + 2] = sb / count;
        blurHV[bi + 3] = blurH[bi + 3];
      }
    }

    // Additive composite
    for (let j = 0; j < outputBuf.length; j += 4) {
      outputBuf[j]     = Math.min(255, outputBuf[j]     + blurHV[j]     * str);
      outputBuf[j + 1] = Math.min(255, outputBuf[j + 1] + blurHV[j + 1] * str);
      outputBuf[j + 2] = Math.min(255, outputBuf[j + 2] + blurHV[j + 2] * str);
    }
  }

  // Phosphor persistence: blend with previous frame
  if (persistence > 0 && prevOutput && prevOutput.length === outputBuf.length) {
    const keep = persistence;
    const fresh = 1 - keep;
    for (let j = 0; j < outputBuf.length; j += 4) {
      outputBuf[j]     = Math.min(255, outputBuf[j] * fresh + prevOutput[j] * keep);
      outputBuf[j + 1] = Math.min(255, outputBuf[j + 1] * fresh + prevOutput[j + 1] * keep);
      outputBuf[j + 2] = Math.min(255, outputBuf[j + 2] * fresh + prevOutput[j + 2] * keep);
    }
  }

  outputCtx.putImageData(
    new ImageData(outputBuf, output.width, output.height),
    0,
    0
  );

  if (blur) {
    const maybeBlurred = convolve.func(output, {
      ...convolveDefaults,
      kernel: GAUSSIAN_3X3_WEAK
    });
    if (maybeBlurred instanceof HTMLCanvasElement) {
      output = maybeBlurred;
    }
  }

  return output;
};

export default defineFilter({
  name: "rgbStripe",
  func: rgbStripe,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true
});
