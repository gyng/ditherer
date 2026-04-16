import { RANGE, COLOR, PALETTE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
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

export const optionTypes = {
  angle: { type: RANGE, range: [-180, 180], step: 1, default: 15, desc: "Rotation angle in degrees" },
  spinPerFrame: { type: RANGE, range: [-45, 45], step: 0.5, default: 2, desc: "Additional degrees of rotation applied every animation frame" },
  bgColor: { type: COLOR, default: [0, 0, 0], desc: "Fill color for exposed corners" },
  palette: { type: PALETTE, default: nearest },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
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
  angle: optionTypes.angle.default,
  spinPerFrame: optionTypes.spinPerFrame.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
  animSpeed: optionTypes.animSpeed.default,
};

type RotateOptions = FilterOptionValues & {
  angle?: number;
  spinPerFrame?: number;
  bgColor?: number[];
  animSpeed?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

const ROT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_cos;
uniform float u_sin;
uniform vec3  u_bg;
uniform float u_levels;

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  float cx = u_res.x * 0.5;
  float cy = u_res.y * 0.5;
  float dx = x - cx;
  float dy = y - cy;
  float sx = cx + dx * u_cos - dy * u_sin;
  float sy = cy + dx * u_sin + dy * u_cos;

  if (sx < 0.0 || sx >= u_res.x - 1.0 || sy < 0.0 || sy >= u_res.y - 1.0) {
    fragColor = vec4(u_bg, 1.0);
    return;
  }
  // Bilinear via GL_LINEAR (set on the source texture before the draw).
  vec2 uv = vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y);
  vec4 c = texture(u_source, uv);
  vec3 rgb = c.rgb;
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { rot: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    rot: linkProgram(gl, ROT_FS, [
      "u_source", "u_res", "u_cos", "u_sin", "u_bg", "u_levels",
    ] as const),
  };
  return _cache;
};

const rotateFilter = (input: any, options: RotateOptions = defaults) => {
  const angle = Number(options.angle ?? defaults.angle);
  const spinPerFrame = Number(options.spinPerFrame ?? defaults.spinPerFrame);
  const bgColor = Array.isArray(options.bgColor) ? options.bgColor : defaults.bgColor;
  const palette = options.palette ?? defaults.palette;
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;
  const animatedAngle = angle + spinPerFrame * frameIndex;
  const rad = (-animatedAngle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);

  if (glAvailable() && options._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "rotate:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      drawPass(gl, null, W, H, cache.rot, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.rot.uniforms.u_source, 0);
        gl.uniform2f(cache.rot.uniforms.u_res, W, H);
        gl.uniform1f(cache.rot.uniforms.u_cos, cosA);
        gl.uniform1f(cache.rot.uniforms.u_sin, sinA);
        gl.uniform3f(cache.rot.uniforms.u_bg, bgColor[0] / 255, bgColor[1] / 255, bgColor[2] / 255);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.rot.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Rotate", "WebGL2",
            `angle=${animatedAngle.toFixed(1)}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Rotate", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const cx = W / 2, cy = H / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = cx + dx * cosA - dy * sinA;
      const sy = cy + dx * sinA + dy * cosA;
      const di = getBufferIndex(x, y, W);

      if (sx < 0 || sx >= W - 1 || sy < 0 || sy >= H - 1) {
        fillBufferPixel(outBuf, di, bgColor[0], bgColor[1], bgColor[2], 255);
        continue;
      }

      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;
      const sample = (ch: number) => {
        const g = (px: number, py: number) => buf[getBufferIndex(px, py, W) + ch];
        return g(sx0,sy0)*(1-fx)*(1-fy) + g(sx0+1,sy0)*fx*(1-fy) + g(sx0,sy0+1)*(1-fx)*fy + g(sx0+1,sy0+1)*fx*fy;
      };

      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter<RotateOptions>({
  name: "Rotate",
  func: rotateFilter,
  optionTypes,
  options: defaults,
  defaults,
});
