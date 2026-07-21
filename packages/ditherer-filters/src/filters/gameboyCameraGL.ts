import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

// Downscale → sensor exposure/inversion → edge filter → gain/level → contrast
// → cartridge 4×4 threshold matrix → 4-level DMG palette → upscale. Each output pixel
// maps through the downscaled grid to a single source location, so the
// whole pipeline collapses into a single fragment shader.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;       // original (output) resolution
uniform vec2  u_downRes;   // downscaled resolution
uniform float u_contrast;
uniform float u_exposure;
uniform float u_gain;
uniform float u_bias;
uniform int u_invert;
uniform int u_edgeMode;
uniform float u_edgeEnhance;
uniform vec3 u_kernel;
uniform float u_sensorNoise;
uniform float u_seed;
uniform float u_frame;
uniform float u_ditherStrength;

const vec3 GB_0 = vec3(15.0,  56.0,  15.0);
const vec3 GB_1 = vec3(48.0,  98.0,  48.0);
const vec3 GB_2 = vec3(139.0, 172.0, 15.0);
const vec3 GB_3 = vec3(155.0, 188.0, 15.0);

// The cartridge controller stores three programmable thresholds for every
// position in a 4x4 tile. This ordered default supplies those 16 positions;
// u_ditherStrength blends it toward spatially uniform three-level thresholds.
const float ORDERED_4X4[16] = float[16](
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

float lumaAtDown(float dx, float dy) {
  float cx = clamp(dx, 0.0, u_downRes.x - 1.0);
  float cy = clamp(dy, 0.0, u_downRes.y - 1.0);
  // Map back to source via round(dx * origW / downW) — nearest-neighbour.
  float sx = min(u_res.x - 1.0, floor(cx * u_res.x / u_downRes.x + 0.5));
  float sy = min(u_res.y - 1.0, floor(cy * u_res.y / u_downRes.y + 0.5));
  vec3 rgb = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;
  return rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722;
}

float hash(vec2 p) {
  return fract(sin(dot(p + vec2(u_seed, u_frame * 17.0), vec2(12.9898, 78.233))) * 43758.5453);
}

float sensorAtDown(float dx, float dy) {
  float noise = (hash(vec2(dx, dy)) - 0.5) * u_sensorNoise * 48.0;
  float signal = clamp(lumaAtDown(dx, dy) * u_exposure + noise, 0.0, 255.0);
  return u_invert == 1 ? 255.0 - signal : signal;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float dx = floor(min(u_downRes.x - 1.0, jsX * u_downRes.x / u_res.x));
  float dy = floor(min(u_downRes.y - 1.0, jsY * u_downRes.y / u_res.y));

  // Sensor integration/inversion feeds the edge stage. The controller's
  // documented order then applies gain and level before threshold conversion.
  float gray = sensorAtDown(dx, dy);

  if (u_edgeMode > 0 && u_edgeEnhance > 0.0) {
    float horizontal = u_kernel.x * sensorAtDown(dx - 1.0, dy)
      + u_kernel.y * gray + u_kernel.z * sensorAtDown(dx + 1.0, dy);
    float vertical = u_kernel.x * sensorAtDown(dx, dy - 1.0)
      + u_kernel.y * gray + u_kernel.z * sensorAtDown(dx, dy + 1.0);
    float filtered = u_edgeMode == 1 ? horizontal
      : (u_edgeMode == 2 ? vertical : (horizontal + vertical) * 0.5);
    gray = mix(gray, filtered, u_edgeEnhance);
  }

  gray = clamp(128.0 + (gray - 128.0) * u_gain + u_bias * 128.0, 0.0, 255.0);
  gray = clamp(128.0 + (gray - 128.0) * u_contrast, 0.0, 255.0);

  int bx = int(mod(dx, 4.0));
  int by = int(mod(dy, 4.0));
  float ordered = ORDERED_4X4[by * 4 + bx];
  float offset = (ordered - 0.5) * u_ditherStrength * 96.0;
  float threshold0 = 64.0 + offset;
  float threshold1 = 128.0 + offset;
  float threshold2 = 192.0 + offset;

  vec3 palCol;
  if (gray < threshold0)       palCol = GB_0;
  else if (gray < threshold1) palCol = GB_1;
  else if (gray < threshold2) palCol = GB_2;
  else                       palCol = GB_3;

  fragColor = vec4(palCol / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_downRes", "u_contrast", "u_edgeEnhance", "u_ditherStrength",
    "u_exposure", "u_gain", "u_bias", "u_invert", "u_edgeMode", "u_kernel",
    "u_sensorNoise", "u_seed", "u_frame",
  ] as const) };
  return _cache;
};

export const gameboyCameraGLAvailable = (): boolean => glAvailable();

export const renderGameboyCameraGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  downW: number, downH: number,
  options: {
    contrast: number; exposure: number; gain: number; bias: number; invert: number;
    edgeMode: number; edgeEnhance: number; kernelP: number; kernelM: number;
    kernelX: number; sensorNoise: number; randomSeed: number; frame: number;
    ditherStrength: number;
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "gameboyCamera:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_downRes, downW, downH);
    gl.uniform1f(cache.prog.uniforms.u_contrast, options.contrast);
    gl.uniform1f(cache.prog.uniforms.u_exposure, options.exposure);
    gl.uniform1f(cache.prog.uniforms.u_gain, options.gain);
    gl.uniform1f(cache.prog.uniforms.u_bias, options.bias);
    gl.uniform1i(cache.prog.uniforms.u_invert, options.invert);
    gl.uniform1i(cache.prog.uniforms.u_edgeMode, options.edgeMode);
    gl.uniform1f(cache.prog.uniforms.u_edgeEnhance, options.edgeEnhance);
    gl.uniform3f(cache.prog.uniforms.u_kernel, options.kernelP, options.kernelM, options.kernelX);
    gl.uniform1f(cache.prog.uniforms.u_sensorNoise, options.sensorNoise);
    gl.uniform1f(cache.prog.uniforms.u_seed, options.randomSeed);
    gl.uniform1f(cache.prog.uniforms.u_frame, options.frame);
    gl.uniform1f(cache.prog.uniforms.u_ditherStrength, options.ditherStrength);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
