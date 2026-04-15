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
} from "gl";

// Relief relighting: treat luminance as a height field, approximate surface
// normals via 4-neighbour central differences, compute diffuse + specular
// lighting from a 2D light direction, and composite against the chosen base
// colour (original / grayscale / tint). Single-pass GL.
const RELIEF_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_lightX;
uniform float u_lightY;
uniform float u_height;
uniform float u_specular;
uniform int   u_baseMode;    // 0 ORIGINAL, 1 GRAYSCALE, 2 TINT
uniform vec3  u_tint;        // 0..255
uniform float u_levels;

vec2 jsUV(float x, float y_js) {
  return vec2((x + 0.5) / u_res.x, 1.0 - (y_js + 0.5) / u_res.y);
}
float lumAt(float x, float y_js) {
  vec3 c = texture(u_source, jsUV(x, y_js)).rgb;
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float xm = max(0.0, x - 1.0);
  float xp = min(u_res.x - 1.0, x + 1.0);
  float ym = max(0.0, y - 1.0);
  float yp = min(u_res.y - 1.0, y + 1.0);

  float dx = (lumAt(xp, y) - lumAt(xm, y)) * u_height;
  float dy = (lumAt(x, yp) - lumAt(x, ym)) * u_height;
  vec3 n = vec3(-dx, -dy, 1.0);
  n = normalize(n);

  float diffuse = max(0.0, n.x * u_lightX + n.y * u_lightY + n.z * 0.85);
  float spec = u_specular > 0.0 ? pow(diffuse, 18.0) * u_specular : 0.0;

  vec4 src = texture(u_source, jsUV(x, y));
  float l = lumAt(x, y);
  vec3 base = src.rgb * 255.0;
  if (u_baseMode == 1) {
    base = vec3(clamp(l * 255.0, 0.0, 255.0));
  } else if (u_baseMode == 2) {
    base = clamp(u_tint * (0.45 + l * 0.8), 0.0, 255.0);
  }

  float shading = 0.35 + diffuse * 0.9;
  vec3 rgb = clamp(base * shading + spec * 255.0, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, src.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, RELIEF_FS, [
      "u_source", "u_res", "u_lightX", "u_lightY", "u_height",
      "u_specular", "u_baseMode", "u_tint", "u_levels",
    ] as const),
  };
  return _cache;
};

export const reliefMapGLAvailable = (): boolean => glAvailable();

export const RELIEF_BASE_MODE_ID: Record<string, number> = {
  ORIGINAL: 0, GRAYSCALE: 1, TINT: 2,
};

export const renderReliefMapGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  lightAngle: number,
  heightScale: number,
  specular: number,
  baseMode: string,
  tint: [number, number, number],
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const modeId = RELIEF_BASE_MODE_ID[baseMode];
  if (modeId === undefined) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const rad = (lightAngle * Math.PI) / 180;
  const lightX = Math.cos(rad);
  const lightY = -Math.sin(rad);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "reliefMap:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_lightX, lightX);
    gl.uniform1f(cache.prog.uniforms.u_lightY, lightY);
    gl.uniform1f(cache.prog.uniforms.u_height, heightScale);
    gl.uniform1f(cache.prog.uniforms.u_specular, specular);
    gl.uniform1i(cache.prog.uniforms.u_baseMode, modeId);
    gl.uniform3f(cache.prog.uniforms.u_tint, tint[0], tint[1], tint[2]);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
