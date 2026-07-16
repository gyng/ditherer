import { ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glUnavailableStub,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

const CHANNELS = { RGB: "RGB", LUMA: "LUMA", CHROMA: "CHROMA" };

export const optionTypes = {
  scale: {
    type: ENUM,
    options: [
      { name: "2 px", value: 2 },
      { name: "4 px", value: 4 },
      { name: "8 px", value: 8 },
    ],
    default: 4,
    desc: "Haar transform block scale",
  },
  channels: {
    type: ENUM,
    options: [
      { name: "RGB", value: CHANNELS.RGB },
      { name: "Luma detail", value: CHANNELS.LUMA },
      { name: "Chroma detail", value: CHANNELS.CHROMA },
    ],
    default: CHANNELS.LUMA,
    desc: "Color components most affected by coefficient loss",
  },
  quality: { type: RANGE, range: [1, 100], step: 1, default: 38, desc: "Coefficient precision; lower values produce stronger codec breakup" },
  detailLoss: { type: RANGE, range: [0, 1], step: 0.01, default: 0.72, desc: "Attenuation of horizontal, vertical, and diagonal detail bands" },
  ringing: { type: RANGE, range: [0, 1], step: 0.01, default: 0.22, desc: "Haloing around reconstructed high-contrast edges" },
};

export const defaults = {
  scale: optionTypes.scale.default,
  channels: optionTypes.channels.default,
  quality: optionTypes.quality.default,
  detailLoss: optionTypes.detailLoss.default,
  ringing: optionTypes.ringing.default,
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_scale;
uniform float u_quantStep;
uniform float u_detailKeep;
uniform float u_ringing;
uniform int u_channels;

vec2 uvAt(vec2 p) {
  vec2 q = clamp(p, vec2(0.5), u_res - vec2(0.5));
  return vec2(q.x / u_res.x, 1.0 - q.y / u_res.y);
}
vec3 quantizeSigned(vec3 value) {
  return floor(value / u_quantStep + vec3(0.5)) * u_quantStep;
}

void main() {
  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 block = floor(pixel / u_scale) * u_scale;
  float halfScale = u_scale * 0.5;
  vec3 a = texture(u_source, uvAt(block + vec2(halfScale * 0.5, halfScale * 0.5))).rgb;
  vec3 b = texture(u_source, uvAt(block + vec2(halfScale * 1.5, halfScale * 0.5))).rgb;
  vec3 c = texture(u_source, uvAt(block + vec2(halfScale * 0.5, halfScale * 1.5))).rgb;
  vec3 d = texture(u_source, uvAt(block + vec2(halfScale * 1.5, halfScale * 1.5))).rgb;

  vec3 average = (a + b + c + d) * 0.25;
  vec3 horizontal = quantizeSigned((a - b + c - d) * 0.25) * u_detailKeep;
  vec3 vertical = quantizeSigned((a + b - c - d) * 0.25) * u_detailKeep;
  vec3 diagonal = quantizeSigned((a - b - c + d) * 0.25) * u_detailKeep;
  vec2 local = mod(pixel, u_scale);
  float sx = local.x < halfScale ? 1.0 : -1.0;
  float sy = local.y < halfScale ? 1.0 : -1.0;
  vec3 reconstructed = average + horizontal * sx + vertical * sy + diagonal * sx * sy;

  vec3 original = texture(u_source, uvAt(pixel)).rgb;
  float originalLuma = dot(original, vec3(0.2126, 0.7152, 0.0722));
  float reconstructedLuma = dot(reconstructed, vec3(0.2126, 0.7152, 0.0722));
  if (u_channels == 1) {
    reconstructed = original + vec3(reconstructedLuma - originalLuma);
  } else if (u_channels == 2) {
    reconstructed += vec3(originalLuma - reconstructedLuma);
  }

  vec2 ringStep = vec2(halfScale / u_res.x, 0.0);
  vec3 neighborhood = (texture(u_source, clamp(v_uv - ringStep, vec2(0.0), vec2(1.0))).rgb
    + texture(u_source, clamp(v_uv + ringStep, vec2(0.0), vec2(1.0))).rgb) * 0.5;
  reconstructed += (original - neighborhood) * u_ringing;
  fragColor = vec4(clamp(reconstructed, 0.0, 1.0), texture(u_source, v_uv).a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_res", "u_scale", "u_quantStep", "u_detailKeep", "u_ringing", "u_channels",
  ] as const);
  return _prog;
};
const channelId: Record<string, number> = { RGB: 0, LUMA: 1, CHROMA: 2 };

const waveletCodec = (input: any, options = defaults) => {
  const W = input.width, H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "waveletCodec:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  const quality = Math.max(1, Math.min(100, Number(options.quality)));
  const quantStep = 0.002 + Math.pow((101 - quality) / 100, 1.6) * 0.28;
  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_res, W, H);
    gl.uniform1f(prog.uniforms.u_scale, Number(options.scale));
    gl.uniform1f(prog.uniforms.u_quantStep, quantStep);
    gl.uniform1f(prog.uniforms.u_detailKeep, 1 - Number(options.detailLoss));
    gl.uniform1f(prog.uniforms.u_ringing, Number(options.ringing));
    gl.uniform1i(prog.uniforms.u_channels, channelId[String(options.channels)] ?? 1);
  }, vao);
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Wavelet Codec", "WebGL2", `scale=${options.scale} quality=${quality}`);
  return output;
};

export default defineFilter({
  name: "Wavelet Codec",
  func: waveletCodec,
  optionTypes,
  options: defaults,
  defaults,
  description: "Haar-style coefficient quantization with multiscale detail loss and reconstruction ringing",
  requiresGL: true,
});
