import { BOOL, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { user } from "../palettes/index";
import { THEMES } from "../palettes/user";
import { logFilterBackend, reducePaletteToCap } from "../utils/index";
import { renderNCandidateGL, NC_ALGO, NC_SPACE, MAX_PAL, MAX_N } from "./nCandidateDitherGL";

// N-candidate ordered dithering: Knoll's algorithm (the Photoshop one) and the
// Yliluoma-2 "EMA" family. Both pick N weighted palette candidates per pixel and
// emit one via a Bayer threshold — see docs/plan/055-n-candidate-dithering.md
// and https://30fps.net/pages/revisiting-yliluoma-2/ for the derivation.

export const ALGO = {
  KNOLL: "KNOLL",
  EMA_SWEEP: "EMA_SWEEP",
  EMA_EXACT: "EMA_EXACT",
  EMA_CONSTANT: "EMA_CONSTANT",
} as const;

export const COLORSPACE = {
  SRGB: "SRGB",
  LINEAR: "LINEAR",
  LIQ: "LIQ",
} as const;

export const NC_BAYER_2X2 = "NC_BAYER_2X2";
export const NC_BAYER_4X4 = "NC_BAYER_4X4";
export const NC_BAYER_8X8 = "NC_BAYER_8X8";

// Defined locally rather than imported from ordered.ts — filters stay
// self-contained (AGENTS.md), and these need raw integers + a level count so
// the threshold can be built as the article's (raw + 0.5) / levels.
const thresholdMaps = {
  [NC_BAYER_2X2]: {
    raw: [[0, 2], [3, 1]],
    levels: 4,
  },
  [NC_BAYER_4X4]: {
    raw: [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
    levels: 16,
  },
  [NC_BAYER_8X8]: {
    raw: [
      [0, 48, 12, 60, 3, 51, 15, 63],
      [32, 16, 44, 28, 35, 19, 47, 31],
      [8, 56, 4, 52, 11, 59, 7, 55],
      [40, 24, 36, 20, 43, 27, 39, 23],
      [2, 50, 14, 62, 1, 49, 13, 61],
      [34, 18, 46, 30, 33, 17, 45, 29],
      [10, 58, 6, 54, 9, 57, 5, 53],
      [42, 26, 38, 22, 41, 25, 37, 21],
    ],
    levels: 64,
  },
};

type ThresholdMapKey = keyof typeof thresholdMaps;

const resolveThresholdMapKey = (key: string): ThresholdMapKey =>
  key in thresholdMaps ? (key as ThresholdMapKey) : NC_BAYER_4X4;

type NCandidatePalette = {
  options?: {
    levels?: number;
    colors?: number[][];
  } & FilterOptionValues;
} & Record<string, unknown>;

type NCandidateOptions = FilterOptionValues & {
  algo?: string;
  candidates?: number;
  strength?: number;
  minT?: number;
  constantT?: number;
  sweepTests?: number;
  lumaWeighted?: boolean;
  thresholdMap?: ThresholdMapKey;
  colorspace?: string;
  palette?: NCandidatePalette;
  _linearize?: boolean;
};

export const optionTypes = {
  algo: {
    type: ENUM,
    options: [
      { name: "EMA-Exact (Yliluoma-2, solved)", value: ALGO.EMA_EXACT },
      { name: "EMA-Sweep (Yliluoma-2, original)", value: ALGO.EMA_SWEEP },
      { name: "EMA-Constant (t = 0.3)", value: ALGO.EMA_CONSTANT },
      { name: "Knoll (Photoshop)", value: ALGO.KNOLL },
    ],
    default: ALGO.EMA_EXACT,
    desc: "Candidate selection. EMA variants track a running mean of chosen colors; Knoll instead compensates each pick's error. Exact solves the mixing factor directly, Sweep tests fixed fractions like the 2011 original, Constant just fixes it at 0.3.",
  },
  candidates: {
    type: RANGE,
    range: [2, MAX_N],
    step: 1,
    default: 32,
    desc: "How many candidates to collect per pixel (N). Low values look noticeably noisier; roughly 2x the palette size is the sweet spot.",
  },
  strength: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.8,
    desc: "How hard each pick's error pushes the next one. Lower means lighter dithering.",
    visibleWhen: (options: NCandidateOptions) => options.algo === ALGO.KNOLL,
  },
  minT: {
    type: RANGE,
    range: [0, 0.9],
    step: 0.05,
    default: 0.2,
    desc: "Floor on the mixing factor. At 0 the running mean can stall and never move; 0.2 is the article's compromise.",
    visibleWhen: (options: NCandidateOptions) =>
      options.algo === ALGO.EMA_EXACT || options.algo === ALGO.EMA_SWEEP,
  },
  constantT: {
    type: RANGE,
    range: [0.05, 0.95],
    step: 0.05,
    default: 0.3,
    desc: "The fixed mixing factor. Higher values dither more strongly.",
    visibleWhen: (options: NCandidateOptions) => options.algo === ALGO.EMA_CONSTANT,
  },
  sweepTests: {
    type: RANGE,
    range: [2, 16],
    step: 1,
    default: 8,
    desc: "How many mixing fractions to test per candidate. More is slower and barely different from solving it exactly.",
    visibleWhen: (options: NCandidateOptions) => options.algo === ALGO.EMA_SWEEP,
  },
  lumaWeighted: {
    type: BOOL,
    default: false,
    desc: "Use Yliluoma-2's original luma-weighted color difference instead of plain Euclidean. Mostly redundant with the LIQ color space.",
    visibleWhen: (options: NCandidateOptions) => options.algo === ALGO.EMA_SWEEP,
  },
  colorspace: {
    type: ENUM,
    options: [
      { name: "sRGB", value: COLORSPACE.SRGB },
      { name: "Linear", value: COLORSPACE.LINEAR },
      { name: "Luma-weighted (libimagequant)", value: COLORSPACE.LIQ },
    ],
    default: COLORSPACE.SRGB,
    desc: "Space the candidate search runs in. Linear reconstructs the original best when squinting; luma-weighted desaturates first, which greens-up the match without a perceptual distance formula.",
  },
  thresholdMap: {
    type: ENUM,
    options: [
      { name: "Bayer 2×2", value: NC_BAYER_2X2 },
      { name: "Bayer 4×4", value: NC_BAYER_4X4 },
      { name: "Bayer 8×8", value: NC_BAYER_8X8 },
    ],
    default: NC_BAYER_4X4,
    desc: "Threshold matrix used to pick which candidate a pixel lands on",
  },
  palette: { type: PALETTE, default: user },
};

const defaults: NCandidateOptions = {
  algo: optionTypes.algo.default,
  candidates: optionTypes.candidates.default,
  strength: optionTypes.strength.default,
  minT: optionTypes.minT.default,
  constantT: optionTypes.constantT.default,
  sweepTests: optionTypes.sweepTests.default,
  lumaWeighted: optionTypes.lumaWeighted.default,
  colorspace: optionTypes.colorspace.default,
  thresholdMap: optionTypes.thresholdMap.default as ThresholdMapKey,
  palette: { ...optionTypes.palette.default, options: { colors: THEMES.PICO8 } },
};

const ALGO_TO_GL: Record<string, number> = {
  [ALGO.KNOLL]: NC_ALGO.KNOLL,
  [ALGO.EMA_SWEEP]: NC_ALGO.EMA_SWEEP,
  [ALGO.EMA_EXACT]: NC_ALGO.EMA_EXACT,
  [ALGO.EMA_CONSTANT]: NC_ALGO.EMA_CONSTANT,
};

const SPACE_TO_GL: Record<string, number> = {
  [COLORSPACE.SRGB]: NC_SPACE.SRGB,
  [COLORSPACE.LINEAR]: NC_SPACE.LINEAR,
  [COLORSPACE.LIQ]: NC_SPACE.LIQ,
};

// N-candidate methods need a discrete palette to draw candidates from. A
// levels-only palette (`nearest`) doesn't have one, so synthesize the RGB cube
// it implies. levels^3 grows fast, so clamp to what MAX_PAL can hold.
export const paletteColorsFor = (palette: NCandidatePalette | undefined): number[][] => {
  const colors = palette?.options?.colors;
  if (colors && colors.length > 0) return reducePaletteToCap(colors, MAX_PAL);

  const requested = palette?.options?.levels ?? 2;
  let levels = Math.max(2, Math.floor(requested));
  while (levels > 2 && levels ** 3 > MAX_PAL) levels--;

  const step = 255 / (levels - 1);
  const cube: number[][] = [];
  for (let r = 0; r < levels; r++) {
    for (let g = 0; g < levels; g++) {
      for (let b = 0; b < levels; b++) {
        cube.push([Math.round(r * step), Math.round(g * step), Math.round(b * step), 255]);
      }
    }
  }
  return cube;
};

const nCandidateDither = (input: any, options: NCandidateOptions = defaults) => {
  const algo = String(options.algo ?? defaults.algo);
  const thresholdKey = resolveThresholdMapKey(String(options.thresholdMap ?? defaults.thresholdMap));
  const threshold = thresholdMaps[thresholdKey];
  const colorspace = String(options.colorspace ?? defaults.colorspace);
  const requestedColors = (options.palette ?? defaults.palette)?.options?.colors?.length ?? 0;
  const paletteRgb = paletteColorsFor(options.palette ?? defaults.palette);
  // Say so when the palette didn't fit the shader — this shows up in the
  // inline-timing tooltip, so a reduced palette is visible rather than a
  // silent surprise.
  const paletteNote = requestedColors > paletteRgb.length
    ? `K=${paletteRgb.length}<-${requestedColors} (median-cut to shader cap)`
    : `K=${paletteRgb.length}`;

  // The global gamma-correct toggle implies the linear working space, but an
  // explicit colorspace choice still wins.
  const space = colorspace === COLORSPACE.SRGB && options._linearize
    ? COLORSPACE.LINEAR
    : colorspace;

  const rendered = renderNCandidateGL(input, input.width, input.height, {
    thresholdMap: threshold.raw,
    thresholdLevels: threshold.levels,
    thresholdMapKey: thresholdKey,
    algo: ALGO_TO_GL[algo] ?? NC_ALGO.EMA_EXACT,
    candidates: typeof options.candidates === "number" ? options.candidates : defaults.candidates!,
    strength: typeof options.strength === "number" ? options.strength : defaults.strength!,
    minT: typeof options.minT === "number" ? options.minT : defaults.minT!,
    maxT: 1.0,
    constantT: typeof options.constantT === "number" ? options.constantT : defaults.constantT!,
    colorspace: SPACE_TO_GL[space] ?? NC_SPACE.SRGB,
    lumaWeighted: !!options.lumaWeighted,
    sweepTests: typeof options.sweepTests === "number" ? options.sweepTests : defaults.sweepTests!,
    paletteRgb,
  });
  if (!rendered) return input;

  logFilterBackend(
    "N-Candidate",
    "WebGL2",
    `${algo} ${space} N=${options.candidates ?? defaults.candidates} ${paletteNote} ${thresholdKey}`,
  );
  return rendered;
};

export default defineFilter({
  name: "N-Candidate",
  func: nCandidateDither,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
