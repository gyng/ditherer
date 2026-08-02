import { RANGE, ENUM, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import {
  normalizeRangeOption,
  normalizeEnumOption,
  normalizeColorOption,
} from "../utils/filterOptions";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
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

const COLORMAP = { TOPOGRAPHIC: "TOPOGRAPHIC", BATHYMETRIC: "BATHYMETRIC", THERMAL: "THERMAL" };

const COLORMAPS: Record<string, number[][]> = {
  [COLORMAP.TOPOGRAPHIC]: [
    [0, 100, 0],
    [34, 139, 34],
    [144, 238, 144],
    [255, 255, 150],
    [210, 180, 80],
    [160, 82, 45],
    [139, 90, 43],
    [200, 200, 200],
    [255, 255, 255],
  ],
  [COLORMAP.BATHYMETRIC]: [
    [0, 0, 80],
    [0, 0, 140],
    [0, 50, 180],
    [0, 100, 200],
    [50, 150, 220],
    [100, 200, 240],
    [180, 230, 250],
    [220, 240, 255],
    [245, 250, 255],
  ],
  [COLORMAP.THERMAL]: [
    [0, 0, 50],
    [20, 0, 100],
    [80, 0, 140],
    [160, 0, 100],
    [220, 60, 20],
    [255, 160, 0],
    [255, 220, 50],
    [255, 255, 150],
    [255, 255, 255],
  ],
};

const MAX_STOPS = 9;

const sampleGradient = (stops: number[][], t: number): [number, number, number] => {
  const ct = Math.max(0, Math.min(1, t));
  const pos = ct * (stops.length - 1);
  const idx = Math.floor(pos);
  const frac = pos - idx;
  if (idx >= stops.length - 1)
    return [stops[stops.length - 1][0], stops[stops.length - 1][1], stops[stops.length - 1][2]];
  const a = stops[idx],
    b = stops[idx + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
};

export const optionTypes = {
  bands: { type: RANGE, range: [3, 20], step: 1, default: 8, desc: "Number of elevation bands" },
  colormap: {
    type: ENUM,
    options: [
      { name: "Topographic", value: COLORMAP.TOPOGRAPHIC },
      { name: "Bathymetric", value: COLORMAP.BATHYMETRIC },
      { name: "Thermal", value: COLORMAP.THERMAL },
    ],
    default: COLORMAP.TOPOGRAPHIC,
    desc: "Color scheme for the contour bands",
  },
  lineColor: { type: COLOR, default: [40, 30, 20], desc: "Iso-contour line color" },
  lineWidth: {
    type: RANGE,
    range: [0, 3],
    step: 0.1,
    default: 1,
    desc: "Contour line thickness in pixels (0 disables lines)",
  },
  lineOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Contour line opacity" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  bands: optionTypes.bands.default,
  colormap: optionTypes.colormap.default,
  lineColor: optionTypes.lineColor.default,
  lineWidth: optionTypes.lineWidth.default,
  lineOpacity: optionTypes.lineOpacity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const COLORMAP_VALUES = Object.values(COLORMAP);

const CM_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform int   u_bands;
uniform int   u_stopCount;
uniform vec3  u_stops[${MAX_STOPS}];
uniform float u_levels;
uniform vec2  u_texel;       // 1 / resolution, for neighbourhood smoothing
uniform vec3  u_lineColor;   // 0..255
uniform float u_lineWidth;   // contour line thickness in pixels
uniform float u_lineOpacity; // 0..1

float lumAt(vec2 uv) {
  vec4 s = texture(u_source, uv);
  return 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b;
}

vec3 sampleGradient(float t) {
  float ct = clamp(t, 0.0, 1.0);
  float pos = ct * float(u_stopCount - 1);
  int idx = int(floor(pos));
  float frac = pos - float(idx);
  if (idx >= u_stopCount - 1) {
    vec3 last = u_stops[0];
    for (int i = 0; i < ${MAX_STOPS}; i++) {
      if (i == u_stopCount - 1) last = u_stops[i];
    }
    return last;
  }
  vec3 a = u_stops[0];
  vec3 b = u_stops[1];
  for (int i = 0; i < ${MAX_STOPS}; i++) {
    if (i == idx) a = u_stops[i];
    if (i == idx + 1) b = u_stops[i];
  }
  return mix(a, b, frac);
}

void main() {
  vec4 c = texture(u_source, v_uv);
  // Smoothed luminance as the elevation proxy: a 5-tap plus average over
  // neighbouring pixels decouples elevation from per-pixel noise so contour
  // lines are clean rather than jagged.
  float h = (
    lumAt(v_uv) +
    lumAt(v_uv + vec2(u_texel.x, 0.0)) +
    lumAt(v_uv - vec2(u_texel.x, 0.0)) +
    lumAt(v_uv + vec2(0.0, u_texel.y)) +
    lumAt(v_uv - vec2(0.0, u_texel.y))
  ) / 5.0;

  // Hypsometric fill: colormap band from the smoothed height.
  float band = floor(h * float(u_bands)) / float(u_bands);
  vec3 rgb = sampleGradient(band) / 255.0;

  // Iso-contour lines at each elevation level via screen-space derivatives.
  float scaled = clamp(h, 0.0, 1.0) * float(u_bands);
  float dist = min(fract(scaled), 1.0 - fract(scaled));
  float aa = fwidth(scaled);
  float line = 1.0 - smoothstep(0.0, max(u_lineWidth * aa, 1e-6), dist);
  line *= step(1e-5, aa);
  // Fade lines out across cliffs where many bands cross a single pixel, so a
  // hard edge reads as a cluster of contours rather than a solid colour block.
  line *= 1.0 - smoothstep(0.5, 1.0, aa);
  rgb = mix(rgb, u_lineColor / 255.0, line * u_lineOpacity);

  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

type Cache = { cm: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    cm: linkProgram(gl, CM_FS, [
      "u_source",
      "u_bands",
      "u_stopCount",
      "u_stops",
      "u_levels",
      "u_texel",
      "u_lineColor",
      "u_lineWidth",
      "u_lineOpacity",
    ] as const),
  };
  return _cache;
};

const contourMap = (input: any, options: Partial<typeof defaults> = defaults) => {
  const bands = normalizeRangeOption(options.bands, defaults.bands, 3, 20, true);
  const colormap = normalizeEnumOption(options.colormap, COLORMAP_VALUES, defaults.colormap);
  const lineColor = normalizeColorOption(options.lineColor, defaults.lineColor);
  const lineWidth = normalizeRangeOption(options.lineWidth, defaults.lineWidth, 0, 3, false);
  const lineOpacity = normalizeRangeOption(options.lineOpacity, defaults.lineOpacity, 0, 1, false);
  const palette = options.palette ?? defaults.palette;
  const W = input.width,
    H = input.height;
  const stops = COLORMAPS[colormap] || COLORMAPS[COLORMAP.TOPOGRAPHIC];

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "contourMap:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const stopArr = new Float32Array(MAX_STOPS * 3);
      for (let i = 0; i < stops.length && i < MAX_STOPS; i++) {
        stopArr[i * 3] = stops[i][0];
        stopArr[i * 3 + 1] = stops[i][1];
        stopArr[i * 3 + 2] = stops[i][2];
      }

      drawPass(
        gl,
        null,
        W,
        H,
        cache.cm,
        () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.cm.uniforms.u_source, 0);
          gl.uniform1i(cache.cm.uniforms.u_bands, bands);
          gl.uniform1i(cache.cm.uniforms.u_stopCount, Math.min(stops.length, MAX_STOPS));
          gl.uniform3fv(cache.cm.uniforms.u_stops, stopArr);
          gl.uniform2f(cache.cm.uniforms.u_texel, 1 / W, 1 / H);
          gl.uniform3f(cache.cm.uniforms.u_lineColor, lineColor[0], lineColor[1], lineColor[2]);
          gl.uniform1f(cache.cm.uniforms.u_lineWidth, lineWidth);
          gl.uniform1f(cache.cm.uniforms.u_lineOpacity, lineOpacity);
          const identity = paletteIsIdentity(palette);
          const pOpts = (palette as { options?: { levels?: number } }).options;
          gl.uniform1f(cache.cm.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
        },
        vao,
      );

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend(
            "Contour Map",
            "WebGL2",
            `${colormap} bands=${bands}${identity ? "" : "+palettePass"}`,
          );
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Contour Map", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Smoothed luminance elevation field (3x3 box) so contour bands and lines are
  // clean rather than per-pixel noisy — the JS analogue of the GL 5-tap smooth.
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
    }
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0,
        count = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          sum += lum[ny * W + nx];
          count++;
        }
      height[y * W + x] = sum / count;
    }

  // Continuous line strength: thinner width fades toward off, 0 disables lines.
  const lineStrength = lineOpacity * Math.min(1, lineWidth);

  const bandIndexAt = (x: number, y: number) => Math.floor(height[y * W + x] * bands);

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const h = height[y * W + x];
      const band = Math.floor(h * bands) / bands;
      const [fr, fg, fb] = sampleGradient(stops, band);

      // Iso-contour line: this pixel sits on a level boundary if its band index
      // differs from the right or bottom neighbour's band index.
      const bi = bandIndexAt(x, y);
      const onLine =
        lineStrength > 0 &&
        ((x + 1 < W && bandIndexAt(x + 1, y) !== bi) ||
          (y + 1 < H && bandIndexAt(x, y + 1) !== bi));

      let cr = fr,
        cg = fg,
        cb = fb;
      if (onLine) {
        cr = Math.round(fr + (lineColor[0] - fr) * lineStrength);
        cg = Math.round(fg + (lineColor[1] - fg) * lineStrength);
        cb = Math.round(fb + (lineColor[2] - fb) * lineStrength);
      }

      const color = paletteGetColor(palette, rgba(cr, cg, cb, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Contour Map",
  func: contourMap,
  optionTypes,
  options: defaults,
  defaults,
});
