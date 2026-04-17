import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// "Decode the image as if it were a JPEG with the wrong metadata":
// encode RGB→YCbCr (Rec.601 encode matrix), then decode back with a
// caller-chosen matrix / range / gamma / chroma-placement policy.
// One-tap chroma left-shift lookup matches the JS reference.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_matrix;      // 0 REC601, 1 REC709, 2 REC2020
uniform int   u_range;       // 0 FULL, 1 LIMITED
uniform int   u_chroma;      // 0 CENTER, 1 LEFT
uniform float u_gamma;
uniform float u_recoveryMix;

vec3 ycbcrAt(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  vec3 rgb = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;
  float yy = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  float cb = 128.0 - 0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b;
  float cr = 128.0 + 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;
  return vec3(yy, cb, cr);
}

vec3 decodeYcbcr(float yy, float cb, float cr) {
  float ccb = cb - 128.0;
  float ccr = cr - 128.0;
  if (u_matrix == 1) {  // REC709
    return vec3(
      yy + 1.5748 * ccr,
      yy - 0.187324 * ccb - 0.468124 * ccr,
      yy + 1.8556 * ccb
    );
  }
  if (u_matrix == 2) {  // REC2020
    return vec3(
      yy + 1.4746 * ccr,
      yy - 0.164553 * ccb - 0.571353 * ccr,
      yy + 1.8814 * ccb
    );
  }
  return vec3(  // REC601
    yy + 1.402 * ccr,
    yy - 0.344136 * ccb - 0.714136 * ccr,
    yy + 1.772 * ccb
  );
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec3 ycc = ycbcrAt(jsX, jsY);
  float yy = ycc.r;
  float cb = ycc.g;
  float cr = ycc.b;

  if (u_chroma == 1 && jsX > 0.0) {
    vec3 leftYcc = ycbcrAt(jsX - 1.0, jsY);
    cb = leftYcc.g;
    cr = leftYcc.b;
  }

  if (u_range == 1) {  // LIMITED
    yy = (yy - 16.0) * (255.0 / 219.0);
    cb = 128.0 + (cb - 128.0) * (255.0 / 224.0);
    cr = 128.0 + (cr - 128.0) * (255.0 / 224.0);
  }

  vec3 rgb = clamp(decodeYcbcr(yy, cb, cr), 0.0, 255.0);

  float gamma = max(0.05, u_gamma);
  rgb = pow(rgb / 255.0, vec3(1.0 / gamma)) * 255.0;

  vec4 srcC = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y));
  vec3 src255 = srcC.rgb * 255.0;
  rgb = mix(rgb, src255, u_recoveryMix);
  rgb = clamp(floor(rgb + 0.5), 0.0, 255.0);

  fragColor = vec4(rgb / 255.0, srcC.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_matrix", "u_range", "u_chroma",
    "u_gamma", "u_recoveryMix",
  ] as const) };
  return _cache;
};

export const metadataMismatchDecodeGLAvailable = (): boolean => glAvailable();

export const renderMetadataMismatchDecodeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  matrixInt: number, rangeInt: number, chromaInt: number,
  gamma: number, recoveryMix: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "metadataMismatchDecode:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_matrix, matrixInt);
    gl.uniform1i(cache.prog.uniforms.u_range, rangeInt);
    gl.uniform1i(cache.prog.uniforms.u_chroma, chromaInt);
    gl.uniform1f(cache.prog.uniforms.u_gamma, gamma);
    gl.uniform1f(cache.prog.uniforms.u_recoveryMix, recoveryMix);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
