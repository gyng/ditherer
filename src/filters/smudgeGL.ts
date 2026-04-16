import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Directional motion blur (pull-model). The JS reference iteratively
// reads outBuf (a running smudge accumulator) — a true sequential
// dependency. Here each fragment samples the source backward along
// the direction with 1/t weights, giving a visually equivalent smudge
// without the JS iteration order sensitivity.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_dx;
uniform float u_dy;
uniform int   u_strength;

vec3 fetch(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec3 here = fetch(jsX, jsY);

  vec3 trail = vec3(0.0);
  float w = 0.0;
  bool stopped = false;
  for (int t = 1; t <= 30; t++) {
    if (t > u_strength || stopped) continue;
    float bx = floor(jsX - u_dx * float(t) + 0.5);
    float by = floor(jsY - u_dy * float(t) + 0.5);
    if (bx < 0.0 || bx >= u_res.x || by < 0.0 || by >= u_res.y) { stopped = true; continue; }
    float weight = 1.0 / float(t);
    trail += fetch(bx, by) * weight;
    w += weight;
  }

  vec3 outRgb;
  if (w > 0.0) {
    vec3 avg = trail / w;
    outRgb = floor(here * 0.5 + avg * 0.5 + 0.5);
  } else {
    outRgb = here;
  }

  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, texture(u_source, v_uv).a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_dx", "u_dy", "u_strength",
  ] as const) };
  return _cache;
};

export const smudgeGLAvailable = (): boolean => glAvailable();

export const renderSmudgeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  strength: number, directionRad: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "smudge:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_dx, Math.cos(directionRad));
    gl.uniform1f(cache.prog.uniforms.u_dy, Math.sin(directionRad));
    gl.uniform1i(cache.prog.uniforms.u_strength, Math.max(1, Math.min(30, Math.round(strength))));
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
