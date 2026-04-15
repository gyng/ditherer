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

// Convention: all intermediate textures and the source are sampled with
// `jsUV(x, y_js) = (x + 0.5)/W, 1 - (y_js + 0.5)/H`. UNPACK_FLIP_Y flips the
// uploaded source; render targets are natively GL-y, and the equivalence
// works out (see the port notes in filters/liquifyGL.ts for the algebra).

// Pass 1: H box-blur of the beam intensity, computed inline from the source.
const BLUR_H_INTENSITY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_radius;
uniform float u_threshold;      // 0..255
uniform float u_intensity;      // beam curve exponent (1/intensity)
uniform float u_noiseFloor;
uniform float u_frameSeed;

float hash(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

float computeIntensity(float x, float y_js) {
  vec3 c = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y_js + 0.5) / u_res.y)).rgb * 255.0;
  float luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float above = max(0.0, luma - u_threshold) / max(1.0, 255.0 - u_threshold);
  float beam = pow(above, 1.0 / max(0.0001, u_intensity));
  float n = u_noiseFloor > 0.0 ? hash(vec2(x, y_js), u_frameSeed) * u_noiseFloor : 0.0;
  return min(1.0, beam + n);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y_js = u_res.y - 1.0 - floor(px.y);

  float sum = 0.0;
  float count = 0.0;
  for (int k = -10; k <= 10; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float nx = clamp(x + float(k), 0.0, u_res.x - 1.0);
    sum += computeIntensity(nx, y_js);
    count += 1.0;
  }
  float hblur = count > 0.0 ? sum / count : 0.0;
  fragColor = vec4(hblur, 0.0, 0.0, 1.0);
}
`;

// Pass 2: V box-blur of temp1.R, then composite bloomed = clamp(intensity +
// hvBlur * bloomStrength, 0, 1). Stored in R.
const BLUR_V_COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_blurH;
uniform vec2  u_res;
uniform int   u_radius;
uniform float u_threshold;
uniform float u_intensity;
uniform float u_noiseFloor;
uniform float u_frameSeed;
uniform float u_bloomStrength;

float hash(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

float computeIntensity(float x, float y_js) {
  vec3 c = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y_js + 0.5) / u_res.y)).rgb * 255.0;
  float luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float above = max(0.0, luma - u_threshold) / max(1.0, 255.0 - u_threshold);
  float beam = pow(above, 1.0 / max(0.0001, u_intensity));
  float n = u_noiseFloor > 0.0 ? hash(vec2(x, y_js), u_frameSeed) * u_noiseFloor : 0.0;
  return min(1.0, beam + n);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y_js = u_res.y - 1.0 - floor(px.y);

  float sum = 0.0;
  float count = 0.0;
  for (int k = -10; k <= 10; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float ny_js = clamp(y_js + float(k), 0.0, u_res.y - 1.0);
    sum += texture(u_blurH, vec2((x + 0.5) / u_res.x, 1.0 - (ny_js + 0.5) / u_res.y)).r;
    count += 1.0;
  }
  float hvBlur = count > 0.0 ? sum / count : 0.0;
  float intensity = computeIntensity(x, y_js);
  float bloomed = u_radius > 0
    ? min(1.0, intensity + hvBlur * u_bloomStrength)
    : intensity;
  fragColor = vec4(bloomed, 0.0, 0.0, 1.0);
}
`;

// Pass 3: final render. Reads bloomed at (x, y) and (x-1, y) for beam speed,
// renders phosphor colour with optional scanlines + graticule, blends with
// prevOutput when persistence > 0.
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_bloomed;
uniform sampler2D u_prevOutput;
uniform int   u_hasPrev;
uniform vec2  u_res;
uniform vec3  u_phosphor;     // 0..255
uniform int   u_scanlines;
uniform float u_spacing;
uniform int   u_graticule;
uniform int   u_graticuleDivs;
uniform float u_persistence;

vec2 bUV(float x, float y_js) {
  return vec2((x + 0.5) / u_res.x, 1.0 - (y_js + 0.5) / u_res.y);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y_js = u_res.y - 1.0 - floor(px.y);

  float bcur = texture(u_bloomed, bUV(x, y_js)).r;
  float bprev = x > 0.0 ? texture(u_bloomed, bUV(x - 1.0, y_js)).r : bcur;
  float beamSpeed = 1.0 + abs(bcur - bprev) * 0.8;
  float val = bcur * beamSpeed;

  if (u_scanlines == 1) {
    float posInLine = mod(y_js, u_spacing);
    float centre = u_spacing * 0.5;
    float distN = abs(posInLine - centre) / max(0.0001, centre);
    val *= exp(-distN * distN * 3.0);
  }
  val = min(1.0, val);

  float sat = val > 0.7 ? 1.0 + (val - 0.7) * 1.5 : 1.0;
  vec3 bg = vec3(2.0, 3.0, 2.0);
  vec3 rgb = bg + val * (u_phosphor * sat - bg);
  rgb = min(rgb, vec3(255.0));

  if (u_graticule == 1) {
    float cellW = u_res.x / float(u_graticuleDivs);
    float cellH = u_res.y / float(u_graticuleDivs);
    bool onV = mod(x, cellW) < 1.0 || abs(x - u_res.x + 1.0) < 1.0;
    bool onH = mod(y_js, cellH) < 1.0 || abs(y_js - u_res.y + 1.0) < 1.0;
    float tickSpacing = max(4.0, floor(cellW / 5.0));
    bool onCH = abs(y_js - u_res.y * 0.5) < 1.0 && mod(x, tickSpacing) < 2.0;
    bool onCV = abs(x - u_res.x * 0.5) < 1.0 && mod(y_js, tickSpacing) < 2.0;
    if (onV || onH || onCH || onCV) {
      rgb = min(vec3(255.0), rgb + u_phosphor * 0.12);
    }
  }

  if (u_hasPrev == 1 && u_persistence > 0.0) {
    vec3 prev = texture(u_prevOutput, bUV(x, y_js)).rgb * 255.0;
    float keep = u_persistence;
    float fresh = 1.0 - keep;
    vec3 pDecayed = prev * keep;
    rgb = min(vec3(255.0), max(rgb * fresh, pDecayed) + rgb * (1.0 - fresh));
  }

  fragColor = vec4(rgb / 255.0, 1.0);
}
`;

type Cache = {
  blurH: Program;
  blurV: Program;
  final: Program;
};
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blurH: linkProgram(gl, BLUR_H_INTENSITY_FS, [
      "u_source", "u_res", "u_radius", "u_threshold", "u_intensity", "u_noiseFloor", "u_frameSeed",
    ] as const),
    blurV: linkProgram(gl, BLUR_V_COMPOSITE_FS, [
      "u_source", "u_blurH", "u_res", "u_radius",
      "u_threshold", "u_intensity", "u_noiseFloor", "u_frameSeed", "u_bloomStrength",
    ] as const),
    final: linkProgram(gl, FINAL_FS, [
      "u_bloomed", "u_prevOutput", "u_hasPrev", "u_res", "u_phosphor",
      "u_scanlines", "u_spacing", "u_graticule", "u_graticuleDivs", "u_persistence",
    ] as const),
  };
  return _cache;
};

export const oscilloscopeGLAvailable = (): boolean => glAvailable();

// Upload a Uint8ClampedArray of RGBA pixel data as a texture. Caller disposes
// via gl.deleteTexture on the returned handle. Disables UNPACK_FLIP_Y so the
// data lands in its JS-top-row-first orientation — matching how render
// targets store previously-rendered frames.
const uploadPrevOutput = (
  gl: WebGL2RenderingContext,
  data: Uint8ClampedArray,
  w: number,
  h: number,
): WebGLTexture | null => {
  // The caller may pass a prevOutput from a prior frame at a different size
  // (e.g., canvas resized). Reject those — persistence will skip this frame.
  if (data.byteLength !== w * h * 4) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // UNPACK_FLIP_Y is sticky-enabled; disable briefly so this buffer's row 0
  // stays at texel row 0 (matches render-target orientation).
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return tex;
};

export const renderOscilloscopeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  params: {
    phosphorColor: [number, number, number];
    threshold: number;
    intensity: number;
    bloom: number;
    bloomStrength: number;
    persistence: number;
    graticule: boolean;
    graticuleDivs: number;
    scanlines: boolean;
    scanlineSpacing: number;
    noiseFloor: number;
    frameIndex: number;
    prevOutput: Uint8ClampedArray | null;
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const radius = Math.min(10, Math.max(0, Math.round(params.bloom)));
  const spacing = Math.max(2, Math.round(params.scanlineSpacing));
  const frameSeed = params.frameIndex * 3571 + 41;

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "oscilloscope:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const temp1 = ensureTexture(gl, "oscilloscope:hblur", width, height);
  const temp2 = ensureTexture(gl, "oscilloscope:bloomed", width, height);

  drawPass(gl, temp1, width, height, cache.blurH, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.blurH.uniforms.u_source, 0);
    gl.uniform2f(cache.blurH.uniforms.u_res, width, height);
    gl.uniform1i(cache.blurH.uniforms.u_radius, radius);
    gl.uniform1f(cache.blurH.uniforms.u_threshold, params.threshold);
    gl.uniform1f(cache.blurH.uniforms.u_intensity, params.intensity);
    gl.uniform1f(cache.blurH.uniforms.u_noiseFloor, params.noiseFloor);
    gl.uniform1f(cache.blurH.uniforms.u_frameSeed, frameSeed);
  }, vao);

  drawPass(gl, temp2, width, height, cache.blurV, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.blurV.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, temp1.tex);
    gl.uniform1i(cache.blurV.uniforms.u_blurH, 1);
    gl.uniform2f(cache.blurV.uniforms.u_res, width, height);
    gl.uniform1i(cache.blurV.uniforms.u_radius, radius);
    gl.uniform1f(cache.blurV.uniforms.u_threshold, params.threshold);
    gl.uniform1f(cache.blurV.uniforms.u_intensity, params.intensity);
    gl.uniform1f(cache.blurV.uniforms.u_noiseFloor, params.noiseFloor);
    gl.uniform1f(cache.blurV.uniforms.u_frameSeed, frameSeed);
    gl.uniform1f(cache.blurV.uniforms.u_bloomStrength, params.bloomStrength);
  }, vao);

  const prevTex = params.prevOutput && params.persistence > 0
    ? uploadPrevOutput(gl, params.prevOutput, width, height)
    : null;

  drawPass(gl, null, width, height, cache.final, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, temp2.tex);
    gl.uniform1i(cache.final.uniforms.u_bloomed, 0);
    if (prevTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.uniform1i(cache.final.uniforms.u_prevOutput, 1);
      gl.uniform1i(cache.final.uniforms.u_hasPrev, 1);
    } else {
      gl.uniform1i(cache.final.uniforms.u_hasPrev, 0);
    }
    gl.uniform2f(cache.final.uniforms.u_res, width, height);
    gl.uniform3f(cache.final.uniforms.u_phosphor, params.phosphorColor[0], params.phosphorColor[1], params.phosphorColor[2]);
    gl.uniform1i(cache.final.uniforms.u_scanlines, params.scanlines ? 1 : 0);
    gl.uniform1f(cache.final.uniforms.u_spacing, spacing);
    gl.uniform1i(cache.final.uniforms.u_graticule, params.graticule ? 1 : 0);
    gl.uniform1i(cache.final.uniforms.u_graticuleDivs, Math.max(2, Math.round(params.graticuleDivs)));
    gl.uniform1f(cache.final.uniforms.u_persistence, params.persistence);
  }, vao);

  const out = readoutToCanvas(canvas, width, height);
  if (prevTex) gl.deleteTexture(prevTex);
  return out;
};
