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
} from "gl";

// CLAHE apply pass: the per-tile histogram/CDF build is tricky on GPU
// (requires atomics or multi-pass reductions) so that stays on the CPU.
// The bottleneck — a bilinear-interpolated CDF lookup for every output
// pixel — maps cleanly to a fragment shader. CDFs are packed into a
// 256-wide × (tilesX*tilesY)-tall R channel texture; the shader samples
// 4 neighbouring tile CDFs and blends.
const CLAHE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_cdfs;          // R-channel packed CDFs
uniform vec2  u_res;
uniform float u_tileSize;
uniform int   u_tilesX;
uniform int   u_tilesY;

float sampleCdf(int tx, int ty, float lum255) {
  int t = ty * u_tilesX + tx;
  // 256 wide, packed vertically by tile index. Use texel-centre UV.
  vec2 uv = vec2((lum255 + 0.5) / 256.0,
                 (float(t) + 0.5) / float(u_tilesX * u_tilesY));
  return texture(u_cdfs, uv).r * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y space for tile indexing. For source sampling we can read v_uv
  // directly since UNPACK_FLIP_Y aligns output JS-row with the sampled row.
  float y = u_res.y - 1.0 - floor(px.y);

  vec4 src = texture(u_source, (floor(px) + 0.5) / u_res);
  // Luminance quantised to integer to match JS Math.round.
  float lumF = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  float l255 = floor(lumF * 255.0 + 0.5);

  float txf = (x + 0.5) / u_tileSize - 0.5;
  float tyf = (y + 0.5) / u_tileSize - 0.5;
  int tx0 = int(max(0.0, floor(txf)));
  int ty0 = int(max(0.0, floor(tyf)));
  int tx1 = min(u_tilesX - 1, tx0 + 1);
  int ty1 = min(u_tilesY - 1, ty0 + 1);
  float fx = clamp(txf - float(tx0), 0.0, 1.0);
  float fy = clamp(tyf - float(ty0), 0.0, 1.0);

  float v00 = sampleCdf(tx0, ty0, l255);
  float v10 = sampleCdf(tx1, ty0, l255);
  float v01 = sampleCdf(tx0, ty1, l255);
  float v11 = sampleCdf(tx1, ty1, l255);
  float mapped = v00 * (1.0 - fx) * (1.0 - fy)
               + v10 * fx * (1.0 - fy)
               + v01 * (1.0 - fx) * fy
               + v11 * fx * fy;

  float scale = l255 > 0.0 ? mapped / l255 : 1.0;
  vec3 rgb = clamp(src.rgb * 255.0 * scale, 0.0, 255.0) / 255.0;
  fragColor = vec4(rgb, src.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, CLAHE_FS, [
      "u_source", "u_cdfs", "u_res", "u_tileSize", "u_tilesX", "u_tilesY",
    ] as const),
  };
  return _cache;
};

export const claheGLAvailable = (): boolean => glAvailable();

// Upload CDFs as RGBA8 with the CDF value in R (G/B/A ignored). 256-wide row
// per tile, one row per tile ordered (ty*tilesX + tx). Texture stays resident
// across frames but is re-uploaded each call since the CDFs are input-specific.
const uploadCdfs = (
  gl: WebGL2RenderingContext,
  cdfs: Uint8Array[],
  tilesX: number,
  tilesY: number,
): { tex: WebGLTexture; w: number; h: number } | null => {
  const w = 256;
  const h = tilesX * tilesY;
  if (h === 0) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  // Pack into an RGBA8 buffer — UNPACK_FLIP_Y_WEBGL is sticky-enabled, so
  // temporarily disable it for this non-image data.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const data = new Uint8Array(w * h * 4);
  for (let t = 0; t < cdfs.length; t++) {
    const cdf = cdfs[t];
    for (let i = 0; i < 256; i++) {
      data[(t * w + i) * 4] = cdf[i];
      data[(t * w + i) * 4 + 3] = 255;
    }
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return { tex, w, h };
};

export const renderClaheGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  tileSize: number,
  cdfs: Uint8Array[],
  tilesX: number,
  tilesY: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "clahe:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const cdfTex = uploadCdfs(gl, cdfs, tilesX, tilesY);
  if (!cdfTex) return null;

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cdfTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_cdfs, 1);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_tileSize, tileSize);
    gl.uniform1i(cache.prog.uniforms.u_tilesX, tilesX);
    gl.uniform1i(cache.prog.uniforms.u_tilesY, tilesY);
  }, vao);

  const out = readoutToCanvas(canvas, width, height);
  gl.deleteTexture(cdfTex.tex);
  return out;
};
