import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

export const PAPER_TEXTURE = {
  PAPER: 0,
  CANVAS: 1,
  LINEN: 2,
  CARDBOARD: 3,
  PARCHMENT: 4,
} as const;

export const PAPER_BLEND = {
  MULTIPLY: 0,
  OVERLAY: 1,
  SOFT_LIGHT: 2,
} as const;

// Procedural texture overlay. All variants produce a 0..1 map where 0.5
// means "no effect", values below darken/shadow, values above lighten.
// The variants differ in frequency/anisotropy of their noise stack.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_type;       // texture variant
uniform int   u_blendMode;  // 0 multiply, 1 overlay, 2 soft-light
uniform float u_scale;      // tiles across the frame
uniform float u_strength;   // 0 = no effect, 1 = full texture
uniform float u_contrast;   // 0.5..3 amplifies tex variance

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return v;
}

// Each variant returns a 0..1 tex value; 0.5 is the neutral point.
float paperTex(vec2 p) {
  float fine = vnoise(p * 12.0) - 0.5;
  float coarse = fbm(p * 2.0) - 0.5;
  return 0.5 + fine * 0.15 + coarse * 0.12;
}

float canvasTex(vec2 p) {
  // Cross-weave sine grid + fibre noise. The abs(sin()) produces bands
  // that look like interlaced threads rather than pure waves.
  float weaveX = abs(sin(p.x * 6.28318 * 16.0)) - 0.5;
  float weaveY = abs(sin(p.y * 6.28318 * 16.0)) - 0.5;
  float weave = (weaveX + weaveY) * 0.08;
  float fibre = (fbm(p * 8.0) - 0.5) * 0.12;
  return 0.5 + weave + fibre;
}

float linenTex(vec2 p) {
  // Directional weave, coarser than canvas, with stronger fibre noise.
  float warp = sin(p.x * 6.28318 * 8.0);
  float weft = sin(p.y * 6.28318 * 10.0);
  float weave = (warp * weft) * 0.1;
  float fibre = (fbm(p * 6.0) - 0.5) * 0.18;
  return 0.5 + weave + fibre;
}

float cardboardTex(vec2 p) {
  // Horizontal corrugation plus anisotropic noise.
  float corrug = sin(p.y * 6.28318 * 24.0) * 0.08;
  float big = (fbm(vec2(p.x * 0.5, p.y * 3.0)) - 0.5) * 0.25;
  return 0.5 + corrug + big;
}

float parchmentTex(vec2 p) {
  // Cloudy low-frequency variation with age blotches.
  float clouds = (fbm(p * 1.5) - 0.5) * 0.35;
  float blotch = smoothstep(0.65, 0.9, fbm(p * 0.8)) * -0.2;
  float fibre = (vnoise(p * 20.0) - 0.5) * 0.05;
  return 0.5 + clouds + blotch + fibre;
}

float softLight(float base, float blend) {
  // Pegtop soft-light — cheap, matches CSS blend spec closely enough.
  return (1.0 - 2.0 * blend) * base * base + 2.0 * blend * base;
}

void main() {
  // World-space coord so the texture doesn't stretch with resolution —
  // u_scale is roughly "how many tiles fit across the longer side".
  float aspect = u_res.x / u_res.y;
  vec2 p = v_uv * u_scale * vec2(aspect, 1.0);

  float tex = 0.5;
  if      (u_type == 0) tex = paperTex(p);
  else if (u_type == 1) tex = canvasTex(p);
  else if (u_type == 2) tex = linenTex(p);
  else if (u_type == 3) tex = cardboardTex(p);
  else                  tex = parchmentTex(p);

  // Contrast around the neutral mid-point.
  tex = (tex - 0.5) * u_contrast + 0.5;
  // Strength pulls the texture toward neutral (=no effect).
  tex = mix(0.5, tex, u_strength);
  tex = clamp(tex, 0.0, 1.0);

  vec4 s = texture(u_source, v_uv);
  vec3 outRgb;
  if (u_blendMode == 0) {
    // Multiply around a neutral value of 0.5 → double so output isn't
    // halved by default. This matches "paper overlay" as darkening /
    // lightening centred on the source.
    outRgb = s.rgb * (2.0 * tex);
  } else if (u_blendMode == 1) {
    // Overlay — classic Photoshop formula.
    outRgb = vec3(
      tex < 0.5 ? 2.0 * s.r * tex : 1.0 - 2.0 * (1.0 - s.r) * (1.0 - tex),
      tex < 0.5 ? 2.0 * s.g * tex : 1.0 - 2.0 * (1.0 - s.g) * (1.0 - tex),
      tex < 0.5 ? 2.0 * s.b * tex : 1.0 - 2.0 * (1.0 - s.b) * (1.0 - tex)
    );
  } else {
    outRgb = vec3(softLight(s.r, tex), softLight(s.g, tex), softLight(s.b, tex));
  }

  fragColor = vec4(clamp(outRgb, 0.0, 1.0), s.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source", "u_res", "u_type", "u_blendMode",
      "u_scale", "u_strength", "u_contrast",
    ] as const),
  };
  return _cache;
};

export const paperTextureGLAvailable = (): boolean => glAvailable();

export const renderPaperTextureGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  type: number,
  blendMode: number,
  scale: number,
  strength: number,
  contrast: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "paperTexture:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_type, type);
    gl.uniform1i(cache.prog.uniforms.u_blendMode, blendMode);
    gl.uniform1f(cache.prog.uniforms.u_scale, scale);
    gl.uniform1f(cache.prog.uniforms.u_strength, strength);
    gl.uniform1f(cache.prog.uniforms.u_contrast, contrast);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
