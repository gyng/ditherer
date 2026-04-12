import { ACTION, RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const RULE = { CONWAY: "CONWAY", HIGHLIFE: "HIGHLIFE", SEEDS: "SEEDS" };
let stateGrid: Uint8Array | null = null;
let scratchGrid: Uint8Array | null = null;
let stateWidth = 0;
let stateHeight = 0;
let stateRule = "";
let stateThreshold = -1;
let stateFreshInjectionEvery = -1;
let lastFrameIndex = -Infinity;

export const optionTypes = {
  rule: { type: ENUM, options: [
    { name: "Conway (B3/S23)", value: RULE.CONWAY },
    { name: "Highlife (B36/S23)", value: RULE.HIGHLIFE },
    { name: "Seeds (B2/S)", value: RULE.SEEDS }
  ], default: RULE.CONWAY, desc: "Cellular automaton ruleset" },
  steps: { type: RANGE, range: [1, 50], step: 1, default: 5, desc: "Simulation steps per frame" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance cutoff for initial alive/dead state" },
  freshInjectionEvery: { type: RANGE, range: [0, 120], step: 1, default: 0, desc: "Inject fresh live cells from the source image every N frames; 0 disables periodic injection" },
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
  freshInjectionEvery: optionTypes.freshInjectionEvery.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const shouldResetState = (
  width: number,
  height: number,
  rule: string,
  threshold: number,
  freshInjectionEvery: number,
  frameIndex: number
) =>
  !stateGrid
  || !scratchGrid
  || width !== stateWidth
  || height !== stateHeight
  || rule !== stateRule
  || threshold !== stateThreshold
  || freshInjectionEvery !== stateFreshInjectionEvery
  || frameIndex <= lastFrameIndex;

const initializeState = (buf: Uint8ClampedArray, width: number, height: number, threshold: number) => {
  stateGrid = new Uint8Array(width * height);
  scratchGrid = new Uint8Array(width * height);
  stateWidth = width;
  stateHeight = height;
  stateThreshold = threshold;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      stateGrid[y * width + x] = lum > threshold ? 1 : 0;
    }
  }
};

const injectSourceState = (buf: Uint8ClampedArray, width: number, height: number, threshold: number, grid: Uint8Array) => {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      if (lum > threshold) {
        grid[y * width + x] = 1;
      }
    }
  }
};

const cellularAutomata = (input, options = defaults) => {
  const { rule, steps, threshold, freshInjectionEvery, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  if (shouldResetState(W, H, rule, threshold, freshInjectionEvery, frameIndex)) {
    initializeState(buf, W, H, threshold);
    stateRule = rule;
    stateFreshInjectionEvery = freshInjectionEvery;
  } else if (freshInjectionEvery > 0 && frameIndex > 0 && frameIndex % freshInjectionEvery === 0) {
    injectSourceState(buf, W, H, threshold, stateGrid!);
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

  let grid = stateGrid!;
  let next = scratchGrid!;

  for (let step = 0; step < steps; step += 1) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = (x + dx + W) % W;
            const ny = (y + dy + H) % H;
            neighbors += grid[ny * W + nx];
          }
        }
        const alive = grid[y * W + x] === 1;
        if (alive) next[y * W + x] = survive.includes(neighbors) ? 1 : 0;
        else next[y * W + x] = birth.includes(neighbors) ? 1 : 0;
      }
    }
    const swap = grid;
    grid = next;
    next = swap;
  }
  stateGrid = grid;
  scratchGrid = next;
  stateRule = rule;
  stateFreshInjectionEvery = freshInjectionEvery;
  lastFrameIndex = frameIndex;

  // Render: alive cells use original color, dead cells are dark
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const alive = grid[y * W + x] === 1;
      const r = alive ? buf[i] : 0;
      const g = alive ? buf[i + 1] : 0;
      const b = alive ? buf[i + 2] : 0;
      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export const __testing = {
  injectSourceState,
};

export default defineFilter({ name: "Cellular Automata", func: cellularAutomata, optionTypes, options: defaults, defaults, mainThread: true });
