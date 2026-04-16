import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Matches the JS LUT: for each channel, step = 255/(levels-1), output is
// round(round(byte/step)*step)/255. We compute in float but keep the same
// rounding semantics.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec3 u_levels;   // R, G, B quantization levels

float quantize(float v, float levels) {
  float step255 = 255.0 / (levels - 1.0);
  float byte = v * 255.0;
  float q = floor(byte / step255 + 0.5) * step255;
  return floor(q + 0.5) / 255.0;
}

void main() {
  vec4 c = texture(u_source, v_uv);
  fragColor = vec4(
    quantize(c.r, u_levels.x),
    quantize(c.g, u_levels.y),
    quantize(c.b, u_levels.z),
    c.a
  );
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_levels"] as const) };
  return _cache;
};

export const chromaticPosterizeGLAvailable = (): boolean => glAvailable();

export const renderChromaticPosterizeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  levelsR: number, levelsG: number, levelsB: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "chromaticPosterize:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform3f(cache.prog.uniforms.u_levels, levelsR, levelsG, levelsB);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
