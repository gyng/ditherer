import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

// Mezzotint begins as a uniformly rocked, ink-holding dark ground. Scraping
// and burnishing remove the burr continuously to reveal lighter paper tones.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_density;
uniform float u_dotSize;
uniform float u_burnish;
uniform float u_burrStrength;
uniform float u_plateWear;
uniform vec3 u_inkColor;
uniform vec3 u_paperColor;

vec3 srgbToLinear(vec3 encoded) {
  vec3 low = encoded / 12.92;
  vec3 high = pow((encoded + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), encoded));
}

vec3 linearToSrgb(vec3 linear) {
  vec3 low = linear * 12.92;
  vec3 high = 1.055 * pow(max(linear, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), linear));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float rockerLayer(vec2 pixel, vec2 direction, float scale, float offset) {
  float along = dot(pixel, direction) / scale;
  float tooth = 0.5 + 0.5 * sin(6.2831853 * along + offset
    + 0.35 * sin(along * 1.73 + offset * 2.0));
  return smoothstep(0.18, 0.82, tooth);
}

void main() {
  vec2 texel = 1.0 / u_res;
  vec4 center = texture(u_source, v_uv);
  vec3 structure = srgbToLinear(center.rgb) * 0.4;
  structure += srgbToLinear(texture(u_source, clamp(v_uv + vec2(texel.x, 0.0), texel * 0.5, 1.0 - texel * 0.5)).rgb) * 0.15;
  structure += srgbToLinear(texture(u_source, clamp(v_uv - vec2(texel.x, 0.0), texel * 0.5, 1.0 - texel * 0.5)).rgb) * 0.15;
  structure += srgbToLinear(texture(u_source, clamp(v_uv + vec2(0.0, texel.y), texel * 0.5, 1.0 - texel * 0.5)).rgb) * 0.15;
  structure += srgbToLinear(texture(u_source, clamp(v_uv - vec2(0.0, texel.y), texel * 0.5, 1.0 - texel * 0.5)).rgb) * 0.15;
  float luminance = dot(structure, vec3(0.2126, 0.7152, 0.0722));

  float wear = clamp(u_plateWear, 0.0, 1.0);
  float inkCoverage = (1.0 - pow(clamp(luminance, 0.0, 1.0), max(0.05, u_burnish)))
    * clamp(u_density, 0.0, 1.0) * (1.0 - wear * 0.55);

  vec2 pixel = floor(v_uv * u_res);
  float scale = max(1.0, u_dotSize);
  vec2 phaseCell = floor(pixel / (scale * 11.0));
  float phaseA = (hash12(phaseCell + vec2(3.0, 7.0)) - 0.5) * 1.7;
  float phaseB = (hash12(phaseCell + vec2(17.0, 5.0)) - 0.5) * 1.7;
  float rocker = 0.0;
  rocker += rockerLayer(pixel, vec2(1.0, 0.0), scale, 0.31 + phaseA);
  rocker += rockerLayer(pixel, vec2(0.0, 1.0), scale, 1.17 + phaseB);
  rocker += rockerLayer(pixel, vec2(0.7071068, 0.7071068), scale, 2.03 - phaseA);
  rocker += rockerLayer(pixel, vec2(-0.7071068, 0.7071068), scale, 2.89 - phaseB);
  rocker *= 0.25;
  float burrAmplitude = u_burrStrength * (1.0 - wear * 0.75)
    * inkCoverage * (1.0 - inkCoverage * 0.45);
  inkCoverage = clamp(inkCoverage + (rocker - 0.5) * 2.0 * burrAmplitude, 0.0, 1.0);

  vec3 ink = srgbToLinear(clamp(u_inkColor / 255.0, 0.0, 1.0));
  vec3 paper = srgbToLinear(clamp(u_paperColor / 255.0, 0.0, 1.0));
  float paperGrain = (hash12(pixel * 0.37) - 0.5) * 0.025 * (1.0 - inkCoverage);
  vec3 printed = mix(clamp(paper + vec3(paperGrain), 0.0, 1.0), ink, inkCoverage);
  fragColor = vec4(clamp(linearToSrgb(printed), 0.0, 1.0), center.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_density", "u_dotSize", "u_burnish",
    "u_burrStrength", "u_plateWear", "u_inkColor", "u_paperColor",
  ] as const) };
  return _cache;
};

export const mezzotintGLAvailable = (): boolean => glAvailable();

export const renderMezzotintGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  density: number, dotSize: number,
  burnish: number, burrStrength: number, plateWear: number,
  inkColor: [number, number, number],
  paperColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "mezzotint:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_density, density);
    gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
    gl.uniform1f(cache.prog.uniforms.u_burnish, burnish);
    gl.uniform1f(cache.prog.uniforms.u_burrStrength, burrStrength);
    gl.uniform1f(cache.prog.uniforms.u_plateWear, plateWear);
    gl.uniform3f(cache.prog.uniforms.u_inkColor, inkColor[0], inkColor[1], inkColor[2]);
    gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
