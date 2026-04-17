import { ACTION, RANGE, BOOL, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderNoiseGeneratorGL, type NoiseType } from "./noiseGeneratorGL";

const NOISE_TYPE = {
  PERLIN: "PERLIN",
  SIMPLEX: "SIMPLEX",
  WORLEY: "WORLEY"
};

export const optionTypes = {
  type: {
    type: ENUM,
    options: [
      { name: "Perlin", value: NOISE_TYPE.PERLIN },
      { name: "Simplex", value: NOISE_TYPE.SIMPLEX },
      { name: "Worley", value: NOISE_TYPE.WORLEY }
    ],
    default: NOISE_TYPE.PERLIN,
    desc: "Noise algorithm type"
  },
  scale: { type: RANGE, range: [1, 200], step: 1, default: 50, desc: "Noise feature size in pixels" },
  octaves: { type: RANGE, range: [1, 8], step: 1, default: 4, desc: "Fractal octave layers — more = finer detail" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for noise pattern" },
  colorize: { type: BOOL, default: false, desc: "Generate colored noise instead of grayscale" },
  mix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Blend amount with source image" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 10 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 10); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  type: optionTypes.type.default,
  scale: optionTypes.scale.default,
  octaves: optionTypes.octaves.default,
  seed: optionTypes.seed.default,
  colorize: optionTypes.colorize.default,
  mix: optionTypes.mix.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type NoiseGeneratorOptions = typeof defaults & { _frameIndex?: number };

const noiseGenerator = (input: any, options: NoiseGeneratorOptions = defaults) => {
  const { type, scale, octaves, seed: seedOpt, colorize, mix, palette } = options;
  const frameIndex = options._frameIndex || 0;
  const W = input.width, H = input.height;
  const typeInt = type === NOISE_TYPE.SIMPLEX ? 1 : type === NOISE_TYPE.WORLEY ? 2 : 0;
  const rendered = renderNoiseGeneratorGL(
    input, W, H,
    typeInt as NoiseType, scale, octaves, seedOpt, frameIndex, colorize, mix,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Noise Generator", "WebGL2", `type=${type} octaves=${octaves}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Noise Generator",
  func: noiseGenerator,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
