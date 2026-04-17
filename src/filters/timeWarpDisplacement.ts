import { RANGE, ENUM, ACTION } from "constants/controlTypes";
import {
  cloneCanvas,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";
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

const SOURCE = {
  LUMINANCE: "LUMINANCE",
  X: "X",
  Y: "Y"
};

const DIRECTION = {
  BRIGHT_RECENT: "BRIGHT_RECENT",
  BRIGHT_OLDEST: "BRIGHT_OLDEST"
};

const SOURCE_ID: Record<string, number> = { LUMINANCE: 0, X: 1, Y: 2 };

let ringBuf: Uint8ClampedArray[] = [];
let ringHead = 0;
let ringW = 0;
let ringH = 0;
let ringDepth = 0;

export const optionTypes = {
  depth: { type: RANGE, range: [4, 30], step: 1, default: 16, desc: "How many frames of history the warp can sample across" },
  source: {
    type: ENUM,
    options: [
      { name: "Luminance", value: SOURCE.LUMINANCE },
      { name: "Position X", value: SOURCE.X },
      { name: "Position Y", value: SOURCE.Y }
    ],
    default: SOURCE.LUMINANCE,
    desc: "What drives the per-pixel frame delay"
  },
  direction: {
    type: ENUM,
    options: [
      { name: "Bright = recent", value: DIRECTION.BRIGHT_RECENT },
      { name: "Bright = oldest", value: DIRECTION.BRIGHT_OLDEST }
    ],
    default: DIRECTION.BRIGHT_RECENT,
    desc: "How the driver maps into older or newer history"
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  depth: optionTypes.depth.default,
  source: optionTypes.source.default,
  direction: optionTypes.direction.default,
  animSpeed: optionTypes.animSpeed.default,
};

const TW_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2DArray u_frames;
uniform vec2  u_res;
uniform int   u_filled;
uniform int   u_head;       // ringHead (next write slot)
uniform int   u_depth;
uniform int   u_source;     // 0 LUMINANCE, 1 X, 2 Y
uniform int   u_invert;     // 1 = bright→oldest

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Current frame for driving value.
  int newestLayer = ((u_head - 1) % u_depth + u_depth) % u_depth;
  vec4 cur = texture(u_frames, vec3(v_uv, float(newestLayer)));

  float t;
  if (u_source == 1) t = x / max(1.0, u_res.x - 1.0);
  else if (u_source == 2) t = y / max(1.0, u_res.y - 1.0);
  else t = 0.2126 * cur.r + 0.7152 * cur.g + 0.0722 * cur.b;

  if (u_invert == 1) t = 1.0 - t;

  int offset = int(min(float(u_filled - 1), floor(t * float(u_filled - 1) + 0.5)));
  int layer = ((u_head - 1 - offset) % u_depth + u_depth) % u_depth;
  fragColor = vec4(texture(u_frames, vec3(v_uv, float(layer))).rgb, 1.0);
}
`;

type GLCache = { prog: Program; tex: WebGLTexture | null; w: number; h: number; depth: number };
let _glCache: GLCache | null = null;

const initGLCache = (gl: WebGL2RenderingContext): GLCache => {
  if (_glCache) return _glCache;
  const prog = linkProgram(gl, TW_FS, [
    "u_frames", "u_res", "u_filled", "u_head", "u_depth", "u_source", "u_invert",
  ] as const);
  _glCache = { prog, tex: null, w: 0, h: 0, depth: 0 };
  return _glCache;
};

const ensureArrayTex = (gl: WebGL2RenderingContext, cache: GLCache, w: number, h: number, depth: number) => {
  if (cache.tex && cache.w === w && cache.h === h && cache.depth === depth) return cache.tex;
  if (cache.tex) gl.deleteTexture(cache.tex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  cache.tex = tex;
  cache.w = w;
  cache.h = h;
  cache.depth = depth;
  return tex;
};

let glRingHead = 0;
let glRingFilled = 0;
let glRingW = 0;
let glRingH = 0;
let glRingDepth = 0;

const timeWarpDisplacement = (input: any, options = defaults) => {
  const { depth, source, direction } = options;
  const W = input.width, H = input.height;
  const invert = direction === DIRECTION.BRIGHT_OLDEST;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initGLCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const arrTex = ensureArrayTex(gl, cache, W, H, depth);
      if (arrTex) {
        if (glRingW !== W || glRingH !== H || glRingDepth !== depth) {
          glRingW = W; glRingH = H; glRingDepth = depth;
          glRingHead = 0; glRingFilled = 0;
        }

        const layer = glRingHead % depth;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY, 0,
          0, 0, layer,
          W, H, 1,
          gl.RGBA, gl.UNSIGNED_BYTE,
          input as TexImageSource,
        );
        glRingHead++;
        glRingFilled = Math.min(glRingFilled + 1, depth);

        drawPass(gl, null, W, H, cache.prog, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
          gl.uniform1i(cache.prog.uniforms.u_frames, 0);
          gl.uniform2f(cache.prog.uniforms.u_res, W, H);
          gl.uniform1i(cache.prog.uniforms.u_filled, glRingFilled);
          gl.uniform1i(cache.prog.uniforms.u_head, glRingHead);
          gl.uniform1i(cache.prog.uniforms.u_depth, depth);
          gl.uniform1i(cache.prog.uniforms.u_source, SOURCE_ID[source] ?? 0);
          gl.uniform1i(cache.prog.uniforms.u_invert, invert ? 1 : 0);
        }, vao);

        const rendered = readoutToCanvas(canvas, W, H);
        if (rendered) {
          logFilterBackend("Time-warp Displacement", "WebGL2",
            `${source} depth=${depth} filled=${glRingFilled}`);
          return rendered;
        }
      }
    }
  }

  logFilterWasmStatus("Time-warp Displacement", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;

  if (ringW !== W || ringH !== H || ringDepth !== depth) {
    ringBuf = [];
    ringHead = 0;
    ringW = W;
    ringH = H;
    ringDepth = depth;
  }

  ringBuf[ringHead % depth] = new Uint8ClampedArray(buf);
  ringHead++;
  const filled = Math.min(ringHead, depth);
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let t = source === SOURCE.X
        ? x / Math.max(1, W - 1)
        : source === SOURCE.Y
          ? y / Math.max(1, H - 1)
          : (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;

      if (invert) t = 1 - t;

      const frameOffset = Math.min(filled - 1, Math.round(t * (filled - 1)));
      const frame = ringBuf[((ringHead - 1 - frameOffset) % depth + depth) % depth] || buf;
      outBuf[i] = frame[i];
      outBuf[i + 1] = frame[i + 1];
      outBuf[i + 2] = frame[i + 2];
      outBuf[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Time-warp Displacement", func: timeWarpDisplacement, optionTypes, options: defaults, defaults, description: "Sample different moments from recent history on a per-pixel basis for surreal time-sliced motion warping" });
