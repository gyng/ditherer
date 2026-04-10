import { ACTION, RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const RULE = { CONWAY: "CONWAY", HIGHLIFE: "HIGHLIFE", SEEDS: "SEEDS" };

export const optionTypes = {
  rule: { type: ENUM, options: [
    { name: "Conway (B3/S23)", value: RULE.CONWAY },
    { name: "Highlife (B36/S23)", value: RULE.HIGHLIFE },
    { name: "Seeds (B2/S)", value: RULE.SEEDS }
  ], default: RULE.CONWAY, desc: "Cellular automaton ruleset" },
  steps: { type: RANGE, range: [1, 50], step: 1, default: 5, desc: "Simulation steps per frame" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance cutoff for initial alive/dead state" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 8 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _filterFunc, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 8); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  rule: optionTypes.rule.default,
  steps: optionTypes.steps.default,
  threshold: optionTypes.threshold.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const cellularAutomata = (input, options: any = defaults) => {
  const { rule, steps, threshold, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Initialize grid from image luminance
  let grid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      grid[y * W + x] = lum > threshold ? 1 : 0;
    }

  // Birth/survival rules
  const getBirthSurvive = () => {
    switch (rule) {
      case RULE.HIGHLIFE: return { birth: [3, 6], survive: [2, 3] };
      case RULE.SEEDS: return { birth: [2], survive: [] as number[] };
      default: return { birth: [3], survive: [2, 3] };
    }
  };
  const { birth, survive } = getBirthSurvive();

  // Run simulation steps (offset by frameIndex for animation)
  const totalSteps = steps + frameIndex;
  for (let step = 0; step < totalSteps; step++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (x + dx + W) % W;
            const ny = (y + dy + H) % H;
            neighbors += grid[ny * W + nx];
          }
        const alive = grid[y * W + x] === 1;
        if (alive) next[y * W + x] = survive.includes(neighbors) ? 1 : 0;
        else next[y * W + x] = birth.includes(neighbors) ? 1 : 0;
      }
    }
    grid = next;
  }

  // Render: alive cells use original color, dead cells are dark
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const alive = grid[y * W + x] === 1;
      const r = alive ? buf[i] : 0;
      const g = alive ? buf[i + 1] : 0;
      const b = alive ? buf[i + 2] : 0;
      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Cellular Automata", func: cellularAutomata, optionTypes, options: defaults, defaults };
