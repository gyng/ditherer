import { RANGE, ENUM, BOOL, ACTION } from "constants/controlTypes";
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

const DIR = { HORIZONTAL: "HORIZONTAL", VERTICAL: "VERTICAL" };
const SCAN = { CENTER: "CENTER", LEFT: "LEFT", RIGHT: "RIGHT" };
const MAX_BYTES = 40 * 1024 * 1024; // 40MB cap on the array texture

export const optionTypes = {
  direction: {
    type: ENUM,
    options: [
      { name: "Horizontal (columns = time)", value: DIR.HORIZONTAL },
      { name: "Vertical (rows = time)", value: DIR.VERTICAL },
    ],
    default: DIR.HORIZONTAL,
    desc: "Whether columns or rows represent time slices",
  },
  depth: { type: RANGE, range: [2, 60], step: 1, default: 30, desc: "Frames of history to scan across" },
  reverse: { type: BOOL, default: false, desc: "Flip the time direction" },
  scanLine: {
    type: ENUM,
    options: [
      { name: "Center", value: SCAN.CENTER },
      { name: "Left / Top", value: SCAN.LEFT },
      { name: "Right / Bottom", value: SCAN.RIGHT },
    ],
    default: SCAN.CENTER,
    desc: "Which column/row captures the live slice",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  direction: optionTypes.direction.default,
  depth: optionTypes.depth.default,
  reverse: optionTypes.reverse.default,
  scanLine: optionTypes.scanLine.default,
  animSpeed: optionTypes.animSpeed.default,
};

type SlitScanOptions = FilterOptionValues & {
  direction?: string;
  depth?: number;
  reverse?: boolean;
  scanLine?: string;
  animSpeed?: number;
  _frameIndex?: number;
};

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2DArray u_frames;
uniform int u_filled;
uniform int u_capacity;
uniform int u_head;       // next-write index modulo capacity
uniform int u_horizontal; // 1 horizontal, 0 vertical
uniform int u_reverse;
uniform vec2 u_resolution;

void main() {
  if (u_filled <= 0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float slicePos = u_horizontal == 1 ? floor(v_uv.x * u_resolution.x) : floor(v_uv.y * u_resolution.y);
  float slices   = u_horizontal == 1 ? u_resolution.x : u_resolution.y;
  int frameOffset = int(floor(slicePos * float(u_filled - 1) / max(1.0, slices - 1.0)));
  int idx = u_reverse == 1 ? frameOffset : (u_filled - 1 - frameOffset);
  // Newest layer = (head - 1) mod capacity. Reading idx frames back:
  int newest = (u_head - 1 + u_capacity) - (((u_head - 1 + u_capacity) / u_capacity) * u_capacity);
  int layerSigned = newest - idx;
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
    "u_horizontal", "u_reverse", "u_resolution",
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

const slitScan = (input: any, options: SlitScanOptions = defaults) => {
  const direction = String(options.direction ?? defaults.direction);
  const reverse = Boolean(options.reverse ?? defaults.reverse);
  let depth = Number(options.depth ?? defaults.depth);
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const bytesPerFrame = W * H * 4;
  const maxDepth = Math.max(2, Math.floor(MAX_BYTES / bytesPerFrame));
  depth = Math.min(Math.max(2, Math.round(depth)), maxDepth);

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
    gl.uniform1i(prog.uniforms.u_horizontal, direction === DIR.HORIZONTAL ? 1 : 0);
    gl.uniform1i(prog.uniforms.u_reverse, reverse ? 1 : 0);
    gl.uniform2f(prog.uniforms.u_resolution, W, H);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Slit Scan", "WebGL2", `dir=${direction} depth=${depth}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Slit Scan",
  func: slitScan,
  optionTypes,
  options: defaults,
  defaults,
  description: "Each column/row shows a different point in time — surreal temporal stretching",
  temporal: true,
  requiresGL: true,
});
