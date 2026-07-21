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
  type TexEntry,
} from "../gl/index";
import type { FilterCanvas } from "../filters/types";

// Boundary feature transform for a thresholded source image. Each boundary
// texel stores its normalized coordinate; jump flooding propagates the nearest
// coordinate across the image. RGBA16F is intentional: unlike the former
// RGBA8 pipeline it preserves the -1 invalid sentinel and enough coordinate
// precision for HD-sized fields.
const SEED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_threshold;

float maskAt(ivec2 p) {
  vec3 c = texelFetch(u_source, clamp(p, ivec2(0), ivec2(u_res) - 1), 0).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722)) >= u_threshold ? 1.0 : 0.0;
}

void main() {
  ivec2 p = ivec2(floor(v_uv * u_res));
  float inside = maskAt(p);
  bool boundary = false;
  const ivec2 offsets[4] = ivec2[4](
    ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1)
  );
  for (int i = 0; i < 4; i++) {
    ivec2 q = p + offsets[i];
    if (q.x < 0 || q.y < 0 || q.x >= int(u_res.x) || q.y >= int(u_res.y)) {
      boundary = boundary || inside > 0.5;
    } else {
      boundary = boundary || abs(maskAt(q) - inside) > 0.5;
    }
  }
  vec2 site = (vec2(p) + 0.5) / u_res;
  fragColor = boundary ? vec4(site, inside, 1.0) : vec4(-1.0, -1.0, inside, 1.0);
}
`;

const JFA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2 u_res;
uniform float u_step;

void main() {
  ivec2 p = ivec2(floor(v_uv * u_res));
  vec2 here = (vec2(p) + 0.5) / u_res;
  vec4 best = texelFetch(u_input, p, 0);
  float bestDistance = best.x < 0.0
    ? 1e20
    : length((best.rg - here) * u_res);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 q = p + ivec2(x, y) * int(u_step);
      if (q.x < 0 || q.y < 0 || q.x >= int(u_res.x) || q.y >= int(u_res.y)) continue;
      vec4 candidate = texelFetch(u_input, q, 0);
      if (candidate.x < 0.0) continue;
      float candidateDistance = length((candidate.rg - here) * u_res);
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
        best = candidate;
      }
    }
  }
  fragColor = vec4(best.rg, texelFetch(u_input, p, 0).b, 1.0);
}
`;

type Cache = { seed: Program; jump: Program };
let cache: Cache | null = null;

const getPrograms = (gl: WebGL2RenderingContext): Cache => {
  if (cache) return cache;
  cache = {
    seed: linkProgram(gl, SEED_FS, ["u_source", "u_res", "u_threshold"]),
    jump: linkProgram(gl, JFA_FS, ["u_input", "u_res", "u_step"]),
  };
  return cache;
};

export type SdfFieldOptions = {
  gl: WebGL2RenderingContext;
  sourceTexture: TexEntry;
  width: number;
  height: number;
  threshold: number;
  key: string;
};

/** Build an approximate signed-distance feature transform on the GPU. */
export const buildSdfField = ({
  gl,
  sourceTexture,
  width,
  height,
  threshold,
  key,
}: SdfFieldOptions): TexEntry | null => {
  const fieldA = ensureFloatTexture(gl, `${key}:sdfA`, width, height);
  const fieldB = ensureFloatTexture(gl, `${key}:sdfB`, width, height);
  if (!fieldA || !fieldB) return null;

  const programs = getPrograms(gl);
  const vao = getQuadVAO(gl);
  drawPass(gl, fieldA, width, height, programs.seed, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(programs.seed.uniforms.u_source, 0);
    gl.uniform2f(programs.seed.uniforms.u_res, width, height);
    gl.uniform1f(programs.seed.uniforms.u_threshold, threshold);
  }, vao);

  let source = fieldA;
  let target = fieldB;
  let step = 1;
  while (step * 2 < Math.max(width, height)) step *= 2;
  for (; step >= 1; step = Math.floor(step / 2)) {
    drawPass(gl, target, width, height, programs.jump, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.tex);
      gl.uniform1i(programs.jump.uniforms.u_input, 0);
      gl.uniform2f(programs.jump.uniforms.u_res, width, height);
      gl.uniform1f(programs.jump.uniforms.u_step, step);
    }, vao);
    [source, target] = [target, source];
  }

  // JFA+1 refinement removes most of the small errors left by the logarithmic
  // schedule while retaining the same parallel gather pattern.
  drawPass(gl, target, width, height, programs.jump, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.tex);
    gl.uniform1i(programs.jump.uniforms.u_input, 0);
    gl.uniform2f(programs.jump.uniforms.u_res, width, height);
    gl.uniform1f(programs.jump.uniforms.u_step, 1);
  }, vao);
  return target;
};

// Shared shader helpers. Coordinates are framebuffer/texture coordinates;
// returned distance is negative inside the source mask and positive outside.
export const SDF_GLSL = `
float sdfMask(sampler2D source, ivec2 p, vec2 res, float threshold) {
  vec3 c = texelFetch(source, clamp(p, ivec2(0), ivec2(res) - 1), 0).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722)) >= threshold ? 1.0 : 0.0;
}

float signedDistanceAt(
  sampler2D field,
  sampler2D source,
  ivec2 p,
  vec2 res,
  float threshold
) {
  ivec2 q = clamp(p, ivec2(0), ivec2(res) - 1);
  vec4 site = texelFetch(field, q, 0);
  float distancePx = site.x < 0.0
    ? max(res.x, res.y)
    : length((site.rg - (vec2(q) + 0.5) / res) * res);
  return sdfMask(source, q, res, threshold) > 0.5 ? -distancePx : distancePx;
}
`;

type UniformSetter = (
  gl: WebGL2RenderingContext,
  uniforms: Record<string, WebGLUniformLocation | null>,
) => void;

type RenderSdfEffectOptions = {
  source: FilterCanvas;
  width: number;
  height: number;
  key: string;
  threshold: number;
  fragmentShader: string;
  uniformNames: readonly string[];
  setUniforms?: UniformSetter;
};

const effectPrograms = new Map<string, Program>();

/** Render a full-screen effect backed by the shared boundary feature field. */
export const renderSdfEffect = ({
  source,
  width,
  height,
  key,
  threshold,
  fragmentShader,
  uniformNames,
  setUniforms,
}: RenderSdfEffectOptions): FilterCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  resizeGLCanvas(canvas, width, height);

  const sourceTexture = ensureTexture(gl, `${key}:source`, width, height);
  uploadSourceTexture(gl, sourceTexture, source);
  const field = buildSdfField({
    gl,
    sourceTexture,
    width,
    height,
    threshold,
    key,
  });
  if (!field) return null;

  let program = effectPrograms.get(key);
  if (!program) {
    program = linkProgram(gl, fragmentShader, [
      "u_source", "u_sdf", "u_res", "u_threshold", ...uniformNames,
    ]);
    effectPrograms.set(key, program);
  }
  const activeProgram = program;
  const vao = getQuadVAO(gl);
  drawPass(gl, null, width, height, activeProgram, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(activeProgram.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, field.tex);
    gl.uniform1i(activeProgram.uniforms.u_sdf, 1);
    gl.uniform2f(activeProgram.uniforms.u_res, width, height);
    gl.uniform1f(activeProgram.uniforms.u_threshold, threshold);
    setUniforms?.(gl, activeProgram.uniforms);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
