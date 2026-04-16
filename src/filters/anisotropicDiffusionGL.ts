import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Perona–Malik anisotropic diffusion: N iterations of 4-neighbour
// gradient + edge-stopping diffusion. We ping-pong between two RGBA8
// FBO textures. Intermediate storage is byte-quantised (vs the JS
// reference's Float32), which costs a little precision at high
// iteration counts but keeps the shader cheap.
const DIFFUSE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform float u_kappa;
uniform float u_lambda;
uniform int   u_conductance;  // 0 = exp, 1 = quadratic

float c(float grad) {
  float t = grad / u_kappa;
  return u_conductance == 0 ? exp(-(t * t)) : 1.0 / (1.0 + t * t);
}

vec3 sampleAt(vec2 uv) {
  uv = clamp(uv, vec2(0.5) / u_res, vec2(1.0) - vec2(0.5) / u_res);
  return texture(u_input, uv).rgb * 255.0;
}

void main() {
  vec3 v = texture(u_input, v_uv).rgb * 255.0;
  vec3 n = sampleAt(v_uv + vec2(0.0,  1.0 / u_res.y));
  vec3 s = sampleAt(v_uv + vec2(0.0, -1.0 / u_res.y));
  vec3 w = sampleAt(v_uv + vec2(-1.0 / u_res.x, 0.0));
  vec3 e = sampleAt(v_uv + vec2( 1.0 / u_res.x, 0.0));
  vec3 dN = n - v;
  vec3 dS = s - v;
  vec3 dW = w - v;
  vec3 dE = e - v;

  vec3 cN = vec3(c(dN.r), c(dN.g), c(dN.b));
  vec3 cS = vec3(c(dS.r), c(dS.g), c(dS.b));
  vec3 cW = vec3(c(dW.r), c(dW.g), c(dW.b));
  vec3 cE = vec3(c(dE.r), c(dE.g), c(dE.b));

  vec3 next = v + u_lambda * (cN * dN + cS * dS + cW * dW + cE * dE);
  next = clamp(next, 0.0, 255.0);
  fragColor = vec4(next / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, DIFFUSE_FS, [
    "u_input", "u_res", "u_kappa", "u_lambda", "u_conductance",
  ] as const) };
  return _cache;
};

export const anisotropicDiffusionGLAvailable = (): boolean => glAvailable();

export const renderAnisotropicDiffusionGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  iterations: number, kappa: number, lambda: number,
  conductanceIsExp: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);

  const src = ensureTexture(gl, "anisotropicDiffusion:src", width, height);
  uploadSourceTexture(gl, src, source);

  const pingA = ensureTexture(gl, "anisotropicDiffusion:A", width, height);
  const pingB = ensureTexture(gl, "anisotropicDiffusion:B", width, height);

  let readTex = src.tex;
  let writeTarget = pingA;
  let other = pingB;

  const runIter = (target: ReturnType<typeof ensureTexture>) => {
    drawPass(gl, target, width, height, cache.prog, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(cache.prog.uniforms.u_input, 0);
      gl.uniform2f(cache.prog.uniforms.u_res, width, height);
      gl.uniform1f(cache.prog.uniforms.u_kappa, kappa);
      gl.uniform1f(cache.prog.uniforms.u_lambda, lambda);
      gl.uniform1i(cache.prog.uniforms.u_conductance, conductanceIsExp ? 0 : 1);
    }, vao);
  };

  const iters = Math.max(1, Math.min(50, Math.round(iterations)));
  for (let i = 0; i < iters - 1; i++) {
    runIter(writeTarget);
    readTex = writeTarget.tex;
    const swap = writeTarget;
    writeTarget = other;
    other = swap;
  }

  // Final pass writes to default framebuffer.
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(cache.prog.uniforms.u_input, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_kappa, kappa);
    gl.uniform1f(cache.prog.uniforms.u_lambda, lambda);
    gl.uniform1i(cache.prog.uniforms.u_conductance, conductanceIsExp ? 0 : 1);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
