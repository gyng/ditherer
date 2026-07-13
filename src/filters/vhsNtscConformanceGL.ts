import {
  drawPass,
  ensureFloatTexture,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadFloatTexture,
  uploadSourceTexture,
  type Program,
  type TexEntry,
} from "gl";
import {
  TAPE_PROFILES,
  makeCompositePreemphasisKernel,
  makeLowpassKernel,
  makeLumaSmearKernel,
  makeNoisePlane,
  makeNotchKernel,
  makeRestorationKernel,
  makeRingingKernel,
  makeRowNoisePlane,
  makeSharpenKernel,
  type TapeFilterType,
  type TapeSpeed,
} from "./vhsNtscConformance";
import type { VHSNTSCGLParams } from "./vhsNtscGL";

const SIGNAL_READ = `
vec4 signalAt(sampler2D tex, float x, float y, vec2 res) {
  vec2 p = clamp(vec2(x, y), vec2(0.0), res - vec2(1.0));
  return texture(tex, vec2(p.x + 0.5, res.y - 0.5 - p.y) / res);
}
`;

const ENCODE_YIQ_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform vec2 u_sourceRes;
uniform int u_parity;
vec4 sourceAt(float x, float y) {
  vec2 p = clamp(vec2(x, y), vec2(0.0), u_sourceRes - vec2(1.0));
  return texture(u_source, vec2(p.x + 0.5, u_sourceRes.y - 0.5 - p.y) / u_sourceRes);
}
vec3 rgbToYiq(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.5959, -0.2746, -0.3213)),
    dot(c, vec3(0.2115, -0.5227, 0.3112)));
}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  float sourceY = u_parity < 0 ? y : y * 2.0 + float(u_parity);
  vec4 source = sourceAt(x, sourceY);
  fragColor = vec4(rgbToYiq(source.rgb), source.a);
}
`;

const MODULATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_yiq;
uniform vec2 u_res;
uniform float u_frame;
uniform int u_parity;
const float PI = 3.14159265358979323846;
${SIGNAL_READ}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec4 yiq = signalAt(u_yiq, x, y, u_res);
  float lineIndex = y * 2.0;
  float phaseIndex = floor(mod(floor(u_frame) + lineIndex, 4.0) * 0.5) * 2.0;
  float phase = x * PI * 0.5 + phaseIndex * PI * 0.5;
  fragColor = vec4(yiq.r + yiq.g * cos(phase) + yiq.b * sin(phase), yiq.a, 0.0, 1.0);
}
`;

const COMPOSITE_EFFECTS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_composite;
uniform sampler2D u_noise;
uniform sampler2D u_rows;
uniform vec2 u_res;
uniform vec2 u_sourceRes;
uniform int u_parity;
uniform float u_compositeNoise;
uniform float u_snow;
uniform float u_snowAnisotropy;
uniform float u_headSwitching;
uniform float u_headSwitchingHeight;
uniform float u_trackingNoise;
uniform float u_trackingHeight;
${SIGNAL_READ}
vec4 noiseAt(float x, float y) { return texture(u_noise, (vec2(x, y) + 0.5) / u_res); }
vec4 rowAt(float y) { return texture(u_rows, vec2(0.5, (y + 0.5) / u_res.y)); }
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  float fullY = u_parity < 0 ? y : y * 2.0 + float(u_parity);
  vec4 row = rowAt(y);
  float headHeight = max(u_headSwitchingHeight, 1.0);
  float headT = clamp((fullY - (u_sourceRes.y - headHeight)) / headHeight, 0.0, 1.0);
  float trackingHeight = max(u_trackingHeight, 1.0);
  float trackingT = clamp((fullY - (u_sourceRes.y - trackingHeight)) / trackingHeight, 0.0, 1.0);
  float shift = pow(headT, 1.5) * u_headSwitching * (1.0 + row.a)
    + row.b * u_trackingNoise * trackingT * trackingT;
  vec4 value = signalAt(u_composite, x + shift, y, u_res);
  vec4 noise = noiseAt(x, y);
  value.r += noise.r * u_compositeNoise;
  float snowGate = mix(abs(noise.g), abs(noise.r), u_snowAnisotropy);
  if (snowGate < u_snow * 0.5) value.r += sign(noise.b) * 0.75;
  fragColor = value;
}
`;

const DEMODULATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_composite;
uniform sampler2D u_notch;
uniform vec2 u_res;
uniform float u_frame;
uniform int u_parity;
uniform int u_demodulation;
const float PI = 3.14159265358979323846;
${SIGNAL_READ}
float sampleComposite(float x, float y) { return signalAt(u_composite, x, y, u_res).r; }
float lumaAt(float x, float y) {
  float current = sampleComposite(x, y);
  float previous = sampleComposite(x, y - 1.0);
  float next = sampleComposite(x, y + 1.0);
  if (u_demodulation == 0) return signalAt(u_notch, x, y, u_res).r;
  if (u_demodulation == 1) return (current + previous) * 0.5;
  if (u_demodulation == 2) return current * 0.5 + (previous + next) * 0.25;
  return current;
}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  float luma = lumaAt(x, y);
  vec2 chroma = vec2(0.0);
  float lineIndex = y * 2.0;
  float phaseIndex = floor(mod(floor(u_frame) + lineIndex, 4.0) * 0.5) * 2.0;
  for (int k = -1; k <= 1; k++) {
    float sx = x + float(k);
    float residual = sampleComposite(sx, y) - lumaAt(sx, y);
    float phase = sx * PI * 0.5 + phaseIndex * PI * 0.5;
    float weight = k == 0 ? 1.0 : 0.5;
    chroma += vec2(cos(phase), sin(phase)) * residual * weight;
  }
  fragColor = vec4(luma, chroma, signalAt(u_composite, x, y, u_res).g);
}
`;

const PRE_TAPE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_yiq;
uniform sampler2D u_noise;
uniform sampler2D u_rows;
uniform vec2 u_res;
uniform float u_lumaNoise;
uniform float u_chromaNoise;
uniform float u_chromaPhaseNoise;
uniform float u_chromaPhaseError;
uniform float u_edgeWave;
const float PI = 3.14159265358979323846;
${SIGNAL_READ}
vec4 noiseAt(float x, float y) { return texture(u_noise, (vec2(x, y) + 0.5) / u_res); }
vec4 rowAt(float y) { return texture(u_rows, vec2(0.5, (y + 0.5) / u_res.y)); }
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec4 row = rowAt(y);
  float shiftedX = x + (row.b / 0.022) * u_edgeWave * 0.5;
  vec4 center = signalAt(u_yiq, shiftedX, y, u_res);
  float luma = center.r;
  vec4 noise = noiseAt(x, y);
  luma += noise.g * u_lumaNoise;
  vec2 chroma = center.gb + noise.ba * u_chromaNoise;
  float phase = (u_chromaPhaseError + row.r * u_chromaPhaseNoise) * PI * 2.0;
  float s = sin(phase); float c = cos(phase);
  chroma = mat2(c, s, -s, c) * chroma;
  fragColor = vec4(luma, chroma, center.a);
}
`;

const FIR_ACCUMULATE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_accumulator;
uniform vec2 u_res;
uniform float u_luma[17];
uniform float u_i[17];
uniform float u_q[17];
uniform int u_offset;
uniform int u_first;
uniform float u_iAdvance;
uniform float u_qAdvance;
uniform float u_chromaDelayH;
uniform float u_chromaDelayV;
uniform int u_lumaZeroLeft;
uniform int u_iZeroLeft;
uniform int u_qZeroLeft;
${SIGNAL_READ}
float lumaAt(float x, float y) {
  if (u_lumaZeroLeft == 1 && x < 0.0) return 0.0;
  return signalAt(u_source, x, y, u_res).r;
}
float iAt(float x, float y) {
  if (u_iZeroLeft == 1 && x < 0.0) return 0.0;
  return signalAt(u_source, x, y, u_res).g;
}
float qAt(float x, float y) {
  if (u_qZeroLeft == 1 && x < 0.0) return 0.0;
  return signalAt(u_source, x, y, u_res).b;
}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec3 value = u_first == 1 ? vec3(0.0) : signalAt(u_accumulator, x, y, u_res).rgb;
  for (int k = 0; k < 17; k++) {
    float delay = float(u_offset + k);
    value.r += lumaAt(x - delay, y) * u_luma[k];
    value.g += iAt(
      x + u_iAdvance + u_chromaDelayH - delay,
      y + u_chromaDelayV) * u_i[k];
    value.b += qAt(
      x + u_qAdvance + u_chromaDelayH - delay,
      y + u_chromaDelayV) * u_q[k];
  }
  fragColor = vec4(value, signalAt(u_source, x, y, u_res).a);
}
`;

const LUMA_FIR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_kernel[17];
uniform float u_advance;
uniform int u_zeroLeft;
${SIGNAL_READ}
float lumaAt(float x, float y) {
  if (u_zeroLeft == 1 && x < 0.0) return 0.0;
  return signalAt(u_source, x, y, u_res).r;
}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec4 center = signalAt(u_source, x, y, u_res);
  float luma = 0.0;
  for (int k = 0; k < 17; k++) luma += lumaAt(x + u_advance - float(k), y) * u_kernel[k];
  fragColor = vec4(luma, center.gba);
}
`;

const CHROMA_LOSS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_rows;
uniform vec2 u_res;
${SIGNAL_READ}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec4 value = signalAt(u_source, x, y, u_res);
  float lost = texture(u_rows, vec2(0.5, (y + 0.5) / u_res.y)).g;
  value.gb *= 1.0 - step(0.5, lost);
  fragColor = value;
}
`;

const OUTPUT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
${SIGNAL_READ}
vec3 yiqToRgb(vec3 c) {
  return vec3(c.x + 0.956 * c.y + 0.619 * c.z,
    c.x - 0.272 * c.y - 0.647 * c.z,
    c.x - 1.106 * c.y + 1.703 * c.z);
}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec4 value = signalAt(u_source, x, y, u_res);
  fragColor = vec4(clamp(yiqToRgb(value.rgb), 0.0, 1.0), value.a);
}
`;

const VERTICAL_BLEND_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_enabled;
${SIGNAL_READ}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec4 value = signalAt(u_source, x, y, u_res);
  if (u_enabled == 1) value.gb = (value.gb + signalAt(u_source, x, y - 1.0, u_res).gb) * 0.5;
  fragColor = value;
}
`;

const WEAVE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_upper;
uniform sampler2D u_lower;
uniform vec2 u_res;
uniform float u_upperHeight;
uniform float u_lowerHeight;
uniform int u_mode;
vec4 fieldAt(sampler2D tex, float x, float row, float fieldHeight) {
  float y = clamp(row, 0.0, fieldHeight - 1.0);
  return texture(tex, vec2((x + 0.5) / u_res.x, (fieldHeight - 0.5 - y) / fieldHeight));
}
void main() {
  float x = floor(v_uv.x * u_res.x);
  float y = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  if (u_mode == 4) fragColor = fieldAt(u_upper, x, y, u_upperHeight);
  else if (u_mode == 2) fragColor = fieldAt(u_upper, x, floor(y * 0.5), u_upperHeight);
  else if (u_mode == 3) fragColor = fieldAt(u_lower, x, floor(y * 0.5), u_lowerHeight);
  else if (mod(y, 2.0) < 1.0) fragColor = fieldAt(u_upper, x, floor(y * 0.5), u_upperHeight);
  else fragColor = fieldAt(u_lower, x, floor(y * 0.5), u_lowerHeight);
}
`;

type Cache = {
  encode: Program;
  modulate: Program;
  compositeEffects: Program;
  demodulate: Program;
  preTape: Program;
  fir: Program;
  lumaFir: Program;
  chromaLoss: Program;
  verticalBlend: Program;
  output: Program;
  weave: Program;
};
let cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => cache ??= {
  encode: linkProgram(gl, ENCODE_YIQ_FS, ["u_source", "u_res", "u_sourceRes", "u_parity"]),
  modulate: linkProgram(gl, MODULATE_FS, ["u_yiq", "u_res", "u_frame", "u_parity"]),
  compositeEffects: linkProgram(gl, COMPOSITE_EFFECTS_FS, ["u_composite", "u_noise", "u_rows", "u_res", "u_sourceRes", "u_parity", "u_compositeNoise", "u_snow", "u_snowAnisotropy", "u_headSwitching", "u_headSwitchingHeight", "u_trackingNoise", "u_trackingHeight"]),
  demodulate: linkProgram(gl, DEMODULATE_FS, ["u_composite", "u_notch", "u_res", "u_frame", "u_parity", "u_demodulation"]),
  preTape: linkProgram(gl, PRE_TAPE_FS, ["u_yiq", "u_noise", "u_rows", "u_res", "u_lumaNoise", "u_chromaNoise", "u_chromaPhaseNoise", "u_chromaPhaseError", "u_edgeWave"]),
  fir: linkProgram(gl, FIR_ACCUMULATE_FS, ["u_source", "u_accumulator", "u_res", "u_luma[0]", "u_i[0]", "u_q[0]", "u_offset", "u_first", "u_iAdvance", "u_qAdvance", "u_chromaDelayH", "u_chromaDelayV", "u_lumaZeroLeft", "u_iZeroLeft", "u_qZeroLeft"]),
  lumaFir: linkProgram(gl, LUMA_FIR_FS, ["u_source", "u_res", "u_kernel[0]", "u_advance", "u_zeroLeft"]),
  chromaLoss: linkProgram(gl, CHROMA_LOSS_FS, ["u_source", "u_rows", "u_res"]),
  verticalBlend: linkProgram(gl, VERTICAL_BLEND_FS, ["u_source", "u_res", "u_enabled"]),
  output: linkProgram(gl, OUTPUT_FS, ["u_source", "u_res"]),
  weave: linkProgram(gl, WEAVE_FS, ["u_upper", "u_lower", "u_res", "u_upperHeight", "u_lowerHeight", "u_mode"]),
};

const bindTexture = (gl: WebGL2RenderingContext, texture: WebGLTexture, unit: number): void => {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
};

const paddedChunk = (kernel: Float32Array, offset: number): Float32Array => {
  const chunk = new Float32Array(17);
  chunk.set(kernel.subarray(offset, offset + 17));
  return chunk;
};

let lastFloatPath = false;
let lastFloatStatus = "not-run";
export const vhsNtscUsingFloatPath = (): boolean => lastFloatPath;
export const vhsNtscFloatStatus = (): string => lastFloatStatus;
export const markVHSNTSCFloatFailure = (reason: string): void => {
  lastFloatPath = false;
  lastFloatStatus = reason;
};

export const renderVHSNTSCConformanceGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  params: VHSNTSCGLParams,
): HTMLCanvasElement | OffscreenCanvas | null => {
  lastFloatPath = false;
  lastFloatStatus = "starting";
  const context = getGLCtx();
  if (!context) { lastFloatStatus = "no-webgl2"; return null; }
  const { gl, canvas } = context;
  const probe = ensureFloatTexture(gl, "vhsNtscConformance:probe", 1, 1);
  if (!probe) { lastFloatStatus = "rgba16f-unavailable"; return null; }
  const programs = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "vhsNtscConformance:source", width, height);
  uploadSourceTexture(gl, sourceTexture, source);

  const tapeSpeed = (["NONE", "SP", "LP", "EP"][params.tapeSpeed] ?? "LP") as TapeSpeed;
  const filterType = (params.filterType === 1 ? "CONSTANT_K" : "BUTTERWORTH") as TapeFilterType;
  const profile = TAPE_PROFILES[tapeSpeed];
  const tapeSharpness = Number.isFinite(params.tapeSharpness) ? params.tapeSharpness : 0.25;
  const lumaKernel = makeLowpassKernel(profile.lumaCutoff, filterType);
  const chromaKernel = makeLowpassKernel(profile.chromaCutoff, filterType);
  const restoration = tapeSpeed === "NONE"
    ? makeLowpassKernel(0, filterType, 17)
    : makeRestorationKernel(profile.lumaCutoff);
  const sharpen = tapeSpeed === "NONE"
    ? makeLowpassKernel(0, filterType, 17)
    : makeSharpenKernel(profile.lumaCutoff, filterType, tapeSharpness);
  const outputIKernel = makeLowpassKernel(1_300_000, filterType);
  const outputQKernel = makeLowpassKernel(600_000, filterType);
  const identityKernel = makeLowpassKernel(0, filterType);
  const smearKernel = makeLumaSmearKernel(params.lumaSmear);
  const ringingKernel = makeRingingKernel(
    params.ringingFrequency,
    params.ringingPower,
    params.ringing,
  );
  const demodulationNotch = makeNotchKernel(0.5, 2, 1, 65);
  const compositePreemphasis = makeCompositePreemphasisKernel(params.compositeSharpness);

  const renderField = (parity: number, fieldFrame: number, fieldHeight: number, key: string): TexEntry | null => {
    const prefix = "vhsNtscConformance:";
    const composite = ensureFloatTexture(gl, `${prefix}composite`, width, fieldHeight);
    const yiq = ensureFloatTexture(gl, `${prefix}yiq`, width, fieldHeight);
    const preTape = ensureFloatTexture(gl, `${prefix}preTape`, width, fieldHeight);
    const ping = ensureFloatTexture(gl, `${prefix}ping`, width, fieldHeight);
    const pong = ensureFloatTexture(gl, `${prefix}pong`, width, fieldHeight);
    const noise = ensureFloatTexture(gl, `${prefix}noise`, width, fieldHeight);
    const rows = ensureFloatTexture(gl, `${prefix}rows`, 1, fieldHeight);
    const final = ensureFloatTexture(gl, `${prefix}final:${key}`, width, fieldHeight);
    if (!composite || !yiq || !preTape || !ping || !pong || !noise || !rows || !final) {
      lastFloatStatus = `field-${key}-allocation-failed`;
      return null;
    }
    const noisePlane = makeNoisePlane(width, fieldHeight, params.seed, fieldFrame);
    const rowPlane = makeRowNoisePlane(fieldHeight, params.seed, fieldFrame, params.chromaLoss);
    uploadFloatTexture(gl, noise, width, fieldHeight, noisePlane.data);
    uploadFloatTexture(gl, rows, 1, fieldHeight, rowPlane.data);

    drawPass(gl, yiq, width, fieldHeight, programs.encode, () => {
      bindTexture(gl, sourceTexture.tex, 0); gl.uniform1i(programs.encode.uniforms.u_source, 0);
      gl.uniform2f(programs.encode.uniforms.u_res, width, fieldHeight);
      gl.uniform2f(programs.encode.uniforms.u_sourceRes, width, height);
      gl.uniform1i(programs.encode.uniforms.u_parity, parity);
    }, vao);

    // Broadcast input chroma bandwidth: distinct I/Q cutoffs and advances.
    let inputAccumulator = ping;
    for (let offset = 0, pass = 0; offset < 65; offset += 17, pass++) {
      const target = pass % 2 === 0 ? ping : pong;
      const previous = pass % 2 === 0 ? pong : ping;
      drawPass(gl, target, width, fieldHeight, programs.fir, () => {
        bindTexture(gl, yiq.tex, 0); gl.uniform1i(programs.fir.uniforms.u_source, 0);
        bindTexture(gl, previous.tex, 1); gl.uniform1i(programs.fir.uniforms.u_accumulator, 1);
        gl.uniform2f(programs.fir.uniforms.u_res, width, fieldHeight);
        gl.uniform1fv(programs.fir.uniforms["u_luma[0]"], paddedChunk(demodulationNotch, offset));
        gl.uniform1fv(programs.fir.uniforms["u_i[0]"], paddedChunk(outputIKernel, offset));
        gl.uniform1fv(programs.fir.uniforms["u_q[0]"], paddedChunk(outputQKernel, offset));
        gl.uniform1i(programs.fir.uniforms.u_offset, offset);
        gl.uniform1i(programs.fir.uniforms.u_first, pass === 0 ? 1 : 0);
        gl.uniform1f(programs.fir.uniforms.u_iAdvance, 2);
        gl.uniform1f(programs.fir.uniforms.u_qAdvance, 4);
        gl.uniform1f(programs.fir.uniforms.u_chromaDelayH, 0);
        gl.uniform1f(programs.fir.uniforms.u_chromaDelayV, 0);
        gl.uniform1i(programs.fir.uniforms.u_lumaZeroLeft, 0);
        gl.uniform1i(programs.fir.uniforms.u_iZeroLeft, 1);
        gl.uniform1i(programs.fir.uniforms.u_qZeroLeft, 1);
      }, vao);
      inputAccumulator = target;
    }
    drawPass(gl, composite, width, fieldHeight, programs.modulate, () => {
      bindTexture(gl, inputAccumulator.tex, 0); gl.uniform1i(programs.modulate.uniforms.u_yiq, 0);
      gl.uniform2f(programs.modulate.uniforms.u_res, width, fieldHeight);
      gl.uniform1f(programs.modulate.uniforms.u_frame, fieldFrame);
      gl.uniform1i(programs.modulate.uniforms.u_parity, parity);
    }, vao);
    drawPass(gl, preTape, width, fieldHeight, programs.lumaFir, () => {
      bindTexture(gl, composite.tex, 0); gl.uniform1i(programs.lumaFir.uniforms.u_source, 0);
      gl.uniform2f(programs.lumaFir.uniforms.u_res, width, fieldHeight);
      gl.uniform1fv(programs.lumaFir.uniforms["u_kernel[0]"], compositePreemphasis);
      gl.uniform1f(programs.lumaFir.uniforms.u_advance, 0);
      gl.uniform1i(programs.lumaFir.uniforms.u_zeroLeft, 1);
    }, vao);
    drawPass(gl, yiq, width, fieldHeight, programs.compositeEffects, () => {
      bindTexture(gl, preTape.tex, 0); gl.uniform1i(programs.compositeEffects.uniforms.u_composite, 0);
      bindTexture(gl, noise.tex, 1); gl.uniform1i(programs.compositeEffects.uniforms.u_noise, 1);
      bindTexture(gl, rows.tex, 2); gl.uniform1i(programs.compositeEffects.uniforms.u_rows, 2);
      gl.uniform2f(programs.compositeEffects.uniforms.u_res, width, fieldHeight);
      gl.uniform2f(programs.compositeEffects.uniforms.u_sourceRes, width, height);
      gl.uniform1i(programs.compositeEffects.uniforms.u_parity, parity);
      gl.uniform1f(programs.compositeEffects.uniforms.u_compositeNoise, params.compositeNoise);
      gl.uniform1f(programs.compositeEffects.uniforms.u_snow, params.snow);
      gl.uniform1f(programs.compositeEffects.uniforms.u_snowAnisotropy, params.snowAnisotropy);
      gl.uniform1f(programs.compositeEffects.uniforms.u_headSwitching, params.headSwitching);
      gl.uniform1f(programs.compositeEffects.uniforms.u_headSwitchingHeight, params.headSwitchingHeight);
      gl.uniform1f(programs.compositeEffects.uniforms.u_trackingNoise, params.trackingNoise);
      gl.uniform1f(programs.compositeEffects.uniforms.u_trackingHeight, params.trackingHeight);
    }, vao);
    let notchAccumulator = ping;
    for (let offset = 0, pass = 0; offset < 65; offset += 17, pass++) {
      const target = pass % 2 === 0 ? ping : pong;
      const previous = pass % 2 === 0 ? pong : ping;
      drawPass(gl, target, width, fieldHeight, programs.fir, () => {
        bindTexture(gl, yiq.tex, 0); gl.uniform1i(programs.fir.uniforms.u_source, 0);
        bindTexture(gl, previous.tex, 1); gl.uniform1i(programs.fir.uniforms.u_accumulator, 1);
        gl.uniform2f(programs.fir.uniforms.u_res, width, fieldHeight);
        gl.uniform1fv(programs.fir.uniforms["u_luma[0]"], paddedChunk(demodulationNotch, offset));
        gl.uniform1fv(programs.fir.uniforms["u_i[0]"], paddedChunk(identityKernel, offset));
        gl.uniform1fv(programs.fir.uniforms["u_q[0]"], paddedChunk(identityKernel, offset));
        gl.uniform1i(programs.fir.uniforms.u_offset, offset);
        gl.uniform1i(programs.fir.uniforms.u_first, pass === 0 ? 1 : 0);
        gl.uniform1f(programs.fir.uniforms.u_iAdvance, 0);
        gl.uniform1f(programs.fir.uniforms.u_qAdvance, 0);
        gl.uniform1f(programs.fir.uniforms.u_chromaDelayH, 0);
        gl.uniform1f(programs.fir.uniforms.u_chromaDelayV, 0);
        gl.uniform1i(programs.fir.uniforms.u_lumaZeroLeft, 1);
        gl.uniform1i(programs.fir.uniforms.u_iZeroLeft, 1);
        gl.uniform1i(programs.fir.uniforms.u_qZeroLeft, 1);
      }, vao);
      notchAccumulator = target;
    }
    drawPass(gl, composite, width, fieldHeight, programs.demodulate, () => {
      bindTexture(gl, yiq.tex, 0); gl.uniform1i(programs.demodulate.uniforms.u_composite, 0);
      bindTexture(gl, notchAccumulator.tex, 1); gl.uniform1i(programs.demodulate.uniforms.u_notch, 1);
      gl.uniform2f(programs.demodulate.uniforms.u_res, width, fieldHeight);
      gl.uniform1f(programs.demodulate.uniforms.u_frame, fieldFrame);
      gl.uniform1i(programs.demodulate.uniforms.u_parity, parity);
      gl.uniform1i(programs.demodulate.uniforms.u_demodulation, params.demodulation);
    }, vao);
    drawPass(gl, yiq, width, fieldHeight, programs.lumaFir, () => {
      bindTexture(gl, composite.tex, 0); gl.uniform1i(programs.lumaFir.uniforms.u_source, 0);
      gl.uniform2f(programs.lumaFir.uniforms.u_res, width, fieldHeight);
      gl.uniform1fv(programs.lumaFir.uniforms["u_kernel[0]"], smearKernel);
      gl.uniform1f(programs.lumaFir.uniforms.u_advance, 0);
      gl.uniform1i(programs.lumaFir.uniforms.u_zeroLeft, 1);
    }, vao);
    drawPass(gl, composite, width, fieldHeight, programs.lumaFir, () => {
      bindTexture(gl, yiq.tex, 0); gl.uniform1i(programs.lumaFir.uniforms.u_source, 0);
      gl.uniform2f(programs.lumaFir.uniforms.u_res, width, fieldHeight);
      gl.uniform1fv(programs.lumaFir.uniforms["u_kernel[0]"], ringingKernel);
      gl.uniform1f(programs.lumaFir.uniforms.u_advance, 1);
      gl.uniform1i(programs.lumaFir.uniforms.u_zeroLeft, 0);
    }, vao);
    drawPass(gl, preTape, width, fieldHeight, programs.preTape, () => {
      bindTexture(gl, composite.tex, 0); gl.uniform1i(programs.preTape.uniforms.u_yiq, 0);
      bindTexture(gl, noise.tex, 1); gl.uniform1i(programs.preTape.uniforms.u_noise, 1);
      bindTexture(gl, rows.tex, 2); gl.uniform1i(programs.preTape.uniforms.u_rows, 2);
      gl.uniform2f(programs.preTape.uniforms.u_res, width, fieldHeight);
      gl.uniform1f(programs.preTape.uniforms.u_lumaNoise, params.lumaNoise);
      gl.uniform1f(programs.preTape.uniforms.u_chromaNoise, params.chromaNoise);
      gl.uniform1f(programs.preTape.uniforms.u_chromaPhaseNoise, params.chromaPhaseNoise);
      gl.uniform1f(programs.preTape.uniforms.u_chromaPhaseError, params.chromaPhaseError);
      gl.uniform1f(programs.preTape.uniforms.u_edgeWave, params.edgeWave);
    }, vao);

    let accumulator = ping;
    for (let offset = 0, pass = 0; offset < 65; offset += 17, pass++) {
      const target = pass % 2 === 0 ? ping : pong;
      const previous = pass % 2 === 0 ? pong : ping;
      drawPass(gl, target, width, fieldHeight, programs.fir, () => {
        bindTexture(gl, preTape.tex, 0); gl.uniform1i(programs.fir.uniforms.u_source, 0);
        bindTexture(gl, previous.tex, 1); gl.uniform1i(programs.fir.uniforms.u_accumulator, 1);
        gl.uniform2f(programs.fir.uniforms.u_res, width, fieldHeight);
        gl.uniform1fv(programs.fir.uniforms["u_luma[0]"], paddedChunk(lumaKernel, offset));
        gl.uniform1fv(programs.fir.uniforms["u_i[0]"], paddedChunk(chromaKernel, offset));
        gl.uniform1fv(programs.fir.uniforms["u_q[0]"], paddedChunk(chromaKernel, offset));
        gl.uniform1i(programs.fir.uniforms.u_offset, offset);
        gl.uniform1i(programs.fir.uniforms.u_first, pass === 0 ? 1 : 0);
        gl.uniform1f(programs.fir.uniforms.u_iAdvance, profile.chromaDelay);
        gl.uniform1f(programs.fir.uniforms.u_qAdvance, profile.chromaDelay);
        gl.uniform1f(programs.fir.uniforms.u_chromaDelayH, params.chromaDelayH);
        gl.uniform1f(programs.fir.uniforms.u_chromaDelayV, params.chromaDelayV);
        gl.uniform1i(programs.fir.uniforms.u_lumaZeroLeft, 1);
        gl.uniform1i(programs.fir.uniforms.u_iZeroLeft, 1);
        gl.uniform1i(programs.fir.uniforms.u_qZeroLeft, 1);
      }, vao);
      accumulator = target;
    }
    drawPass(gl, yiq, width, fieldHeight, programs.lumaFir, () => {
      bindTexture(gl, accumulator.tex, 0); gl.uniform1i(programs.lumaFir.uniforms.u_source, 0);
      gl.uniform2f(programs.lumaFir.uniforms.u_res, width, fieldHeight);
      gl.uniform1fv(programs.lumaFir.uniforms["u_kernel[0]"], restoration);
      gl.uniform1f(programs.lumaFir.uniforms.u_advance, 0);
      gl.uniform1i(programs.lumaFir.uniforms.u_zeroLeft, 1);
    }, vao);
    drawPass(gl, preTape, width, fieldHeight, programs.chromaLoss, () => {
      bindTexture(gl, yiq.tex, 0); gl.uniform1i(programs.chromaLoss.uniforms.u_source, 0);
      bindTexture(gl, rows.tex, 1); gl.uniform1i(programs.chromaLoss.uniforms.u_rows, 1);
      gl.uniform2f(programs.chromaLoss.uniforms.u_res, width, fieldHeight);
    }, vao);
    drawPass(gl, yiq, width, fieldHeight, programs.lumaFir, () => {
      bindTexture(gl, preTape.tex, 0); gl.uniform1i(programs.lumaFir.uniforms.u_source, 0);
      gl.uniform2f(programs.lumaFir.uniforms.u_res, width, fieldHeight);
      gl.uniform1fv(programs.lumaFir.uniforms["u_kernel[0]"], sharpen);
      gl.uniform1f(programs.lumaFir.uniforms.u_advance, 0);
      gl.uniform1i(programs.lumaFir.uniforms.u_zeroLeft, 1);
    }, vao);
    drawPass(gl, preTape, width, fieldHeight, programs.verticalBlend, () => {
      bindTexture(gl, yiq.tex, 0); gl.uniform1i(programs.verticalBlend.uniforms.u_source, 0);
      gl.uniform2f(programs.verticalBlend.uniforms.u_res, width, fieldHeight);
      gl.uniform1i(programs.verticalBlend.uniforms.u_enabled, params.chromaVertBlend ? 1 : 0);
    }, vao);
    // ntsc-rs applies the configured output chroma low-pass after vertical
    // blend. This four-chunk accumulation reproduces the distinct 1.3/0.6 MHz
    // I/Q filters and their two/four-sample advances.
    let outputAccumulator = ping;
    for (let offset = 0, pass = 0; offset < 65; offset += 17, pass++) {
      const target = pass % 2 === 0 ? ping : pong;
      const previous = pass % 2 === 0 ? pong : ping;
      drawPass(gl, target, width, fieldHeight, programs.fir, () => {
        bindTexture(gl, preTape.tex, 0); gl.uniform1i(programs.fir.uniforms.u_source, 0);
        bindTexture(gl, previous.tex, 1); gl.uniform1i(programs.fir.uniforms.u_accumulator, 1);
        gl.uniform2f(programs.fir.uniforms.u_res, width, fieldHeight);
        gl.uniform1fv(programs.fir.uniforms["u_luma[0]"], paddedChunk(identityKernel, offset));
        gl.uniform1fv(programs.fir.uniforms["u_i[0]"], paddedChunk(outputIKernel, offset));
        gl.uniform1fv(programs.fir.uniforms["u_q[0]"], paddedChunk(outputQKernel, offset));
        gl.uniform1i(programs.fir.uniforms.u_offset, offset);
        gl.uniform1i(programs.fir.uniforms.u_first, pass === 0 ? 1 : 0);
        gl.uniform1f(programs.fir.uniforms.u_iAdvance, 2);
        gl.uniform1f(programs.fir.uniforms.u_qAdvance, 4);
        gl.uniform1f(programs.fir.uniforms.u_chromaDelayH, 0);
        gl.uniform1f(programs.fir.uniforms.u_chromaDelayV, 0);
        gl.uniform1i(programs.fir.uniforms.u_lumaZeroLeft, 1);
        gl.uniform1i(programs.fir.uniforms.u_iZeroLeft, 1);
        gl.uniform1i(programs.fir.uniforms.u_qZeroLeft, 1);
      }, vao);
      outputAccumulator = target;
    }
    drawPass(gl, final, width, fieldHeight, programs.output, () => {
      bindTexture(gl, outputAccumulator.tex, 0); gl.uniform1i(programs.output.uniforms.u_source, 0);
      gl.uniform2f(programs.output.uniforms.u_res, width, fieldHeight);
    }, vao);
    return final;
  };

  if (params.fieldMode === 1) {
    const progressive = renderField(-1, params.frame, height, "progressive");
    if (!progressive) return null;
    drawPass(gl, null, width, height, programs.weave, () => {
      bindTexture(gl, progressive.tex, 0); gl.uniform1i(programs.weave.uniforms.u_upper, 0);
      bindTexture(gl, progressive.tex, 1); gl.uniform1i(programs.weave.uniforms.u_lower, 1);
      gl.uniform2f(programs.weave.uniforms.u_res, width, height);
      gl.uniform1f(programs.weave.uniforms.u_upperHeight, height);
      gl.uniform1f(programs.weave.uniforms.u_lowerHeight, height);
      gl.uniform1i(programs.weave.uniforms.u_mode, 4);
    }, vao);
  } else {
    const upperHeight = Math.ceil(height / 2);
    const lowerHeight = Math.max(1, Math.floor(height / 2));
    const upperFrame = params.frame * 2;
    const lowerFrame = params.frame * 2 + 1;
    const upper = renderField(0, upperFrame, upperHeight, "upper");
    const lower = renderField(1, lowerFrame, lowerHeight, "lower");
    if (!upper || !lower) return null;
    drawPass(gl, null, width, height, programs.weave, () => {
      bindTexture(gl, upper.tex, 0); gl.uniform1i(programs.weave.uniforms.u_upper, 0);
      bindTexture(gl, lower.tex, 1); gl.uniform1i(programs.weave.uniforms.u_lower, 1);
      gl.uniform2f(programs.weave.uniforms.u_res, width, height);
      gl.uniform1f(programs.weave.uniforms.u_upperHeight, upperHeight);
      gl.uniform1f(programs.weave.uniforms.u_lowerHeight, lowerHeight);
      gl.uniform1i(programs.weave.uniforms.u_mode, params.fieldMode);
    }, vao);
  }
  const output = readoutToCanvas(canvas, width, height);
  lastFloatPath = true;
  lastFloatStatus = "rgba16f";
  return output;
};
