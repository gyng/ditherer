import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Nearest-neighbour downsample → nearest upsample in a single pass.
// The JS reference draws the source into a smaller temp canvas with
// imageSmoothingEnabled=false (so a smoothed scale, not pure
// nearest-from-a-corner), then redraws that temp up. The equivalent
// pull-model step here: for each output pixel find which downscaled
// cell it belongs to, then sample the source at that cell's centre.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_downRes;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  // Which downscaled cell does this pixel sit in? (floor-scale matches
  // the JS drawImage-up step: (x * downW / W) floored.)
  float dx = floor(min(u_downRes.x - 1.0, jsX * u_downRes.x / u_res.x));
  float dy = floor(min(u_downRes.y - 1.0, jsY * u_downRes.y / u_res.y));

  // Sample the source at the cell centre (approximates a downscaled
  // average under the JS drawImage scale; for hard nearest-neighbour
  // this is equivalent up to a half-pixel rounding).
  float sx = min(u_res.x - 1.0, floor((dx + 0.5) * u_res.x / u_downRes.x));
  float sy = min(u_res.y - 1.0, floor((dy + 0.5) * u_res.y / u_downRes.y));
  fragColor = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y));
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_res", "u_downRes"] as const) };
  return _cache;
};

export const pixelateGLAvailable = (): boolean => glAvailable();

export const renderPixelateGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  downW: number, downH: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "pixelate:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_downRes, Math.max(1, downW), Math.max(1, downH));
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
