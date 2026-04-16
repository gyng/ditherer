import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

const MAX_RADIUS = 60;

// Extract highlights, tint them toward the halation colour. Keeps the
// amplitude proportional to the excess above threshold so only genuinely
// bright areas contribute to the glow.
const EXTRACT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_threshold;
uniform vec3  u_tint;
void main() {
  vec3 c = texture(u_source, v_uv).rgb;
  float l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float excess = max(0.0, l - u_threshold);
  // Tint the extracted light so halation appears coloured rather than
  // white. Retains a bit of the source colour for naturalness.
  vec3 extracted = mix(u_tint, c, 0.3) * excess;
  fragColor = vec4(extracted, 1.0);
}
`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_dir;
uniform float u_sigma;
uniform int   u_radius;
void main() {
  float twoSigmaSq = 2.0 * u_sigma * u_sigma + 1e-6;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int k = -${MAX_RADIUS}; k <= ${MAX_RADIUS}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float fk = float(k);
    float w = exp(-(fk * fk) / twoSigmaSq);
    vec2 uv = clamp(v_uv + u_dir * fk,
                    vec2(0.5) / u_res,
                    vec2(1.0) - vec2(0.5) / u_res);
    acc += texture(u_input, uv) * w;
    wsum += w;
  }
  fragColor = acc / wsum;
}
`;

// Screen blend the halation glow over the source. Using screen rather than
// additive prevents highlights clipping to pure white — the bleed looks
// red-ish even in already-bright regions.
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_halation;
uniform float u_strength;
void main() {
  vec4 s = texture(u_source, v_uv);
  vec3 h = texture(u_halation, v_uv).rgb * u_strength;
  vec3 screen = vec3(1.0) - (vec3(1.0) - s.rgb) * (vec3(1.0) - h);
  fragColor = vec4(clamp(screen, 0.0, 1.0), s.a);
}
`;

type Cache = { extract: Program; blur: Program; composite: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    extract: linkProgram(gl, EXTRACT_FS, ["u_source", "u_threshold", "u_tint"] as const),
    blur: linkProgram(gl, BLUR_FS, ["u_input", "u_res", "u_dir", "u_sigma", "u_radius"] as const),
    composite: linkProgram(gl, COMPOSITE_FS, ["u_source", "u_halation", "u_strength"] as const),
  };
  return _cache;
};

export const halationGLAvailable = (): boolean => glAvailable();

export const renderHalationGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  radius: number,
  threshold: number,   // 0..255
  strength: number,
  tint: number[],      // 0..255
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const sigma = Math.max(1, radius);
  const kr = Math.min(MAX_RADIUS, Math.ceil(sigma * 3));

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "halation:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const extractTex = ensureTexture(gl, "halation:extract", width, height);
  drawPass(gl, extractTex, width, height, cache.extract, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.extract.uniforms.u_source, 0);
    gl.uniform1f(cache.extract.uniforms.u_threshold, threshold / 255);
    gl.uniform3f(cache.extract.uniforms.u_tint, tint[0] / 255, tint[1] / 255, tint[2] / 255);
  }, vao);

  const tempH = ensureTexture(gl, "halation:blurH", width, height);
  drawPass(gl, tempH, width, height, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, extractTex.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, width, height);
    gl.uniform2f(cache.blur.uniforms.u_dir, 1 / width, 0);
    gl.uniform1f(cache.blur.uniforms.u_sigma, sigma);
    gl.uniform1i(cache.blur.uniforms.u_radius, kr);
  }, vao);

  const blurTex = ensureTexture(gl, "halation:blurV", width, height);
  drawPass(gl, blurTex, width, height, cache.blur, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tempH.tex);
    gl.uniform1i(cache.blur.uniforms.u_input, 0);
    gl.uniform2f(cache.blur.uniforms.u_res, width, height);
    gl.uniform2f(cache.blur.uniforms.u_dir, 0, 1 / height);
    gl.uniform1f(cache.blur.uniforms.u_sigma, sigma);
    gl.uniform1i(cache.blur.uniforms.u_radius, kr);
  }, vao);

  drawPass(gl, null, width, height, cache.composite, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.composite.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurTex.tex);
    gl.uniform1i(cache.composite.uniforms.u_halation, 1);
    gl.uniform1f(cache.composite.uniforms.u_strength, strength);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
