import { ACTION, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import {
  cloneCanvas,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import {
  drawPass,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  type Program,
} from "gl";

let historyFrames: Uint8ClampedArray[] = [];
let historyHead = 0;
let historyWidth = 0;
let historyHeight = 0;
let historyDepth = 0;
let lastFrameIndex = -1;

const resetHistory = (width: number, height: number, depth: number) => {
  historyFrames = [];
  historyHead = 0;
  historyWidth = width;
  historyHeight = height;
  historyDepth = depth;
};

const insertionSort = (values: number[], length: number) => {
  for (let i = 1; i < length; i++) {
    const value = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > value) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = value;
  }
};

const medianFromHistory = (
  frames: Uint8ClampedArray[],
  filled: number,
  pixelIndex: number,
  scratch: number[]
) => {
  for (let i = 0; i < filled; i++) {
    scratch[i] = frames[i][pixelIndex];
  }
  insertionSort(scratch, filled);
  return scratch[Math.floor(filled * 0.5)];
};

export const optionTypes = {
  windowSize: {
    type: RANGE,
    range: [3, 9],
    step: 2,
    default: 5,
    desc: "How many recent frames participate in the temporal median consensus",
  },
  animSpeed: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 15,
    desc: "Playback speed when using the built-in animation toggle",
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  windowSize: optionTypes.windowSize.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalMedianOptions = FilterOptionValues & {
  windowSize?: number;
  animSpeed?: number;
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

// One TEXTURE_2D_ARRAY with 9 layers holds the recent frames; each frame we
// texSubImage3D into the (head % N) layer and sample all `filled` layers in
// the shader to take a per-pixel, per-channel median.
const MAX_WINDOW = 9;
const TMED_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2DArray u_frames;
uniform int  u_filled;

void sortInPlace(inout float v[${MAX_WINDOW}], int n) {
  for (int i = 1; i < ${MAX_WINDOW}; i++) {
    if (i >= n) break;
    float x = v[i];
    int j = i - 1;
    for (int k = 0; k < ${MAX_WINDOW}; k++) {
      if (j < 0) break;
      if (v[j] <= x) break;
      v[j + 1] = v[j];
      j--;
    }
    v[j + 1] = x;
  }
}

void main() {
  float vr[${MAX_WINDOW}];
  float vg[${MAX_WINDOW}];
  float vb[${MAX_WINDOW}];
  float a = 0.0;
  for (int i = 0; i < ${MAX_WINDOW}; i++) {
    if (i >= u_filled) break;
    vec4 s = texture(u_frames, vec3(v_uv, float(i)));
    vr[i] = s.r;
    vg[i] = s.g;
    vb[i] = s.b;
    if (i == u_filled - 1) a = s.a;
  }
  sortInPlace(vr, u_filled);
  sortInPlace(vg, u_filled);
  sortInPlace(vb, u_filled);
  int mid = u_filled / 2;
  // GLSL array[int] — use pick loop to dodge driver quirks on arbitrary index.
  float r = 0.0, g = 0.0, b = 0.0;
  for (int i = 0; i < ${MAX_WINDOW}; i++) {
    if (i == mid) { r = vr[i]; g = vg[i]; b = vb[i]; }
  }
  fragColor = vec4(r, g, b, a);
}
`;

type Cache = { prog: Program; tex: WebGLTexture | null; w: number; h: number; depth: number };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  const prog = linkProgram(gl, TMED_FS, ["u_frames", "u_filled"] as const);
  _cache = { prog, tex: null, w: 0, h: 0, depth: 0 };
  return _cache;
};

const ensureArrayTex = (gl: WebGL2RenderingContext, cache: Cache, w: number, h: number) => {
  if (cache.tex && cache.w === w && cache.h === h && cache.depth === MAX_WINDOW) return cache.tex;
  if (cache.tex) gl.deleteTexture(cache.tex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, MAX_WINDOW, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  cache.tex = tex;
  cache.w = w;
  cache.h = h;
  cache.depth = MAX_WINDOW;
  return tex;
};

// Persistent upload state for the array texture.
let glHistoryHead = 0;
let glHistoryFilled = 0;
let glHistoryW = 0;
let glHistoryH = 0;

const temporalMedian = (input: any, options: TemporalMedianOptions = defaults) => {
  const windowSize = Math.max(3, Math.round(Number(options.windowSize ?? defaults.windowSize)));
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width;
  const H = input.height;

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const arrTex = ensureArrayTex(gl, cache, W, H);
      if (arrTex) {
        const restartedAnimation = frameIndex === 0 && lastFrameIndex > 0;
        if (glHistoryW !== W || glHistoryH !== H || restartedAnimation) {
          glHistoryW = W; glHistoryH = H;
          glHistoryHead = 0;
          glHistoryFilled = 0;
        }
        lastFrameIndex = frameIndex;

        // Upload the current input as the next history layer.
        const layer = glHistoryHead % MAX_WINDOW;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY, 0,
          0, 0, layer,
          W, H, 1,
          gl.RGBA, gl.UNSIGNED_BYTE,
          input as TexImageSource,
        );
        glHistoryHead++;
        glHistoryFilled = Math.min(glHistoryFilled + 1, MAX_WINDOW);
        const filled = Math.min(glHistoryFilled, windowSize);

        drawPass(gl, null, W, H, cache.prog, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
          gl.uniform1i(cache.prog.uniforms.u_frames, 0);
          gl.uniform1i(cache.prog.uniforms.u_filled, filled);
        }, vao);

        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          logFilterBackend("Time Median", "WebGL2", `window=${windowSize} filled=${filled}`);
          return rendered;
        }
      }
    }
  }

  logFilterWasmStatus("Time Median", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const source = inputCtx.getImageData(0, 0, W, H).data;
  const restartedAnimation = frameIndex === 0 && lastFrameIndex > 0;

  if (
    historyWidth !== W ||
    historyHeight !== H ||
    historyDepth !== windowSize ||
    restartedAnimation
  ) {
    resetHistory(W, H, windowSize);
  }
  lastFrameIndex = frameIndex;

  historyFrames[historyHead % windowSize] = new Uint8ClampedArray(source);
  historyHead += 1;

  const filled = Math.min(historyHead, windowSize);
  const activeFrames = historyFrames.slice(0, filled);
  const outBuf = new Uint8ClampedArray(source.length);
  const scratchR = new Array<number>(filled);
  const scratchG = new Array<number>(filled);
  const scratchB = new Array<number>(filled);

  for (let i = 0; i < source.length; i += 4) {
    outBuf[i] = medianFromHistory(activeFrames, filled, i, scratchR);
    outBuf[i + 1] = medianFromHistory(activeFrames, filled, i + 1, scratchG);
    outBuf[i + 2] = medianFromHistory(activeFrames, filled, i + 2, scratchB);
    outBuf[i + 3] = source[i + 3];
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Time Median",
  func: temporalMedian,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Take the per-pixel median across recent frames to suppress brief motion and flicker while preserving stable structure",
});
