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

// Single-image lenticular proxy: luminance supplies a bounded depth cue for
// synthetic parallax views, which are interlaced at the lens pitch. Viewing
// angle selects a view phase; neighbouring views leak according to crosstalk.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_stripWidth;
uniform float u_cosA;
uniform float u_sinA;
uniform float u_viewAngle;
uniform int   u_viewCount;
uniform float u_parallax;
uniform float u_crosstalk;
uniform float u_lensStrength;

vec4 samplePx(vec2 sourcePx) {
  vec2 p = clamp(sourcePx, vec2(0.0), u_res - vec2(1.0));
  return texture(u_source, vec2((p.x + 0.5) / u_res.x, 1.0 - (p.y + 0.5) / u_res.y));
}

float viewPosition(float slot) {
  return slot / max(float(u_viewCount - 1), 1.0) * 2.0 - 1.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec2 sourcePx = vec2(jsX, jsY);
  vec2 lensNormal = vec2(u_cosA, u_sinA);
  float projection = dot(sourcePx, lensNormal);
  float lensPhase = fract(projection / max(u_stripWidth, 1.0));
  float viewPhase = fract(lensPhase + u_viewAngle * 0.5);
  float slot = min(float(u_viewCount - 1), floor(viewPhase * float(u_viewCount)));

  vec4 center = samplePx(sourcePx);
  float depth = 0.2126 * center.r + 0.7152 * center.g + 0.0722 * center.b;
  float depthScale = 0.25 + depth * 0.75;
  float offset = viewPosition(slot) * u_parallax * depthScale;
  vec3 selected = samplePx(sourcePx + lensNormal * offset).rgb;

  float previousSlot = max(0.0, slot - 1.0);
  float nextSlot = min(float(u_viewCount - 1), slot + 1.0);
  vec3 neighbours = 0.5 * (
    samplePx(sourcePx + lensNormal * viewPosition(previousSlot) * u_parallax * depthScale).rgb +
    samplePx(sourcePx + lensNormal * viewPosition(nextSlot) * u_parallax * depthScale).rgb
  );
  vec3 interlaced = mix(selected, neighbours, u_crosstalk);

  float lensX = lensPhase * 2.0 - 1.0;
  float centerHighlight = pow(max(0.0, 1.0 - lensX * lensX), 12.0);
  float transmission = 1.0 - u_lensStrength * 0.16 * lensX * lensX
    + u_lensStrength * 0.05 * centerHighlight;
  fragColor = vec4(clamp(interlaced * transmission, 0.0, 1.0), center.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source",
      "u_res",
      "u_stripWidth",
      "u_cosA",
      "u_sinA",
      "u_viewAngle",
      "u_viewCount",
      "u_parallax",
      "u_crosstalk",
      "u_lensStrength",
    ] as const),
  };
  return _cache;
};

export const lenticularGLAvailable = (): boolean => glAvailable();

export const renderLenticularGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  stripWidth: number,
  angleRad: number,
  viewAngle: number,
  viewCount: number,
  parallax: number,
  crosstalk: number,
  lensStrength: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lenticular:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(
    gl,
    null,
    width,
    height,
    cache.prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.prog.uniforms.u_source, 0);
      gl.uniform2f(cache.prog.uniforms.u_res, width, height);
      gl.uniform1f(cache.prog.uniforms.u_stripWidth, stripWidth);
      gl.uniform1f(cache.prog.uniforms.u_cosA, Math.cos(angleRad));
      gl.uniform1f(cache.prog.uniforms.u_sinA, Math.sin(angleRad));
      gl.uniform1f(cache.prog.uniforms.u_viewAngle, Math.max(-1, Math.min(1, viewAngle)));
      gl.uniform1i(
        cache.prog.uniforms.u_viewCount,
        Math.max(2, Math.min(12, Math.round(viewCount))),
      );
      gl.uniform1f(cache.prog.uniforms.u_parallax, Math.max(0, Math.min(24, parallax)));
      gl.uniform1f(cache.prog.uniforms.u_crosstalk, Math.max(0, Math.min(0.5, crosstalk)));
      gl.uniform1f(cache.prog.uniforms.u_lensStrength, Math.max(0, Math.min(1, lensStrength)));
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
