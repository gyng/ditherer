import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { normalizeRangeOption } from "../utils/filterOptions";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import {
  hatchLayerFill,
  hatchLineHalfWidthPx,
  lineCoverage,
  luminance01,
  PRINTMAKING_TONE_GLSL,
} from "./printmakingToneContracts";
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
} from "../gl/index";

// Classic fixed-angle pen-and-ink hatching, done as a continuous tonal ramp
// (Winkenbach & Salesin 1994). Darkness maps to a hatch *level* that
// progressively activates four layers — the two user angles plus two derived
// intermediates — and each active layer's stroke width grows within its tone
// band, so a mid-grey and a near-black no longer collapse to the same pattern.
// (The previous filter used two hard luminance thresholds and constant
// spacing.) The angles stay fixed, which keeps this distinct from the
// form-following Flow Crosshatch.

const LAYER_COUNT = 4;

export const optionTypes = {
  density: { type: RANGE, range: [2, 20], step: 1, default: 6, desc: "Hatch line spacing in pixels" },
  angle1: { type: RANGE, range: [0, 180], step: 5, default: 45, desc: "Primary hatch angle in degrees" },
  angle2: { type: RANGE, range: [0, 180], step: 5, default: 135, desc: "Secondary hatch angle in degrees" },
  inkColor: { type: COLOR, default: [0, 0, 0], desc: "Hatch line color" },
  paperColor: { type: COLOR, default: [255, 255, 240], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  density: optionTypes.density.default,
  angle1: optionTypes.angle1.default,
  angle2: optionTypes.angle2.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Four fixed hatch-line directions (radians) from the two user angles.
const layerAngles = (angle1: number, angle2: number): number[] => {
  const a1 = (angle1 * Math.PI) / 180;
  const a2 = (angle2 * Math.PI) / 180;
  const mid = (a1 + a2) / 2;
  return [a1, a2, mid, mid + Math.PI / 2];
};

const CH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_density;
uniform vec2  u_across[${LAYER_COUNT}];   // per-layer across-line unit vector
uniform vec3  u_inkColor;     // 0..1
uniform vec3  u_paperColor;   // 0..1
uniform float u_levels;

${PRINTMAKING_TONE_GLSL}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 src = texture(u_source, suv);
  float darkness = 1.0 - pm_luma(src.rgb);

  float ink = 0.0;
  for (int k = 0; k < ${LAYER_COUNT}; k++) {
    float fill = pm_hatchLayerFill(darkness, float(k), float(${LAYER_COUNT}));
    if (fill <= 0.0) continue;
    float proj = dot(vec2(x, y), u_across[k]);
    float m = mod(proj, u_density);
    float dist = min(m, u_density - m);
    float hw = pm_hatchHalfWidth(fill, u_density, 0.5);
    float cov = pm_lineCoverage(dist, hw, 0.75);
    ink = 1.0 - (1.0 - ink) * (1.0 - cov);
  }

  vec3 rgb = mix(u_paperColor, u_inkColor, ink);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), src.a);
}
`;

type Cache = { ch: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ch: linkProgram(gl, CH_FS, [
      "u_source", "u_res", "u_density", "u_across",
      "u_inkColor", "u_paperColor", "u_levels",
    ] as const),
  };
  return _cache;
};

const crosshatch = (input: any, options: Partial<typeof defaults> = defaults) => {
  const density = normalizeRangeOption(options.density, defaults.density, 2, 20);
  const angle1 = normalizeRangeOption(options.angle1, defaults.angle1, 0, 180);
  const angle2 = normalizeRangeOption(options.angle2, defaults.angle2, 0, 180);
  const inkColor = options.inkColor ?? defaults.inkColor;
  const paperColor = options.paperColor ?? defaults.paperColor;
  const palette = options.palette ?? defaults.palette;
  const W = input.width;
  const H = input.height;
  const angles = layerAngles(angle1, angle2);
  // Across-line unit vectors (perpendicular to each line direction).
  const across = new Float32Array(LAYER_COUNT * 2);
  angles.forEach((a, k) => {
    across[k * 2] = -Math.sin(a);
    across[k * 2 + 1] = Math.cos(a);
  });

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "crosshatch:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.ch, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.ch.uniforms.u_source, 0);
        gl.uniform2f(cache.ch.uniforms.u_res, W, H);
        gl.uniform1f(cache.ch.uniforms.u_density, density);
        gl.uniform2fv(cache.ch.uniforms.u_across, across);
        gl.uniform3f(cache.ch.uniforms.u_inkColor, inkColor[0] / 255, inkColor[1] / 255, inkColor[2] / 255);
        gl.uniform3f(cache.ch.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.ch.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Crosshatch", "WebGL2",
            `density=${density}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Crosshatch", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const identity = paletteIsIdentity(palette);
  const acrossPairs = angles.map((a) => [-Math.sin(a), Math.cos(a)] as const);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const darkness = 1 - luminance01(buf[i], buf[i + 1], buf[i + 2]);
      let ink = 0;
      for (let k = 0; k < LAYER_COUNT; k++) {
        const fill = hatchLayerFill(darkness, k, LAYER_COUNT);
        if (fill <= 0) continue;
        const proj = x * acrossPairs[k][0] + y * acrossPairs[k][1];
        const m = ((proj % density) + density) % density;
        const dist = Math.min(m, density - m);
        const hw = hatchLineHalfWidthPx(fill, density);
        const cov = lineCoverage(dist, hw, 0.75);
        ink = 1 - (1 - ink) * (1 - cov);
      }
      const r = paperColor[0] + (inkColor[0] - paperColor[0]) * ink;
      const g = paperColor[1] + (inkColor[1] - paperColor[1]) * ink;
      const b = paperColor[2] + (inkColor[2] - paperColor[2]) * ink;
      fillBufferPixel(outBuf, i, r, g, b, buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return identity ? output : (applyPalettePassToCanvas(output, W, H, palette) ?? output);
};

export default defineFilter({
  name: "Crosshatch",
  func: crosshatch,
  optionTypes,
  options: defaults,
  defaults,
  description: "Fixed-angle pen-and-ink crosshatching with a continuous tonal ramp — darker areas stack more hatch layers and thicker strokes instead of two hard thresholds",
});
