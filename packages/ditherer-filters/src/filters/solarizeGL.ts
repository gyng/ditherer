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
} from "../gl/index";
import { SOLARIZE_GLSL } from "./toneTransferContracts";

// Sabattier / solarization: a smooth tone-reversal curve applied with the SAME
// curve on every channel, so a darkroom re-exposure hump reverses highlights
// continuously — not a knife-edge, per-channel invert (which produced garish,
// discontinuous false colour).
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_reversal;   // 0..1 tone at which the curve turns over
uniform float u_strength;   // 0..1 blend from identity to full reversal
${SOLARIZE_GLSL}
void main() {
  vec4 c = texture(u_source, v_uv);
  fragColor = vec4(
    tt_solarizeCurve(c.r, u_reversal, u_strength),
    tt_solarizeCurve(c.g, u_reversal, u_strength),
    tt_solarizeCurve(c.b, u_reversal, u_strength),
    c.a
  );
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_reversal", "u_strength"] as const) };
  return _cache;
};

export const solarizeGLAvailable = (): boolean => glAvailable();

export const renderSolarizeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  reversal: number,
  strength: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "solarize:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(
    gl,
    null,
    width,
    height,
    cache.prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.prog.uniforms.u_source, 0);
      gl.uniform1f(cache.prog.uniforms.u_reversal, reversal);
      gl.uniform1f(cache.prog.uniforms.u_strength, strength);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
