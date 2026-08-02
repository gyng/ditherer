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
} from "../gl/index";

// Perona–Malik anisotropic diffusion with RGBA16F iteration storage. A shared
// vector-gradient conductance keeps RGB channels registered; alpha gates flux
// and is restored exactly from the original source in the final pass.
const DIFFUSE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform float u_kappa;
uniform float u_lambda;
uniform int   u_conductance;  // 0 = exp, 1 = quadratic

float conductance(float grad) {
  float t = grad / u_kappa;
  return u_conductance == 0 ? exp(-(t * t)) : 1.0 / (1.0 + t * t);
}

vec4 sampleAt(vec2 uv) {
  uv = clamp(uv, vec2(0.5) / u_res, vec2(1.0) - vec2(0.5) / u_res);
  return texture(u_input, uv);
}

void main() {
  vec4 center = texture(u_input, v_uv);
  vec4 n = sampleAt(v_uv + vec2(0.0,  1.0 / u_res.y));
  vec4 s = sampleAt(v_uv + vec2(0.0, -1.0 / u_res.y));
  vec4 w = sampleAt(v_uv + vec2(-1.0 / u_res.x, 0.0));
  vec4 e = sampleAt(v_uv + vec2( 1.0 / u_res.x, 0.0));
  vec3 dN = n.rgb - center.rgb;
  vec3 dS = s.rgb - center.rgb;
  vec3 dW = w.rgb - center.rgb;
  vec3 dE = e.rgb - center.rgb;
  float centerVisible = step(0.5 / 255.0, center.a);
  float wN = centerVisible * step(0.5 / 255.0, n.a) * min(center.a, n.a);
  float wS = centerVisible * step(0.5 / 255.0, s.a) * min(center.a, s.a);
  float wW = centerVisible * step(0.5 / 255.0, w.a) * min(center.a, w.a);
  float wE = centerVisible * step(0.5 / 255.0, e.a) * min(center.a, e.a);
  float gN = length(dN) * (255.0 / sqrt(3.0));
  float gS = length(dS) * (255.0 / sqrt(3.0));
  float gW = length(dW) * (255.0 / sqrt(3.0));
  float gE = length(dE) * (255.0 / sqrt(3.0));
  vec3 next = center.rgb + u_lambda * (
    wN * conductance(gN) * dN + wS * conductance(gS) * dS
    + wW * conductance(gW) * dW + wE * conductance(gE) * dE
  );
  fragColor = vec4(clamp(next, 0.0, 1.0), center.a);
}
`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_diffused;
uniform sampler2D u_source;
void main() {
  vec3 rgb = texture(u_diffused, v_uv).rgb;
  float alpha = texture(u_source, v_uv).a;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), alpha);
}
`;

type Cache = { prog: Program; composite: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, DIFFUSE_FS, [
      "u_input",
      "u_res",
      "u_kappa",
      "u_lambda",
      "u_conductance",
    ] as const),
    composite: linkProgram(gl, COMPOSITE_FS, ["u_diffused", "u_source"] as const),
  };
  return _cache;
};

export const anisotropicDiffusionGLAvailable = (): boolean => glAvailable();

export const renderAnisotropicDiffusionGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  iterations: number,
  kappa: number,
  lambda: number,
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

  const pingA = ensureFloatTexture(gl, "anisotropicDiffusion:A16f", width, height);
  const pingB = ensureFloatTexture(gl, "anisotropicDiffusion:B16f", width, height);
  if (!pingA || !pingB) return null;

  let readTex = src.tex;
  let writeTarget = pingA;
  let other = pingB;

  const runIter = (target: ReturnType<typeof ensureTexture>) => {
    drawPass(
      gl,
      target,
      width,
      height,
      cache.prog,
      () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, readTex);
        gl.uniform1i(cache.prog.uniforms.u_input, 0);
        gl.uniform2f(cache.prog.uniforms.u_res, width, height);
        gl.uniform1f(cache.prog.uniforms.u_kappa, kappa);
        gl.uniform1f(cache.prog.uniforms.u_lambda, lambda);
        gl.uniform1i(cache.prog.uniforms.u_conductance, conductanceIsExp ? 0 : 1);
      },
      vao,
    );
  };

  const iters = Math.max(1, Math.min(50, Math.round(iterations)));
  for (let i = 0; i < iters; i++) {
    runIter(writeTarget);
    readTex = writeTarget.tex;
    const swap = writeTarget;
    writeTarget = other;
    other = swap;
  }

  drawPass(
    gl,
    null,
    width,
    height,
    cache.composite,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(cache.composite.uniforms.u_diffused, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(cache.composite.uniforms.u_source, 1);
    },
    vao,
  );

  return readoutToCanvas(canvas, width, height);
};
