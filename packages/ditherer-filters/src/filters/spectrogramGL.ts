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

export const SPECTROGRAM_MAX_STOPS = 8;
export const SPECTROGRAM_GL_MAX_SIGNAL_LENGTH = 4096;

// Two-pass pipeline for per-column spatial DFT:
//
//   1. `magnitudes` (W × numBins RGBA8) — for each (x, k) pair, compute the
//      discrete Fourier magnitude of the luminance column at frequency k.
//      Inner loop samples all H source rows. Magnitude stored in R (0..1
//      clamped). A Hann window and one-sided scaling produce magnitude, which
//      is encoded against a shared fixed dB range so columns remain comparable.
//   2. `render` (canvas) — each pixel maps display row to a linear or
//      logarithmic frequency bin and samples the chosen colormap gradient.

// --- Pass 1: magnitudes. ---
const MAG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform int  u_W;
uniform int  u_H;
uniform int  u_numBins;
uniform float u_dynamicRange;

const float PI = 3.14159265;

void main() {
  int x = int(floor(v_uv.x * float(u_W)));
  int k = int(floor(v_uv.y * float(u_numBins)));
  float re = 0.0;
  float im = 0.0;
  float windowSum = 0.0;
  // Loop over all source rows. GLSL ES 300 supports dynamic loop bounds;
  // 2048 covers any realistic canvas height.
  for (int n = 0; n < 4096; n++) {
    if (n >= u_H) break;
    // Source uploaded with UNPACK_FLIP_Y, so uv.y = 1 - (n + 0.5)/H maps to
    // JS-row n — matching the CPU reference's column scan.
    vec4 c = texture(u_source, vec2((float(x) + 0.5) / float(u_W), 1.0 - (float(n) + 0.5) / float(u_H)));
    float lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * c.a;
    float window = u_H <= 2
      ? 1.0
      : 0.5 - 0.5 * cos(2.0 * PI * float(n) / float(u_H - 1));
    float angle = (2.0 * PI * float(k) * float(n)) / float(u_H);
    re += lum * window * cos(angle);
    im -= lum * window * sin(angle);
    windowSum += window;
  }
  bool evenNyquist = (u_H % 2 == 0) && k == u_H / 2;
  float oneSidedScale = k == 0 || evenNyquist ? 1.0 : 2.0;
  float magnitude = sqrt(re * re + im * im) / max(windowSum, 1e-6) * oneSidedScale;
  float floorMagnitude = pow(10.0, -u_dynamicRange / 20.0);
  float db = 20.0 * log(max(floorMagnitude, magnitude)) / log(10.0);
  float level = clamp((db + u_dynamicRange) / u_dynamicRange, 0.0, 1.0);
  fragColor = vec4(level, 0.0, 0.0, 1.0);
}
`;

// --- Pass 2: render ---
const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_mags;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_numBins;
uniform int   u_logFrequency;
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
  float axis = 1.0 - y_js / max(u_res.y - 1.0, 1.0);
  float mapped = u_logFrequency == 1
    ? exp(log(float(u_numBins)) * axis) - 1.0
    : axis * float(u_numBins - 1);
  int bin = int(floor(mapped + 0.5));
  bin = clamp(bin, 0, u_numBins - 1);

  float mag = texture(u_mags, vec2((x + 0.5) / u_res.x, (float(bin) + 0.5) / float(u_numBins))).r;
  vec3 rgb = sampleColormap(mag);
  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  float alpha = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y_js + 0.5) / u_res.y)).a;
  fragColor = vec4(rgb, alpha);
}
`;

type Cache = { mag: Program; render: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    mag: linkProgram(gl, MAG_FS, ["u_source", "u_W", "u_H", "u_numBins", "u_dynamicRange"] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_mags", "u_source", "u_res", "u_numBins", "u_logFrequency",
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
  dynamicRange: number,
  stops: number[][],
  levels: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  // The shader loop is intentionally compile-time bounded. Falling back is
  // slower but exact; silently truncating the source signal is not acceptable.
  if (height > SPECTROGRAM_GL_MAX_SIGNAL_LENGTH) return null;
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
    gl.uniform1f(cache.mag.uniforms.u_dynamicRange, Math.max(20, Math.min(100, dynamicRange)));
  }, vao);

  // Pass 2: render.
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
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.render.uniforms.u_source, 1);
    gl.uniform2f(cache.render.uniforms.u_res, width, height);
    gl.uniform1i(cache.render.uniforms.u_numBins, numBins);
    gl.uniform1i(cache.render.uniforms.u_logFrequency, logScale ? 1 : 0);
    gl.uniform1i(cache.render.uniforms.u_stopCount, stopCount);
    const loc = cache.render.uniforms["u_stops[0]"];
    if (loc) gl.uniform3fv(loc, flatStops);
    gl.uniform1f(cache.render.uniforms.u_levels, levels);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
