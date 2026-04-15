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

export const SPECTROGRAM_MAX_STOPS = 8;

// Three-pass pipeline for per-column DFT:
//
//   1. `magnitudes` (W × numBins RGBA8) — for each (x, k) pair, compute the
//      discrete Fourier magnitude of the luminance column at frequency k.
//      Inner loop samples all H source rows. Magnitude stored in R (0..1
//      clamped; for logScale the result of log10(1 + mag·100) / ~3 fits).
//   2. `max-per-column` (W × 1 RGBA8) — reduce the magnitudes texture along
//      the bin axis to get max magnitude for each column (used to normalise
//      t ∈ [0, 1] for colormap sampling).
//   3. `render` (canvas) — each pixel picks its frequency bin from its y
//      position, samples magnitudes[x, bin], divides by max[x] to get t,
//      then samples the chosen colormap gradient.

// --- Pass 1: magnitudes. ---
const MAG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform int  u_W;
uniform int  u_H;
uniform int  u_numBins;
uniform int  u_logScale;

const float PI = 3.14159265;

void main() {
  int x = int(floor(v_uv.x * float(u_W)));
  int k = int(floor(v_uv.y * float(u_numBins)));
  float re = 0.0;
  float im = 0.0;
  // Loop over all source rows. GLSL ES 300 supports dynamic loop bounds;
  // 2048 covers any realistic canvas height.
  for (int n = 0; n < 4096; n++) {
    if (n >= u_H) break;
    // Source uploaded with UNPACK_FLIP_Y, so uv.y = 1 - (n + 0.5)/H maps to
    // JS-row n — matching the CPU reference's column scan.
    vec3 c = texture(u_source, vec2((float(x) + 0.5) / float(u_W), 1.0 - (float(n) + 0.5) / float(u_H))).rgb;
    float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    float angle = (2.0 * PI * float(k) * float(n)) / float(u_H);
    re += lum * cos(angle);
    im -= lum * sin(angle);
  }
  float mag = sqrt(re * re + im * im) / float(u_H);
  if (u_logScale == 1) mag = log(1.0 + mag * 100.0) / log(10.0);
  // Cap stored value at 1.0 — log-scaled mag can reach ~2.0 but further
  // headroom isn't useful (colormap saturates beyond its top stop).
  fragColor = vec4(clamp(mag * 0.5, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

// --- Pass 2: max-per-column reduction along the bin axis. ---
const MAX_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_mags;
uniform int  u_W;
uniform int  u_numBins;

void main() {
  int x = int(floor(v_uv.x * float(u_W)));
  float maxMag = 0.0;
  for (int k = 0; k < 256; k++) {
    if (k >= u_numBins) break;
    float m = texture(u_mags, vec2((float(x) + 0.5) / float(u_W), (float(k) + 0.5) / float(u_numBins))).r;
    if (m > maxMag) maxMag = m;
  }
  fragColor = vec4(maxMag, 0.0, 0.0, 1.0);
}
`;

// --- Pass 3: render ---
const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_mags;
uniform sampler2D u_maxs;
uniform vec2  u_res;
uniform int   u_numBins;
uniform int   u_stopCount;
uniform vec3  u_stops[${SPECTROGRAM_MAX_STOPS}];
uniform float u_levels;

vec3 sampleColormap(float t) {
  float tc = clamp(t, 0.0, 1.0);
  float pos = tc * float(u_stopCount - 1);
  int idx = int(floor(pos));
  float frac = pos - float(idx);
  if (idx >= u_stopCount - 1) return u_stops[u_stopCount - 1];
  vec3 a = u_stops[idx];
  vec3 b = u_stops[idx + 1];
  return a + (b - a) * frac;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y_js = u_res.y - 1.0 - floor(px.y);
  int bin = int(floor(y_js / u_res.y * float(u_numBins)));
  bin = clamp(bin, 0, u_numBins - 1);

  float mag = texture(u_mags, vec2((x + 0.5) / u_res.x, (float(bin) + 0.5) / float(u_numBins))).r;
  float maxMag = texture(u_maxs, vec2((x + 0.5) / u_res.x, 0.5)).r;
  float t = maxMag > 0.0 ? mag / maxMag : 0.0;

  vec3 rgb = sampleColormap(t);
  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { mag: Program; max: Program; render: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    mag: linkProgram(gl, MAG_FS, ["u_source", "u_W", "u_H", "u_numBins", "u_logScale"] as const),
    max: linkProgram(gl, MAX_FS, ["u_mags", "u_W", "u_numBins"] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_mags", "u_maxs", "u_res", "u_numBins",
      "u_stopCount", "u_stops[0]", "u_levels",
    ] as const),
  };
  return _cache;
};

export const spectrogramGLAvailable = (): boolean => glAvailable();

export const renderSpectrogramGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  numBins: number,
  logScale: boolean,
  stops: number[][],
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "spectrogram:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  // Pass 1: magnitudes (W × numBins).
  const magsTex = ensureTexture(gl, "spectrogram:mags", width, numBins);
  drawPass(gl, magsTex, width, numBins, cache.mag, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.mag.uniforms.u_source, 0);
    gl.uniform1i(cache.mag.uniforms.u_W, width);
    gl.uniform1i(cache.mag.uniforms.u_H, height);
    gl.uniform1i(cache.mag.uniforms.u_numBins, numBins);
    gl.uniform1i(cache.mag.uniforms.u_logScale, logScale ? 1 : 0);
  }, vao);

  // Pass 2: max per column.
  const maxsTex = ensureTexture(gl, "spectrogram:maxs", width, 1);
  drawPass(gl, maxsTex, width, 1, cache.max, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, magsTex.tex);
    gl.uniform1i(cache.max.uniforms.u_mags, 0);
    gl.uniform1i(cache.max.uniforms.u_W, width);
    gl.uniform1i(cache.max.uniforms.u_numBins, numBins);
  }, vao);

  // Pass 3: render.
  const stopCount = Math.min(SPECTROGRAM_MAX_STOPS, stops.length);
  const flatStops = new Float32Array(SPECTROGRAM_MAX_STOPS * 3);
  for (let i = 0; i < stopCount; i++) {
    flatStops[i * 3] = stops[i][0];
    flatStops[i * 3 + 1] = stops[i][1];
    flatStops[i * 3 + 2] = stops[i][2];
  }

  drawPass(gl, null, width, height, cache.render, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, magsTex.tex);
    gl.uniform1i(cache.render.uniforms.u_mags, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maxsTex.tex);
    gl.uniform1i(cache.render.uniforms.u_maxs, 1);
    gl.uniform2f(cache.render.uniforms.u_res, width, height);
    gl.uniform1i(cache.render.uniforms.u_numBins, numBins);
    gl.uniform1i(cache.render.uniforms.u_stopCount, stopCount);
    const loc = cache.render.uniforms["u_stops[0]"];
    if (loc) gl.uniform3fv(loc, flatStops);
    gl.uniform1f(cache.render.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
