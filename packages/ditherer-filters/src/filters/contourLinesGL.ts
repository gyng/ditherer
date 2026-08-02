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

// Single-pass isolines over the source luminance field. Filled bands quantize
// to endpoint-preserving levels; derivatives convert scalar distance from the
// nearest boundary into screen-pixel distance for resolution-independent AA.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_levels;
uniform float u_lineWidth;
uniform vec3  u_lineColor;   // 0..255
uniform int   u_fillMode;    // 0 = lines only, 1 = filled bands, 2 = both

vec3 bandColour(vec3 source, float sourceLuma, float bandLuma) {
  vec3 chroma = source - vec3(sourceLuma);
  float scale = 1.0;
  for (int channel = 0; channel < 3; channel++) {
    float component = chroma[channel];
    if (component > 0.0) scale = min(scale, (1.0 - bandLuma) / component);
    if (component < 0.0) scale = min(scale, bandLuma / -component);
  }
  return clamp(vec3(bandLuma) + chroma * max(0.0, scale), 0.0, 1.0);
}

void main() {
  vec4 source = texture(u_source, v_uv);
  float sourceLuma = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
  float intervals = max(2.0, floor(u_levels + 0.5) - 1.0);
  float scaled = clamp(sourceLuma, 0.0, 1.0) * intervals;
  float bandIndex = floor(scaled + 0.5);
  float bandLuma = floor(bandIndex * 255.0 / intervals + 0.5) / 255.0;
  vec3 fill = bandColour(source.rgb, sourceLuma, bandLuma);
  vec3 base = u_fillMode == 0 ? vec3(1.0) : fill;

  float scalarDistance = abs(fract(scaled) - 0.5);
  float scalarPerPixel = max(fwidth(scaled), 1e-5);
  float pixelDistance = scalarDistance / scalarPerPixel;
  float halfWidth = u_lineWidth * 0.5;
  float coverage = 1.0 - smoothstep(max(0.0, halfWidth - 0.5), halfWidth + 0.5, pixelDistance);
  coverage *= step(1e-4, scalarPerPixel);
  if (u_fillMode == 1) coverage = 0.0;
  vec3 outRgb = mix(base, u_lineColor / 255.0, coverage);
  fragColor = vec4(clamp(outRgb, 0.0, 1.0), source.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source",
      "u_levels",
      "u_lineWidth",
      "u_lineColor",
      "u_fillMode",
    ] as const),
  };
  return _cache;
};

export const contourLinesGLAvailable = (): boolean => glAvailable();

export type ContourFillMode = 0 | 1 | 2;

export const renderContourLinesGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  levels: number,
  lineWidth: number,
  lineColor: [number, number, number],
  fillMode: ContourFillMode,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "contourLines:source", width, height);
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
      gl.uniform1f(cache.prog.uniforms.u_levels, levels);
      gl.uniform1f(cache.prog.uniforms.u_lineWidth, lineWidth);
      gl.uniform3f(cache.prog.uniforms.u_lineColor, lineColor[0], lineColor[1], lineColor[2]);
      gl.uniform1i(cache.prog.uniforms.u_fillMode, fillMode);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
