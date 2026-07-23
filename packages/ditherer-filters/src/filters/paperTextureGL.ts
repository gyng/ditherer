import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

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

float threadProfile(float coordinate, float halfWidth) {
  float distanceToCenter = abs(fract(coordinate) - 0.5);
  float footprint = max(fwidth(coordinate) * 0.65, 0.002);
  return 1.0 - smoothstep(halfWidth - footprint, halfWidth + footprint, distanceToCenter);
}

// Each variant returns a 0..1 tex value; 0.5 is the neutral point.
float paperTex(vec2 p) {
  float formation = fbm(p * 1.7) - 0.5;
  float longFiber = vnoise(vec2((p.x + p.y * 0.28) * 9.0, (p.y - p.x * 0.12) * 1.5)) - 0.5;
  float crossingFiber = vnoise(vec2((p.x - p.y * 0.22) * 2.1 + 17.0, (p.y + p.x * 0.18) * 8.0)) - 0.5;
  float fine = vnoise(p * 12.0 + vec2(31.0, 7.0)) - 0.5;
  return 0.5 + formation * 0.1 + longFiber * 0.075 + crossingFiber * 0.05 + fine * 0.035;
}

float canvasTex(vec2 p) {
  // Alternating 1/1 plain weave: adjacent crossings swap which yarn is on
  // top. Low-frequency wobble and slub keep the textile from becoming a
  // perfectly ruled screen; derivative coverage suppresses moire.
  vec2 q = p * 4.0;
  float warpWobble = (vnoise(vec2(q.y * 0.18, 5.0)) - 0.5) * 0.22;
  float weftWobble = (vnoise(vec2(9.0, q.x * 0.16)) - 0.5) * 0.22;
  float warp = threadProfile(q.x + warpWobble, 0.32);
  float weft = threadProfile(q.y + weftWobble, 0.32);
  float crossing = mod(floor(q.x + warpWobble) + floor(q.y + weftWobble), 2.0);
  float relief = mix(warp * 0.12 + weft * 0.045, warp * 0.045 + weft * 0.12, crossing) - 0.075;
  float slub = (vnoise(vec2(q.x * 0.08, q.y * 0.7)) - 0.5) * 0.055;
  return 0.5 + relief + slub;
}

float linenTex(vec2 p) {
  vec2 q = p * vec2(3.5, 3.0);
  float warpSlub = (vnoise(vec2(q.y * 0.11, 13.0)) - 0.5) * 0.38;
  float weftSlub = (vnoise(vec2(29.0, q.x * 0.09)) - 0.5) * 0.3;
  float warp = threadProfile(q.x + warpSlub, 0.24 + 0.06 * vnoise(vec2(q.y * 0.13, 3.0)));
  float weft = threadProfile(q.y + weftSlub, 0.29 + 0.05 * vnoise(vec2(q.x * 0.12, 7.0)));
  float crossing = mod(floor(q.x + warpSlub) + floor(q.y + weftSlub), 2.0);
  float relief = mix(warp * 0.11 + weft * 0.035, warp * 0.035 + weft * 0.1, crossing) - 0.065;
  float fibre = (vnoise(vec2(q.x * 1.8, q.y * 0.24)) - 0.5) * 0.07;
  return 0.5 + relief + fibre;
}

float cardboardTex(vec2 p) {
  // Surface-facing kraft liner: machine-direction fibres and broad formation
  // variation, not the hidden corrugated flute rendered as perfect stripes.
  float formation = fbm(vec2(p.x * 0.85, p.y * 1.7)) - 0.5;
  float machineFiber = vnoise(vec2(p.x * 1.15, p.y * 10.0)) - 0.5;
  float clumps = vnoise(vec2(p.x * 2.0 + 19.0, p.y * 4.5)) - 0.5;
  return 0.5 + formation * 0.16 + machineFiber * 0.1 + clumps * 0.07;
}

float parchmentTex(vec2 p) {
  // Cloudy low-frequency variation with age blotches.
  float clouds = (fbm(p * 1.35) - 0.5) * 0.24;
  float blotch = smoothstep(0.68, 0.9, fbm(p * 0.75)) * -0.13;
  float fibre = (vnoise(vec2((p.x + p.y * 0.24) * 8.0, (p.y - p.x * 0.18) * 1.8)) - 0.5) * 0.055;
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
