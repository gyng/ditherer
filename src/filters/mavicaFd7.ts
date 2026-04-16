import { ENUM, BOOL, RANGE } from "constants/controlTypes";
import {
  cloneCanvas,
  getBufferIndex,
  clamp,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { applyJpegArtifactToCanvas, defaults as jpegDefaults } from "./jpegArtifact";
import { defineFilter } from "filters/types";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
  type TexEntry,
} from "gl";
const readU8 = (buf: Uint8ClampedArray, index: number) => buf[index] ?? 0;

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

type JpegPreset = typeof jpegDefaults;

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
    rSum += readU8(buf, i);
    gSum += readU8(buf, i + 1);
    bSum += readU8(buf, i + 2);
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
  return [rMul, gMul, bMul] as const;
};

const applySoulTone = (buf: Uint8ClampedArray, w: number, h: number) => {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = getBufferIndex(x, y, w);
      for (let c = 0; c < 3; c += 1) {
        const v = readU8(buf, i + c) / 255;
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
      buf[di] = readU8(src, si);
      buf[di + 2] = readU8(src, si + 2);
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
        const mid = readU8(src, i + c);
        const avg = (readU8(src, iu + c) + readU8(src, id + c)) * 0.5;
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
      const l = 0.299 * readU8(buf, i) + 0.587 * readU8(buf, i + 1) + 0.114 * readU8(buf, i + 2);
      const lx = 0.299 * readU8(buf, ix) + 0.587 * readU8(buf, ix + 1) + 0.114 * readU8(buf, ix + 2);
      const ly = 0.299 * readU8(buf, iy) + 0.587 * readU8(buf, iy + 1) + 0.114 * readU8(buf, iy + 2);
      lumSum += l;
      gradSum += Math.abs(l - lx) + Math.abs(l - ly);
      count += 1;
    }
  }

  const mean = lumSum / Math.max(1, count);
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = getBufferIndex(x, y, w);
      const l = 0.299 * readU8(buf, i) + 0.587 * readU8(buf, i + 1) + 0.114 * readU8(buf, i + 2);
      const d = l - mean;
      varSum += d * d;
    }
  }

  const gradNorm = clamp(0, 1, (gradSum / Math.max(1, count)) / 80);
  const varNorm = clamp(0, 1, Math.sqrt(varSum / Math.max(1, count)) / 70);
  return clamp(0, 1, gradNorm * 0.65 + varNorm * 0.35);
};

const getBudgetedJpegPreset = (quality: string, complexity: number, flash: boolean) => {
  const base = JPEG_PRESETS[quality as keyof typeof JPEG_PRESETS] || JPEG_PRESETS[QUALITY_FINE];
  const c = clamp(0, 1, complexity);
  const qDrop = quality === QUALITY_STANDARD ? 10 : 7;
  const chromaDrop = quality === QUALITY_STANDARD ? 14 : 9;

  const tuned: JpegPreset = {
    ...jpegDefaults,
    ...base,
    qualityLuma: clamp(8, 95, base.qualityLuma - qDrop * c),
    qualityChroma: clamp(6, 95, base.qualityChroma - chromaDrop * c),
    mosquito: clamp(0, 1, base.mosquito + 0.08 * c),
    ringing: clamp(0, 1, base.ringing + 0.06 * c),
  };

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
      let r = readU8(buf, i);
      let g = readU8(buf, i + 1);
      let b = readU8(buf, i + 2);
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
      const r = readU8(buf, i);
      const g = readU8(buf, i + 1);
      const b = readU8(buf, i + 2);

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
        buf[di] = (readU8(src, i0) + readU8(src, i1)) >> 1;
        buf[di + 1] = (readU8(src, i0 + 1) + readU8(src, i1 + 1)) >> 1;
        buf[di + 2] = (readU8(src, i0 + 2) + readU8(src, i1 + 2)) >> 1;
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
      buf[di] = readU8(src, si);
      buf[di + 1] = readU8(src, si + 1);
      buf[di + 2] = readU8(src, si + 2);
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
      let r = readU8(buf, i) * baseGain * 1.02;
      let g = readU8(buf, i + 1) * baseGain * 1.0;
      let b = readU8(buf, i + 2) * baseGain * 0.98;

      // Specular pop on bright/reflective surfaces under flash.
      const lum = 0.299 * readU8(buf, i) + 0.587 * readU8(buf, i + 1) + 0.114 * readU8(buf, i + 2);
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

// ===== GL pre/post color stages =====
// Pre-JPEG shader: AWB → saturation → flash illum → scene mode → picture
// effect → soul tone → chroma delay. Interlace + vertical soften handled by
// separate passes since they depend on post-color-pipeline neighbours.
const PRE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec3  u_awb;          // (rMul, gMul, bMul)
uniform int   u_fluorescent;  // 1 = add green flutter noise
uniform float u_seed;

uniform int   u_flash;
uniform float u_flashPower;
uniform float u_flashFalloff;
uniform vec2  u_flashCenter;  // pixel coords
uniform float u_flashMaxR;

uniform int   u_sceneMode;    // 0 AUTO, 1 SOFT_PORTRAIT, 2 SPORTS, 3 BEACH_SKI, 4 SUNSET_MOON, 5 LANDSCAPE
uniform int   u_fx;           // 0 NONE, 1 PASTEL, 2 NEG_ART, 3 SEPIA, 4 BW

float hash2(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Chroma delay: R and B sampled from x-1, G from x.
  vec3 self = samplePx(x, y);
  vec3 shifted = samplePx(x - 1.0, y);
  vec3 c = vec3(shifted.r, self.g, shifted.b);

  // AWB
  c *= u_awb;
  if (u_fluorescent == 1) {
    c.g += (hash2(vec2(x, y), u_seed + 7.0) - 0.5) * 8.0;
  }

  // Mild saturation (×1.06 around channel mean)
  float grey = (c.r + c.g + c.b) / 3.0;
  c = grey + (c - vec3(grey)) * 1.06;

  // Flash illumination
  if (u_flash == 1) {
    float dx = x - u_flashCenter.x;
    float dy = y - u_flashCenter.y;
    float dist = sqrt(dx * dx + dy * dy) / u_flashMaxR;
    float radial = clamp(1.0 - dist, 0.0, 1.0);
    float illum = u_flashPower * pow(radial, u_flashFalloff);
    float baseGain = 0.74 + illum * 1.35;
    c.r = c.r * baseGain * 1.02;
    c.g = c.g * baseGain;
    c.b = c.b * baseGain * 0.98;
    float lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    float spec = pow(clamp((lum - 120.0) / 135.0, 0.0, 1.0), 2.0) * illum * 125.0;
    c.r += spec;
    c.g += spec;
    c.b += spec * 0.95;
  }

  // Scene mode
  if (u_sceneMode != 0) {
    float lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    if (u_sceneMode == 1) {              // SOFT_PORTRAIT
      c.r = c.r * 1.04 + 6.0;
      c.g = c.g * 1.01 + 3.0;
      c.b = c.b * 0.98 + 1.0;
      float t = lum / 255.0;
      float lift = (0.18 - abs(t - 0.5)) * 24.0;
      c += vec3(lift);
    } else if (u_sceneMode == 2) {       // SPORTS
      c = (c - vec3(128.0)) * 1.08 + vec3(128.0);
    } else if (u_sceneMode == 3) {       // BEACH_SKI
      float hp = lum > 210.0 ? 0.86 : 1.04;
      c.r = c.r * hp * 0.98;
      c.g = c.g * hp * 1.01;
      c.b = c.b * hp * 1.08;
    } else if (u_sceneMode == 4) {       // SUNSET_MOON
      c.r = c.r * 1.12 + 6.0;
      c.g = c.g * 0.98;
      c.b = c.b * 0.86;
      if (lum < 70.0) { c.r += 4.0; c.g += 2.0; }
    } else if (u_sceneMode == 5) {       // LANDSCAPE
      c = (c - vec3(128.0)) * 1.12 + vec3(128.0);
      c.g *= 1.06;
    }
  }

  // Picture effect
  if (u_fx == 1) {                       // PASTEL
    float lum = (c.r + c.g + c.b) / 3.0;
    vec3 boosted = vec3(lum) + (c - vec3(lum)) * 1.18;
    c = floor(boosted / 18.0 + 0.5) * 18.0;
  } else if (u_fx == 2) {                // NEG_ART
    c = vec3(255.0) - c;
  } else if (u_fx == 3) {                // SEPIA
    c = mat3(
      0.393, 0.349, 0.272,
      0.769, 0.686, 0.534,
      0.189, 0.168, 0.131
    ) * c;
  } else if (u_fx == 4) {                // BW
    float y2 = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    c = vec3(y2);
  }

  // Soul tone: toe/shoulder
  for (int k = 0; k < 3; k++) {
    float v = c[k] / 255.0;
    float toe = v < 0.08 ? v * 0.65 + 0.02 : v;
    float shoulder = toe > 0.78 ? 0.78 + (toe - 0.78) * 0.58 : toe;
    c[k] = clamp(shoulder * 255.0, 0.0, 255.0);
  }

  fragColor = vec4(c / 255.0, 1.0);
}
`;

// Interlace shader: field vs frame capture mode. Reads from pre-color
// output; samples the appropriate neighbour lines per row.
const INTERLACE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_captureField;   // 1 = FIELD mode, 0 = FRAME mode
uniform float u_jitter;         // frame-mode jitter strength (0..3)
uniform float u_seed;

float hash2(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_input, uv);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  bool isOdd = mod(y, 2.0) > 0.5;

  if (u_captureField == 1) {
    // FIELD: odd rows become average of their even neighbours.
    if (isOdd) {
      vec4 a = samplePx(x, y - 1.0);
      vec4 b = samplePx(x, min(u_res.y - 1.0, y + 1.0));
      fragColor = vec4((a.rgb + b.rgb) * 0.5, 1.0);
    } else {
      fragColor = samplePx(x, y);
    }
  } else {
    // FRAME: odd rows shifted by jitter (simulates second-field motion).
    if (isOdd && u_jitter > 0.0) {
      float sx = floor((hash2(vec2(y, 0.0), u_seed + 211.0) - 0.5) * 2.0 * u_jitter);
      float sy = floor((hash2(vec2(y, 0.0), u_seed + 223.0) - 0.5) * u_jitter);
      fragColor = samplePx(x + sx, y + sy);
    } else {
      fragColor = samplePx(x, y);
    }
  }
}
`;

// Vertical soften (FIELD mode only): 3-tap vertical average with 22% mix.
const SOFTEN_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform float u_amount;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 uv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 mid = texture(u_input, uv);
  if (y < 1.0 || y >= u_res.y - 1.0) {
    fragColor = mid;
    return;
  }
  vec2 uvUp = vec2((x + 0.5) / u_res.x, 1.0 - (y - 1.0 + 0.5) / u_res.y);
  vec2 uvDn = vec2((x + 0.5) / u_res.x, 1.0 - (y + 1.0 + 0.5) / u_res.y);
  vec3 avg = (texture(u_input, uvUp).rgb + texture(u_input, uvDn).rgb) * 0.5;
  fragColor = vec4(mid.rgb * (1.0 - u_amount) + avg * u_amount, 1.0);
}
`;

// Post-JPEG shader: CCD smear + shadow noise + hard highlight/shadow clip.
// Smear scans ±25 vertical px for bright source pixels and brightens the
// output toward white by a decay factor. Noise and clip are per-pixel.
const POST_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_smear;
uniform float u_smearThreshold;
uniform int   u_flash;
uniform float u_noiseRB;
uniform float u_noiseG;
uniform float u_shadowCut;
uniform float u_clipPoint;
uniform float u_seed;

float hash2(vec2 p, float s) {
  p = fract(p * vec2(443.897, 441.423) + s);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_input, uv).rgb * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec3 c = samplePx(x, y);

  // Smear: for each vertical offset d in ±25, look at the pixel at (x, y+d).
  // If that pixel is above threshold, it projects a smear onto us whose
  // strength is decay^1.5 times 0.85; blend toward white.
  if (u_smear == 1) {
    for (int d = 1; d <= 25; d++) {
      for (int side = 0; side < 2; side++) {
        float yy = side == 0 ? y - float(d) : y + float(d);
        if (yy < 0.0 || yy >= u_res.y) continue;
        vec3 bright = samplePx(x, yy);
        float lum = 0.299 * bright.r + 0.587 * bright.g + 0.114 * bright.b;
        if (lum <= u_smearThreshold) continue;
        float decay = 1.0 - pow(float(d) / 25.0, 1.5);
        float blend = decay * 0.85;
        vec3 smeared = bright + (vec3(255.0) - bright) * blend;
        c = max(c, smeared);
      }
    }
  }

  // Shadow noise
  float lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  if (lum < u_shadowCut) {
    float t = (u_shadowCut - lum) / u_shadowCut;
    c.r += (hash2(vec2(x, y), u_seed + 73.0) - 0.5) * 2.0 * u_noiseRB * t;
    c.g += (hash2(vec2(x, y), u_seed + 89.0) - 0.5) * 2.0 * u_noiseG  * t;
    c.b += (hash2(vec2(x, y), u_seed + 97.0) - 0.5) * 2.0 * u_noiseRB * t;
  }

  // Hard highlight clip + shadow crush
  c = vec3(
    c.r > u_clipPoint ? 255.0 : c.r,
    c.g > u_clipPoint ? 255.0 : c.g,
    c.b > u_clipPoint ? 255.0 : c.b
  );
  float lum2 = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  if (lum2 < 8.0) c = vec3(0.0);

  fragColor = vec4(clamp(c, 0.0, 255.0) / 255.0, 1.0);
}
`;

type GLCache = { pre: Program; interlace: Program; soften: Program; post: Program };
let _glCache: GLCache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    pre: linkProgram(gl, PRE_FS, [
      "u_source", "u_res", "u_awb", "u_fluorescent", "u_seed",
      "u_flash", "u_flashPower", "u_flashFalloff", "u_flashCenter", "u_flashMaxR",
      "u_sceneMode", "u_fx",
    ] as const),
    interlace: linkProgram(gl, INTERLACE_FS, [
      "u_input", "u_res", "u_captureField", "u_jitter", "u_seed",
    ] as const),
    soften: linkProgram(gl, SOFTEN_FS, ["u_input", "u_res", "u_amount"] as const),
    post: linkProgram(gl, POST_FS, [
      "u_input", "u_res", "u_smear", "u_smearThreshold", "u_flash",
      "u_noiseRB", "u_noiseG", "u_shadowCut", "u_clipPoint", "u_seed",
    ] as const),
  };
  return _glCache;
};

const SCENE_MODE_ID: Record<string, number> = {
  [SCENE_AUTO]: 0, [SCENE_SOFT_PORTRAIT]: 1, [SCENE_SPORTS]: 2,
  [SCENE_BEACH_SKI]: 3, [SCENE_SUNSET_MOON]: 4, [SCENE_LANDSCAPE]: 5,
};
const FX_ID: Record<string, number> = {
  [FX_NONE]: 0, [FX_PASTEL]: 1, [FX_NEG_ART]: 2, [FX_SEPIA]: 3, [FX_BW]: 4,
};

const runGLPipeline = (
  src: HTMLCanvasElement | OffscreenCanvas,
  W: number, H: number,
  awb: readonly [number, number, number],
  fluorescent: boolean,
  flashOn: boolean,
  flashPower: number, flashFalloff: number,
  flashOffsetX: number, flashOffsetY: number,
  sceneMode: string, pictureEffect: string,
  captureMode: string, frameJitter: number,
  smear: boolean,
  quality: string,
  frameIndex: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initGLCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "mavicaFd7:source", W, H);
  uploadSourceTexture(gl, sourceTex, src);
  const preTex: TexEntry = ensureTexture(gl, "mavicaFd7:pre", W, H);
  const interlaceTex: TexEntry = ensureTexture(gl, "mavicaFd7:interlace", W, H);
  const softenTex: TexEntry = ensureTexture(gl, "mavicaFd7:soften", W, H);

  const seed = ((frameIndex * 7919 + 31337) % 1000000) * 0.001;

  // Pass 1: color pipeline.
  const flashCx = W * (0.5 + Math.max(-1, Math.min(1, flashOffsetX)) * 0.2);
  const flashCy = H * (0.45 + Math.max(-1, Math.min(1, flashOffsetY)) * 0.2);
  const flashMaxR = Math.max(W, H) * 0.9;
  drawPass(gl, preTex, W, H, cache.pre, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.pre.uniforms.u_source, 0);
    gl.uniform2f(cache.pre.uniforms.u_res, W, H);
    gl.uniform3f(cache.pre.uniforms.u_awb, awb[0], awb[1], awb[2]);
    gl.uniform1i(cache.pre.uniforms.u_fluorescent, fluorescent ? 1 : 0);
    gl.uniform1f(cache.pre.uniforms.u_seed, seed);
    gl.uniform1i(cache.pre.uniforms.u_flash, flashOn ? 1 : 0);
    gl.uniform1f(cache.pre.uniforms.u_flashPower, flashPower);
    gl.uniform1f(cache.pre.uniforms.u_flashFalloff, flashFalloff);
    gl.uniform2f(cache.pre.uniforms.u_flashCenter, flashCx, H - 1 - flashCy);
    gl.uniform1f(cache.pre.uniforms.u_flashMaxR, flashMaxR);
    gl.uniform1i(cache.pre.uniforms.u_sceneMode, SCENE_MODE_ID[sceneMode] ?? 0);
    gl.uniform1i(cache.pre.uniforms.u_fx, FX_ID[pictureEffect] ?? 0);
  }, vao);

  // Pass 2: interlace. Target = softenTex (soften follows in FIELD mode)
  // or the default framebuffer (null = the GL canvas) in FRAME mode so we
  // can readoutToCanvas it directly.
  const effectiveFieldMode = flashOn && captureMode === CAPTURE_FRAME
    ? CAPTURE_FIELD
    : captureMode;
  const fieldMode = effectiveFieldMode === CAPTURE_FIELD;
  const interlaceTarget = fieldMode ? interlaceTex : null;
  drawPass(gl, interlaceTarget, W, H, cache.interlace, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, preTex.tex);
    gl.uniform1i(cache.interlace.uniforms.u_input, 0);
    gl.uniform2f(cache.interlace.uniforms.u_res, W, H);
    gl.uniform1i(cache.interlace.uniforms.u_captureField, fieldMode ? 1 : 0);
    gl.uniform1f(cache.interlace.uniforms.u_jitter, Math.max(0, Math.min(3, frameJitter)));
    gl.uniform1f(cache.interlace.uniforms.u_seed, seed);
  }, vao);

  // Pass 3: vertical soften (FIELD only) → default framebuffer.
  if (fieldMode) {
    drawPass(gl, null, W, H, cache.soften, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, interlaceTex.tex);
      gl.uniform1i(cache.soften.uniforms.u_input, 0);
      gl.uniform2f(cache.soften.uniforms.u_res, W, H);
      gl.uniform1f(cache.soften.uniforms.u_amount, 0.22);
    }, vao);
  }
  void softenTex;

  // GL canvas now holds the pre-JPEG result. Hand off to JPEG (GL when
  // eligible, WASM fallback) then run the post pass.
  const preJpegCanvas = readoutToCanvas(canvas, W, H);
  if (!preJpegCanvas) return null;

  const preCtx = (preJpegCanvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  const complexityBuf = preCtx?.getImageData(0, 0, W, H).data;
  const complexity = complexityBuf ? estimateSceneComplexity(complexityBuf, W, H) : 0.5;
  const jpegPreset = getBudgetedJpegPreset(quality, complexity, flashOn);
  const jpegCanvas = applyJpegArtifactToCanvas(preJpegCanvas, jpegPreset);

  // Pass 4: post (smear + noise + clip) reading from the JPEG result.
  resizeGLCanvas(canvas, W, H);
  const postSrcTex = ensureTexture(gl, "mavicaFd7:postSrc", W, H);
  uploadSourceTexture(gl, postSrcTex, jpegCanvas);

  const { rb: noiseRB, g: noiseG } = NOISE_PARAMS[quality as keyof typeof NOISE_PARAMS] ?? NOISE_PARAMS[QUALITY_FINE];
  drawPass(gl, null, W, H, cache.post, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, postSrcTex.tex);
    gl.uniform1i(cache.post.uniforms.u_input, 0);
    gl.uniform2f(cache.post.uniforms.u_res, W, H);
    gl.uniform1i(cache.post.uniforms.u_smear, smear ? 1 : 0);
    gl.uniform1f(cache.post.uniforms.u_smearThreshold, flashOn ? 245 : 235);
    gl.uniform1i(cache.post.uniforms.u_flash, flashOn ? 1 : 0);
    gl.uniform1f(cache.post.uniforms.u_noiseRB, noiseRB);
    gl.uniform1f(cache.post.uniforms.u_noiseG, noiseG);
    gl.uniform1f(cache.post.uniforms.u_shadowCut, flashOn ? 42 : 50);
    gl.uniform1f(cache.post.uniforms.u_clipPoint, flashOn ? 244 : 248);
    gl.uniform1f(cache.post.uniforms.u_seed, seed);
  }, vao);

  return readoutToCanvas(canvas, W, H);
};

const mavicaFd7 = (input: any, options = defaults) => {
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

  // Step 2 — AWB colour temperature (auto by default, or user override).
  // Auto path is a reduction so it stays on CPU either way; results feed
  // both the GL and JS paths as a uniform.
  const [rMul, gMul, bMul] = lighting === LIGHTING_AUTO
    ? computeAutoAwb(buf)
    : (AWB[lighting as keyof typeof AWB] || AWB[LIGHTING_AUTO]);

  // GL fast path: pre-color → interlace → [soften] → JPEG (GL-dispatched by
  // applyJpegArtifactToCanvas when eligible) → post. Three readback/upload
  // bridges at 640×480 add ~6-10ms; faster than the JS pipeline at scale.
  const wantGL = glAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false;
  if (wantGL) {
    const glResult = runGLPipeline(
      workCanvas, workW, workH,
      [rMul, gMul, bMul],
      lighting === LIGHTING_FLUORESCENT,
      Boolean(flash),
      Number(flashPower ?? 1),
      Number(flashFalloff ?? 1.55),
      Number(flashOffsetX ?? 0),
      Number(flashOffsetY ?? -0.08),
      sceneMode,
      pictureEffect,
      captureMode,
      Number(frameJitter || 0),
      smear,
      quality,
      Number((options as { _frameIndex?: number })._frameIndex || 0),
    );
    if (glResult) {
      const output = cloneCanvas(input, false);
      if (nativeVgaOutput) {
        output.width = workW;
        output.height = workH;
      }
      const outputCtx = output.getContext("2d");
      if (outputCtx) {
        if (nativeVgaOutput) {
          outputCtx.drawImage(glResult, 0, 0);
        } else if (needsScale) {
          outputCtx.imageSmoothingEnabled = false;
          outputCtx.drawImage(glResult, 0, 0, origW, origH);
        } else {
          outputCtx.drawImage(glResult, 0, 0);
        }
        logFilterBackend("Mavica FD7", "WebGL2",
          `${quality} ${sceneMode} ${captureMode}${flash ? " flash" : ""}`);
        return output;
      }
    }
  }
  logFilterWasmStatus("Mavica FD7", false, "fallback JS");

  // === JS fallback below — identical to the pre-GL pipeline ===
  const [rMulJs, gMulJs, bMulJs] = [rMul, gMul, bMul];
  void rMulJs; void gMulJs; void bMulJs;
  const fluorescentFlutter = lighting === LIGHTING_FLUORESCENT;

  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      let gFlutter = 0;
      if (fluorescentFlutter) {
        gFlutter = (pixelNoise(x, y, 7) - 0.5) * 8;  // +/-4
      }
      buf[i] = clamp(0, 255, Math.round(readU8(buf, i) * rMul));
      buf[i + 1] = clamp(0, 255, Math.round(readU8(buf, i + 1) * gMul + gFlutter));
      buf[i + 2] = clamp(0, 255, Math.round(readU8(buf, i + 2) * bMul));
    }
  }

  // Step 3 — Mild saturation shaping (sample set trends less aggressive than modern pipelines)
  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      const grey = (readU8(buf, i) + readU8(buf, i + 1) + readU8(buf, i + 2)) / 3;
      buf[i] = clamp(0, 255, Math.round(grey + (readU8(buf, i) - grey) * 1.06));
      buf[i + 1] = clamp(0, 255, Math.round(grey + (readU8(buf, i + 1) - grey) * 1.06));
      buf[i + 2] = clamp(0, 255, Math.round(grey + (readU8(buf, i + 2) - grey) * 1.06));
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
  for (let i = 0; i < buf.length; i += 1) buf[i] = readU8(jpegBuf, i);

  // Step 8 — CCD vertical smear (optional)
  if (smear) {
    const smearLen = 25;
    // Work on a copy so smears don't cascade
    const smearBuf = new Uint8ClampedArray(buf);

    for (let y = 0; y < workH; y += 1) {
      for (let x = 0; x < workW; x += 1) {
        const i = getBufferIndex(x, y, workW);
        const luma = 0.299 * readU8(buf, i) + 0.587 * readU8(buf, i + 1) + 0.114 * readU8(buf, i + 2);
        const smearThreshold = flash ? 245 : 235;
        if (luma <= smearThreshold) continue;

        for (let d = 1; d <= smearLen; d += 1) {
          const decay = 1 - (d / smearLen) ** 1.5;
          const blend = decay * 0.85;
          const sr = Math.round(readU8(buf, i) + (255 - readU8(buf, i)) * blend);
          const sg = Math.round(readU8(buf, i + 1) + (255 - readU8(buf, i + 1)) * blend);
          const sb = Math.round(readU8(buf, i + 2) + (255 - readU8(buf, i + 2)) * blend);

          // Smear upward
          if (y - d >= 0) {
            const ti = getBufferIndex(x, y - d, workW);
            smearBuf[ti] = Math.max(readU8(smearBuf, ti), sr);
            smearBuf[ti + 1] = Math.max(readU8(smearBuf, ti + 1), sg);
            smearBuf[ti + 2] = Math.max(readU8(smearBuf, ti + 2), sb);
          }
          // Smear downward
          if (y + d < workH) {
            const ti = getBufferIndex(x, y + d, workW);
            smearBuf[ti] = Math.max(readU8(smearBuf, ti), sr);
            smearBuf[ti + 1] = Math.max(readU8(smearBuf, ti + 1), sg);
            smearBuf[ti + 2] = Math.max(readU8(smearBuf, ti + 2), sb);
          }
        }
      }
    }

    // Copy smear results back
    for (let j = 0; j < buf.length; j += 1) buf[j] = readU8(smearBuf, j);
  }

  // Step 9 — Shadow noise (measured: R/B sigma ~8, G sigma ~6)
  const { rb: noiseRB, g: noiseG } = NOISE_PARAMS[quality as keyof typeof NOISE_PARAMS] ?? NOISE_PARAMS[QUALITY_FINE];

  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      const luma = 0.299 * readU8(buf, i) + 0.587 * readU8(buf, i + 1) + 0.114 * readU8(buf, i + 2);
      const shadowCut = flash ? 42 : 50;
      if (luma >= shadowCut) continue;
      const t = (shadowCut - luma) / shadowCut;
      buf[i] = clamp(0, 255, Math.round(readU8(buf, i) + (pixelNoise(x, y, 73) - 0.5) * 2 * noiseRB * t));
      buf[i + 1] = clamp(0, 255, Math.round(readU8(buf, i + 1) + (pixelNoise(x, y, 89) - 0.5) * 2 * noiseG  * t));
      buf[i + 2] = clamp(0, 255, Math.round(readU8(buf, i + 2) + (pixelNoise(x, y, 97) - 0.5) * 2 * noiseRB * t));
    }
  }

  // Step 10 — Hard highlight clip + shadow crush (measured from real FD7 output)
  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      // Highlight: hard clip near top-end (flash clips slightly harder)
      const clipPoint = flash ? 244 : 248;
      if (readU8(buf, i) > clipPoint) buf[i] = 255;
      if (readU8(buf, i + 1) > clipPoint) buf[i + 1] = 255;
      if (readU8(buf, i + 2) > clipPoint) buf[i + 2] = 255;
      // Shadow: crush to black
      const luma = 0.299 * readU8(buf, i) + 0.587 * readU8(buf, i + 1) + 0.114 * readU8(buf, i + 2);
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
