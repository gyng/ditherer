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
} from "gl";

// Pass 1 follows the first half of the ntsc-rs pipeline: RGB -> YIQ,
// bandwidth-limited chroma, carrier modulation, then disturbances applied to
// the scalar composite waveform. The signal is packed into R as [-2, 2].
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_frame;
uniform float u_seed;
uniform int u_fieldMode;
uniform float u_compositeSharpness;
uniform float u_compositeNoise;
uniform float u_snow;
uniform float u_snowAnisotropy;
uniform float u_headSwitching;
uniform float u_headSwitchingHeight;
uniform float u_trackingNoise;
uniform float u_trackingHeight;

const float PI = 3.14159265358979323846;

float hash(vec2 p) {
  p += vec2(u_seed * 0.1031, u_seed * 0.11369);
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 rgbToYiq(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.5959, -0.2746, -0.3213)),
    dot(c, vec3(0.2115, -0.5227, 0.3112))
  );
}

vec4 sourceAt(float x, float y) {
  vec2 cp = clamp(vec2(x, y), vec2(0.0), u_res - vec2(1.0));
  return texture(u_source, vec2(cp.x + 0.5, u_res.y - 0.5 - cp.y) / u_res);
}

float fieldSourceY(float y) {
  if (u_fieldMode == 2) {
    return clamp(floor(y * 0.5) * 2.0, 0.0, u_res.y - 1.0);
  }
  if (u_fieldMode == 3) {
    return clamp(floor(y * 0.5) * 2.0 + 1.0, 0.0, u_res.y - 1.0);
  }
  return y;
}

float smoothLineNoise(float y, float speed, float seed) {
  seed += u_seed * 0.0073;
  float a = sin(y * 0.071 + u_frame * speed + seed);
  float b = sin(y * 0.019 - u_frame * speed * 0.37 + seed * 2.3);
  float c = sin(y * 0.233 + u_frame * speed * 0.11 + seed * 4.7);
  return a * 0.58 + b * 0.29 + c * 0.13;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  float sy = fieldSourceY(y);

  float headHeight = max(u_headSwitchingHeight, 1.0);
  float headT = clamp((y - (u_res.y - headHeight)) / headHeight, 0.0, 1.0);
  float headShift = pow(headT, 1.5) * u_headSwitching
    * (0.82 + hash(vec2(floor(u_frame * 0.5), y)) * 0.36);

  float trackingHeight = max(u_trackingHeight, 1.0);
  float trackingT = clamp((y - (u_res.y - trackingHeight)) / trackingHeight, 0.0, 1.0);
  float trackingShift = smoothLineNoise(y, 0.31, 9.1)
    * u_trackingNoise * trackingT * trackingT;

  float warpedX = x + headShift + trackingShift;
  vec4 center = sourceAt(warpedX, sy);
  vec3 centerYiq = rgbToYiq(center.rgb);

  vec2 chroma = vec2(0.0);
  float chromaWeight = 0.0;
  for (int k = -3; k <= 3; k++) {
    float weight = 4.0 - abs(float(k));
    chroma += rgbToYiq(sourceAt(warpedX + float(k), sy).rgb).yz * weight;
    chromaWeight += weight;
  }
  chroma /= chromaWeight;

  float neighborY = (
    rgbToYiq(sourceAt(warpedX - 1.0, sy).rgb).x
    + rgbToYiq(sourceAt(warpedX + 1.0, sy).rgb).x
  ) * 0.5;
  float luma = centerYiq.x + (centerYiq.x - neighborY) * u_compositeSharpness * 0.18;

  float phaseLine = u_fieldMode == 1 ? y : floor(y * 0.5);
  float framePhase = u_fieldMode == 0 ? floor(u_frame) : 0.0;
  float linePhase = mod(phaseLine + framePhase, 2.0) * PI;
  float carrierPhase = warpedX * (PI * 0.5) + linePhase;
  float composite = luma + chroma.x * cos(carrierPhase) + chroma.y * sin(carrierPhase);

  float broadNoise = smoothLineNoise(y + x * 0.025, 0.43, 17.0);
  composite += broadNoise * u_compositeNoise * 0.12;
  composite += (hash(vec2(x + u_frame * 31.0, y)) - 0.5) * u_compositeNoise * 0.08;

  float lineSnow = hash(vec2(y, floor(u_frame * 0.75) + 29.0));
  float pixelSnow = hash(vec2(floor(x * 0.25), y + u_frame * 13.0));
  float snowGate = mix(pixelSnow, lineSnow, u_snowAnisotropy);
  if (snowGate < u_snow * 0.12) {
    float transient = hash(vec2(x * 1.73 + 7.0, y + u_frame * 43.0));
    composite += (transient * 2.0 - 0.65) * 0.9;
  }

  float packedSignal = clamp(composite * 0.25 + 0.5, 0.0, 1.0);
  fragColor = vec4(packedSignal, centerYiq.x, 0.0, center.a);
}
`;

// Pass 2 performs NTSC demodulation. The notch path separates the carrier
// horizontally; comb modes use phase-opposed neighboring scanlines, matching
// the one-line/two-line structure in ntsc-rs.
const DEMODULATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_composite;
uniform vec2 u_res;
uniform float u_frame;
uniform int u_fieldMode;
uniform int u_demodulation;

const float PI = 3.14159265358979323846;
const float IQ_PACK = 0.72;

vec4 packedAt(float x, float y) {
  vec2 cp = clamp(vec2(x, y), vec2(0.0), u_res - vec2(1.0));
  return texture(u_composite, vec2(cp.x + 0.5, u_res.y - 0.5 - cp.y) / u_res);
}

float signalAt(float x, float y) {
  return (packedAt(x, y).r - 0.5) * 4.0;
}

float notchLuma(float x, float y) {
  return signalAt(x, y) * 0.5
    + (signalAt(x - 2.0, y) + signalAt(x + 2.0, y)) * 0.25;
}

float lumaAt(float x, float y) {
  float current = signalAt(x, y);
  float lineStep = u_fieldMode == 1 ? 1.0 : 2.0;
  float prevY = y >= lineStep ? y - lineStep : y + lineStep;
  float nextY = y + lineStep < u_res.y ? y + lineStep : y - lineStep;
  if (u_demodulation == 1) {
    return (current + signalAt(x, prevY)) * 0.5;
  }
  if (u_demodulation == 2) {
    return current * 0.5
      + signalAt(x, prevY) * 0.25
      + signalAt(x, nextY) * 0.25;
  }
  return notchLuma(x, y);
}

float carrierPhase(float x, float y) {
  float phaseLine = u_fieldMode == 1 ? y : floor(y * 0.5);
  float framePhase = u_fieldMode == 0 ? floor(u_frame) : 0.0;
  float linePhase = mod(phaseLine + framePhase, 2.0) * PI;
  return x * (PI * 0.5) + linePhase;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  float luma = lumaAt(x, y);

  vec2 chroma = vec2(0.0);
  for (int k = -1; k <= 1; k++) {
    float fk = float(k);
    float weight = k == 0 ? 1.0 : 0.5;
    float sx = x + fk;
    float residual = signalAt(sx, y) - lumaAt(sx, y);
    float phase = carrierPhase(sx, y);
    chroma += vec2(cos(phase), sin(phase)) * residual * weight;
  }

  fragColor = vec4(
    clamp(luma, 0.0, 1.0),
    clamp(chroma.x * IQ_PACK + 0.5, 0.0, 1.0),
    clamp(chroma.y * IQ_PACK + 0.5, 0.0, 1.0),
    packedAt(x, y).a
  );
}
`;

// Pass 3 applies the helical-tape bandwidth profile and converts back to RGB.
// SP/LP/EP become progressively wider gather kernels and larger chroma delay.
const TAPE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_yiq;
uniform vec2 u_res;
uniform float u_frame;
uniform float u_seed;
uniform int u_filterType;
uniform int u_lumaRadius;
uniform int u_chromaRadius;
uniform float u_tapeChromaDelay;
uniform float u_chromaDelayH;
uniform float u_chromaDelayV;
uniform bool u_chromaVertBlend;
uniform float u_chromaLoss;
uniform float u_chromaPhaseNoise;
uniform float u_chromaPhaseError;
uniform float u_lumaSmear;
uniform float u_ringing;
uniform float u_lumaNoise;
uniform float u_chromaNoise;
uniform float u_edgeWave;

const float PI = 3.14159265358979323846;
const float IQ_PACK = 0.72;

float hash(vec2 p) {
  p += vec2(u_seed * 0.1031, u_seed * 0.11369);
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 packedAt(float x, float y) {
  vec2 cp = clamp(vec2(x, y), vec2(0.0), u_res - vec2(1.0));
  return texture(u_yiq, vec2(cp.x + 0.5, u_res.y - 0.5 - cp.y) / u_res);
}

vec3 yiqAt(float x, float y) {
  vec3 p = packedAt(x, y).rgb;
  return vec3(p.r, (p.g - 0.5) / IQ_PACK, (p.b - 0.5) / IQ_PACK);
}

vec3 yiqToRgb(vec3 c) {
  return vec3(
    c.x + 0.956 * c.y + 0.619 * c.z,
    c.x - 0.272 * c.y - 0.647 * c.z,
    c.x - 1.106 * c.y + 1.703 * c.z
  );
}

float tapWeight(int k, int radius) {
  if (radius == 0) return k == 0 ? 1.0 : 0.0;
  float distance = abs(float(k));
  if (distance > float(radius)) return 0.0;
  if (u_filterType == 1) {
    return exp(-distance / max(float(radius) * 0.52, 0.5));
  }
  float normalized = distance / (float(radius) + 1.0);
  return 1.0 / (1.0 + pow(normalized * 2.1, 4.0));
}

float edgeShiftForLine(float y) {
  float seedPhase = u_seed * 0.0073;
  float a = sin(y * 0.071 + u_frame * 0.055 + 1.7 + seedPhase);
  float b = sin(y * 0.019 - u_frame * 0.02035 + 3.91 + seedPhase * 2.3);
  float c = sin(y * 0.233 + u_frame * 0.00605 + 7.99 + seedPhase * 4.7);
  return (a * 0.58 + b * 0.29 + c * 0.13) * u_edgeWave;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float luma = 0.0;
  float lumaWeight = 0.0;
  vec2 chroma = vec2(0.0);
  float chromaWeight = 0.0;
  float baseX = x + edgeShiftForLine(y);
  float chromaX = baseX + u_tapeChromaDelay + u_chromaDelayH;
  float chromaY = y + u_chromaDelayV;

  for (int k = -8; k <= 8; k++) {
    float lw = tapWeight(k, u_lumaRadius);
    float cw = tapWeight(k, u_chromaRadius);
    luma += yiqAt(baseX + float(k), y).x * lw;
    chroma += yiqAt(chromaX + float(k), chromaY).yz * cw;
    lumaWeight += lw;
    chromaWeight += cw;
  }
  luma /= max(lumaWeight, 0.0001);
  chroma /= max(chromaWeight, 0.0001);

  if (u_chromaVertBlend) {
    vec2 above = vec2(0.0);
    float aboveWeight = 0.0;
    for (int k = -8; k <= 8; k++) {
      float cw = tapWeight(k, u_chromaRadius);
      above += yiqAt(chromaX + float(k), chromaY - 1.0).yz * cw;
      aboveWeight += cw;
    }
    chroma = mix(chroma, above / max(aboveWeight, 0.0001), 0.5);
  }

  float smear1 = yiqAt(baseX - 1.0, y).x;
  float smear2 = yiqAt(baseX - 2.0, y).x;
  luma = mix(luma, luma * 0.55 + smear1 * 0.30 + smear2 * 0.15, u_lumaSmear);

  float leftY = yiqAt(baseX - 1.0, y).x;
  float rightY = yiqAt(baseX + 1.0, y).x;
  luma += (luma - (leftY + rightY) * 0.5) * u_ringing * 0.65;

  if (hash(vec2(y, floor(u_frame) + 113.0)) < u_chromaLoss) {
    chroma = vec2(0.0);
  }

  float phase = u_chromaPhaseError * PI * 2.0
    + (hash(vec2(y * 0.37, floor(u_frame * 0.5) + 47.0)) - 0.5)
      * 2.0 * u_chromaPhaseNoise * PI * 2.0;
  float cp = cos(phase);
  float sp = sin(phase);
  chroma = mat2(cp, sp, -sp, cp) * chroma;

  luma += (hash(vec2(x + u_frame * 17.0, y * 1.7)) - 0.5) * u_lumaNoise * 0.16;
  float chromaGrain = hash(vec2(floor(x * 0.25) + u_frame * 5.0, y + 83.0)) - 0.5;
  chroma += vec2(chromaGrain, -chromaGrain * 0.63) * u_chromaNoise * 0.18;

  vec3 rgb = clamp(yiqToRgb(vec3(luma, chroma)), 0.0, 1.0);
  fragColor = vec4(rgb, packedAt(x, y).a);
}
`;

type Cache = {
  composite: Program;
  demodulate: Program;
  tape: Program;
};

let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    composite: linkProgram(gl, COMPOSITE_FS, [
      "u_source", "u_res", "u_frame", "u_seed", "u_fieldMode", "u_compositeSharpness",
      "u_compositeNoise", "u_snow", "u_snowAnisotropy", "u_headSwitching",
      "u_headSwitchingHeight", "u_trackingNoise", "u_trackingHeight",
    ] as const),
    demodulate: linkProgram(gl, DEMODULATE_FS, [
      "u_composite", "u_res", "u_frame", "u_fieldMode", "u_demodulation",
    ] as const),
    tape: linkProgram(gl, TAPE_FS, [
      "u_yiq", "u_res", "u_frame", "u_seed", "u_filterType", "u_lumaRadius",
      "u_chromaRadius", "u_tapeChromaDelay", "u_chromaDelayH", "u_chromaDelayV",
      "u_chromaVertBlend", "u_chromaLoss", "u_chromaPhaseNoise",
      "u_chromaPhaseError", "u_lumaSmear", "u_ringing", "u_lumaNoise",
      "u_chromaNoise", "u_edgeWave",
    ] as const),
  };
  return _cache;
};

export const vhsNtscGLAvailable = (): boolean => glAvailable();

export type VHSNTSCGLParams = {
  frame: number;
  seed: number;
  fieldMode: number;
  filterType: number;
  demodulation: number;
  lumaRadius: number;
  chromaRadius: number;
  tapeChromaDelay: number;
  compositeSharpness: number;
  compositeNoise: number;
  snow: number;
  snowAnisotropy: number;
  headSwitching: number;
  headSwitchingHeight: number;
  trackingNoise: number;
  trackingHeight: number;
  edgeWave: number;
  chromaDelayH: number;
  chromaDelayV: number;
  chromaVertBlend: boolean;
  chromaLoss: number;
  chromaPhaseNoise: number;
  chromaPhaseError: number;
  lumaSmear: number;
  ringing: number;
  lumaNoise: number;
  chromaNoise: number;
};

export const renderVHSNTSCGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  params: VHSNTSCGLParams,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "vhsNtsc:source", width, height);
  const compositeTex = ensureTexture(gl, "vhsNtsc:composite", width, height);
  const yiqTex = ensureTexture(gl, "vhsNtsc:yiq", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, compositeTex, width, height, cache.composite, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.composite.uniforms.u_source, 0);
    gl.uniform2f(cache.composite.uniforms.u_res, width, height);
    gl.uniform1f(cache.composite.uniforms.u_frame, params.frame);
    gl.uniform1f(cache.composite.uniforms.u_seed, params.seed);
    gl.uniform1i(cache.composite.uniforms.u_fieldMode, params.fieldMode);
    gl.uniform1f(cache.composite.uniforms.u_compositeSharpness, params.compositeSharpness);
    gl.uniform1f(cache.composite.uniforms.u_compositeNoise, params.compositeNoise);
    gl.uniform1f(cache.composite.uniforms.u_snow, params.snow);
    gl.uniform1f(cache.composite.uniforms.u_snowAnisotropy, params.snowAnisotropy);
    gl.uniform1f(cache.composite.uniforms.u_headSwitching, params.headSwitching);
    gl.uniform1f(cache.composite.uniforms.u_headSwitchingHeight, params.headSwitchingHeight);
    gl.uniform1f(cache.composite.uniforms.u_trackingNoise, params.trackingNoise);
    gl.uniform1f(cache.composite.uniforms.u_trackingHeight, params.trackingHeight);
  }, vao);

  drawPass(gl, yiqTex, width, height, cache.demodulate, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, compositeTex.tex);
    gl.uniform1i(cache.demodulate.uniforms.u_composite, 0);
    gl.uniform2f(cache.demodulate.uniforms.u_res, width, height);
    gl.uniform1f(cache.demodulate.uniforms.u_frame, params.frame);
    gl.uniform1i(cache.demodulate.uniforms.u_fieldMode, params.fieldMode);
    gl.uniform1i(cache.demodulate.uniforms.u_demodulation, params.demodulation);
  }, vao);

  drawPass(gl, null, width, height, cache.tape, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, yiqTex.tex);
    gl.uniform1i(cache.tape.uniforms.u_yiq, 0);
    gl.uniform2f(cache.tape.uniforms.u_res, width, height);
    gl.uniform1f(cache.tape.uniforms.u_frame, params.frame);
    gl.uniform1f(cache.tape.uniforms.u_seed, params.seed);
    gl.uniform1i(cache.tape.uniforms.u_filterType, params.filterType);
    gl.uniform1i(cache.tape.uniforms.u_lumaRadius, params.lumaRadius);
    gl.uniform1i(cache.tape.uniforms.u_chromaRadius, params.chromaRadius);
    gl.uniform1f(cache.tape.uniforms.u_tapeChromaDelay, params.tapeChromaDelay);
    gl.uniform1f(cache.tape.uniforms.u_chromaDelayH, params.chromaDelayH);
    gl.uniform1f(cache.tape.uniforms.u_chromaDelayV, params.chromaDelayV);
    gl.uniform1i(cache.tape.uniforms.u_chromaVertBlend, params.chromaVertBlend ? 1 : 0);
    gl.uniform1f(cache.tape.uniforms.u_chromaLoss, params.chromaLoss);
    gl.uniform1f(cache.tape.uniforms.u_chromaPhaseNoise, params.chromaPhaseNoise);
    gl.uniform1f(cache.tape.uniforms.u_chromaPhaseError, params.chromaPhaseError);
    gl.uniform1f(cache.tape.uniforms.u_lumaSmear, params.lumaSmear);
    gl.uniform1f(cache.tape.uniforms.u_ringing, params.ringing);
    gl.uniform1f(cache.tape.uniforms.u_lumaNoise, params.lumaNoise);
    gl.uniform1f(cache.tape.uniforms.u_chromaNoise, params.chromaNoise);
    gl.uniform1f(cache.tape.uniforms.u_edgeWave, params.edgeWave);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
