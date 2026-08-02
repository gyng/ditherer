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

// N-candidate ordered dithering — Knoll's algorithm plus the Yliluoma-2 "EMA"
// family (sweep / exact / constant). See docs/plan/055-n-candidate-dithering.md
// and https://30fps.net/pages/revisiting-yliluoma-2/.
//
// Every pixel is independent (no error diffusion), so the whole family is one
// gather-parallel fragment shader:
//
//   1. Transform source + palette into the working space (sRGB / linear / LIQ).
//   2. Collect N weighted palette candidates for the pixel — the algorithms
//      differ only here.
//   3. Normalize the weights, then walk the luma-sorted palette and emit the
//      entry where the cumulative weight first crosses the Bayer threshold.
//
// The palette cap exists because of the per-fragment `weights[]` accumulator —
// a real float array per invocation, unlike ordered.ts's 256-entry palette which
// only ever needs a running best-distance. Where the cap belongs is an open
// question: on SwiftShader raising it to 256 costs small palettes nothing and
// K=256 renders correctly, but a software rasterizer cannot show the GPU
// register spilling that motivates a cap at all. `maxPal` is therefore a
// parameter, not a constant, so `test/e2e/nc-bench.spec.ts` can measure the
// tradeoff on real hardware before we commit to a number.
export const MAX_PAL = 64;
export const MAX_N = 64;
const MAX_SWEEP = 16;

export const NC_ALGO = {
  KNOLL: 0,
  EMA_SWEEP: 1,
  EMA_EXACT: 2,
  EMA_CONSTANT: 3,
} as const;

export const NC_SPACE = {
  SRGB: 0,
  LINEAR: 1,
  LIQ: 2,
} as const;

const LIQ_EXPONENT = 0.57 / 0.45455;
const LUMA_WEIGHTS: [number, number, number] = [0.309, 0.609, 0.082];

const buildFS = (MAX_PAL: number) => `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_threshold;      // R32F, already normalized to (raw+0.5)/levels
uniform vec2  u_res;
uniform ivec2 u_mapSize;
uniform int   u_algo;               // 0 KNOLL, 1 EMA_SWEEP, 2 EMA_EXACT, 3 EMA_CONSTANT
uniform int   u_n;                  // candidate iterations
uniform float u_strength;           // Knoll error-compensation scale
uniform float u_minT;
uniform float u_maxT;
uniform float u_constantT;
uniform int   u_colorspace;         // 0 SRGB, 1 LINEAR, 2 LIQ
uniform int   u_lumaWeighted;       // EMA_SWEEP only — Yliluoma-2's original distance
uniform int   u_sweepTests;
uniform int   u_paletteCount;
uniform vec3  u_palWork[${MAX_PAL}];  // working space, luma-ascending
uniform vec3  u_palOut[${MAX_PAL}];   // sRGB 0..255, same permutation

const vec3 LW = vec3(${LUMA_WEIGHTS[0]}, ${LUMA_WEIGHTS[1]}, ${LUMA_WEIGHTS[2]});

float srgbToLinearC(float c) {
  return c > 0.04045 ? pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

// The candidate search, the luma ordering, and the distance metric all run in
// this space — matching the reference, which derives luma from the already
// transformed palette.
vec3 toWorking(vec3 c) {
  if (u_colorspace == 1) {
    return vec3(srgbToLinearC(c.r), srgbToLinearC(c.g), srgbToLinearC(c.b));
  }
  if (u_colorspace == 2) {
    return pow(max(c, vec3(0.0)), vec3(${LIQ_EXPONENT})) * vec3(0.5, 1.0, 0.45);
  }
  return c;
}

// Yliluoma-2's luma-weighted color difference. The article's point is that you
// don't need this — it's here so EMA-Sweep can reproduce the original exactly.
float lumaDist2(vec3 p, vec3 m) {
  vec3 d = p - m;
  float ld = dot(p, LW) - dot(m, LW);
  return dot(d * d, LW) * 0.75 + ld * ld;
}

int findClosest(vec3 c) {
  int best = 0;
  float bestD = 1e30;
  for (int k = 0; k < ${MAX_PAL}; k++) {
    if (k >= u_paletteCount) break;
    vec3 dv = c - u_palWork[k];
    float d = dot(dv, dv);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  // JS-y space so threshold indexing matches the CPU reference.
  float y = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y)).rgb;
  vec3 p = toWorking(src);

  int tix = int(mod(x, float(u_mapSize.x)));
  int tiy = int(mod(y, float(u_mapSize.y)));
  float threshold = texelFetch(u_threshold, ivec2(tix, tiy), 0).r;

  float weights[${MAX_PAL}];
  for (int i = 0; i < ${MAX_PAL}; i++) weights[i] = 0.0;

  if (u_algo == 0) {
    // Knoll: repeatedly snap to the closest color, then push the goal back by
    // the error just made so the next pick compensates for it.
    vec3 err = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < ${MAX_N}; i++) {
      if (i >= u_n) break;
      int idx = findClosest(p + err * u_strength);
      weights[idx] += 1.0;
      wsum += 1.0;
      err += p - u_palWork[idx];
    }
    for (int k = 0; k < ${MAX_PAL}; k++) {
      if (k >= u_paletteCount) break;
      weights[k] /= wsum;
    }
  } else {
    // EMA family: keep a running mean of the candidates chosen so far, seeded
    // with the closest palette color at weight 1.
    int seed = findClosest(p);
    vec3 mean = u_palWork[seed];
    weights[seed] = 1.0;

    // Nudge the open ends off 0/1: t=0 never moves the mean, t=1 discards it.
    float minT = u_minT;
    float maxT = u_maxT;
    if (u_algo == 1) {
      if (minT == 0.0) minT += 0.05;
    } else if (u_algo == 2) {
      if (minT == 0.0) minT += 0.025;
      if (maxT == 1.0) maxT -= 0.025;
    }
    float sweepStep = (maxT - minT) / float(u_sweepTests);

    for (int i = 0; i < ${MAX_N}; i++) {
      if (i >= u_n) break;
      int bestK = 0;
      float bestT = 0.0;
      float bestDist = 1e30;

      // Of all palette colors, pick the one whose segment from the current
      // mean passes closest to the input color.
      for (int k = 0; k < ${MAX_PAL}; k++) {
        if (k >= u_paletteCount) break;
        vec3 ck = u_palWork[k];

        if (u_algo == 1) {
          for (int s = 0; s < ${MAX_SWEEP}; s++) {
            if (s >= u_sweepTests) break;
            float t = minT + float(s) * sweepStep;
            vec3 r = mix(mean, ck, t);
            float d = (u_lumaWeighted == 1) ? lumaDist2(p, r) : dot(p - r, p - r);
            if (d < bestDist) { bestDist = d; bestT = t; bestK = k; }
          }
        } else {
          float t;
          if (u_algo == 3) {
            t = u_constantT;
          } else {
            // Closest point on segment [mean, ck] to p, solved directly.
            vec3 delta = ck - mean;
            float delta2 = dot(delta, delta);
            t = 0.0;
            if (delta2 >= 1e-9) t = dot(p - mean, delta) / delta2;
            t = clamp(t, minT, maxT);
          }
          vec3 r = mix(mean, ck, t);
          vec3 dv = p - r;
          float d = dot(dv, dv);
          if (d < bestDist) { bestDist = d; bestT = t; bestK = k; }
        }
      }

      weights[bestK] += bestT;
      mean = mix(mean, u_palWork[bestK], bestT);
    }

    float sum = 0.0;
    for (int k = 0; k < ${MAX_PAL}; k++) {
      if (k >= u_paletteCount) break;
      sum += weights[k];
    }
    float norm = max(1e-6, sum);
    for (int k = 0; k < ${MAX_PAL}; k++) {
      if (k >= u_paletteCount) break;
      weights[k] /= norm;
    }
  }

  // Unused candidates have weight 0 and are skipped for free.
  float cumulative = 0.0;
  int idx = u_paletteCount - 1;
  for (int k = 0; k < ${MAX_PAL}; k++) {
    if (k >= u_paletteCount) break;
    idx = k;
    cumulative += weights[k];
    if (cumulative > threshold) break;
  }

  fragColor = vec4(u_palOut[idx] / 255.0, 1.0);
}
`;

const uniformNames = [
  "u_source",
  "u_threshold",
  "u_res",
  "u_mapSize",
  "u_algo",
  "u_n",
  "u_strength",
  "u_minT",
  "u_maxT",
  "u_constantT",
  "u_colorspace",
  "u_lumaWeighted",
  "u_sweepTests",
  "u_paletteCount",
  "u_palWork[0]",
  "u_palOut[0]",
];

// One program per palette cap. In normal use that's a single entry (MAX_PAL);
// the bench compiles several to compare them.
const _programs = new Map<number, Program>();

const initProgram = (gl: WebGL2RenderingContext, maxPal: number): Program => {
  const cached = _programs.get(maxPal);
  if (cached) return cached;
  const prog = linkProgram(gl, buildFS(maxPal), uniformNames as unknown as readonly string[]);
  _programs.set(maxPal, prog);
  return prog;
};

export const nCandidateGLAvailable = (): boolean => glAvailable();

const srgbToLinear = (c: number): number =>
  c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;

export const toWorkingSpace = (rgb: readonly number[], space: number): [number, number, number] => {
  if (space === NC_SPACE.LINEAR) {
    return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
  }
  if (space === NC_SPACE.LIQ) {
    return [
      Math.pow(Math.max(rgb[0], 0), LIQ_EXPONENT) * 0.5,
      Math.pow(Math.max(rgb[1], 0), LIQ_EXPONENT) * 1.0,
      Math.pow(Math.max(rgb[2], 0), LIQ_EXPONENT) * 0.45,
    ];
  }
  return [rgb[0], rgb[1], rgb[2]];
};

// Sort the palette by working-space luma up front. The reference threads a
// separate `luma_order` index array through the cumulative walk; permuting here
// lets the shader walk 0..K directly and skip that array entirely.
export const preparePalette = (palette: number[][], space: number, maxPal: number = MAX_PAL) => {
  const entries = palette.slice(0, maxPal).map((c) => {
    const work = toWorkingSpace([c[0] / 255, c[1] / 255, c[2] / 255], space);
    return {
      work,
      out: c,
      luma: work[0] * LUMA_WEIGHTS[0] + work[1] * LUMA_WEIGHTS[1] + work[2] * LUMA_WEIGHTS[2],
    };
  });
  entries.sort((a, b) => a.luma - b.luma);
  return entries;
};

const _thresholdTexCache = new Map<
  string,
  { tex: WebGLTexture; w: number; h: number; mapRef: number[][] }
>();

// Uploads the threshold matrix pre-normalized to (raw + 0.5) / levels, which is
// the form the article's code compares the cumulative weight against.
const uploadThresholdMap = (
  gl: WebGL2RenderingContext,
  map: number[][],
  levels: number,
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
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = ((map[y][x] ?? 0) + 0.5) / levels;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  _thresholdTexCache.set(cacheKey, { tex, w, h, mapRef: map });
  return { tex, w, h };
};

export const renderNCandidateGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  opts: {
    thresholdMap: number[][];
    thresholdLevels: number;
    thresholdMapKey: string;
    algo: number;
    candidates: number;
    strength: number;
    minT: number;
    maxT: number;
    constantT: number;
    colorspace: number;
    lumaWeighted: boolean;
    sweepTests: number;
    paletteRgb: number[][];
    // Bench-only override of the compiled palette cap. Production leaves this
    // unset and gets MAX_PAL.
    maxPal?: number;
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const maxPal = opts.maxPal ?? MAX_PAL;
  const prog = initProgram(gl, maxPal);
  const vao = getQuadVAO(gl);

  const threshTex = uploadThresholdMap(
    gl,
    opts.thresholdMap,
    opts.thresholdLevels,
    opts.thresholdMapKey,
  );
  if (!threshTex) return null;

  const entries = preparePalette(opts.paletteRgb, opts.colorspace, maxPal);
  const paletteCount = entries.length;
  if (paletteCount === 0) return null;

  const flatWork = new Float32Array(maxPal * 3);
  const flatOut = new Float32Array(maxPal * 3);
  for (let i = 0; i < paletteCount; i++) {
    flatWork[i * 3] = entries[i].work[0];
    flatWork[i * 3 + 1] = entries[i].work[1];
    flatWork[i * 3 + 2] = entries[i].work[2];
    flatOut[i * 3] = entries[i].out[0];
    flatOut[i * 3 + 1] = entries[i].out[1];
    flatOut[i * 3 + 2] = entries[i].out[2];
  }

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "nCandidate:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(
    gl,
    null,
    width,
    height,
    prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(prog.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, threshTex.tex);
      gl.uniform1i(prog.uniforms.u_threshold, 1);
      gl.uniform2f(prog.uniforms.u_res, width, height);
      gl.uniform2i(prog.uniforms.u_mapSize, threshTex.w, threshTex.h);
      gl.uniform1i(prog.uniforms.u_algo, opts.algo);
      gl.uniform1i(prog.uniforms.u_n, Math.min(MAX_N, Math.max(1, opts.candidates)));
      gl.uniform1f(prog.uniforms.u_strength, opts.strength);
      gl.uniform1f(prog.uniforms.u_minT, opts.minT);
      gl.uniform1f(prog.uniforms.u_maxT, opts.maxT);
      gl.uniform1f(prog.uniforms.u_constantT, opts.constantT);
      gl.uniform1i(prog.uniforms.u_colorspace, opts.colorspace);
      gl.uniform1i(prog.uniforms.u_lumaWeighted, opts.lumaWeighted ? 1 : 0);
      gl.uniform1i(prog.uniforms.u_sweepTests, Math.min(MAX_SWEEP, Math.max(1, opts.sweepTests)));
      gl.uniform1i(prog.uniforms.u_paletteCount, paletteCount);
      const locWork = prog.uniforms["u_palWork[0]"];
      if (locWork) gl.uniform3fv(locWork, flatWork);
      const locOut = prog.uniforms["u_palOut[0]"];
      if (locOut) gl.uniform3fv(locOut, flatOut);
    },
    vao,
  );

  return readoutToCanvas(canvas, width, height);
};
