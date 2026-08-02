import {
  drawPass,
  ensureFloatTexture,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
  type TexEntry,
} from "../gl/index";
import { SRGB_GLSL } from "./opticalConvolutionContracts";

const MAX_RADIUS = 64;

// Orton is an optical diffusion effect — it blurs emitted light and
// additively (screen) recombines it with the sharp source — so the glow
// must be built and composited in linear light, not gamma/sRGB. The source
// is linearized once, blurred (a Gaussian of linear values stays linear —
// no per-tap colour conversion needed), then screen-blended in linear
// before converting back to sRGB for display and the sRGB-tuned contrast/
// saturation grade below.
const LINEARIZE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
${SRGB_GLSL}
void main() {
  vec4 c = texture(u_source, v_uv);
  fragColor = vec4(oc_srgbToLinear(c.rgb), c.a);
}
`;

const GAUSS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_dir;
uniform float u_sigma;
uniform int   u_radius;
void main() {
  float twoSigmaSq = 2.0 * u_sigma * u_sigma;
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

// Orton composite. Combines the sharp source and the (linear-light) blurred
// copy via a screen blend (1 - (1-a)(1-b)) done in linear light, mixes
// between source and screen by u_strength — also in linear — then converts
// back to sRGB. A small contrast lift pulls the midtones back after the
// screen brightens everything; saturation nudges warmth the way over-
// exposed analog film does — both stay in sRGB, tuned for that range.
const ORTON_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_blurred;
uniform float u_strength;     // 0..1 opacity of the screen blend
uniform float u_contrast;     // 0..1 post-contrast lift
uniform float u_saturation;   // 0..2 saturation multiplier
${SRGB_GLSL}
void main() {
  vec4 s = texture(u_source, v_uv);
  vec3 sLin = oc_srgbToLinear(s.rgb);
  vec3 bLin = texture(u_blurred, v_uv).rgb;
  vec3 screenLin = vec3(1.0) - (vec3(1.0) - sLin) * (vec3(1.0) - bLin);
  vec3 mixedLin = mix(sLin, screenLin, u_strength);
  vec3 mixed = oc_linearToSrgb(mixedLin);
  // Contrast around 0.5 mid (u_contrast ∈ [0,1] scales a soft S curve).
  mixed = mix(mixed, (mixed - vec3(0.5)) * (1.0 + u_contrast) + vec3(0.5), 1.0);
  // Saturation around luma.
  float lum = 0.2126 * mixed.r + 0.7152 * mixed.g + 0.0722 * mixed.b;
  mixed = mix(vec3(lum), mixed, u_saturation);
  fragColor = vec4(clamp(mixed, 0.0, 1.0), s.a);
}
`;

type Cache = { linearize: Program; gauss: Program; composite: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    linearize: linkProgram(gl, LINEARIZE_FS, ["u_source"] as const),
    gauss: linkProgram(gl, GAUSS_FS, ["u_input", "u_res", "u_dir", "u_sigma", "u_radius"] as const),
    composite: linkProgram(gl, ORTON_FS, [
      "u_source",
      "u_blurred",
      "u_strength",
      "u_contrast",
      "u_saturation",
    ] as const),
  };
  return _cache;
};

export const ortonGLAvailable = (): boolean => glAvailable();

export const renderOrtonGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  sigma: number,
  strength: number,
  contrast: number,
  saturation: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  const radius = Math.min(MAX_RADIUS, Math.ceil(sigma * 3));

  resizeGLCanvas(canvas, width, height);

  const sourceTex = ensureTexture(gl, "orton:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  // The linearized source and its blur passes hold linear-light energy; use
  // RGBA16F where available so the wide glow tail does not band, falling
  // back to 8-bit.
  const linTex = (name: string): TexEntry =>
    ensureFloatTexture(gl, name, width, height) ?? ensureTexture(gl, name, width, height);
  const linSourceTex = linTex("orton:linSource");
  drawPass(
    gl,
    linSourceTex,
    width,
    height,
    cache.linearize,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.linearize.uniforms.u_source, 0);
    },
    vao,
  );

  const tempH = linTex("orton:tempH");
  drawPass(
    gl,
    tempH,
    width,
    height,
    cache.gauss,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, linSourceTex.tex);
      gl.uniform1i(cache.gauss.uniforms.u_input, 0);
      gl.uniform2f(cache.gauss.uniforms.u_res, width, height);
      gl.uniform2f(cache.gauss.uniforms.u_dir, 1 / width, 0);
      gl.uniform1f(cache.gauss.uniforms.u_sigma, sigma);
      gl.uniform1i(cache.gauss.uniforms.u_radius, radius);
    },
    vao,
  );

  const blurTex = linTex("orton:blur");
  drawPass(
    gl,
    blurTex,
    width,
    height,
    cache.gauss,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tempH.tex);
      gl.uniform1i(cache.gauss.uniforms.u_input, 0);
      gl.uniform2f(cache.gauss.uniforms.u_res, width, height);
      gl.uniform2f(cache.gauss.uniforms.u_dir, 0, 1 / height);
      gl.uniform1f(cache.gauss.uniforms.u_sigma, sigma);
      gl.uniform1i(cache.gauss.uniforms.u_radius, radius);
    },
    vao,
  );

  drawPass(
    gl,
    null,
    width,
    height,
    cache.composite,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.composite.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurTex.tex);
      gl.uniform1i(cache.composite.uniforms.u_blurred, 1);
      gl.uniform1f(cache.composite.uniforms.u_strength, strength);
      gl.uniform1f(cache.composite.uniforms.u_contrast, contrast);
      gl.uniform1f(cache.composite.uniforms.u_saturation, saturation);
    },
    vao,
  );

  return readoutToCanvas(canvas, width, height);
};
