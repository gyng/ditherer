import {
  drawPass,
  ensureFloatTexture,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";

const COLOR_SPACE_GLSL = `
vec3 srgbToLinear(vec3 c) {
  bvec3 low = lessThanEqual(c, vec3(0.04045));
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(hi, lo, low);
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  bvec3 low = lessThanEqual(c, vec3(0.0031308));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, low);
}
vec4 readPx(sampler2D source, vec2 pixel, vec2 resolution) {
  vec2 clampedPixel = clamp(pixel, vec2(0.0), resolution - vec2(1.0));
  return texture(source, vec2(clampedPixel.x + 0.5, resolution.y - 0.5 - clampedPixel.y) / resolution);
}
`;

const GUIDE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_sourceRes;
uniform vec2 u_workRes;
uniform int u_factor;
uniform bool u_linearize;
${COLOR_SPACE_GLSL}
void main() {
  vec2 workPixel = vec2(floor(v_uv.x * u_workRes.x), u_workRes.y - 1.0 - floor(v_uv.y * u_workRes.y));
  vec2 origin = workPixel * float(u_factor);
  vec3 weightedRgb = vec3(0.0);
  float alphaSum = 0.0;
  float sampleCount = 0.0;
  for (int y = 0; y < 4; y++) {
    if (y >= u_factor) continue;
    for (int x = 0; x < 4; x++) {
      if (x >= u_factor) continue;
      vec2 sourcePixel = origin + vec2(float(x), float(y));
      if (sourcePixel.x >= u_sourceRes.x || sourcePixel.y >= u_sourceRes.y) continue;
      vec4 sampleValue = readPx(u_source, sourcePixel, u_sourceRes);
      vec3 rgb = u_linearize ? srgbToLinear(sampleValue.rgb) : sampleValue.rgb;
      weightedRgb += rgb * sampleValue.a;
      alphaSum += sampleValue.a;
      sampleCount += 1.0;
    }
  }
  vec3 rgb = alphaSum > 1e-6 ? weightedRgb / alphaSum : vec3(0.0);
  fragColor = vec4(rgb, sampleCount > 0.0 ? alphaSum / sampleCount : 0.0);
}
`;

const BILATERAL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_signal;
uniform sampler2D u_guide;
uniform vec2 u_res;
uniform vec2 u_direction;
uniform int u_radius;
uniform float u_sigmaSpatial;
uniform float u_sigmaRange;
${COLOR_SPACE_GLSL}
void main() {
  vec2 pixel = vec2(floor(v_uv.x * u_res.x), u_res.y - 1.0 - floor(v_uv.y * u_res.y));
  vec4 centerGuide = readPx(u_guide, pixel, u_res);
  vec4 centerSignal = readPx(u_signal, pixel, u_res);
  if (centerGuide.a <= 1e-6) {
    fragColor = vec4(0.0);
    return;
  }
  float spatialDenom = max(2.0 * u_sigmaSpatial * u_sigmaSpatial, 1e-6);
  float rangeDenom = max(2.0 * u_sigmaRange * u_sigmaRange, 1e-6);
  vec3 sum = vec3(0.0);
  float weightSum = 0.0;
  for (int offset = -24; offset <= 24; offset++) {
    if (offset < -u_radius || offset > u_radius) continue;
    vec2 neighborPixel = pixel + u_direction * float(offset);
    vec4 neighborGuide = readPx(u_guide, neighborPixel, u_res);
    vec3 neighborSignal = readPx(u_signal, neighborPixel, u_res).rgb;
    vec3 delta = (centerGuide.rgb - neighborGuide.rgb) * 255.0;
    float spatialWeight = exp(-float(offset * offset) / spatialDenom);
    float rangeWeight = exp(-dot(delta, delta) / rangeDenom);
    float weight = spatialWeight * rangeWeight * neighborGuide.a;
    sum += neighborSignal * weight;
    weightSum += weight;
  }
  vec3 rgb = weightSum > 1e-6 ? sum / weightSum : centerSignal.rgb;
  fragColor = vec4(rgb, centerGuide.a);
}
`;

const RECONSTRUCT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_blurred;
uniform sampler2D u_guide;
uniform vec2 u_sourceRes;
uniform vec2 u_workRes;
uniform int u_factor;
uniform float u_sigmaRange;
uniform bool u_linearize;
${COLOR_SPACE_GLSL}
void main() {
  vec2 pixel = vec2(floor(v_uv.x * u_sourceRes.x), u_sourceRes.y - 1.0 - floor(v_uv.y * u_sourceRes.y));
  vec4 source = readPx(u_source, pixel, u_sourceRes);
  if (source.a <= 0.5 / 255.0) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 centerGuide = u_linearize ? srgbToLinear(source.rgb) : source.rgb;
  if (u_factor == 1) {
    vec3 rgb = readPx(u_blurred, pixel, u_workRes).rgb;
    if (u_linearize) rgb = linearToSrgb(rgb);
    fragColor = vec4(clamp(rgb, 0.0, 1.0), source.a);
    return;
  }
  vec2 workPosition = (pixel + vec2(0.5)) / float(u_factor) - vec2(0.5);
  vec2 base = floor(workPosition);
  float rangeDenom = max(2.0 * u_sigmaRange * u_sigmaRange, 1e-6);
  vec3 sum = vec3(0.0);
  float weightSum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 candidate = base + vec2(float(x), float(y));
      vec4 guide = readPx(u_guide, candidate, u_workRes);
      vec3 signal = readPx(u_blurred, candidate, u_workRes).rgb;
      vec2 spatialDelta = candidate - workPosition;
      vec3 rangeDelta = (centerGuide - guide.rgb) * 255.0;
      float spatialWeight = exp(-dot(spatialDelta, spatialDelta) / 2.0);
      float rangeWeight = exp(-dot(rangeDelta, rangeDelta) / rangeDenom);
      float weight = spatialWeight * rangeWeight * guide.a;
      sum += signal * weight;
      weightSum += weight;
    }
  }
  vec3 rgb = weightSum > 1e-6 ? sum / weightSum : centerGuide;
  if (u_linearize) rgb = linearToSrgb(rgb);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), source.a);
}
`;

type Cache = { guide: Program; bilateral: Program; reconstruct: Program };
let cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (cache) return cache;
  cache = {
    guide: linkProgram(gl, GUIDE_FS, [
      "u_source", "u_sourceRes", "u_workRes", "u_factor", "u_linearize",
    ] as const),
    bilateral: linkProgram(gl, BILATERAL_FS, [
      "u_signal", "u_guide", "u_res", "u_direction", "u_radius",
      "u_sigmaSpatial", "u_sigmaRange",
    ] as const),
    reconstruct: linkProgram(gl, RECONSTRUCT_FS, [
      "u_source", "u_blurred", "u_guide", "u_sourceRes", "u_workRes",
      "u_factor", "u_sigmaRange", "u_linearize",
    ] as const),
  };
  return cache;
};

export const renderBilateralBlurGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  sigmaSpatial: number,
  sigmaRange: number,
  factor: number,
  linearize: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const programs = initCache(gl);
  const vao = getQuadVAO(gl);
  const workWidth = Math.max(1, Math.ceil(width / factor));
  const workHeight = Math.max(1, Math.ceil(height / factor));
  const sigmaWork = sigmaSpatial / factor;
  const radius = Math.max(1, Math.min(24, Math.ceil(2 * sigmaWork)));
  resizeGLCanvas(canvas, width, height);

  const sourceTexture = ensureTexture(gl, "bilateralBlur:source", width, height);
  const guide = ensureFloatTexture(gl, "bilateralBlur:guide16f", workWidth, workHeight);
  const horizontal = ensureFloatTexture(gl, "bilateralBlur:horizontal16f", workWidth, workHeight);
  const blurred = ensureFloatTexture(gl, "bilateralBlur:blurred16f", workWidth, workHeight);
  if (!guide || !horizontal || !blurred) return null;
  uploadSourceTexture(gl, sourceTexture, source);

  drawPass(gl, guide, workWidth, workHeight, programs.guide, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(programs.guide.uniforms.u_source, 0);
    gl.uniform2f(programs.guide.uniforms.u_sourceRes, width, height);
    gl.uniform2f(programs.guide.uniforms.u_workRes, workWidth, workHeight);
    gl.uniform1i(programs.guide.uniforms.u_factor, factor);
    gl.uniform1i(programs.guide.uniforms.u_linearize, linearize ? 1 : 0);
  }, vao);

  const bilateralPass = (target: typeof horizontal, signal: WebGLTexture, directionX: number, directionY: number) => {
    drawPass(gl, target, workWidth, workHeight, programs.bilateral, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, signal);
      gl.uniform1i(programs.bilateral.uniforms.u_signal, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, guide.tex);
      gl.uniform1i(programs.bilateral.uniforms.u_guide, 1);
      gl.uniform2f(programs.bilateral.uniforms.u_res, workWidth, workHeight);
      gl.uniform2f(programs.bilateral.uniforms.u_direction, directionX, directionY);
      gl.uniform1i(programs.bilateral.uniforms.u_radius, radius);
      gl.uniform1f(programs.bilateral.uniforms.u_sigmaSpatial, sigmaWork);
      gl.uniform1f(programs.bilateral.uniforms.u_sigmaRange, sigmaRange);
    }, vao);
  };
  bilateralPass(horizontal, guide.tex, 1, 0);
  bilateralPass(blurred, horizontal.tex, 0, 1);

  drawPass(gl, null, width, height, programs.reconstruct, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(programs.reconstruct.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurred.tex);
    gl.uniform1i(programs.reconstruct.uniforms.u_blurred, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, guide.tex);
    gl.uniform1i(programs.reconstruct.uniforms.u_guide, 2);
    gl.uniform2f(programs.reconstruct.uniforms.u_sourceRes, width, height);
    gl.uniform2f(programs.reconstruct.uniforms.u_workRes, workWidth, workHeight);
    gl.uniform1i(programs.reconstruct.uniforms.u_factor, factor);
    gl.uniform1f(programs.reconstruct.uniforms.u_sigmaRange, sigmaRange);
    gl.uniform1i(programs.reconstruct.uniforms.u_linearize, linearize ? 1 : 0);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
