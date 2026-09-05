import { ENUM, BOOL, RANGE } from "../constants/controlTypes";
import {
  cloneCanvas,
  getBufferIndex,
  clamp,
  logFilterBackend,
  releasePooledCanvas,
  takePooledCanvas,
  withPooledCanvasCleanup,
} from "../utils/index";
import { tryApplyJpegArtifactToCanvas, defaults as jpegDefaults } from "./jpegArtifact";
import { defineFilter } from "./types";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
  type TexEntry,
} from "../gl/index";
import {
  normalizeBooleanOption,
  normalizeEnumOption,
  normalizeRangeOption,
} from "../utils/filterOptions";
const readU8 = (buf: Uint8ClampedArray, index: number) => buf[index] ?? 0;
const JPEG_CODEC_UNAVAILABLE = Symbol("mavica-jpeg-codec-unavailable");

const QUALITY_FINE = "FINE";
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
const LIGHTING_DAYLIGHT = "DAYLIGHT";
const LIGHTING_TUNGSTEN = "TUNGSTEN";
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
    desc: "Field uses one interlaced field resampled to full height; Frame combines two fields and can show combing",
  },
  quality: {
    type: ENUM,
    options: [
      { name: "Fine (~72–96 KB/frame)", value: QUALITY_FINE },
      { name: "Standard (~36–48 KB/frame)", value: QUALITY_STANDARD },
    ],
    default: QUALITY_STANDARD,
    desc: "JPEG compression quality preset with floppy-era file-size bias",
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
    desc: "FD7 Program AE presets affecting tone, color, and clarity bias",
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
    desc: "FD7 Picture Effect processing in DSP",
  },
  lighting: {
    type: ENUM,
    options: [
      { name: "Auto WB (default)", value: LIGHTING_AUTO },
      { name: "Daylight (warm bias)", value: LIGHTING_DAYLIGHT },
      { name: "Tungsten (strong warm cast)", value: LIGHTING_TUNGSTEN },
      { name: "Fluorescent (green cast)", value: LIGHTING_FLUORESCENT },
    ],
    default: LIGHTING_AUTO,
    desc: "Auto white balance (default) or period-accurate lighting overrides",
  },
  flash: {
    type: BOOL,
    default: false,
    desc: "Simulate built-in flash; frame mode falls back to field capture when flash fires",
  },
  flashPower: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 1,
    desc: "Built-in flash output strength",
  },
  flashFalloff: {
    type: RANGE,
    range: [0.8, 3],
    step: 0.05,
    default: 1.55,
    desc: "How quickly flash illumination falls off with distance",
  },
  flashOffsetX: {
    type: RANGE,
    range: [-1, 1],
    step: 0.01,
    default: 0,
    desc: "Horizontal flash aim offset (for off-center framing)",
  },
  flashOffsetY: {
    type: RANGE,
    range: [-1, 1],
    step: 0.01,
    default: -0.08,
    desc: "Vertical flash aim offset (slightly above center feels more camera-like)",
  },
  smear: { type: BOOL, default: false, desc: "CCD smear artifact on bright highlights" },
  nativeVgaOutput: {
    type: BOOL,
    label: "Native resolution ceiling",
    default: false,
    desc: "Limit output to the sensor working size, up to 640×480, instead of rescaling it to a larger input canvas",
  },
  frameJitter: {
    type: ENUM,
    options: [
      { name: "Off", value: "0" },
      { name: "Low", value: "1" },
      { name: "Medium", value: "2" },
      { name: "High", value: "3" },
    ],
    default: "2",
    desc: "In frame mode, odd-field offset strength (camera/subject motion between fields)",
  },
};

export const defaults = {
  captureMode: optionTypes.captureMode.default,
  quality: optionTypes.quality.default,
  sceneMode: optionTypes.sceneMode.default,
  pictureEffect: optionTypes.pictureEffect.default,
  lighting: optionTypes.lighting.default,
  flash: optionTypes.flash.default,
  flashPower: optionTypes.flashPower.default,
  flashFalloff: optionTypes.flashFalloff.default,
  flashOffsetX: optionTypes.flashOffsetX.default,
  flashOffsetY: optionTypes.flashOffsetY.default,
  smear: optionTypes.smear.default,
  nativeVgaOutput: optionTypes.nativeVgaOutput.default,
  frameJitter: optionTypes.frameJitter.default,
};

type MavicaFd7Options = Partial<typeof defaults> & {
  _frameIndex?: number;
};

// AWB colour multipliers — measured from real FD7 output.
// Daylight already has warm bias: R ~+6%, B ~-6% relative to neutral.
const AWB = {
  [LIGHTING_AUTO]: [1.0, 1.0, 1.0],
  [LIGHTING_DAYLIGHT]: [1.03, 1.0, 0.9],
  [LIGHTING_TUNGSTEN]: [1.1, 0.97, 0.72],
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
  [QUALITY_FINE]: { rb: 8, g: 6 },
  [QUALITY_STANDARD]: { rb: 11, g: 8 },
};

type JpegPreset = typeof jpegDefaults;

const computeAutoAwb = (buf: Uint8ClampedArray) => {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let coverageSum = 0;

  for (let i = 0; i < buf.length; i += 4) {
    const coverage = readU8(buf, i + 3) / 255;
    rSum += readU8(buf, i) * coverage;
    gSum += readU8(buf, i + 1) * coverage;
    bSum += readU8(buf, i + 2) * coverage;
    coverageSum += coverage;
  }

  if (coverageSum <= 1e-6) return AWB[LIGHTING_AUTO];
  const rAvg = rSum / coverageSum;
  const gAvg = gSum / coverageSum;
  const bAvg = bSum / coverageSum;
  const target = (rAvg + gAvg + bAvg) / 3;

  // Mild clamp to avoid extreme casts; slight warm bias like late-90s CCD auto WB.
  // Conservative gray-world with mild late-90s CCD warm/green tendency.
  const rMul = clamp(0.88, 1.16, target / Math.max(1, rAvg)) * 1.015;
  const gMul = clamp(0.88, 1.16, target / Math.max(1, gAvg)) * 1.005;
  const bMul = clamp(0.88, 1.16, target / Math.max(1, bAvg)) * 0.975;
  return [rMul, gMul, bMul] as const;
};

const estimateSceneComplexity = (buf: Uint8ClampedArray, w: number, h: number) => {
  // Lightweight proxy for entropy/detail to tune JPEG pressure. The camera
  // signal is already coverage weighted before it reaches this spatial stage,
  // so transparent colour contributes once rather than being weighted twice.
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
      const lx =
        0.299 * readU8(buf, ix) + 0.587 * readU8(buf, ix + 1) + 0.114 * readU8(buf, ix + 2);
      const ly =
        0.299 * readU8(buf, iy) + 0.587 * readU8(buf, iy + 1) + 0.114 * readU8(buf, iy + 2);
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

  const gradNorm = clamp(0, 1, gradSum / Math.max(1, count) / 80);
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

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  vec4 sampleValue = texture(u_source, uv);
  return vec4(sampleValue.rgb * 255.0, sampleValue.a);
}

vec3 processCameraColor(vec3 c, float x, float y) {
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

  return c;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec4 self = samplePx(x, y);
  vec4 shifted = samplePx(x - 1.0, y);

  // Finish the per-pixel camera pipeline before the first neighbourhood
  // operation. Chroma delay then converts the signal to coverage-weighted
  // RGB, preventing nearly transparent colour from entering later field and
  // JPEG samples at full strength.
  vec3 selfColor = processCameraColor(self.rgb, x, y);
  vec3 shiftedColor = processCameraColor(shifted.rgb, x - 1.0, y);
  float chromaCoverage = min(shifted.a, self.a);
  vec3 c = vec3(
    shiftedColor.r * chromaCoverage,
    selfColor.g * self.a,
    shiftedColor.b * chromaCoverage
  );
  fragColor = vec4(c / 255.0, self.a);
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

vec3 sampleForCoverage(float sx, float sy, float destinationCoverage) {
  vec4 sampleValue = samplePx(sx, sy);
  float scale = sampleValue.a > 0.0
    ? min(1.0, destinationCoverage / sampleValue.a)
    : 0.0;
  return sampleValue.rgb * scale;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  bool isOdd = mod(y, 2.0) > 0.5;

  if (u_captureField == 1) {
    // FIELD: odd rows become average of their even neighbours.
    if (isOdd) {
      float destinationCoverage = samplePx(x, y).a;
      vec3 a = sampleForCoverage(x, y - 1.0, destinationCoverage);
      vec3 b = sampleForCoverage(x, min(u_res.y - 1.0, y + 1.0), destinationCoverage);
      fragColor = vec4((a + b) * 0.5, destinationCoverage);
    } else {
      fragColor = samplePx(x, y);
    }
  } else {
    // FRAME: odd rows shifted by jitter (simulates second-field motion).
    if (isOdd && u_jitter > 0.0) {
      // floor(value + 0.5) matches JS Math.round, including negative values,
      // and avoids floor's one-sided jitter bias.
      float sx = floor((hash2(vec2(y, 0.0), u_seed + 211.0) - 0.5) * 2.0 * u_jitter + 0.5);
      float sy = floor((hash2(vec2(y, 0.0), u_seed + 223.0) - 0.5) * u_jitter + 0.5);
      float destinationCoverage = samplePx(x, y).a;
      fragColor = vec4(
        sampleForCoverage(x + sx, y + sy, destinationCoverage),
        destinationCoverage
      );
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
  vec4 upper = texture(u_input, uvUp);
  vec4 lower = texture(u_input, uvDn);
  float upperScale = upper.a > 0.0 ? min(1.0, mid.a / upper.a) : 0.0;
  float lowerScale = lower.a > 0.0 ? min(1.0, mid.a / lower.a) : 0.0;
  vec3 avg = (upper.rgb * upperScale + lower.rgb * lowerScale) * 0.5;
  fragColor = vec4(mid.rgb * (1.0 - u_amount) + avg * u_amount, mid.a);
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
uniform sampler2D u_alphaSource;
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

vec4 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return vec4(
    texture(u_input, uv).rgb * 255.0,
    texture(u_alphaSource, uv).a
  );
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec4 center = samplePx(x, y);
  float outputAlpha = center.a;
  vec3 c = clamp(center.rgb, vec3(0.0), vec3(255.0 * outputAlpha));

  // Smear: for each vertical offset d in ±25, look at the pixel at (x, y+d).
  // If that pixel is above threshold, it projects a smear onto us whose
  // strength is decay^1.5 times 0.85; blend toward white.
  if (u_smear == 1) {
    for (int d = 1; d <= 25; d++) {
      for (int side = 0; side < 2; side++) {
        float yy = side == 0 ? y - float(d) : y + float(d);
        if (yy < 0.0 || yy >= u_res.y) continue;
        vec4 brightSample = samplePx(x, yy);
        vec3 boundedBright = clamp(
          brightSample.rgb,
          vec3(0.0),
          vec3(255.0 * brightSample.a)
        );
        vec3 bright = brightSample.a > 0.0
          ? boundedBright / brightSample.a
          : vec3(0.0);
        float lum = 0.299 * bright.r + 0.587 * bright.g + 0.114 * bright.b;
        if (lum <= u_smearThreshold) continue;
        float decay = 1.0 - pow(float(d) / 25.0, 1.5);
        float blend = decay * 0.85;
        float smearCoverage = min(brightSample.a, outputAlpha);
        vec3 smearedStraight = bright + (vec3(255.0) - bright) * blend;
        vec3 smeared = smearedStraight * smearCoverage;
        c = max(c, smeared);
      }
    }
  }

  // Shadow noise
  vec3 straightForNoise = outputAlpha > 0.0 ? c / outputAlpha : vec3(0.0);
  float lum = 0.299 * straightForNoise.r + 0.587 * straightForNoise.g + 0.114 * straightForNoise.b;
  if (lum < u_shadowCut) {
    float t = (u_shadowCut - lum) / u_shadowCut;
    c.r += (hash2(vec2(x, y), u_seed + 73.0) - 0.5) * 2.0 * u_noiseRB * t * outputAlpha;
    c.g += (hash2(vec2(x, y), u_seed + 89.0) - 0.5) * 2.0 * u_noiseG  * t * outputAlpha;
    c.b += (hash2(vec2(x, y), u_seed + 97.0) - 0.5) * 2.0 * u_noiseRB * t * outputAlpha;
  }

  // Hard highlight clip + shadow crush
  vec3 straight = outputAlpha > 0.0 ? c / outputAlpha : vec3(0.0);
  c = vec3(
    straight.r > u_clipPoint ? 255.0 * outputAlpha : c.r,
    straight.g > u_clipPoint ? 255.0 * outputAlpha : c.g,
    straight.b > u_clipPoint ? 255.0 * outputAlpha : c.b
  );
  float lum2 = 0.299 * straight.r + 0.587 * straight.g + 0.114 * straight.b;
  if (lum2 < 8.0) c = vec3(0.0);

  vec3 bounded = clamp(c, vec3(0.0), vec3(255.0 * outputAlpha));
  vec3 straightOutput = outputAlpha > 0.0
    ? bounded / (255.0 * outputAlpha)
    : vec3(0.0);
  fragColor = vec4(straightOutput, outputAlpha);
}
`;

type GLCache = { pre: Program; interlace: Program; soften: Program; post: Program };
let _glCache: GLCache | null = null;
const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  _glCache = {
    pre: linkProgram(gl, PRE_FS, [
      "u_source",
      "u_res",
      "u_awb",
      "u_fluorescent",
      "u_seed",
      "u_flash",
      "u_flashPower",
      "u_flashFalloff",
      "u_flashCenter",
      "u_flashMaxR",
      "u_sceneMode",
      "u_fx",
    ] as const),
    interlace: linkProgram(gl, INTERLACE_FS, [
      "u_input",
      "u_res",
      "u_captureField",
      "u_jitter",
      "u_seed",
    ] as const),
    soften: linkProgram(gl, SOFTEN_FS, ["u_input", "u_res", "u_amount"] as const),
    post: linkProgram(gl, POST_FS, [
      "u_input",
      "u_alphaSource",
      "u_res",
      "u_smear",
      "u_smearThreshold",
      "u_flash",
      "u_noiseRB",
      "u_noiseG",
      "u_shadowCut",
      "u_clipPoint",
      "u_seed",
    ] as const),
  };
  return _glCache;
};

const SCENE_MODE_ID: Record<string, number> = {
  [SCENE_AUTO]: 0,
  [SCENE_SOFT_PORTRAIT]: 1,
  [SCENE_SPORTS]: 2,
  [SCENE_BEACH_SKI]: 3,
  [SCENE_SUNSET_MOON]: 4,
  [SCENE_LANDSCAPE]: 5,
};
const FX_ID: Record<string, number> = {
  [FX_NONE]: 0,
  [FX_PASTEL]: 1,
  [FX_NEG_ART]: 2,
  [FX_SEPIA]: 3,
  [FX_BW]: 4,
};

const runGLPipeline = (
  src: HTMLCanvasElement | OffscreenCanvas,
  W: number,
  H: number,
  awb: readonly [number, number, number],
  fluorescent: boolean,
  flashOn: boolean,
  flashPower: number,
  flashFalloff: number,
  flashOffsetX: number,
  flashOffsetY: number,
  sceneMode: string,
  pictureEffect: string,
  captureMode: string,
  frameJitter: number,
  smear: boolean,
  quality: string,
  frameIndex: number,
): HTMLCanvasElement | OffscreenCanvas | typeof JPEG_CODEC_UNAVAILABLE | null => {
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

  const seed = ((frameIndex * 7919 + 31337) % 1000000) * 0.001;

  // Pass 1: color pipeline.
  const flashCx = W * (0.5 + Math.max(-1, Math.min(1, flashOffsetX)) * 0.2);
  const flashCy = H * (0.45 + Math.max(-1, Math.min(1, flashOffsetY)) * 0.2);
  const flashMaxR = Math.max(W, H) * 0.9;
  drawPass(
    gl,
    preTex,
    W,
    H,
    cache.pre,
    () => {
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
    },
    vao,
  );

  // Pass 2: interlace. Target = interlaceTex (soften follows in FIELD mode)
  // or the default framebuffer (null = the GL canvas) in FRAME mode so we
  // can readoutToCanvas it directly.
  const effectiveFieldMode = flashOn && captureMode === CAPTURE_FRAME ? CAPTURE_FIELD : captureMode;
  const fieldMode = effectiveFieldMode === CAPTURE_FIELD;
  const interlaceTarget = fieldMode ? interlaceTex : null;
  drawPass(
    gl,
    interlaceTarget,
    W,
    H,
    cache.interlace,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, preTex.tex);
      gl.uniform1i(cache.interlace.uniforms.u_input, 0);
      gl.uniform2f(cache.interlace.uniforms.u_res, W, H);
      gl.uniform1i(cache.interlace.uniforms.u_captureField, fieldMode ? 1 : 0);
      gl.uniform1f(cache.interlace.uniforms.u_jitter, Math.max(0, Math.min(3, frameJitter)));
      gl.uniform1f(cache.interlace.uniforms.u_seed, seed);
    },
    vao,
  );

  // Pass 3: vertical soften (FIELD only) → default framebuffer.
  if (fieldMode) {
    drawPass(
      gl,
      null,
      W,
      H,
      cache.soften,
      () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, interlaceTex.tex);
        gl.uniform1i(cache.soften.uniforms.u_input, 0);
        gl.uniform2f(cache.soften.uniforms.u_res, W, H);
        gl.uniform1f(cache.soften.uniforms.u_amount, 0.22);
      },
      vao,
    );
  }
  // GL canvas now holds the pre-JPEG result. Hand off to the GL JPEG codec,
  // then run the post pass.
  const preJpegCanvas = readoutToCanvas(canvas, W, H);
  if (!preJpegCanvas) return null;
  return withPooledCanvasCleanup([preJpegCanvas], () => {
    const preCtx = (preJpegCanvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    const complexityBuf = preCtx?.getImageData(0, 0, W, H).data;
    const complexity = complexityBuf ? estimateSceneComplexity(complexityBuf, W, H) : 0.5;
    const jpegPreset = getBudgetedJpegPreset(quality, complexity, flashOn);
    const jpegCanvas = tryApplyJpegArtifactToCanvas(preJpegCanvas, jpegPreset);
    if (!jpegCanvas) return JPEG_CODEC_UNAVAILABLE;
    return withPooledCanvasCleanup(jpegCanvas === preJpegCanvas ? [] : [jpegCanvas], () => {
      // Pass 4: post (smear + noise + clip) reading from the JPEG result.
      resizeGLCanvas(canvas, W, H);
      const postSrcTex = ensureTexture(gl, "mavicaFd7:postSrc", W, H);
      uploadSourceTexture(gl, postSrcTex, jpegCanvas);

      const { rb: noiseRB, g: noiseG } =
        NOISE_PARAMS[quality as keyof typeof NOISE_PARAMS] ?? NOISE_PARAMS[QUALITY_FINE];
      drawPass(
        gl,
        null,
        W,
        H,
        cache.post,
        () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, postSrcTex.tex);
          gl.uniform1i(cache.post.uniforms.u_input, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.post.uniforms.u_alphaSource, 1);
          gl.uniform2f(cache.post.uniforms.u_res, W, H);
          gl.uniform1i(cache.post.uniforms.u_smear, smear ? 1 : 0);
          gl.uniform1f(cache.post.uniforms.u_smearThreshold, flashOn ? 245 : 235);
          gl.uniform1i(cache.post.uniforms.u_flash, flashOn ? 1 : 0);
          gl.uniform1f(cache.post.uniforms.u_noiseRB, noiseRB);
          gl.uniform1f(cache.post.uniforms.u_noiseG, noiseG);
          gl.uniform1f(cache.post.uniforms.u_shadowCut, flashOn ? 42 : 50);
          gl.uniform1f(cache.post.uniforms.u_clipPoint, flashOn ? 244 : 248);
          gl.uniform1f(cache.post.uniforms.u_seed, seed);
        },
        vao,
      );

      return readoutToCanvas(canvas, W, H);
    });
  });
};

const mavicaFd7 = (input: any, options: MavicaFd7Options = defaults) => {
  // The complete FD7 pipeline includes the shared WebGL-only JPEG codec.
  // Runtime dispatchers normally enforce requiresGL; direct callers get a
  // coherent passthrough rather than a silently JPEG-free approximation.
  if (!glAvailable()) return input;
  const supplied = { ...defaults, ...options };
  const resolved = {
    ...supplied,
    captureMode: normalizeEnumOption(
      supplied.captureMode,
      [CAPTURE_FIELD, CAPTURE_FRAME],
      defaults.captureMode,
    ),
    quality: normalizeEnumOption(
      supplied.quality,
      [QUALITY_FINE, QUALITY_STANDARD],
      defaults.quality,
    ),
    sceneMode: normalizeEnumOption(
      supplied.sceneMode,
      [
        SCENE_AUTO,
        SCENE_SOFT_PORTRAIT,
        SCENE_SPORTS,
        SCENE_BEACH_SKI,
        SCENE_SUNSET_MOON,
        SCENE_LANDSCAPE,
      ],
      defaults.sceneMode,
    ),
    pictureEffect: normalizeEnumOption(
      supplied.pictureEffect,
      [FX_NONE, FX_PASTEL, FX_NEG_ART, FX_SEPIA, FX_BW],
      defaults.pictureEffect,
    ),
    lighting: normalizeEnumOption(
      supplied.lighting,
      [LIGHTING_AUTO, LIGHTING_DAYLIGHT, LIGHTING_TUNGSTEN, LIGHTING_FLUORESCENT],
      defaults.lighting,
    ),
    flash: normalizeBooleanOption(supplied.flash, defaults.flash),
    flashPower: normalizeRangeOption(supplied.flashPower, defaults.flashPower, 0, 2),
    flashFalloff: normalizeRangeOption(supplied.flashFalloff, defaults.flashFalloff, 0.8, 3),
    flashOffsetX: normalizeRangeOption(supplied.flashOffsetX, defaults.flashOffsetX, -1, 1),
    flashOffsetY: normalizeRangeOption(supplied.flashOffsetY, defaults.flashOffsetY, -1, 1),
    smear: normalizeBooleanOption(supplied.smear, defaults.smear),
    nativeVgaOutput: normalizeBooleanOption(supplied.nativeVgaOutput, defaults.nativeVgaOutput),
    frameJitter: normalizeEnumOption(
      supplied.frameJitter,
      ["0", "1", "2", "3"],
      defaults.frameJitter,
    ),
  };
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
    frameJitter,
  } = resolved;
  const inputCtx = input.getContext("2d");
  if (!inputCtx) return input;

  const origW = input.width;
  const origH = input.height;

  // Step 1 — Downscale to 640x480 ceiling
  const needsScale = origW > MAX_W || origH > MAX_H;
  const workW = needsScale ? MAX_W : origW;
  const workH = needsScale ? MAX_H : origH;

  const workCanvas = takePooledCanvas(workW, workH);
  const workCtx = workCanvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!workCtx) {
    releasePooledCanvas(workCanvas);
    return input;
  }

  return withPooledCanvasCleanup([workCanvas], () => {
    // Pooled canvases retain their prior pixels. Drawing translucent input with
    // source-over would otherwise accumulate coverage on each reuse.
    workCtx.clearRect(0, 0, workW, workH);
    if (needsScale) {
      workCtx.imageSmoothingEnabled = true;
      workCtx.drawImage(input, 0, 0, workW, workH);
    } else {
      workCtx.drawImage(input, 0, 0);
    }

    const buf = workCtx.getImageData(0, 0, workW, workH).data;
    // Auto white balance is a small CPU reduction; all image stages and the
    // complete JPEG codec remain on the required WebGL2 pipeline.
    const [rMul, gMul, bMul] =
      lighting === LIGHTING_AUTO
        ? computeAutoAwb(buf)
        : AWB[lighting as keyof typeof AWB] || AWB[LIGHTING_AUTO];
    const glResult = runGLPipeline(
      workCanvas,
      workW,
      workH,
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
      Number(resolved._frameIndex || 0),
    );
    if (glResult === JPEG_CODEC_UNAVAILABLE) {
      const outputWidth = nativeVgaOutput ? workW : origW;
      const outputHeight = nativeVgaOutput ? workH : origH;
      return glUnavailableStub(outputWidth, outputHeight);
    }
    if (!glResult) return input;
    return withPooledCanvasCleanup([glResult], () => {
      const output = cloneCanvas(input, false);
      let transferred = false;
      try {
        if (nativeVgaOutput) {
          output.width = workW;
          output.height = workH;
        }
        const outputCtx = output.getContext("2d");
        if (!outputCtx) return input;
        if (nativeVgaOutput) {
          outputCtx.drawImage(glResult, 0, 0);
        } else if (needsScale) {
          outputCtx.imageSmoothingEnabled = false;
          outputCtx.drawImage(glResult, 0, 0, origW, origH);
        } else {
          outputCtx.drawImage(glResult, 0, 0);
        }
        logFilterBackend(
          "Mavica FD7",
          "WebGL2",
          `${quality} ${sceneMode} ${captureMode}${flash ? " flash" : ""}`,
        );
        transferred = true;
        return output;
      } finally {
        if (!transferred) releasePooledCanvas(output);
      }
    });
  });
};

export default defineFilter({
  // The JPEG helper receives a fresh preset, never this filter's injected history.
  history: {},
  name: "Mavica FD7",
  func: mavicaFd7,
  options: defaults,
  optionTypes,
  defaults,
  description:
    "Sony MVC-FD7 still-camera proxy with VGA CCD sampling, interlaced field capture, period JPEG budgets, scene modes, and optional flash artifacts",
  temporal: true,
  requiresGL: true,
});
