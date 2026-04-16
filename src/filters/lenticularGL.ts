import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Holographic lenticular strip overlay: rainbow hue rides along the
// strip-projection axis, lens brightness breathes sinusoidally across
// each strip. HSL→RGB inlined in the shader to match the JS reference.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_stripWidth;
uniform float u_sheenIntensity;
uniform float u_rainbowSpread;
uniform float u_cosA;
uniform float u_sinA;

vec3 hslToRgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hh = mod(mod(h, 360.0) + 360.0, 360.0);
  float x = c * (1.0 - abs(mod(hh / 60.0, 2.0) - 1.0));
  float m = l - c * 0.5;
  vec3 rgb;
  if (hh < 60.0)       rgb = vec3(c, x, 0.0);
  else if (hh < 120.0) rgb = vec3(x, c, 0.0);
  else if (hh < 180.0) rgb = vec3(0.0, c, x);
  else if (hh < 240.0) rgb = vec3(0.0, x, c);
  else if (hh < 300.0) rgb = vec3(x, 0.0, c);
  else                 rgb = vec3(c, 0.0, x);
  return floor((rgb + vec3(m)) * 255.0 + 0.5);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb * 255.0;

  float proj = jsX * u_cosA + jsY * u_sinA;
  float stripPos = mod(mod(proj / u_stripWidth, 1.0) + 1.0, 1.0);

  float hue = mod(proj / u_stripWidth * u_rainbowSpread * 60.0, 360.0);
  vec3 sheen = hslToRgb(hue, 0.8, 0.6);

  float lensFactor = 0.7 + 0.3 * cos(stripPos * 6.28318530718);
  vec3 blended = src * lensFactor * (1.0 - u_sheenIntensity) + sheen * u_sheenIntensity * lensFactor;
  blended = clamp(floor(blended + 0.5), 0.0, 255.0);
  fragColor = vec4(blended / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_stripWidth", "u_sheenIntensity", "u_rainbowSpread", "u_cosA", "u_sinA",
  ] as const) };
  return _cache;
};

export const lenticularGLAvailable = (): boolean => glAvailable();

export const renderLenticularGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  stripWidth: number, sheenIntensity: number, rainbowSpread: number, angleRad: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lenticular:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_stripWidth, stripWidth);
    gl.uniform1f(cache.prog.uniforms.u_sheenIntensity, sheenIntensity);
    gl.uniform1f(cache.prog.uniforms.u_rainbowSpread, rainbowSpread);
    gl.uniform1f(cache.prog.uniforms.u_cosA, Math.cos(angleRad));
    gl.uniform1f(cache.prog.uniforms.u_sinA, Math.sin(angleRad));
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
