import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderLUTGL, LUT_PRESET } from "./lutGL";

const PRESET_NAMES = {
  ACES:          "ACES Filmic",
  REINHARD:      "Reinhard",
  UNCHARTED2:    "Uncharted 2 (Hable)",
  TEAL_ORANGE:   "Teal & Orange",
  BLEACH_BYPASS: "Bleach Bypass",
  CROSS_PROCESS: "Cross Process",
  KODACHROME:    "Kodachrome",
  FADED_FILM:    "Faded Film",
  TECHNICOLOR:   "Technicolor",
  MATRIX_GREEN:  "Matrix Green",
  AMBER_NOIR:    "Amber Noir",
  COLD_WINTER:   "Cold Winter",
  LOMO:          "Lomo",
  VELVIA:        "Velvia (Fuji)",
  PORTRA:        "Portra (Kodak)",
  TRIX_BW:       "Tri-X B&W",
  DUNE:          "Dune",
  MOONRISE:      "Moonrise",
  CLARENDON:     "Clarendon",
  NASHVILLE:     "Nashville",
  MAGIC_HOUR:    "Magic Hour",
  JOHN_WICK:     "John Wick",
  WES_ANDERSON:  "Wes Anderson",
  FURY_ROAD:     "Fury Road",
  NEGATIVE:      "Negative",
  KODAK_GOLD:    "Kodak Gold 200",
  FUJI_PRO_400H: "Fuji Pro 400H",
  CINESTILL_800T:"CineStill 800T",
  ILFORD_HP5:    "Ilford HP5+",
  EKTACHROME:    "Kodak Ektachrome",
  AGFA_VISTA:    "Agfa Vista",
  DEAKINS:       "Deakins (cool moody)",
  AMELIE:        "Amélie (storybook)",
  SAVING_RYAN:   "Saving Private Ryan",
  THREE_HUNDRED: "300",
  BLADE_RUNNER:  "Blade Runner (1982)",
  SIN_CITY:      "Sin City",
  BREAKING_BAD:  "Breaking Bad",
  MR_ROBOT:      "Mr. Robot",
  REVENANT:      "The Revenant",
  INCEPTION:     "Inception",
  DRIVE:         "Drive",
  STRANGER_THINGS: "Stranger Things",
  JOKER_2019:    "Joker (2019)" } as const;

const PRESET_KEYS = [
  "ACES", "REINHARD", "UNCHARTED2", "TEAL_ORANGE", "BLEACH_BYPASS",
  "CROSS_PROCESS", "KODACHROME", "FADED_FILM", "TECHNICOLOR",
  "MATRIX_GREEN", "AMBER_NOIR", "COLD_WINTER",
  "LOMO", "VELVIA", "PORTRA", "TRIX_BW", "DUNE", "MOONRISE",
  "CLARENDON", "NASHVILLE", "MAGIC_HOUR", "JOHN_WICK",
  "WES_ANDERSON", "FURY_ROAD", "NEGATIVE",
  "KODAK_GOLD", "FUJI_PRO_400H", "CINESTILL_800T", "ILFORD_HP5",
  "EKTACHROME", "AGFA_VISTA", "DEAKINS", "AMELIE",
  "SAVING_RYAN", "THREE_HUNDRED", "BLADE_RUNNER", "SIN_CITY",
  "BREAKING_BAD", "MR_ROBOT", "REVENANT", "INCEPTION",
  "DRIVE", "STRANGER_THINGS", "JOKER_2019",
] as const;

export const optionTypes = {
  preset: {
    type: ENUM,
    options: PRESET_KEYS.map(k => ({ name: PRESET_NAMES[k], value: k })),
    default: "ACES" as typeof PRESET_KEYS[number],
    desc: "Colour-grade lookup — iconic tonemap and film-style looks" },
  strength: { type: RANGE, range: [0, 1.5], step: 0.05, default: 1, desc: "Blend/overshoot toward graded image (0 = source, 1 = fully graded, >1 = push past grade for extreme looks)" },
  exposure: { type: RANGE, range: [-5, 5], step: 0.1, default: 0, desc: "Pre-grade exposure in stops (2^exposure multiplier)" },
  palette: { type: PALETTE, default: nearest } };

export const defaults = {
  preset: optionTypes.preset.default,
  strength: optionTypes.strength.default,
  exposure: optionTypes.exposure.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } } };

const sat01 = (v: number) => Math.max(0, Math.min(1, v));
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Mirrors of the GLSL transforms — used by the JS fallback path.
const grade = (preset: string, r: number, g: number, b: number): [number, number, number] => {
  switch (preset) {
    case "ACES": {
      const a = 2.51, bb = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return [
        sat01((r * (a * r + bb)) / (r * (c * r + d) + e)),
        sat01((g * (a * g + bb)) / (g * (c * g + d) + e)),
        sat01((b * (a * b + bb)) / (b * (c * b + d) + e)),
      ];
    }
    case "REINHARD":
      return [r / (1 + r), g / (1 + g), b / (1 + b)];
    case "UNCHARTED2": {
      const A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30, W = 11.2;
      const hable = (x: number) => ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
      const wh = hable(W);
      return [hable(r * 2) / wh, hable(g * 2) / wh, hable(b * 2) / wh];
    }
    case "TEAL_ORANGE": {
      const l = luma(r, g, b);
      const rr = r + (l - 0.4) * 0.22;
      const gg = g + (l - 0.5) * 0.05;
      let bb = b - (l - 0.5) * 0.28;
      bb = Math.max(bb, b * 0.7);
      const l2 = luma(rr, gg, bb);
      return [l2 + (rr - l2) * 1.25, l2 + (gg - l2) * 1.25, l2 + (bb - l2) * 1.25];
    }
    case "BLEACH_BYPASS": {
      const l = luma(r, g, b);
      const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
      const dr = mix(l, r, 0.4), dg = mix(l, g, 0.4), db = mix(l, b, 0.4);
      return [(dr - 0.5) * 1.35 + 0.5, (dg - 0.5) * 1.35 + 0.5, (db - 0.5) * 1.35 + 0.5];
    }
    case "CROSS_PROCESS": {
      const ssf = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
      const rr = Math.pow(sat01(r), 0.85) * 1.05;
      const gg = ssf(0.05, 0.95, g);
      const bb = 0.05 + (0.95 - 0.05) * Math.pow(sat01(b), 1.25);
      return [rr, gg, bb];
    }
    case "KODACHROME": {
      const rr = Math.pow(Math.max(0, r), 0.92) * 1.08;
      const gg = Math.pow(Math.max(0, g), 0.92) * 1.02;
      const bb = Math.pow(Math.max(0, b), 0.92) * 0.92;
      const l = luma(rr, gg, bb);
      return [l + (rr - l) * 1.3, l + (gg - l) * 1.3, l + (bb - l) * 1.3];
    }
    case "FADED_FILM":
      return [
        r * 0.82 + 0.12 + Math.max(0, 0.12 - r) * 0.6,
        g * 0.82 + 0.12,
        b * 0.82 + 0.12 - Math.max(0, 0.12 - b) * 0.3,
      ];
    case "TECHNICOLOR": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 1.5) * 1.05;
      const gg = (l + (g - l) * 1.5) * 0.98;
      const bb = (l + (b - l) * 1.5) * 1.02;
      return [rr, gg, bb];
    }
    case "MATRIX_GREEN": {
      const l = luma(r, g, b);
      return [
        (l * 0.35 - 0.5) * 1.2 + 0.5,
        (l * 1.15 - 0.5) * 1.2 + 0.5,
        (l * 0.4  - 0.5) * 1.2 + 0.5,
      ];
    }
    case "AMBER_NOIR": {
      const l = luma(r, g, b);
      const t = l * l * (3 - 2 * l);
      const ar = 0.1 + (1.0 - 0.1) * t;
      const ag = 0.08 + (0.75 - 0.08) * t;
      const ab = 0.05 + (0.35 - 0.05) * t;
      return [l + (ar - l) * 0.85, l + (ag - l) * 0.85, l + (ab - l) * 0.85];
    }
    case "COLD_WINTER": {
      const l = luma(r, g, b);
      const rr = l + (r * 0.75 - l) * 0.55;
      const gg = l + (g * 0.9 - l) * 0.55;
      const bb = l + (b * 1.05 - l) * 0.55;
      return [rr * 0.88 + 0.08, gg * 0.88 + 0.08, bb * 0.88 + 0.08];
    }
    case "LOMO": {
      const l = luma(r, g, b);
      let rr = l + (r - l) * 1.45;
      let gg = l + (g - l) * 1.45;
      let bb = l + (b - l) * 1.45;
      rr = Math.pow(sat01(rr), 0.9);
      bb = Math.pow(sat01(bb), 1.15);
      rr += 0.04; gg += 0.02; bb -= 0.02;
      return [(rr - 0.5) * 1.15 + 0.5, (gg - 0.5) * 1.15 + 0.5, (bb - 0.5) * 1.15 + 0.5];
    }
    case "VELVIA": {
      const l = luma(r, g, b);
      const rr = l + (r - l) * 1.7;
      const gg = (l + (g - l) * 1.7) * 1.05;
      const bb = (l + (b - l) * 1.7) * 1.08;
      return [Math.pow(sat01(rr), 0.95), Math.pow(sat01(gg), 0.95), Math.pow(sat01(bb), 0.95)];
    }
    case "PORTRA": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 0.82) * 0.92 + 0.06;
      const gg = (l + (g - l) * 0.82) * 0.92 + 0.06;
      const bb = (l + (b - l) * 0.82) * 0.92 + 0.06;
      return [rr * 1.06, gg * 1.02, bb * 0.95];
    }
    case "TRIX_BW": {
      let l = luma(r, g, b);
      l = (l - 0.5) * 1.25 + 0.5;
      l = l + Math.sin(l * Math.PI) * 0.04;
      return [l, l, l];
    }
    case "DUNE": {
      const l = luma(r, g, b);
      const t = l * l * (3 - 2 * l);
      const orange = [1.05, 0.55, 0.15];
      const shadow = [0.12, 0.05, 0.0];
      const yr = shadow[0] + (orange[0] - shadow[0]) * t;
      const yg = shadow[1] + (orange[1] - shadow[1]) * t;
      const yb = shadow[2] + (orange[2] - shadow[2]) * t;
      return [l + (yr - l) * 0.9, l + (yg - l) * 0.9, l + (yb - l) * 0.9];
    }
    case "MOONRISE": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 0.55) * 0.92;
      const gg = (l + (g - l) * 0.55) * 0.98;
      const bb = (l + (b - l) * 0.55) * 1.08;
      return [rr * 0.9 + 0.08, gg * 0.9 + 0.08, bb * 0.9 + 0.08];
    }
    case "CLARENDON": {
      const l = luma(r, g, b);
      let rr = l + (r - l) * 1.3;
      let gg = l + (g - l) * 1.3;
      let bb = l + (b - l) * 1.3;
      rr += -0.05 * (1 - l) + 0.04 * l;
      gg += 0.05 * (1 - l) + 0.04 * l;
      bb += 0.08 * (1 - l) + 0.06 * l;
      return [rr, gg, bb];
    }
    case "NASHVILLE": {
      const yr = Math.pow(sat01(r * 0.9 + 0.08), 0.9);
      const yg = g * 0.9 + 0.02;
      const yb = Math.pow(sat01(b * 0.9), 1.1);
      return [yr, yg, yb];
    }
    case "MAGIC_HOUR": {
      const l = luma(r, g, b);
      const rr = r + (1 - l) * 0.05 + l * 0.1 + 0.03;
      const gg = g + l * 0.03 - 0.01;
      const bb = b - l * 0.08 + 0.02;
      return [l + (rr - l) * 1.1, l + (gg - l) * 1.1, l + (bb - l) * 1.1];
    }
    case "JOHN_WICK": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 0.7) * 0.85;
      const gg = (l + (g - l) * 0.7) * 1.02;
      const bb = (l + (b - l) * 0.7) * 1.1;
      return [((rr - 0.5) * 1.25 + 0.5) * 0.88, ((gg - 0.5) * 1.25 + 0.5) * 0.88, ((bb - 0.5) * 1.25 + 0.5) * 0.88];
    }
    case "WES_ANDERSON": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 0.75) * 0.85 + 0.15 + 0.03;
      const gg = (l + (g - l) * 0.75) * 0.85 + 0.15;
      const bb = (l + (b - l) * 0.75) * 0.85 + 0.15 - 0.02;
      return [Math.pow(sat01(rr), 0.92), Math.pow(sat01(gg), 0.92), Math.pow(sat01(bb), 0.92)];
    }
    case "FURY_ROAD": {
      const l = luma(r, g, b);
      let rr = r + (l - 0.4) * 0.35;
      let gg = g;
      let bb = b - (l - 0.5) * 0.4;
      bb = Math.max(bb, b * 0.5);
      const l2 = luma(rr, gg, bb);
      rr = l2 + (rr - l2) * 1.55;
      gg = l2 + (gg - l2) * 1.55;
      bb = l2 + (bb - l2) * 1.55;
      return [(rr - 0.5) * 1.3 + 0.5, (gg - 0.5) * 1.3 + 0.5, (bb - 0.5) * 1.3 + 0.5];
    }
    case "NEGATIVE":
      return [1 - sat01(r), 1 - sat01(g), 1 - sat01(b)];
    case "KODAK_GOLD": {
      const l = luma(r, g, b);
      const rr = r * 1.08 + (1 - l) * 0.03;
      const gg = g * 1.02 + (1 - l) * 0.01;
      const bb = b * 0.88 - (1 - l) * 0.02;
      const l2 = luma(rr, gg, bb);
      return [l2 + (rr - l2) * 1.1, l2 + (gg - l2) * 1.1, l2 + (bb - l2) * 1.1];
    }
    case "FUJI_PRO_400H": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 0.7) * 0.85 + 0.14;
      const gg = (l + (g - l) * 0.7) * 0.85 + 0.14;
      const bb = (l + (b - l) * 0.7) * 0.85 + 0.14;
      return [rr * 0.98, gg * 1.01, bb * 1.04];
    }
    case "CINESTILL_800T": {
      const l = luma(r, g, b);
      const rr = r - (1 - l) * 0.02 + l * l * 0.12;
      const gg = g;
      const bb = b + (1 - l) * 0.08 + l * l * 0.05;
      const l2 = luma(rr, gg, bb);
      return [l2 + (rr - l2) * 1.15, l2 + (gg - l2) * 1.15, l2 + (bb - l2) * 1.15];
    }
    case "ILFORD_HP5": {
      let l = luma(r, g, b);
      l = Math.pow(sat01(l), 0.9);
      l = (l - 0.5) * 1.18 + 0.5;
      return [l, l, l];
    }
    case "EKTACHROME": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 1.3) * 0.98;
      const gg = l + (g - l) * 1.3;
      const bb = (l + (b - l) * 1.3) * 1.07;
      return [(rr - 0.5) * 1.05 + 0.5, (gg - 0.5) * 1.05 + 0.5, (bb - 0.5) * 1.05 + 0.5];
    }
    case "AGFA_VISTA": {
      const l = luma(r, g, b);
      let rr = r * 1.12;
      let gg = g * 1.02;
      let bb = b * 0.92;
      rr = l + (rr - l) * 1.15;
      gg = l + (gg - l) * 1.15;
      bb = l + (bb - l) * 1.15;
      return [rr * 0.92 + 0.06, gg * 0.92 + 0.06, bb * 0.92 + 0.06];
    }
    case "DEAKINS": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 0.5) * 0.96;
      const gg = l + (g - l) * 0.5;
      const bb = (l + (b - l) * 0.5) * 1.05;
      return [(rr - 0.5) * 1.1 + 0.5 - 0.03, (gg - 0.5) * 1.1 + 0.5 - 0.03, (bb - 0.5) * 1.1 + 0.5 - 0.03];
    }
    case "AMELIE": {
      const rr = r * 1.15 + 0.02;
      const gg = g * 1.1 + 0.03;
      const bb = b * 0.82 - 0.02;
      const l2 = luma(rr, gg, bb);
      return [l2 + (rr - l2) * 1.2, l2 + (gg - l2) * 1.2, l2 + (bb - l2) * 1.2];
    }
    case "SAVING_RYAN": {
      const l = luma(r, g, b);
      let rr = l + (r - l) * 0.22;
      let gg = l + (g - l) * 0.22;
      let bb = l + (b - l) * 0.22;
      rr = ((rr - 0.5) * 1.45 + 0.5) * 1.05;
      gg = ((gg - 0.5) * 1.45 + 0.5) * 1.02;
      bb = ((bb - 0.5) * 1.45 + 0.5) * 0.88;
      return [rr, gg, bb];
    }
    case "THREE_HUNDRED": {
      const l = luma(r, g, b);
      let rr = r + (l - 0.3) * 0.25;
      let gg = g * 0.85;
      let bb = Math.max(0.02, b - l * 0.25);
      const l2 = luma(rr, gg, bb);
      rr = l2 + (rr - l2) * 1.4;
      gg = l2 + (gg - l2) * 1.4;
      bb = l2 + (bb - l2) * 1.4;
      return [(rr - 0.5) * 1.15 + 0.5, (gg - 0.5) * 1.15 + 0.5, (bb - 0.5) * 1.15 + 0.5];
    }
    case "BLADE_RUNNER": {
      const l = luma(r, g, b);
      let rr = r + l * l * 0.2;
      let gg = g + (1 - l) * 0.05;
      let bb = b + (1 - l) * 0.18;
      const l2 = luma(rr, gg, bb);
      rr = l2 + (rr - l2) * 0.9;
      gg = l2 + (gg - l2) * 0.9;
      bb = l2 + (bb - l2) * 0.9;
      return [rr * 0.92 + 0.04, gg * 0.92 + 0.04, bb * 0.92 + 0.04];
    }
    case "SIN_CITY": {
      let l = luma(r, g, b);
      l = (l - 0.5) * 1.8 + 0.5;
      const t = Math.max(0, Math.min(1, (l - 0.05) / 0.9));
      l = t * t * (3 - 2 * t);
      return [l, l, l];
    }
    case "BREAKING_BAD": {
      const rr = r * 1.08 + 0.03;
      const gg = g * 1.06 + 0.02;
      const bb = b * 0.78 - 0.02;
      const l2 = luma(rr, gg, bb);
      return [l2 + (rr - l2) * 1.15, l2 + (gg - l2) * 1.15, l2 + (bb - l2) * 1.15];
    }
    case "MR_ROBOT": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 0.55) * 0.95;
      const gg = (l + (g - l) * 0.55) * 1.08;
      const bb = (l + (b - l) * 0.55) * 0.88;
      return [(rr - 0.5) * 1.08 + 0.5, (gg - 0.5) * 1.08 + 0.5, (bb - 0.5) * 1.08 + 0.5];
    }
    case "REVENANT": {
      const l = luma(r, g, b);
      const rr = (l + (r - l) * 0.55) * 0.92;
      const gg = (l + (g - l) * 0.55) * 0.96;
      const bb = (l + (b - l) * 0.55) * 1.08;
      return [rr * 0.92 + 0.08, gg * 0.92 + 0.08, bb * 0.92 + 0.08];
    }
    case "INCEPTION": {
      const l = luma(r, g, b);
      const rr = r + (l - 0.4) * 0.25;
      const gg = g * 0.98;
      let bb = b + (0.5 - l) * 0.25;
      bb = Math.max(bb, b * 0.6);
      const l2 = luma(rr, gg, bb);
      return [l2 + (rr - l2) * 1.3, l2 + (gg - l2) * 1.3, l2 + (bb - l2) * 1.3];
    }
    case "DRIVE": {
      const l = luma(r, g, b);
      const rr = r + l * 0.1 + 0.03;
      const gg = g * 0.88 - 0.02;
      const bb = b + l * 0.08 + (1 - l) * 0.1 + 0.03;
      const l2 = luma(rr, gg, bb);
      return [l2 + (rr - l2) * 1.15, l2 + (gg - l2) * 1.15, l2 + (bb - l2) * 1.15];
    }
    case "STRANGER_THINGS": {
      const l = luma(r, g, b);
      const rr = Math.max(r, r + l * l * 0.18);
      const gg = g + (1 - l) * 0.04;
      const bb = b + (1 - l) * 0.12;
      const l2 = luma(rr, gg, bb);
      return [l2 + (rr - l2) * 1.2, l2 + (gg - l2) * 1.2, l2 + (bb - l2) * 1.2];
    }
    case "JOKER_2019": {
      let rr = r * 1.05 - 0.02;
      let gg = g * 1.1 + 0.04;
      let bb = b * 0.75 - 0.03;
      const l2 = luma(rr, gg, bb);
      rr = l2 + (rr - l2) * 1.25;
      gg = l2 + (gg - l2) * 1.25;
      bb = l2 + (bb - l2) * 1.25;
      return [(rr - 0.5) * 1.1 + 0.5, (gg - 0.5) * 1.1 + 0.5, (bb - 0.5) * 1.1 + 0.5];
    }
    default:
      return [r, g, b];
  }
};

const lut = (input: any, options: typeof defaults = defaults) => {
  const { preset, strength, exposure, palette } = options;
  const W = input.width, H = input.height;
  const presetId = LUT_PRESET[preset] ?? 0;

  const rendered = renderLUTGL(input, W, H, presetId, strength, exposure);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("LUT", "WebGL2", `${preset} str=${strength}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "LUT",
  func: lut,
  optionTypes,
  options: defaults,
  defaults,
  description: "Colour grading lookup with iconic tonemaps (ACES, Reinhard, Hable) and film styles (Teal & Orange, Bleach Bypass, Kodachrome, Technicolor, Cross Process, Matrix Green, Amber Noir, Faded Film, Cold Winter)",
  requiresGL: true });
