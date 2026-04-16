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

// Freeze-frame glitch. CPU owns the freeze grid (mutable state that evolves
// across frames) and uploads it as a small R8 texture; prevOutput uploaded
// as an RGBA8 texture. Shader does a per-pixel lookup: for each block, if
// the freeze flag is set use prevOutput, else source. Supports
// channelIndependent mode where R/G/B each have their own flag.
const FREEZE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_prevOutput;
uniform sampler2D u_freezeGrid;    // R channel: 0 = thawed, 255 = frozen
uniform int   u_hasPrev;
uniform vec2  u_res;
uniform int   u_blockSize;
uniform int   u_blocksX;
uniform int   u_blocksY;
uniform int   u_channelIndependent;

// Sample the freeze grid at (blockIdx, channel); channel is always 0 in
// unified mode, 0/1/2 for RGB in channel-independent mode.
float getFreeze(int blockIdx, int channel) {
  int w = u_channelIndependent == 1 ? u_blocksX * 3 : u_blocksX;
  int col = u_channelIndependent == 1 ? blockIdx * 3 + channel : blockIdx;
  int row = col / w;
  int x = col - row * w;
  vec2 uv = vec2((float(x) + 0.5) / float(w), (float(row) + 0.5) / float(u_blocksY));
  return texture(u_freezeGrid, uv).r;
}

void main() {
  vec2 px = v_uv * u_res;
  int xo = int(floor(px.x));
  int yo_js = int(u_res.y) - 1 - int(floor(px.y));
  int bx = xo / u_blockSize;
  int by = yo_js / u_blockSize;
  bx = min(bx, u_blocksX - 1);
  by = min(by, u_blocksY - 1);
  int blockIdx = by * u_blocksX + bx;

  vec2 suv = vec2((float(xo) + 0.5) / u_res.x, 1.0 - (float(yo_js) + 0.5) / u_res.y);
  vec4 src = texture(u_source, suv);
  vec4 prev = u_hasPrev == 1 ? texture(u_prevOutput, suv) : src;

  vec3 out3;
  if (u_channelIndependent == 1 && u_hasPrev == 1) {
    float fR = getFreeze(blockIdx, 0);
    float fG = getFreeze(blockIdx, 1);
    float fB = getFreeze(blockIdx, 2);
    out3 = vec3(
      fR > 0.5 ? prev.r : src.r,
      fG > 0.5 ? prev.g : src.g,
      fB > 0.5 ? prev.b : src.b
    );
  } else {
    float f = getFreeze(blockIdx, 0);
    out3 = (f > 0.5 && u_hasPrev == 1) ? prev.rgb : src.rgb;
  }

  fragColor = vec4(out3, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FREEZE_FS, [
      "u_source", "u_prevOutput", "u_freezeGrid", "u_hasPrev",
      "u_res", "u_blockSize", "u_blocksX", "u_blocksY", "u_channelIndependent",
    ] as const),
  };
  return _cache;
};

export const freezeFrameGlitchGLAvailable = (): boolean => glAvailable();

const uploadFreezeGrid = (
  gl: WebGL2RenderingContext,
  grid: Uint8Array,
  blocksX: number,
  blocksY: number,
  channelIndependent: boolean,
): WebGLTexture | null => {
  const tex = gl.createTexture();
  if (!tex) return null;
  // Pack row-major: blocksX*3 if channelIndependent, blocksX otherwise.
  const w = channelIndependent ? blocksX * 3 : blocksX;
  const h = blocksY;
  if (grid.length < w * h) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  // Single-channel R8 rows aren't 4-byte aligned unless w happens to be a
  // multiple of 4; default UNPACK_ALIGNMENT=4 then makes the driver read
  // past the end of `data` and throw INVALID_OPERATION. Force 1-byte rows.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = grid[i] ? 255 : 0;
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return tex;
};

const uploadPrevOutput = (
  gl: WebGL2RenderingContext,
  data: Uint8ClampedArray,
  w: number,
  h: number,
): WebGLTexture | null => {
  if (data.byteLength !== w * h * 4) return null;
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return tex;
};

export const renderFreezeFrameGlitchGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  blockSize: number,
  blocksX: number,
  blocksY: number,
  freezeGrid: Uint8Array,
  channelIndependent: boolean,
  prevOutput: Uint8ClampedArray | null,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "freezeFrameGlitch:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const gridTex = uploadFreezeGrid(gl, freezeGrid, blocksX, blocksY, channelIndependent);
  if (!gridTex) return null;
  const prevTex = prevOutput ? uploadPrevOutput(gl, prevOutput, width, height) : null;

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevTex ?? sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_prevOutput, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, gridTex);
    gl.uniform1i(cache.prog.uniforms.u_freezeGrid, 2);
    gl.uniform1i(cache.prog.uniforms.u_hasPrev, prevTex ? 1 : 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_blockSize, blockSize);
    gl.uniform1i(cache.prog.uniforms.u_blocksX, blocksX);
    gl.uniform1i(cache.prog.uniforms.u_blocksY, blocksY);
    gl.uniform1i(cache.prog.uniforms.u_channelIndependent, channelIndependent ? 1 : 0);
  }, vao);

  const out = readoutToCanvas(canvas, width, height);
  gl.deleteTexture(gridTex);
  if (prevTex) gl.deleteTexture(prevTex);
  return out;
};
