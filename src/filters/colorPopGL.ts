import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// HSV hue match → protect-mix → desaturate-outside.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_targetHue;      // 0..360
uniform float u_hueWidth;
uniform float u_desaturate;
uniform float u_softEdge;

void main() {
  vec4 c = texture(u_source, v_uv);
  float r = c.r, g = c.g, b = c.b;
  float mx = max(r, max(g, b));
  float mn = min(r, min(g, b));
  float delta = mx - mn;
  float hue = 0.0;
  if (delta > 0.0) {
    if (mx == r) hue = mod((g - b) / delta + (g < b ? 6.0 : 0.0), 6.0) / 6.0;
    else if (mx == g) hue = ((b - r) / delta + 2.0) / 6.0;
    else hue = ((r - g) / delta + 4.0) / 6.0;
  }
  float hueDist = abs(hue * 360.0 - u_targetHue);
  if (hueDist > 180.0) hueDist = 360.0 - hueDist;

  float protectedMix = 1.0 - smoothstep(u_hueWidth, u_softEdge, hueDist);
  float mute = u_desaturate * (1.0 - protectedMix);
  // Match JS: round(0.2126*R + 0.7152*G + 0.0722*B) on bytes, then mix
  // bytes linearly. In shader we stay in 0..1 and do the same arithmetic
  // using the byte values so rounding behaves.
  float gray = (0.2126 * r * 255.0 + 0.7152 * g * 255.0 + 0.0722 * b * 255.0);
  gray = floor(gray + 0.5) / 255.0;
  fragColor = vec4(
    mix(r, gray, mute),
    mix(g, gray, mute),
    mix(b, gray, mute),
    c.a
  );
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, ["u_source", "u_targetHue", "u_hueWidth", "u_desaturate", "u_softEdge"] as const),
  };
  return _cache;
};

export const colorPopGLAvailable = (): boolean => glAvailable();

export const renderColorPopGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  targetHue: number, hueWidth: number, desaturateOthers: number, softness: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "colorPop:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const softEdge = hueWidth + softness * 90;
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform1f(cache.prog.uniforms.u_targetHue, targetHue);
    gl.uniform1f(cache.prog.uniforms.u_hueWidth, hueWidth);
    gl.uniform1f(cache.prog.uniforms.u_desaturate, desaturateOthers);
    gl.uniform1f(cache.prog.uniforms.u_softEdge, softEdge);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
