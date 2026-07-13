import { COLOR, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glUnavailableStub,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

const MODE = { FOCUS: "FOCUS", ZEBRAS: "ZEBRAS", FALSE_COLOR: "FALSE_COLOR", CLIPPING: "CLIPPING", COMBINED: "COMBINED" };

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Focus peaking", value: MODE.FOCUS },
      { name: "Exposure zebras", value: MODE.ZEBRAS },
      { name: "False color", value: MODE.FALSE_COLOR },
      { name: "Clipping warnings", value: MODE.CLIPPING },
      { name: "Combined monitor", value: MODE.COMBINED },
    ],
    default: MODE.COMBINED,
    desc: "Camera-assist overlay to render",
  },
  focusThreshold: { type: RANGE, range: [0.02, 0.6], step: 0.01, default: 0.18, desc: "Minimum local contrast for focus peaking" },
  zebraThreshold: { type: RANGE, range: [0.5, 1], step: 0.01, default: 0.78, desc: "Luminance where exposure zebras begin" },
  shadowClip: { type: RANGE, range: [0, 0.2], step: 0.01, default: 0.03, desc: "Shadow clipping warning threshold" },
  highlightClip: { type: RANGE, range: [0.8, 1], step: 0.01, default: 0.98, desc: "Highlight clipping warning threshold" },
  overlayOpacity: { type: RANGE, range: [0, 1], step: 0.01, default: 0.8, desc: "Strength of monitoring overlays" },
  stripeWidth: { type: RANGE, range: [2, 16], step: 1, default: 6, desc: "Exposure zebra stripe width" },
  focusColor: { type: COLOR, default: [32, 255, 64], desc: "Focus-peaking overlay color" },
};

export const defaults = {
  mode: optionTypes.mode.default,
  focusThreshold: optionTypes.focusThreshold.default,
  zebraThreshold: optionTypes.zebraThreshold.default,
  shadowClip: optionTypes.shadowClip.default,
  highlightClip: optionTypes.highlightClip.default,
  overlayOpacity: optionTypes.overlayOpacity.default,
  stripeWidth: optionTypes.stripeWidth.default,
  focusColor: optionTypes.focusColor.default,
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_focusThreshold;
uniform float u_zebraThreshold;
uniform float u_shadowClip;
uniform float u_highlightClip;
uniform float u_opacity;
uniform float u_stripeWidth;
uniform vec3 u_focusColor;
uniform int u_mode;

float lumaAt(vec2 uv) { return dot(texture(u_source, clamp(uv, vec2(0.0), vec2(1.0))).rgb, vec3(0.2126, 0.7152, 0.0722)); }
vec3 falseColor(float y) {
  if (y < 0.05) return vec3(0.35, 0.0, 0.55);
  if (y < 0.18) return mix(vec3(0.0, 0.1, 0.8), vec3(0.0, 0.75, 1.0), (y - 0.05) / 0.13);
  if (y < 0.42) return mix(vec3(0.0, 0.75, 1.0), vec3(0.1, 0.85, 0.15), (y - 0.18) / 0.24);
  if (y < 0.62) return mix(vec3(0.1, 0.85, 0.15), vec3(0.55), (y - 0.42) / 0.20);
  if (y < 0.78) return mix(vec3(0.55), vec3(1.0, 0.75, 0.0), (y - 0.62) / 0.16);
  return mix(vec3(1.0, 0.75, 0.0), vec3(1.0, 0.0, 0.1), (y - 0.78) / 0.22);
}

void main() {
  vec4 source = texture(u_source, v_uv);
  vec2 texel = 1.0 / u_res;
  float gx = lumaAt(v_uv + vec2(texel.x, 0.0)) - lumaAt(v_uv - vec2(texel.x, 0.0));
  float gy = lumaAt(v_uv + vec2(0.0, texel.y)) - lumaAt(v_uv - vec2(0.0, texel.y));
  float edge = length(vec2(gx, gy));
  float y = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec2 pixel = floor(v_uv * u_res);
  float stripe = mod(pixel.x + pixel.y, u_stripeWidth * 2.0) < u_stripeWidth ? 1.0 : 0.0;
  vec3 focus = mix(source.rgb, u_focusColor, step(u_focusThreshold, edge) * u_opacity);
  vec3 zebras = mix(source.rgb, vec3(1.0 - stripe), step(u_zebraThreshold, y) * u_opacity * 0.85);
  vec3 falseMapped = mix(source.rgb, falseColor(y), u_opacity);
  vec3 clipped = source.rgb;
  if (y <= u_shadowClip) clipped = mix(clipped, vec3(0.0, 0.25, 1.0), u_opacity);
  if (y >= u_highlightClip) clipped = mix(clipped, vec3(1.0, 0.0, 0.15), u_opacity);
  vec3 result = focus;
  if (u_mode == 1) result = zebras;
  else if (u_mode == 2) result = falseMapped;
  else if (u_mode == 3) result = clipped;
  else if (u_mode == 4) {
    result = mix(source.rgb, falseColor(y), u_opacity * 0.28);
    result = mix(result, u_focusColor, step(u_focusThreshold, edge) * u_opacity);
    result = mix(result, vec3(1.0 - stripe), step(u_zebraThreshold, y) * u_opacity * 0.7);
    if (y <= u_shadowClip) result = mix(result, vec3(0.0, 0.25, 1.0), u_opacity);
    if (y >= u_highlightClip) result = mix(result, vec3(1.0, 0.0, 0.15), u_opacity);
  }
  fragColor = vec4(clamp(result, 0.0, 1.0), source.a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_res", "u_focusThreshold", "u_zebraThreshold", "u_shadowClip",
    "u_highlightClip", "u_opacity", "u_stripeWidth", "u_focusColor", "u_mode",
  ] as const);
  return _prog;
};
const modeId: Record<string, number> = { FOCUS: 0, ZEBRAS: 1, FALSE_COLOR: 2, CLIPPING: 3, COMBINED: 4 };

const cameraMonitor = (input: any, options = defaults) => {
  const W = input.width, H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "cameraMonitor:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  const focusColor = options.focusColor as number[];
  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_res, W, H);
    gl.uniform1f(prog.uniforms.u_focusThreshold, options.focusThreshold);
    gl.uniform1f(prog.uniforms.u_zebraThreshold, options.zebraThreshold);
    gl.uniform1f(prog.uniforms.u_shadowClip, options.shadowClip);
    gl.uniform1f(prog.uniforms.u_highlightClip, options.highlightClip);
    gl.uniform1f(prog.uniforms.u_opacity, options.overlayOpacity);
    gl.uniform1f(prog.uniforms.u_stripeWidth, options.stripeWidth);
    gl.uniform3f(prog.uniforms.u_focusColor, focusColor[0] / 255, focusColor[1] / 255, focusColor[2] / 255);
    gl.uniform1i(prog.uniforms.u_mode, modeId[options.mode] ?? 4);
  }, vao);
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Camera Monitor", "WebGL2", String(options.mode));
  return output;
};

export default defineFilter({
  name: "Camera Monitor",
  func: cameraMonitor,
  optionTypes,
  options: defaults,
  defaults,
  description: "Production monitor overlays: focus peaking, zebras, false color, and clipping warnings",
  requiresGL: true,
});
