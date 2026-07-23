import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

// Resolution-independent lens flare. Energy is added in linear light and
// ghost interreflections span the source/centre/reflected optical axis.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_centre;     // JS-y
uniform vec2  u_imageCentre;
uniform vec3  u_flareColor; // 0..255
uniform float u_intensity;
uniform int   u_ghosts;
uniform float u_bloomRadius;
uniform float u_ghostSpread;
uniform float u_streakStrength;
uniform float u_chromaticSpread;

vec3 srgbToLinear(vec3 encoded) {
  bvec3 cutoff = lessThanEqual(encoded, vec3(0.04045));
  vec3 low = encoded / 12.92;
  vec3 high = pow((encoded + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

vec3 linearToSrgb(vec3 linear) {
  linear = max(linear, vec3(0.0));
  bvec3 cutoff = lessThanEqual(linear, vec3(0.0031308));
  vec3 low = linear * 12.92;
  vec3 high = 1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, cutoff);
}

float softRing(float distanceToCenter, float radius, float width) {
  float signedDistance = abs(distanceToCenter - radius) - width;
  float aa = max(fwidth(signedDistance), 0.75);
  return 1.0 - smoothstep(-aa, aa, signedDistance);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec4 source = texture(u_source, v_uv);
  if (u_intensity <= 0.0) {
    fragColor = source;
    return;
  }

  float shortSide = max(1.0, min(u_res.x, u_res.y));
  vec3 flareLinear = srgbToLinear(clamp(u_flareColor / 255.0, 0.0, 1.0));
  vec3 total = srgbToLinear(source.rgb);

  // Soft source bloom, scaled by the short image dimension.
  float bloomR = max(1.0, shortSide * u_bloomRadius);
  vec2 dBloom = vec2(jsX - u_centre.x, jsY - u_centre.y);
  float distBloom = length(dBloom);
  float bloom = exp(-3.2 * pow(distBloom / bloomR, 2.0));
  float core = exp(-18.0 * pow(distBloom / bloomR, 2.0));
  total += flareLinear * (bloom * 0.32 + core * 0.28) * u_intensity;

  // Interreflection ghosts span both sides of the optical centre. Subtly
  // different RGB ring radii imitate lateral chromatic aberration.
  for (int g = 0; g < 6; g++) {
    if (g >= u_ghosts) break;
    float axisPosition = u_ghosts <= 1
      ? 0.0
      : (float(g) + 1.0) / (float(u_ghosts) + 1.0) * 2.0 - 1.0;
    vec2 ghostC = u_imageCentre
      + (u_imageCentre - u_centre) * axisPosition * u_ghostSpread;
    float sequence = float(g) / max(1.0, float(u_ghosts));
    float ghostR = shortSide * (0.035 + sequence * 0.055);
    float ringWidth = max(1.0, ghostR * (0.15 + sequence * 0.05));
    float ghostI = u_intensity * (0.18 / (1.0 + float(g) * 0.42));
    vec2 dG = vec2(jsX - ghostC.x, jsY - ghostC.y);
    float distG = length(dG);
    float shift = ghostR * 0.07 * u_chromaticSpread;
    vec3 rings = vec3(
      softRing(distG, ghostR + shift, ringWidth),
      softRing(distG, ghostR, ringWidth),
      softRing(distG, max(0.0, ghostR - shift), ringWidth)
    );
    float veil = exp(-2.4 * pow(distG / max(1.0, ghostR), 2.0)) * 0.18;
    total += flareLinear * (rings + vec3(veil)) * ghostI;
  }

  // Horizontal anamorphic streak with smooth Gaussian cross-section.
  float streakLength = max(1.0, u_res.x * 0.42);
  float streakHeight = max(1.0, shortSide * 0.008);
  float dyStreak = abs(jsY - u_centre.y);
  float dxStreak = abs(jsX - u_centre.x);
  float streak = exp(-0.5 * pow(dyStreak / streakHeight, 2.0))
    * exp(-4.0 * pow(dxStreak / streakLength, 2.0));
  total += flareLinear * streak * u_intensity * u_streakStrength * 0.42;

  vec3 outRgb = clamp(linearToSrgb(total), 0.0, 1.0);
  fragColor = vec4(floor(outRgb * 255.0 + 0.5) / 255.0, source.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_centre", "u_imageCentre",
    "u_flareColor", "u_intensity", "u_ghosts", "u_bloomRadius",
    "u_ghostSpread", "u_streakStrength", "u_chromaticSpread",
  ] as const) };
  return _cache;
};

export const lensFlareGLAvailable = (): boolean => glAvailable();

export const renderLensFlareGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  centreX: number, centreY: number,
  intensity: number, flareColor: [number, number, number],
  ghosts: number,
  bloomRadius: number, ghostSpread: number, streakStrength: number,
  chromaticSpread: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lensFlare:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_centre, centreX, centreY);
    gl.uniform2f(cache.prog.uniforms.u_imageCentre, width / 2, height / 2);
    gl.uniform3f(cache.prog.uniforms.u_flareColor, flareColor[0], flareColor[1], flareColor[2]);
    gl.uniform1f(cache.prog.uniforms.u_intensity, intensity);
    gl.uniform1i(cache.prog.uniforms.u_ghosts, ghosts | 0);
    gl.uniform1f(cache.prog.uniforms.u_bloomRadius, bloomRadius);
    gl.uniform1f(cache.prog.uniforms.u_ghostSpread, ghostSpread);
    gl.uniform1f(cache.prog.uniforms.u_streakStrength, streakStrength);
    gl.uniform1f(cache.prog.uniforms.u_chromaticSpread, chromaticSpread);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
