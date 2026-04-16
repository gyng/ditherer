import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Vintage CRT-TV look: vertical roll offset, horizontal channel-offset
// colour fringe on R, sinusoidal horizontal banding, and luma-gated
// phosphor glow. Each fragment samples its scrolled source row and
// the appropriate channel offset, then adds the per-row band value
// and bright-pixel glow.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_banding;
uniform float u_colorFringe;
uniform float u_rollOffset;
uniform float u_frame;
uniform float u_glow;

vec3 fetch(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float srcY = mod(mod(jsY + u_rollOffset, u_res.y) + u_res.y, u_res.y);
  float srcXR = clamp(jsX + u_colorFringe, 0.0, u_res.x - 1.0);

  vec3 cR = fetch(srcXR, srcY);
  vec3 cG = fetch(jsX,   srcY);
  vec3 cB = fetch(jsX,   srcY);

  float r = cR.r;
  float g = cG.g;
  float b = cB.b;

  if (u_banding > 0.0) {
    float bandVal = sin(jsY * 0.05 + u_frame * 0.3) * u_banding * 40.0;
    r += bandVal;
    g += bandVal;
    b += bandVal;
  }

  if (u_glow > 0.0) {
    float luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (luma > 180.0) {
      float boost = (luma - 180.0) / 75.0 * u_glow * 50.0;
      r += boost;
      g += boost;
      b += boost;
    }
  }

  vec3 outRgb = clamp(floor(vec3(r, g, b) + 0.5), 0.0, 255.0);
  fragColor = vec4(outRgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_banding", "u_colorFringe",
    "u_rollOffset", "u_frame", "u_glow",
  ] as const) };
  return _cache;
};

export const vintageTVGLAvailable = (): boolean => glAvailable();

export const renderVintageTVGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  banding: number, colorFringe: number, rollOffset: number, frame: number, glow: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "vintageTV:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_banding, banding);
    gl.uniform1f(cache.prog.uniforms.u_colorFringe, colorFringe);
    gl.uniform1f(cache.prog.uniforms.u_rollOffset, rollOffset);
    gl.uniform1f(cache.prog.uniforms.u_frame, frame);
    gl.uniform1f(cache.prog.uniforms.u_glow, glow);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
