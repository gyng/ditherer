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

// Ordered-dither fragment shader. Mirrors the CPU reference in
// `filters/ordered.ts` + the WASM `ordered_dither_linear_buffer` path:
//
//   1. Sample threshold map (R-channel texture) at
//      ((x + offX) % (baseW*scaleX)) / scaleX; same for y.
//   2. Apply bias to source (sRGB or sRGB→linear).
//   3. Quantise to `levels` steps, matching JS Math.round semantics.
//   4. If linear mode: clamp then linear→sRGB back.
//   5. Palette match in-shader using one of five algorithms
//      (LEVELS / RGB / RGB_APPROX / HSV / LAB).
export const MAX_PALETTE = 256;

const ORDERED_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_threshold;
uniform vec2  u_res;
uniform ivec2 u_mapBaseSize;        // unscaled threshold-map dimensions
uniform ivec2 u_mapScale;           // thresholdMapScaleX, thresholdMapScaleY
uniform ivec2 u_tempOffset;         // temporalOffsetX, temporalOffsetY
uniform float u_levels;
uniform int   u_invertThreshold;    // 1 = 1.0 - threshold before bias
uniform int   u_linearize;          // 0 = sRGB, 1 = linear
uniform int   u_palMode;            // 0 LEVELS, 1 RGB, 2 RGB_APPROX, 3 HSV, 4 LAB
uniform int   u_paletteCount;
uniform vec3  u_paletteRgb[${MAX_PALETTE}];   // 0..255
uniform vec3  u_paletteAux[${MAX_PALETTE}];   // LAB (mode 4) or HSV (mode 3), unused otherwise
uniform vec3  u_labRef;             // LAB whitepoint (ref_x, ref_y, ref_z), default D65

// --- sRGB transfer (matches utils/index.ts SRGB_TO_LINEAR_F) ---
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// --- RGB 0..255 → LAB (D65 default whitepoint via u_labRef) ---
vec3 rgbToLab(vec3 rgb255) {
  vec3 lin = srgbToLinear(rgb255 / 255.0) * 100.0;
  float X = lin.r * 0.4124 + lin.g * 0.3576 + lin.b * 0.1805;
  float Y = lin.r * 0.2126 + lin.g * 0.7152 + lin.b * 0.0722;
  float Z = lin.r * 0.0193 + lin.g * 0.1192 + lin.b * 0.9505;
  vec3 xyz = vec3(X, Y, Z) / u_labRef;
  vec3 f = mix(xyz * 7.787 + 16.0 / 116.0, pow(xyz, vec3(1.0 / 3.0)), step(0.008856, xyz));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}

// --- RGB 0..255 → HSV (matches lib.rs rgb_to_hsv) ---
vec3 rgbToHsv(vec3 rgb255) {
  vec3 c = rgb255 / 255.0;
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float delta = mx - mn;
  float v = mx;
  if (delta == 0.0) return vec3(0.0, 0.0, v);
  float s = delta / mx;
  float h;
  if (c.r == mx)      h = (c.g - c.b) / delta;
  else if (c.g == mx) h = 2.0 + (c.b - c.r) / delta;
  else                h = 4.0 + (c.r - c.g) / delta;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, v);
}

// JS Math.round half-up semantics (Rust's js_round_f32 equivalent).
float jsRound(float x) { return floor(x + 0.5); }
vec3  jsRoundV(vec3 v) { return floor(v + 0.5); }

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y space so threshold indexing matches the CPU reference.
  float y = u_res.y - 1.0 - floor(px.y);

  // Sample source in JS-y space (UNPACK_FLIP_Y).
  vec3 src255 = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb * 255.0;

  // Threshold lookup: (x + offX) % (baseW * scaleX) then / scaleX gives the
  // base-map cell. Same for y.
  int tixAbs = int(mod(x + float(u_tempOffset.x), float(u_mapBaseSize.x * u_mapScale.x)));
  int tiyAbs = int(mod(y + float(u_tempOffset.y), float(u_mapBaseSize.y * u_mapScale.y)));
  int tix = tixAbs / u_mapScale.x;
  int tiy = tiyAbs / u_mapScale.y;
  float threshold = texelFetch(u_threshold, ivec2(tix, tiy), 0).r;
  if (u_invertThreshold == 1) threshold = 1.0 - threshold;

  // --- Dither + quantise ---
  vec3 quant;
  if (u_linearize == 1) {
    float stepF = 1.0 / (u_levels - 1.0);
    vec3 lin = srgbToLinear(src255 / 255.0);
    float bias = stepF * (threshold - 0.5);
    vec3 q = jsRoundV((lin + bias) / stepF) * stepF;
    // JS rounds to 1e-6 precision before the next round; match that
    // so LUT-based WASM result stays within 1 LSB.
    q = floor(q * 1e6 + 0.5) / 1e6;
    q = clamp(q, 0.0, 1.0);
    quant = linearToSrgb(q) * 255.0;
  } else {
    float step255 = 255.0 / (u_levels - 1.0);
    float bias = step255 * (threshold - 0.5);
    quant = jsRoundV(jsRoundV((src255 + bias) / step255) * step255);
  }
  quant = clamp(quant, 0.0, 255.0);

  // --- Palette match ---
  vec3 outRgb;
  if (u_palMode == 0 || u_paletteCount <= 0) {
    outRgb = quant;
  } else {
    vec3 aux = vec3(0.0);
    if (u_palMode == 4) aux = rgbToLab(quant);
    else if (u_palMode == 3) aux = rgbToHsv(quant);

    int bestIdx = 0;
    float bestD = 1e30;
    for (int i = 0; i < ${MAX_PALETTE}; i++) {
      if (i >= u_paletteCount) break;
      float d;
      if (u_palMode == 1) {
        vec3 dv = quant - u_paletteRgb[i];
        d = dot(dv, dv);
      } else if (u_palMode == 2) {
        float rm = (quant.r + u_paletteRgb[i].r) * 0.5;
        vec3 dv = quant - u_paletteRgb[i];
        d = (2.0 + rm / 256.0) * dv.r * dv.r
          + 4.0 * dv.g * dv.g
          + (2.0 + (255.0 - rm) / 256.0) * dv.b * dv.b;
      } else if (u_palMode == 3) {
        vec3 pa = u_paletteAux[i];
        float dhAbs = abs(aux.x - pa.x);
        float dh = min(dhAbs, 360.0 - dhAbs) / 180.0;
        float ds = abs(aux.y - pa.y);
        float dvv = abs(aux.z - pa.z);
        d = dh*dh + ds*ds + dvv*dvv;
      } else {
        vec3 dv = aux - u_paletteAux[i];
        d = dot(dv, dv);
      }
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    outRgb = u_paletteRgb[bestIdx];
  }

  fragColor = vec4(outRgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const uniformNames = [
  "u_source", "u_threshold", "u_res", "u_mapBaseSize", "u_mapScale",
  "u_tempOffset", "u_levels", "u_invertThreshold", "u_linearize", "u_palMode", "u_paletteCount",
  "u_paletteRgb[0]", "u_paletteAux[0]", "u_labRef",
];

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, ORDERED_FS, uniformNames as unknown as readonly string[]) };
  return _cache;
};

export const orderedGLAvailable = (): boolean => glAvailable();

export const ORDERED_PAL_MODE = {
  LEVELS: 0,
  RGB: 1,
  RGB_APPROX: 2,
  HSV: 3,
  LAB: 4,
} as const;

// Threshold map texture cache — keyed by map identity (baseW|baseH|first-cell
// hash). The CPU-side thresholdMaps object holds fixed arrays per name so a
// simple name-key is enough in practice, but hashing the first row keeps us
// safe against future variants.
const _thresholdTexCache = new Map<string, { tex: WebGLTexture; w: number; h: number; mapRef: number[][] }>();

const uploadThresholdMap = (
  gl: WebGL2RenderingContext,
  map: number[][],
  cacheKey: string,
): { tex: WebGLTexture; w: number; h: number } | null => {
  const cached = _thresholdTexCache.get(cacheKey);
  if (cached && cached.mapRef === map) return { tex: cached.tex, w: cached.w, h: cached.h };
  const h = map.length;
  const w = map[0]?.length ?? 0;
  if (w === 0 || h === 0) return null;
  const tex = cached?.tex ?? gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  // R32F gives us the native float threshold values without the 8-bit
  // quantisation that would creep in with R8.
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = map[y][x] ?? 0;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  _thresholdTexCache.set(cacheKey, { tex, w, h, mapRef: map });
  return { tex, w, h };
};

// Precomputed CPU → GLSL helpers, matching lib.rs.
const rgbToHsvJs = (r: number, g: number, b: number): [number, number, number] => {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
  const delta = mx - mn;
  const v = mx;
  if (delta === 0) return [0, 0, v];
  const s = delta / mx;
  let h = rn === mx ? (gn - bn) / delta : gn === mx ? 2 + (bn - rn) / delta : 4 + (rn - gn) / delta;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, v];
};

const rgbToLabJs = (r: number, g: number, b: number, rx: number, ry: number, rz: number): [number, number, number] => {
  const srgb = (c: number) => c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  const lr = srgb(r / 255) * 100, lg = srgb(g / 255) * 100, lb = srgb(b / 255) * 100;
  let X = lr * 0.4124 + lg * 0.3576 + lb * 0.1805;
  let Y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  let Z = lr * 0.0193 + lg * 0.1192 + lb * 0.9505;
  X /= rx; Y /= ry; Z /= rz;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : t * 7.787 + 16 / 116;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

export const renderOrderedGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  opts: {
    thresholdMap: number[][];
    thresholdMapKey: string;
    mapScaleX: number;
    mapScaleY: number;
    tempOffsetX: number;
    tempOffsetY: number;
    levels: number;
    invertThreshold: boolean;
    linearize: boolean;
    palMode: number;
    paletteRgb: number[][] | null;   // 0..255 RGB list, or null for LEVELS mode
    labRef: [number, number, number]; // LAB whitepoint (D65 default)
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  const threshTex = uploadThresholdMap(gl, opts.thresholdMap, opts.thresholdMapKey);
  if (!threshTex) return null;

  // Flatten palettes. We always upload both arrays to keep the shader's
  // uniform layout constant; the unused one stays at zeros.
  const paletteCount = Math.min(MAX_PALETTE, opts.paletteRgb?.length ?? 0);
  const flatRgb = new Float32Array(MAX_PALETTE * 3);
  const flatAux = new Float32Array(MAX_PALETTE * 3);
  if (opts.paletteRgb) {
    for (let i = 0; i < paletteCount; i++) {
      const c = opts.paletteRgb[i];
      flatRgb[i * 3] = c[0];
      flatRgb[i * 3 + 1] = c[1];
      flatRgb[i * 3 + 2] = c[2];
      if (opts.palMode === ORDERED_PAL_MODE.LAB) {
        const lab = rgbToLabJs(c[0], c[1], c[2], opts.labRef[0], opts.labRef[1], opts.labRef[2]);
        flatAux[i * 3] = lab[0]; flatAux[i * 3 + 1] = lab[1]; flatAux[i * 3 + 2] = lab[2];
      } else if (opts.palMode === ORDERED_PAL_MODE.HSV) {
        const hsv = rgbToHsvJs(c[0], c[1], c[2]);
        flatAux[i * 3] = hsv[0]; flatAux[i * 3 + 1] = hsv[1]; flatAux[i * 3 + 2] = hsv[2];
      }
    }
  }

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "ordered:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, threshTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_threshold, 1);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2i(cache.prog.uniforms.u_mapBaseSize, threshTex.w, threshTex.h);
    gl.uniform2i(cache.prog.uniforms.u_mapScale, opts.mapScaleX, opts.mapScaleY);
    gl.uniform2i(cache.prog.uniforms.u_tempOffset, opts.tempOffsetX, opts.tempOffsetY);
    gl.uniform1f(cache.prog.uniforms.u_levels, opts.levels);
    gl.uniform1i(cache.prog.uniforms.u_invertThreshold, opts.invertThreshold ? 1 : 0);
    gl.uniform1i(cache.prog.uniforms.u_linearize, opts.linearize ? 1 : 0);
    gl.uniform1i(cache.prog.uniforms.u_palMode, opts.palMode);
    gl.uniform1i(cache.prog.uniforms.u_paletteCount, paletteCount);
    const locRgb = cache.prog.uniforms["u_paletteRgb[0]"];
    if (locRgb) gl.uniform3fv(locRgb, flatRgb);
    const locAux = cache.prog.uniforms["u_paletteAux[0]"];
    if (locAux) gl.uniform3fv(locAux, flatAux);
    gl.uniform3f(cache.prog.uniforms.u_labRef, opts.labRef[0], opts.labRef[1], opts.labRef[2]);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
