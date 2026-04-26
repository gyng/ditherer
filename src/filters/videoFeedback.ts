import { RANGE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { logFilterBackend } from "utils";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

export const optionTypes = {
  zoom: { type: RANGE, range: [1.01, 1.2], step: 0.01, default: 1.05, desc: "Scale factor per feedback iteration" },
  rotation: { type: RANGE, range: [-10, 10], step: 0.5, default: 1, desc: "Rotation degrees per iteration" },
  offsetX: { type: RANGE, range: [-0.2, 0.2], step: 0.01, default: 0, desc: "Horizontal drift as fraction of width" },
  offsetY: { type: RANGE, range: [-0.2, 0.2], step: 0.01, default: 0, desc: "Vertical drift as fraction of height" },
  mix: { type: RANGE, range: [0.3, 0.95], step: 0.05, default: 0.7, desc: "Blend ratio of feedback vs fresh input" },
  colorShift: { type: RANGE, range: [0, 30], step: 1, default: 5, desc: "Hue rotation degrees per iteration" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  zoom: optionTypes.zoom.default,
  rotation: optionTypes.rotation.default,
  offsetX: optionTypes.offsetX.default,
  offsetY: optionTypes.offsetY.default,
  mix: optionTypes.mix.default,
  colorShift: optionTypes.colorShift.default,
  animSpeed: optionTypes.animSpeed.default,
};

type VideoFeedbackOptions = FilterOptionValues & {
  zoom?: number;
  rotation?: number;
  offsetX?: number;
  offsetY?: number;
  mix?: number;
  colorShift?: number;
  animSpeed?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prev;
uniform mat2  u_invAffine;     // inverse rotate*scale
uniform vec2  u_centerUv;      // 0.5 + offset
uniform float u_mix;
uniform float u_shift;         // colorShift / 120
uniform float u_havePrev;

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  if (u_havePrev < 0.5) {
    fragColor = vec4(cur, 1.0);
    return;
  }
  // Inverse-map: srcUv = invAffine * (v_uv - centerUv) + 0.5
  vec2 src = u_invAffine * (v_uv - u_centerUv) + vec2(0.5);
  vec3 fb = texture(u_prev, src).rgb;
  if (u_shift > 0.0) {
    float s = u_shift;
    vec3 r = fb;
    fb.r = clamp(r.r * (1.0 - s) + r.g * s, 0.0, 1.0);
    fb.g = clamp(r.g * (1.0 - s) + r.b * s, 0.0, 1.0);
    fb.b = clamp(r.b * (1.0 - s) + r.r * s, 0.0, 1.0);
  }
  fragColor = vec4(fb * u_mix + cur * (1.0 - u_mix), 1.0);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_prev", "u_invAffine", "u_centerUv",
    "u_mix", "u_shift", "u_havePrev",
  ] as const);
  return _prog;
};

const videoFeedback = (input: any, options: VideoFeedbackOptions = defaults) => {
  const zoom = Number(options.zoom ?? defaults.zoom);
  const rotation = Number(options.rotation ?? defaults.rotation);
  const offsetX = Number(options.offsetX ?? defaults.offsetX);
  const offsetY = Number(options.offsetY ?? defaults.offsetY);
  const mix = Number(options.mix ?? defaults.mix);
  const colorShift = Number(options.colorShift ?? defaults.colorShift);
  const prev = options._prevOutput ?? null;
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "videoFeedback:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const prevTex = ensureTexture(gl, "videoFeedback:prev", W, H);
  const havePrev = !!prev && prev.length === W * H * 4;
  if (havePrev) {
    gl.bindTexture(gl.TEXTURE_2D, prevTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, prev!);
  }

  // Forward affine in pixel space (Canvas2D semantics) is:
  //   p' = R*S*(p - center) + center + offset
  // Inverse (sample location in prev) is:
  //   p  = (R*S)^-1 * (p' - center - offset) + center
  // In UV space the same matrix applies to (uv - centerUv); then add 0.5.
  const rad = rotation * Math.PI / 180;
  const c = Math.cos(rad) * zoom;
  const s = Math.sin(rad) * zoom;
  // Inverse of [c -s; s c] is (1/det) * [c s; -s c] where det = c^2 + s^2 = zoom^2
  const det = c * c + s * s;
  const invA = c / det;
  const invB = s / det;
  const invC = -s / det;
  const invD = c / det;

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevTex.tex);
    gl.uniform1i(prog.uniforms.u_prev, 1);
    // mat2 column-major: [m00, m10, m01, m11] = [invA, invC, invB, invD]
    gl.uniformMatrix2fv(prog.uniforms.u_invAffine, false, [invA, invC, invB, invD]);
    gl.uniform2f(prog.uniforms.u_centerUv, 0.5 + offsetX, 0.5 + offsetY);
    gl.uniform1f(prog.uniforms.u_mix, mix);
    gl.uniform1f(prog.uniforms.u_shift, colorShift / 120);
    gl.uniform1f(prog.uniforms.u_havePrev, havePrev ? 1 : 0);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Video Feedback", "WebGL2", `mix=${mix} zoom=${zoom}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Video Feedback",
  func: videoFeedback,
  optionTypes,
  options: defaults,
  defaults,
  description: "Camera-pointing-at-monitor effect — infinite recursive tunnels and fractal patterns",
  temporal: true,
  requiresGL: true,
});
