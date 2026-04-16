import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Circular structuring element, picks the pixel in the disk with the
// highest (dilate) or lowest (erode) luminance. Kernel is symmetric so
// sampling direction (UV vs JS-y) doesn't affect the result — the same
// shader handles both the source→intermediate and intermediate→output
// passes used by OPEN/CLOSE.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform int   u_radius;
uniform int   u_isDilate;   // 1 = dilate (max lum), 0 = erode (min lum)

void main() {
  vec4 best = texture(u_input, v_uv);
  float bestLum = u_isDilate == 1 ? -1.0 : 1e9;
  int r = u_radius;
  for (int ky = -10; ky <= 10; ky++) {
    if (ky < -r || ky > r) continue;
    for (int kx = -10; kx <= 10; kx++) {
      if (kx < -r || kx > r) continue;
      if (kx * kx + ky * ky > r * r) continue;
      vec2 off = vec2(float(kx), float(ky)) / u_res;
      vec2 uv = clamp(v_uv + off, vec2(0.5) / u_res, vec2(1.0) - vec2(0.5) / u_res);
      vec4 c = texture(u_input, uv);
      float lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      if ((u_isDilate == 1 && lum > bestLum) || (u_isDilate == 0 && lum < bestLum)) {
        bestLum = lum;
        best = c;
      }
    }
  }
  fragColor = best;
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_input", "u_res", "u_radius", "u_isDilate"] as const) };
  return _cache;
};

export const morphologyGLAvailable = (): boolean => glAvailable();

export type MorphMode = "DILATE" | "ERODE" | "OPEN" | "CLOSE";

export const renderMorphologyGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  mode: MorphMode, radius: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);

  const input = ensureTexture(gl, "morph:input", width, height);
  uploadSourceTexture(gl, input, source);

  const runPass = (
    srcTex: WebGLTexture,
    target: ReturnType<typeof ensureTexture> | null,
    isDilate: boolean,
  ) => {
    drawPass(gl, target, width, height, cache.prog, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(cache.prog.uniforms.u_input, 0);
      gl.uniform2f(cache.prog.uniforms.u_res, width, height);
      gl.uniform1i(cache.prog.uniforms.u_radius, radius);
      gl.uniform1i(cache.prog.uniforms.u_isDilate, isDilate ? 1 : 0);
    }, vao);
  };

  if (mode === "DILATE" || mode === "ERODE") {
    runPass(input.tex, null, mode === "DILATE");
  } else {
    // OPEN = erode → dilate, CLOSE = dilate → erode
    const temp = ensureTexture(gl, "morph:temp", width, height);
    const firstIsDilate = mode === "CLOSE";
    runPass(input.tex, temp, firstIsDilate);
    runPass(temp.tex, null, !firstIsDilate);
  }

  return readoutToCanvas(canvas, width, height);
};
