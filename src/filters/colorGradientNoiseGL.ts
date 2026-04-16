import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Classic Perlin noise with a seed-driven permutation table. The perm
// table is generated on CPU (matching the JS reference exactly) and
// uploaded as a 512×1 R8 texture — the shader samples via texelFetch.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_perm;     // 512×1 R8, values 0..255
uniform vec2  u_res;
uniform float u_scale;
uniform vec3  u_color1;
uniform vec3  u_color2;
uniform float u_mix;

float fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

int permAt(int i) {
  // texelFetch returns float in [0, 1] for R8; scale back to the byte.
  return int(floor(texelFetch(u_perm, ivec2(i, 0), 0).r * 255.0 + 0.5));
}

float gradVal(int hash, float x, float y) {
  int h = hash & 3;
  float u = (h < 2) ? x : -x;
  float v = (h == 0 || h == 3) ? y : -y;
  return u + v;
}

float perlin(float px, float py) {
  int X = int(floor(px)) & 255;
  int Y = int(floor(py)) & 255;
  float xf = px - floor(px);
  float yf = py - floor(py);
  float u = fade(xf);
  float v = fade(yf);
  int aa = permAt(permAt(X) + Y);
  int ab = permAt(permAt(X) + Y + 1);
  int ba = permAt(permAt(X + 1) + Y);
  int bb = permAt(permAt(X + 1) + Y + 1);
  float lx0 = mix(gradVal(aa, xf, yf),       gradVal(ba, xf - 1.0, yf),       u);
  float lx1 = mix(gradVal(ab, xf, yf - 1.0), gradVal(bb, xf - 1.0, yf - 1.0), u);
  return (mix(lx0, lx1, v) + 1.0) * 0.5;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb * 255.0;
  float n = perlin(jsX / u_scale, jsY / u_scale);
  vec3 noiseCol = mix(u_color1, u_color2, n);
  vec3 outRgb = clamp(floor(src * (1.0 - u_mix) + noiseCol * u_mix + 0.5), 0.0, 255.0);
  fragColor = vec4(outRgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program; permTex: WebGLTexture | null; permSeed: number };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source", "u_perm", "u_res", "u_scale", "u_color1", "u_color2", "u_mix",
    ] as const),
    permTex: null,
    permSeed: NaN,
  };
  return _cache;
};

// Matches the JS reference's seeded Fisher-Yates.
const buildPerm = (seed: number): Uint8Array => {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
};

export const colorGradientNoiseGLAvailable = (): boolean => glAvailable();

export const renderColorGradientNoiseGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  scale: number,
  color1: [number, number, number], color2: [number, number, number],
  mix: number, seed: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);

  if (cache.permTex === null || cache.permSeed !== seed) {
    if (cache.permTex) gl.deleteTexture(cache.permTex);
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 512, 1, 0, gl.RED, gl.UNSIGNED_BYTE, buildPerm(seed));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Restore source-upload default.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    cache.permTex = tex;
    cache.permSeed = seed;
  }

  const sourceTex = ensureTexture(gl, "colorGradientNoise:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cache.permTex as WebGLTexture);
    gl.uniform1i(cache.prog.uniforms.u_perm, 1);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_scale, scale);
    gl.uniform3f(cache.prog.uniforms.u_color1, color1[0], color1[1], color1[2]);
    gl.uniform3f(cache.prog.uniforms.u_color2, color2[0], color2[1], color2[2]);
    gl.uniform1f(cache.prog.uniforms.u_mix, mix);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
