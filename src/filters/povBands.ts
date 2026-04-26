import { RANGE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { logFilterBackend } from "utils";
import {
  drawPass,
  getGLCtx,
  getQuadVAO,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  type Program,
} from "gl";

const MAX_BYTES = 40 * 1024 * 1024; // 40MB cap on the array texture

export const optionTypes = {
  bands: { type: RANGE, range: [2, 20], step: 1, default: 8, desc: "Number of horizontal bands shown with different time offsets" },
  framesPerBand: { type: RANGE, range: [1, 10], step: 1, default: 3, desc: "How many frames older each band becomes than the one above it" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  bands: optionTypes.bands.default,
  framesPerBand: optionTypes.framesPerBand.default,
  animSpeed: optionTypes.animSpeed.default,
};

type PovBandsOptions = FilterOptionValues & {
  bands?: number;
  framesPerBand?: number;
  animSpeed?: number;
  _frameIndex?: number;
};

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2DArray u_frames;
uniform int   u_filled;
uniform int   u_capacity;
uniform int   u_head;
uniform int   u_bands;
uniform int   u_framesPerBand;
uniform vec2  u_resolution;

void main() {
  if (u_filled <= 0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float bandHeight = ceil(u_resolution.y / float(u_bands));
  float py = floor(v_uv.y * u_resolution.y);
  int band = int(min(float(u_bands - 1), floor(py / bandHeight)));
  int frameOffset = min(u_filled - 1, band * u_framesPerBand);
  int newest = (u_head - 1 + u_capacity) - (((u_head - 1 + u_capacity) / u_capacity) * u_capacity);
  int layerSigned = newest - frameOffset;
  int layer = (layerSigned + u_capacity * 64) - (((layerSigned + u_capacity * 64) / u_capacity) * u_capacity);
  fragColor = vec4(texture(u_frames, vec3(v_uv, float(layer))).rgb, 1.0);
}
`;

let _prog: Program | null = null;
let _arrTex: WebGLTexture | null = null;
let _ringW = 0;
let _ringH = 0;
let _ringDepth = 0;
let _ringHead = 0;
let _ringFilled = 0;

const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_frames", "u_filled", "u_capacity", "u_head",
    "u_bands", "u_framesPerBand", "u_resolution",
  ] as const);
  return _prog;
};

const ensureArrayTex = (gl: WebGL2RenderingContext, w: number, h: number, depth: number) => {
  if (_arrTex && _ringW === w && _ringH === h && _ringDepth === depth) return _arrTex;
  if (_arrTex) gl.deleteTexture(_arrTex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  _arrTex = tex;
  return tex;
};

const povBands = (input: any, options: PovBandsOptions = defaults) => {
  const bands = Math.max(2, Math.round(Number(options.bands ?? defaults.bands)));
  const framesPerBand = Math.max(1, Math.round(Number(options.framesPerBand ?? defaults.framesPerBand)));
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const desiredDepth = Math.max(2, bands * framesPerBand);
  const bytesPerFrame = W * H * 4;
  const maxDepth = Math.max(2, Math.floor(MAX_BYTES / bytesPerFrame));
  const depth = Math.min(desiredDepth, maxDepth);

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  if (_ringW !== W || _ringH !== H || _ringDepth !== depth || frameIndex === 0) {
    _ringW = W; _ringH = H; _ringDepth = depth;
    _ringHead = 0; _ringFilled = 0;
  }

  const arrTex = ensureArrayTex(gl, W, H, depth);
  if (!arrTex) return glUnavailableStub(W, H);

  const layer = _ringHead % depth;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, W, H, 1,
    gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
  _ringHead++;
  _ringFilled = Math.min(_ringFilled + 1, depth);

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
    gl.uniform1i(prog.uniforms.u_frames, 0);
    gl.uniform1i(prog.uniforms.u_filled, _ringFilled);
    gl.uniform1i(prog.uniforms.u_capacity, depth);
    gl.uniform1i(prog.uniforms.u_head, _ringHead);
    gl.uniform1i(prog.uniforms.u_bands, bands);
    gl.uniform1i(prog.uniforms.u_framesPerBand, framesPerBand);
    gl.uniform2f(prog.uniforms.u_resolution, W, H);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("POV Bands", "WebGL2", `bands=${bands} fpb=${framesPerBand}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "POV Bands",
  func: povBands,
  optionTypes,
  options: defaults,
  defaults,
  description: "Split the frame into horizontal bands that each show a different recent moment in time",
  temporal: true,
  requiresGL: true,
});
