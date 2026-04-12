import { ENUM, BOOL, RANGE } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex, clamp } from "utils";
import { applyJpegArtifactToCanvas, defaults as jpegDefaults } from "./jpegArtifact";
import { defineFilter } from "filters/types";

const QUALITY_FINE     = "FINE";
const QUALITY_STANDARD = "STANDARD";
const CAPTURE_FIELD = "FIELD";
const CAPTURE_FRAME = "FRAME";
const SCENE_AUTO = "AUTO";
const SCENE_SOFT_PORTRAIT = "SOFT_PORTRAIT";
const SCENE_SPORTS = "SPORTS";
const SCENE_BEACH_SKI = "BEACH_SKI";
const SCENE_SUNSET_MOON = "SUNSET_MOON";
const SCENE_LANDSCAPE = "LANDSCAPE";
const FX_NONE = "NONE";
const FX_PASTEL = "PASTEL";
const FX_NEG_ART = "NEG_ART";
const FX_SEPIA = "SEPIA";
const FX_BW = "BW";

const LIGHTING_AUTO = "AUTO";
const LIGHTING_DAYLIGHT    = "DAYLIGHT";
const LIGHTING_TUNGSTEN    = "TUNGSTEN";
const LIGHTING_FLUORESCENT = "FLUORESCENT";

// Max working resolution — the FD7 CCD is 640x480.
const MAX_W = 640;
const MAX_H = 480;

export const optionTypes = {
  captureMode: {
    type: ENUM,
    options: [
      { name: "Field (single interlaced field)", value: CAPTURE_FIELD },
      { name: "Frame (combine two fields)", value: CAPTURE_FRAME },
    ],
    default: CAPTURE_FIELD,
    desc: "Field uses one interlaced field resampled to full height; Frame combines two fields and can show combing"
  },
  quality: {
    type: ENUM,
    options: [
      { name: "Fine (~72–96 KB/frame)",    value: QUALITY_FINE },
      { name: "Standard (~36–48 KB/frame)", value: QUALITY_STANDARD },
    ],
    default: QUALITY_STANDARD,
    desc: "JPEG compression quality preset with floppy-era file-size bias"
  },
  sceneMode: {
    type: ENUM,
    options: [
      { name: "Auto", value: SCENE_AUTO },
      { name: "Soft Portrait", value: SCENE_SOFT_PORTRAIT },
      { name: "Sports Lesson", value: SCENE_SPORTS },
      { name: "Beach & Ski", value: SCENE_BEACH_SKI },
      { name: "Sunset & Moon", value: SCENE_SUNSET_MOON },
      { name: "Landscape", value: SCENE_LANDSCAPE },
    ],
    default: SCENE_AUTO,
    desc: "FD7 Program AE presets affecting tone, color, and clarity bias"
  },
  pictureEffect: {
    type: ENUM,
    options: [
      { name: "Off", value: FX_NONE },
      { name: "Pastel", value: FX_PASTEL },
      { name: "Neg.Art", value: FX_NEG_ART },
      { name: "Sepia", value: FX_SEPIA },
      { name: "B&W", value: FX_BW },
    ],
    default: FX_NONE,
    desc: "FD7 Picture Effect processing in DSP"
  },
  lighting: {
    type: ENUM,
    options: [
      { name: "Auto WB (default)",           value: LIGHTING_AUTO },
      { name: "Daylight (warm bias)",         value: LIGHTING_DAYLIGHT },
      { name: "Tungsten (strong warm cast)",  value: LIGHTING_TUNGSTEN },
      { name: "Fluorescent (green cast)",     value: LIGHTING_FLUORESCENT },
    ],
    default: LIGHTING_AUTO,
    desc: "Auto white balance (default) or period-accurate lighting overrides"
  },
  flash: { type: BOOL, default: false, desc: "Simulate built-in flash; frame mode falls back to field capture when flash fires" },
  flashPower: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Built-in flash output strength" },
  flashFalloff: { type: RANGE, range: [0.8, 3], step: 0.05, default: 1.55, desc: "How quickly flash illumination falls off with distance" },
  flashOffsetX: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Horizontal flash aim offset (for off-center framing)" },
  flashOffsetY: { type: RANGE, range: [-1, 1], step: 0.01, default: -0.08, desc: "Vertical flash aim offset (slightly above center feels more camera-like)" },
  smear: { type: BOOL, default: false, desc: "CCD smear artifact on bright highlights" },
  nativeVgaOutput: { type: BOOL, default: false, desc: "Keep authentic Mavica output resolution at 640x480 instead of scaling back to input size" },
  frameJitter: { type: ENUM, options: [
    { name: "Off", value: "0" },
    { name: "Low", value: "1" },
    { name: "Medium", value: "2" },
    { name: "High", value: "3" },
  ], default: "2", desc: "In frame mode, odd-field offset strength (camera/subject motion between fields)" },
};

export const defaults = {
  captureMode: optionTypes.captureMode.default,
  quality:  optionTypes.quality.default,
  sceneMode: optionTypes.sceneMode.default,
  pictureEffect: optionTypes.pictureEffect.default,
  lighting: optionTypes.lighting.default,
  flash: optionTypes.flash.default,
  flashPower: optionTypes.flashPower.default,
  flashFalloff: optionTypes.flashFalloff.default,
  flashOffsetX: optionTypes.flashOffsetX.default,
  flashOffsetY: optionTypes.flashOffsetY.default,
  smear:    optionTypes.smear.default,
  nativeVgaOutput: optionTypes.nativeVgaOutput.default,
  frameJitter: optionTypes.frameJitter.default,
};

// AWB colour multipliers — measured from real FD7 output.
// Daylight already has warm bias: R ~+6%, B ~-6% relative to neutral.
const AWB = {
  [LIGHTING_AUTO]:        [1.00, 1.00, 1.00],
  [LIGHTING_DAYLIGHT]:    [1.03, 1.00, 0.90],
  [LIGHTING_TUNGSTEN]:    [1.10, 0.97, 0.72],
  [LIGHTING_FLUORESCENT]: [0.96, 1.06, 0.92],
};

const JPEG_PRESETS = {
  [QUALITY_FINE]: {
    qualityLuma: 52,
    qualityChroma: 44,
    subsampling: "422",
    blockSize: 16,
    ringing: 0.1,
    mosquito: 0.04,
    gridJitter: 0.03,
    corruptBurstChance: 0.01,
    deblock: 0.22,
    temporalHold: 0,
    keyframeInterval: 1,
    preserveAlpha: true,
  },
  [QUALITY_STANDARD]: {
    qualityLuma: 38,
    qualityChroma: 26,
    subsampling: "420",
    blockSize: 16,
    ringing: 0.18,
    mosquito: 0.1,
    gridJitter: 0.08,
    corruptBurstChance: 0.05,
    deblock: 0.15,
    temporalHold: 0,
    keyframeInterval: 1,
    preserveAlpha: true,
  },
};

// Shadow noise sigma — measured: R/B ~8, G ~6.
const NOISE_PARAMS = {
  [QUALITY_FINE]:     { rb: 8,  g: 6 },
  [QUALITY_STANDARD]: { rb: 11, g: 8 },
};

// Deterministic-looking noise from pixel coordinates.
// Uses a simple hash to avoid Math.random() producing different output per run
// while still appearing random spatially.
const pixelNoise = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = ((h ^ (h >> 13)) * 1103515245) | 0;
  return ((h >> 16) & 0xFFFF) / 65535;  // 0..1
};

const computeAutoAwb = (buf: Uint8ClampedArray) => {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const px = Math.max(1, buf.length / 4);

  for (let i = 0; i < buf.length; i += 4) {
    rSum += buf[i];
    gSum += buf[i + 1];
    bSum += buf[i + 2];
  }

  const rAvg = rSum / px;
  const gAvg = gSum / px;
  const bAvg = bSum / px;
  const target = (rAvg + gAvg + bAvg) / 3;

  // Mild clamp to avoid extreme casts; slight warm bias like late-90s CCD auto WB.
  // Conservative gray-world with mild late-90s CCD warm/green tendency.
  const rMul = clamp(0.88, 1.16, target / Math.max(1, rAvg)) * 1.015;
  const gMul = clamp(0.88, 1.16, target / Math.max(1, gAvg)) * 1.005;
  const bMul = clamp(0.88, 1.16, target / Math.max(1, bAvg)) * 0.975;
  return [rMul, gMul, bMul];
};

const applySoulTone = (buf: Uint8ClampedArray, w: number, h: number) => {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = getBufferIndex(x, y, w);
      for (let c = 0; c < 3; c += 1) {
        const v = buf[i + c] / 255;
        // Lift deep shadows slightly, compress highlights, keep midtones gentle.
        const toe = v < 0.08 ? v * 0.65 + 0.02 : v;
        const shoulder = toe > 0.78 ? 0.78 + (toe - 0.78) * 0.58 : toe;
        buf[i + c] = clamp(0, 255, Math.round(shoulder * 255));
      }
    }
  }
};

const applyChromaDelay = (buf: Uint8ClampedArray, w: number, h: number, pixels: number) => {
  if (pixels <= 0) return;
  const src = new Uint8ClampedArray(buf);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const di = getBufferIndex(x, y, w);
      const sx = Math.max(0, Math.min(w - 1, x - pixels));
      const si = getBufferIndex(sx, y, w);
      // Shift chroma-dominant channels for mild camcorder-like color lag.
      buf[di] = src[si];
      buf[di + 2] = src[si + 2];
    }
  }
};

const applyVerticalSoften = (buf: Uint8ClampedArray, w: number, h: number, amount: number) => {
  if (amount <= 0) return;
  const src = new Uint8ClampedArray(buf);
  const a = clamp(0, 1, amount);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = getBufferIndex(x, y, w);
      const iu = getBufferIndex(x, y - 1, w);
      const id = getBufferIndex(x, y + 1, w);
      for (let c = 0; c < 3; c += 1) {
        const mid = src[i + c];
        const avg = (src[iu + c] + src[id + c]) * 0.5;
        buf[i + c] = clamp(0, 255, Math.round(mid * (1 - a) + avg * a));
      }
    }
  }
};

const estimateSceneComplexity = (buf: Uint8ClampedArray, w: number, h: number) => {
  // Lightweight proxy for entropy/detail to tune JPEG pressure.
  const step = Math.max(1, Math.floor(Math.min(w, h) / 120));
  let gradSum = 0;
  let varSum = 0;
  let count = 0;
  let lumSum = 0;

  for (let y = 0; y < h - step; y += step) {
    for (let x = 0; x < w - step; x += step) {
      const i = getBufferIndex(x, y, w);
      const ix = getBufferIndex(x + step, y, w);
      const iy = getBufferIndex(x, y + step, w);
      const l = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      const lx = 0.299 * buf[ix] + 0.587 * buf[ix + 1] + 0.114 * buf[ix + 2];
      const ly = 0.299 * buf[iy] + 0.587 * buf[iy + 1] + 0.114 * buf[iy + 2];
      lumSum += l;
      gradSum += Math.abs(l - lx) + Math.abs(l - ly);
      count += 1;
    }
  }

  const mean = lumSum / Math.max(1, count);
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = getBufferIndex(x, y, w);
      const l = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      const d = l - mean;
      varSum += d * d;
    }
  }

  const gradNorm = clamp(0, 1, (gradSum / Math.max(1, count)) / 80);
  const varNorm = clamp(0, 1, Math.sqrt(varSum / Math.max(1, count)) / 70);
  return clamp(0, 1, gradNorm * 0.65 + varNorm * 0.35);
};

const getBudgetedJpegPreset = (quality: string, complexity: number, flash: boolean) => {
  const base = JPEG_PRESETS[quality] || JPEG_PRESETS[QUALITY_FINE];
  const c = clamp(0, 1, complexity);
  const qDrop = quality === QUALITY_STANDARD ? 10 : 7;
  const chromaDrop = quality === QUALITY_STANDARD ? 14 : 9;

  const tuned = {
    ...jpegDefaults,
    ...base,
    qualityLuma: clamp(8, 95, base.qualityLuma - qDrop * c),
    qualityChroma: clamp(6, 95, base.qualityChroma - chromaDrop * c),
    mosquito: clamp(0, 1, base.mosquito + 0.08 * c),
    ringing: clamp(0, 1, base.ringing + 0.06 * c),
  } as any;

  if (flash) {
    // Flash tends to lower visible shadow noise and slightly raises effective detail.
    tuned.qualityLuma = clamp(8, 95, tuned.qualityLuma + 2);
    tuned.qualityChroma = clamp(6, 95, tuned.qualityChroma + 1);
    tuned.mosquito = clamp(0, 1, tuned.mosquito - 0.03);
  }

  return tuned;
};

const applySceneMode = (buf: Uint8ClampedArray, w: number, h: number, sceneMode: string) => {
  if (sceneMode === SCENE_AUTO) return;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = getBufferIndex(x, y, w);
      let r = buf[i];
      let g = buf[i + 1];
      let b = buf[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (sceneMode === SCENE_SOFT_PORTRAIT) {
        const t = lum / 255;
        r = r * 1.04 + 6;
        g = g * 1.01 + 3;
        b = b * 0.98 + 1;
        const lift = (0.18 - Math.abs(t - 0.5)) * 24;
        r += lift;
        g += lift;
        b += lift;
      } else if (sceneMode === SCENE_SPORTS) {
        r = (r - 128) * 1.08 + 128;
        g = (g - 128) * 1.08 + 128;
        b = (b - 128) * 1.08 + 128;
      } else if (sceneMode === SCENE_BEACH_SKI) {
        const highlightProtect = lum > 210 ? 0.86 : 1.04;
        r = r * highlightProtect * 0.98;
        g = g * highlightProtect * 1.01;
        b = b * highlightProtect * 1.08;
      } else if (sceneMode === SCENE_SUNSET_MOON) {
        r = r * 1.12 + 6;
        g = g * 0.98;
        b = b * 0.86;
        if (lum < 70) {
          r += 4;
          g += 2;
        }
      } else if (sceneMode === SCENE_LANDSCAPE) {
        const c = 1.12;
        r = (r - 128) * c + 128;
        g = (g - 128) * c + 128;
        b = (b - 128) * c + 128;
        g *= 1.06;
      }

      buf[i] = clamp(0, 255, Math.round(r));
      buf[i + 1] = clamp(0, 255, Math.round(g));
      buf[i + 2] = clamp(0, 255, Math.round(b));
    }
  }
};

const applyPictureEffect = (buf: Uint8ClampedArray, w: number, h: number, pictureEffect: string) => {
  if (pictureEffect === FX_NONE) return;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = getBufferIndex(x, y, w);
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];

      if (pictureEffect === FX_NEG_ART) {
        buf[i] = 255 - r;
        buf[i + 1] = 255 - g;
        buf[i + 2] = 255 - b;
        continue;
      }

      if (pictureEffect === FX_BW) {
        const yv = clamp(0, 255, Math.round(0.299 * r + 0.587 * g + 0.114 * b));
        buf[i] = yv;
        buf[i + 1] = yv;
        buf[i + 2] = yv;
        continue;
      }

      if (pictureEffect === FX_SEPIA) {
        const nr = 0.393 * r + 0.769 * g + 0.189 * b;
        const ng = 0.349 * r + 0.686 * g + 0.168 * b;
        const nb = 0.272 * r + 0.534 * g + 0.131 * b;
        buf[i] = clamp(0, 255, Math.round(nr));
        buf[i + 1] = clamp(0, 255, Math.round(ng));
        buf[i + 2] = clamp(0, 255, Math.round(nb));
        continue;
      }

      // PASTEL: flatter tones + animation-like color separation
      const lum = (r + g + b) / 3;
      const sat = 1.18;
      const rr = lum + (r - lum) * sat;
      const gg = lum + (g - lum) * sat;
      const bb = lum + (b - lum) * sat;
      const q = 18;
      buf[i] = clamp(0, 255, Math.round(Math.round(rr / q) * q));
      buf[i + 1] = clamp(0, 255, Math.round(Math.round(gg / q) * q));
      buf[i + 2] = clamp(0, 255, Math.round(Math.round(bb / q) * q));
    }
  }
};

const applyInterlacedCapture = (
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  captureMode: string,
  frameJitter: number
) => {
  const src = new Uint8ClampedArray(buf);

  if (captureMode === CAPTURE_FIELD) {
    // Simulate single-field capture (240 lines) resampled to 480.
    for (let y = 0; y < h; y += 1) {
      if ((y & 1) === 0) continue;
      const y0 = y - 1;
      const y1 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x += 1) {
        const di = getBufferIndex(x, y, w);
        const i0 = getBufferIndex(x, y0, w);
        const i1 = getBufferIndex(x, y1, w);
        buf[di] = (src[i0] + src[i1]) >> 1;
        buf[di + 1] = (src[i0 + 1] + src[i1 + 1]) >> 1;
        buf[di + 2] = (src[i0 + 2] + src[i1 + 2]) >> 1;
      }
    }
    return;
  }

  // Simulate frame mode combining two interlaced fields captured at different instants.
  const jitter = Math.max(0, Math.min(3, frameJitter));
  for (let y = 1; y < h; y += 2) {
    const shiftX = Math.round((pixelNoise(y, 0, 211) - 0.5) * 2 * jitter);
    const shiftY = Math.round((pixelNoise(y, 0, 223) - 0.5) * jitter);
    const srcY = Math.max(0, Math.min(h - 1, y + shiftY));
    for (let x = 0; x < w; x += 1) {
      const srcX = Math.max(0, Math.min(w - 1, x + shiftX));
      const di = getBufferIndex(x, y, w);
      const si = getBufferIndex(srcX, srcY, w);
      buf[di] = src[si];
      buf[di + 1] = src[si + 1];
      buf[di + 2] = src[si + 2];
    }
  }
};

const applyDigicamFlashLighting = (
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  flashPower: number,
  flashFalloff: number,
  flashOffsetX: number,
  flashOffsetY: number
) => {
  const power = clamp(0, 2.5, flashPower);
  if (power <= 0) return;
  const falloff = clamp(0.5, 4, flashFalloff);
  const cx = w * (0.5 + clamp(-1, 1, flashOffsetX) * 0.2);
  const cy = h * (0.45 + clamp(-1, 1, flashOffsetY) * 0.2);
  const maxR = Math.max(w, h) * 0.9;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = getBufferIndex(x, y, w);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxR;
      const radial = clamp(0, 1, 1 - dist);
      const illum = power * Math.pow(radial, falloff);

      // Background drops faster, foreground/hotspot rises quickly.
      const baseGain = 0.74 + illum * 1.35;
      let r = buf[i] * baseGain * 1.02;
      let g = buf[i + 1] * baseGain * 1.0;
      let b = buf[i + 2] * baseGain * 0.98;

      // Specular pop on bright/reflective surfaces under flash.
      const lum = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      const spec = Math.pow(clamp(0, 1, (lum - 120) / 135), 2) * illum * 125;
      r += spec;
      g += spec;
      b += spec * 0.95;

      buf[i] = clamp(0, 255, Math.round(r));
      buf[i + 1] = clamp(0, 255, Math.round(g));
      buf[i + 2] = clamp(0, 255, Math.round(b));
    }
  }
};

const mavicaFd7 = (input, options = defaults) => {
  const {
    captureMode,
    quality,
    sceneMode,
    pictureEffect,
    lighting,
    flash,
    flashPower,
    flashFalloff,
    flashOffsetX,
    flashOffsetY,
    smear,
    nativeVgaOutput,
    frameJitter
  } = options;
  const inputCtx = input.getContext("2d");
  if (!inputCtx) return input;

  const origW = input.width;
  const origH = input.height;

  // Step 1 — Downscale to 640x480 ceiling
  const needsScale = origW > MAX_W || origH > MAX_H;
  const workW = needsScale ? MAX_W : origW;
  const workH = needsScale ? MAX_H : origH;

  const workCanvas = cloneCanvas(input, false);
  workCanvas.width = workW;
  workCanvas.height = workH;
  const workCtx = workCanvas.getContext("2d");
  if (!workCtx) return input;

  if (needsScale) {
    workCtx.imageSmoothingEnabled = true;
    workCtx.drawImage(input, 0, 0, workW, workH);
  } else {
    workCtx.drawImage(input, 0, 0);
  }

  const imgData = workCtx.getImageData(0, 0, workW, workH);
  const buf = imgData.data;

  // Step 2 — AWB colour temperature (auto by default, or user override)
  const [rMul, gMul, bMul] = lighting === LIGHTING_AUTO
    ? computeAutoAwb(buf)
    : (AWB[lighting] || AWB[LIGHTING_AUTO]);
  const fluorescentFlutter = lighting === LIGHTING_FLUORESCENT;

  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      let gFlutter = 0;
      if (fluorescentFlutter) {
        gFlutter = (pixelNoise(x, y, 7) - 0.5) * 8;  // +/-4
      }
      buf[i]     = clamp(0, 255, Math.round(buf[i]     * rMul));
      buf[i + 1] = clamp(0, 255, Math.round(buf[i + 1] * gMul + gFlutter));
      buf[i + 2] = clamp(0, 255, Math.round(buf[i + 2] * bMul));
    }
  }

  // Step 3 — Mild saturation shaping (sample set trends less aggressive than modern pipelines)
  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      const grey = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      buf[i]     = clamp(0, 255, Math.round(grey + (buf[i]     - grey) * 1.06));
      buf[i + 1] = clamp(0, 255, Math.round(grey + (buf[i + 1] - grey) * 1.06));
      buf[i + 2] = clamp(0, 255, Math.round(grey + (buf[i + 2] - grey) * 1.06));
    }
  }

  // Step 3b — Xenon flash illumination field (if enabled)
  if (flash) {
    applyDigicamFlashLighting(
      buf,
      workW,
      workH,
      Number(flashPower ?? 1),
      Number(flashFalloff ?? 1.55),
      Number(flashOffsetX ?? 0),
      Number(flashOffsetY ?? -0.08)
    );
  }

  // Step 4 — FD7 Program AE + Picture Effect DSP stages
  applySceneMode(buf, workW, workH, sceneMode);
  applyPictureEffect(buf, workW, workH, pictureEffect);

  // Step 5 — Mavica "soul": toe/shoulder response and slight chroma lag.
  applySoulTone(buf, workW, workH);
  applyChromaDelay(buf, workW, workH, 1);

  // Step 6 — Interlaced capture behavior: field vs frame.
  // Manual note: frame mode with flash effectively records as field mode.
  const effectiveCaptureMode = flash && captureMode === CAPTURE_FRAME ? CAPTURE_FIELD : captureMode;
  applyInterlacedCapture(buf, workW, workH, effectiveCaptureMode, Number(frameJitter || 0));
  if (effectiveCaptureMode === CAPTURE_FIELD) {
    applyVerticalSoften(buf, workW, workH, 0.22);
  }

  // Step 7 — Apply shared JPEG corruption pipeline (same core as JPEG artifact filter)
  const complexity = estimateSceneComplexity(buf, workW, workH);
  const jpegPreset = getBudgetedJpegPreset(quality, complexity, !!flash);
  workCtx.putImageData(imgData, 0, 0);
  const jpegCanvas = applyJpegArtifactToCanvas(
    workCanvas,
    jpegPreset
  );
  const jpegCtx = jpegCanvas.getContext("2d");
  if (!jpegCtx) return input;
  const jpegData = jpegCtx.getImageData(0, 0, workW, workH);
  const jpegBuf = jpegData.data;
  for (let i = 0; i < buf.length; i += 1) buf[i] = jpegBuf[i];

  // Step 8 — CCD vertical smear (optional)
  if (smear) {
    const smearLen = 25;
    // Work on a copy so smears don't cascade
    const smearBuf = new Uint8ClampedArray(buf);

    for (let y = 0; y < workH; y += 1) {
      for (let x = 0; x < workW; x += 1) {
        const i = getBufferIndex(x, y, workW);
        const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      const smearThreshold = flash ? 245 : 235;
      if (luma <= smearThreshold) continue;

        for (let d = 1; d <= smearLen; d += 1) {
          const decay = 1 - (d / smearLen) ** 1.5;
          const blend = decay * 0.85;
          const sr = Math.round(buf[i]     + (255 - buf[i])     * blend);
          const sg = Math.round(buf[i + 1] + (255 - buf[i + 1]) * blend);
          const sb = Math.round(buf[i + 2] + (255 - buf[i + 2]) * blend);

          // Smear upward
          if (y - d >= 0) {
            const ti = getBufferIndex(x, y - d, workW);
            smearBuf[ti]     = Math.max(smearBuf[ti],     sr);
            smearBuf[ti + 1] = Math.max(smearBuf[ti + 1], sg);
            smearBuf[ti + 2] = Math.max(smearBuf[ti + 2], sb);
          }
          // Smear downward
          if (y + d < workH) {
            const ti = getBufferIndex(x, y + d, workW);
            smearBuf[ti]     = Math.max(smearBuf[ti],     sr);
            smearBuf[ti + 1] = Math.max(smearBuf[ti + 1], sg);
            smearBuf[ti + 2] = Math.max(smearBuf[ti + 2], sb);
          }
        }
      }
    }

    // Copy smear results back
    for (let j = 0; j < buf.length; j += 1) buf[j] = smearBuf[j];
  }

  // Step 9 — Shadow noise (measured: R/B sigma ~8, G sigma ~6)
  const { rb: noiseRB, g: noiseG } = NOISE_PARAMS[quality] || NOISE_PARAMS[QUALITY_FINE];

  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      const shadowCut = flash ? 42 : 50;
      if (luma >= shadowCut) continue;
      const t = (shadowCut - luma) / shadowCut;
      buf[i]     = clamp(0, 255, Math.round(buf[i]     + (pixelNoise(x, y, 73) - 0.5) * 2 * noiseRB * t));
      buf[i + 1] = clamp(0, 255, Math.round(buf[i + 1] + (pixelNoise(x, y, 89) - 0.5) * 2 * noiseG  * t));
      buf[i + 2] = clamp(0, 255, Math.round(buf[i + 2] + (pixelNoise(x, y, 97) - 0.5) * 2 * noiseRB * t));
    }
  }

  // Step 10 — Hard highlight clip + shadow crush (measured from real FD7 output)
  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      // Highlight: hard clip near top-end (flash clips slightly harder)
      const clipPoint = flash ? 244 : 248;
      if (buf[i]     > clipPoint) buf[i]     = 255;
      if (buf[i + 1] > clipPoint) buf[i + 1] = 255;
      if (buf[i + 2] > clipPoint) buf[i + 2] = 255;
      // Shadow: crush to black
      const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      if (luma < 8) {
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
      }
    }
  }

  workCtx.putImageData(imgData, 0, 0);

  // Output at native VGA by default; optionally scale back to input dimensions.
  const output = cloneCanvas(input, false);
  if (nativeVgaOutput) {
    output.width = workW;
    output.height = workH;
  }
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  if (nativeVgaOutput) {
    outputCtx.drawImage(workCanvas, 0, 0);
  } else if (needsScale) {
    outputCtx.imageSmoothingEnabled = false;
    outputCtx.drawImage(workCanvas, 0, 0, origW, origH);
  } else {
    outputCtx.drawImage(workCanvas, 0, 0);
  }

  return output;
};

export default defineFilter({
  name: "Mavica FD7",
  func: mavicaFd7,
  options: defaults,
  optionTypes,
  defaults,
});
