import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Per-channel median over a circular neighbourhood (radius ≤ 8 in the
// JS reference). We build a 256-bucket histogram per channel in-shader
// and scan for the bucket containing the median. That sidesteps
// sorting and scales cleanly up to the max radius.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_radius;

uint histR[256];
uint histG[256];
uint histB[256];

vec3 fetch(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;
}

int medianBucket(uint hist[256], int mid) {
  int acc = 0;
  for (int i = 0; i < 256; i++) {
    acc += int(hist[i]);
    if (acc > mid) return i;
  }
  return 255;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  for (int i = 0; i < 256; i++) { histR[i] = 0u; histG[i] = 0u; histB[i] = 0u; }

  int r = u_radius;
  int r2 = r * r;
  int count = 0;
  for (int ky = -8; ky <= 8; ky++) {
    if (ky < -r || ky > r) continue;
    for (int kx = -8; kx <= 8; kx++) {
      if (kx < -r || kx > r) continue;
      if (kx * kx + ky * ky > r2) continue;
      vec3 c = fetch(jsX + float(kx), jsY + float(ky));
      int rr = int(floor(c.r + 0.5));
      int gg = int(floor(c.g + 0.5));
      int bb = int(floor(c.b + 0.5));
      histR[clamp(rr, 0, 255)]++;
      histG[clamp(gg, 0, 255)]++;
      histB[clamp(bb, 0, 255)]++;
      count++;
    }
  }

  int mid = count / 2;
  float mr = float(medianBucket(histR, mid));
  float mg = float(medianBucket(histG, mid));
  float mb = float(medianBucket(histB, mid));
  vec4 srcC = texture(u_source, v_uv);
  fragColor = vec4(vec3(mr, mg, mb) / 255.0, srcC.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_res", "u_radius"] as const) };
  return _cache;
};

export const medianFilterGLAvailable = (): boolean => glAvailable();

export const renderMedianFilterGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  radius: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (radius > 8) return null;
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "medianFilter:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_radius, Math.max(1, Math.min(8, Math.round(radius))));
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
