// CPU reference for the N-candidate ordered dithers (Knoll + Yliluoma/EMA).
//
// A port of Pekka Väänänen's `color_selection.py` from
// https://30fps.net/pages/revisiting-yliluoma-2/ (CC0). This is a TEST ORACLE,
// not a runtime fallback: plan 036 forbids an in-flight JS path once a filter
// has a GL path, so nothing under `src/` may import this file. It exists so the
// fragment shader in `nCandidateDitherGL.ts` has something exact to be checked
// against — see docs/plan/055-n-candidate-dithering.md.
//
// Deliberate deviation from the script: the LIQ transform is applied in float
// rather than round-tripping through 8-bit as the script's `to_8bit_liq_rgb`
// does. The shader does the same, so oracle and shader stay consistent.

export type NCandidateAlgo = "KNOLL" | "EMA_SWEEP" | "EMA_EXACT" | "EMA_CONSTANT";
export type NCandidateColorspace = "SRGB" | "LINEAR" | "LIQ";

export type ThresholdMatrix = { raw: number[][]; levels: number };

export const BAYER_4X4_RAW: ThresholdMatrix = {
  raw: [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ],
  levels: 16,
};

export type NCandidateParams = {
  algo: NCandidateAlgo;
  candidates: number;
  strength: number;
  minT: number;
  maxT: number;
  constantT: number;
  colorspace: NCandidateColorspace;
  lumaWeighted: boolean;
  sweepTests: number;
  threshold: ThresholdMatrix;
};

export const defaultParams: NCandidateParams = {
  algo: "EMA_EXACT",
  candidates: 32,
  strength: 0.8,
  minT: 0.2,
  maxT: 1.0,
  constantT: 0.3,
  colorspace: "SRGB",
  lumaWeighted: false,
  sweepTests: 8,
  threshold: BAYER_4X4_RAW,
};

// Poynton's luma weights. Yliluoma's C++ uses Rec.602; the article prefers
// these (attributed to Poynton by Burger & Burge).
export const LUMA_WEIGHTS = [0.309, 0.609, 0.082] as const;

const LIQ_WEIGHTS = [0.5, 1.0, 0.45] as const;
const LIQ_EXPONENT = 0.57 / 0.45455;

export const srgbToLinear = (c: number): number =>
  c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;

// Convert an sRGB 0..1 triple into the space the candidate search runs in.
export const toWorkingSpace = (
  rgb: readonly number[],
  colorspace: NCandidateColorspace,
): [number, number, number] => {
  if (colorspace === "LINEAR") {
    return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
  }
  if (colorspace === "LIQ") {
    return [
      Math.pow(rgb[0], LIQ_EXPONENT) * LIQ_WEIGHTS[0],
      Math.pow(rgb[1], LIQ_EXPONENT) * LIQ_WEIGHTS[1],
      Math.pow(rgb[2], LIQ_EXPONENT) * LIQ_WEIGHTS[2],
    ];
  }
  return [rgb[0], rgb[1], rgb[2]];
};

export const lumaOf = (rgb: readonly number[]): number =>
  rgb[0] * LUMA_WEIGHTS[0] + rgb[1] * LUMA_WEIGHTS[1] + rgb[2] * LUMA_WEIGHTS[2];

export type PreparedPalette = {
  // Working-space colors, luma-ascending. Flat K*3.
  work: Float64Array;
  // Original sRGB 0..255 colors under the same permutation — what we emit.
  out: number[][];
  count: number;
};

// Sort the palette by working-space luma so the cumulative-weight walk is a
// plain 0..K loop. The reference keeps a separate `luma_order` index array and
// computes luma from the already-transformed palette; permuting up front is
// equivalent and lets the shader drop the array.
export const preparePalette = (
  palette: number[][],
  colorspace: NCandidateColorspace,
): PreparedPalette => {
  const entries = palette.map((c) => {
    const work = toWorkingSpace([c[0] / 255, c[1] / 255, c[2] / 255], colorspace);
    return { work, out: c, luma: lumaOf(work) };
  });
  // Stable tie-break on the original index keeps the order deterministic for
  // palettes with duplicate luma (e.g. saturated primaries).
  entries.sort((a, b) => a.luma - b.luma);

  const count = entries.length;
  const work = new Float64Array(count * 3);
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    work[i * 3] = entries[i].work[0];
    work[i * 3 + 1] = entries[i].work[1];
    work[i * 3 + 2] = entries[i].work[2];
    out.push(entries[i].out);
  }
  return { work, out, count };
};

const dist2 = (pal: Float64Array, k: number, x: number, y: number, z: number): number => {
  const dr = x - pal[k * 3];
  const dg = y - pal[k * 3 + 1];
  const db = z - pal[k * 3 + 2];
  return dr * dr + dg * dg + db * db;
};

const findClosest = (pal: Float64Array, count: number, x: number, y: number, z: number): number => {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < count; k++) {
    const d = dist2(pal, k, x, y, z);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
};

// Closest point on segment [A,B] to C, as the mixing factor t.
// t = clamp(dot(C-A, B-A) / |B-A|^2, minT, maxT)
export const solveT = (
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  minT: number,
  maxT: number,
): number => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2];
  const delta2 = dx * dx + dy * dy + dz * dz;
  let t = 0;
  // Degenerate segment (c_k == mean): leave t at 0 and let the clamp decide,
  // matching the reference's `if delta2 >= 1e-9` guard.
  if (delta2 >= 1e-9) {
    t = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy + (c[2] - a[2]) * dz) / delta2;
  }
  return Math.max(minT, Math.min(maxT, t));
};

// Yliluoma-2's original luma-weighted color difference. Only reachable from
// EMA-Sweep, mirroring the reference's `use_luma` restriction.
const lumaDist2 = (
  px: number,
  py: number,
  pz: number,
  mx: number,
  my: number,
  mz: number,
): number => {
  const dr = px - mx,
    dg = py - my,
    db = pz - mz;
  const lumaDiff = lumaOf([px, py, pz]) - lumaOf([mx, my, mz]);
  const weighted =
    dr * dr * LUMA_WEIGHTS[0] + dg * dg * LUMA_WEIGHTS[1] + db * db * LUMA_WEIGHTS[2];
  return weighted * 0.75 + lumaDiff * lumaDiff;
};

// Per-pixel candidate weights, normalized to sum 1.
export const candidateWeights = (
  p: readonly number[],
  pal: PreparedPalette,
  params: NCandidateParams,
  out: Float64Array = new Float64Array(pal.count),
): Float64Array => {
  const { work, count } = pal;
  const N = params.candidates;
  out.fill(0);

  if (params.algo === "KNOLL") {
    // No seed candidate: the first iteration runs with zero error, which picks
    // closest(p) anyway.
    let ex = 0,
      ey = 0,
      ez = 0;
    let weightSum = 0;
    for (let i = 0; i < N; i++) {
      const idx = findClosest(
        work,
        count,
        p[0] + ex * params.strength,
        p[1] + ey * params.strength,
        p[2] + ez * params.strength,
      );
      out[idx] += 1;
      weightSum += 1;
      ex += p[0] - work[idx * 3];
      ey += p[1] - work[idx * 3 + 1];
      ez += p[2] - work[idx * 3 + 2];
    }
    for (let k = 0; k < count; k++) out[k] /= weightSum;
    return out;
  }

  // EMA variants: seed the running mean with the closest palette color at
  // weight 1, then move it toward a best candidate N times.
  const seed = findClosest(work, count, p[0], p[1], p[2]);
  let mx = work[seed * 3],
    my = work[seed * 3 + 1],
    mz = work[seed * 3 + 2];
  out[seed] = 1;

  // The reference nudges the open ends off 0.0/1.0: t=0 never moves the mean,
  // t=1 discards it entirely.
  let minT = params.minT;
  let maxT = params.maxT;
  if (params.algo === "EMA_SWEEP") {
    if (minT === 0) minT += 0.05;
  } else if (params.algo === "EMA_EXACT") {
    if (minT === 0) minT += 0.025;
    if (maxT === 1) maxT -= 0.025;
  }

  const sweepStep = (maxT - minT) / params.sweepTests;

  for (let i = 0; i < N; i++) {
    let bestK = -1;
    let bestT = 0;
    let bestDist = Infinity;

    for (let k = 0; k < count; k++) {
      const cr = work[k * 3],
        cg = work[k * 3 + 1],
        cb = work[k * 3 + 2];

      if (params.algo === "EMA_SWEEP") {
        // linspace(minT, maxT, sweepTests, endpoint=False)
        for (let s = 0; s < params.sweepTests; s++) {
          const t = minT + s * sweepStep;
          const rx = mx + (cr - mx) * t;
          const ry = my + (cg - my) * t;
          const rz = mz + (cb - mz) * t;
          const d = params.lumaWeighted
            ? lumaDist2(p[0], p[1], p[2], rx, ry, rz)
            : (p[0] - rx) ** 2 + (p[1] - ry) ** 2 + (p[2] - rz) ** 2;
          if (d < bestDist) {
            bestDist = d;
            bestT = t;
            bestK = k;
          }
        }
        continue;
      }

      const t =
        params.algo === "EMA_CONSTANT"
          ? params.constantT
          : solveT([mx, my, mz], [cr, cg, cb], p, minT, maxT);
      const rx = mx + (cr - mx) * t;
      const ry = my + (cg - my) * t;
      const rz = mz + (cb - mz) * t;
      const d = (p[0] - rx) ** 2 + (p[1] - ry) ** 2 + (p[2] - rz) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestT = t;
        bestK = k;
      }
    }

    out[bestK] += bestT;
    mx += (work[bestK * 3] - mx) * bestT;
    my += (work[bestK * 3 + 1] - my) * bestT;
    mz += (work[bestK * 3 + 2] - mz) * bestT;
  }

  let sum = 0;
  for (let k = 0; k < count; k++) sum += out[k];
  const norm = Math.max(1e-6, sum);
  for (let k = 0; k < count; k++) out[k] /= norm;
  return out;
};

// Walk the luma-sorted palette and emit the entry where the cumulative weight
// first crosses the threshold. Unused candidates have weight 0 and are skipped
// for free.
export const pickIndex = (weights: Float64Array, count: number, threshold: number): number => {
  let cumulative = 0;
  let idx = count - 1;
  for (let k = 0; k < count; k++) {
    idx = k;
    cumulative += weights[k];
    if (cumulative > threshold) break;
  }
  return idx;
};

// Dither an RGBA buffer. Returns a new RGBA buffer of original palette colors.
export const ditherNCandidate = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: number[][],
  params: NCandidateParams = defaultParams,
): Uint8ClampedArray => {
  const pal = preparePalette(palette, params.colorspace);
  const out = new Uint8ClampedArray(rgba.length);
  const weights = new Float64Array(pal.count);
  const { raw, levels } = params.threshold;
  const mapH = raw.length;
  const mapW = raw[0].length;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const p = toWorkingSpace(
        [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255],
        params.colorspace,
      );
      candidateWeights(p, pal, params, weights);
      const threshold = (raw[y % mapH][x % mapW] + 0.5) / levels;
      const idx = pickIndex(weights, pal.count, threshold);
      const c = pal.out[idx];
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = rgba[i + 3];
    }
  }
  return out;
};
