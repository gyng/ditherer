import { ACTION, RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const PRESET_CUSTOM    = "CUSTOM";
export const PRESET_CORAL     = "CORAL";
export const PRESET_WORMS     = "WORMS";
export const PRESET_SOLITONS  = "SOLITONS";
export const PRESET_PULSATING = "PULSATING";
export const PRESET_LABYRINTH = "LABYRINTH";

const PRESETS: Record<string, { feed: number; kill: number }> = {
  [PRESET_CORAL]:     { feed: 0.0545, kill: 0.062  },
  [PRESET_WORMS]:     { feed: 0.078,  kill: 0.061  },
  [PRESET_SOLITONS]:  { feed: 0.03,   kill: 0.058  },
  [PRESET_PULSATING]: { feed: 0.025,  kill: 0.06   },
  [PRESET_LABYRINTH]: { feed: 0.037,  kill: 0.06   },
  [PRESET_CUSTOM]:    { feed: 0.055,  kill: 0.062  }
};

export const optionTypes = {
  preset: {
    type: ENUM,
    options: [
      { name: "Coral",     value: PRESET_CORAL     },
      { name: "Worms",     value: PRESET_WORMS     },
      { name: "Solitons",  value: PRESET_SOLITONS  },
      { name: "Pulsating", value: PRESET_PULSATING },
      { name: "Labyrinth", value: PRESET_LABYRINTH },
      { name: "Custom",    value: PRESET_CUSTOM    }
    ],
    default: PRESET_CORAL,
    desc: "Pattern preset — sets feed/kill parameters"
  },
  iterations: { type: RANGE, range: [1, 100], step: 1, default: 30, desc: "Simulation steps per frame" },
  feed: { type: RANGE, range: [0, 0.1], step: 0.001, default: 0.055, desc: "Chemical A feed rate" },
  kill: { type: RANGE, range: [0, 0.1], step: 0.001, default: 0.062, desc: "Chemical B kill rate" },
  diffusionA: { type: RANGE, range: [0, 1], step: 0.01, default: 1.0, desc: "Diffusion rate of chemical A" },
  diffusionB: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Diffusion rate of chemical B" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 4 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 4); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  preset: optionTypes.preset.default,
  iterations: optionTypes.iterations.default,
  feed: optionTypes.feed.default,
  kill: optionTypes.kill.default,
  diffusionA: optionTypes.diffusionA.default,
  diffusionB: optionTypes.diffusionB.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const reactionDiffusion = (input, options: any = defaults) => {
  const { iterations, diffusionA, diffusionB, palette } = options;
  const isAnimating = (options as any)._isAnimating || false;
  const prevOutput = (options as any)._prevOutput as Uint8ClampedArray | null;

  const preset = options.preset ?? PRESET_CUSTOM;
  const feed = preset !== PRESET_CUSTOM ? PRESETS[preset].feed : options.feed;
  const kill = preset !== PRESET_CUSTOM ? PRESETS[preset].kill : options.kill;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  const A = new Float32Array(W * H);
  const B = new Float32Array(W * H);

  // When animating with previous output: decode A/B state from stored pixels
  // We encode A in the green channel and B in the blue channel (scaled to 0-255)
  if (isAnimating && prevOutput && prevOutput.length === buf.length) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = getBufferIndex(x, y, W);
        A[y * W + x] = prevOutput[i + 1] / 255; // green = A
        B[y * W + x] = prevOutput[i + 2] / 255; // blue = B
      }
    }
  } else {
    // Initialize from image luminance
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = getBufferIndex(x, y, W);
        const lum = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
        A[y * W + x] = 1 - lum;
        B[y * W + x] = lum;
      }
    }
  }

  const nextA = new Float32Array(W * H);
  const nextB = new Float32Array(W * H);

  const laplacian = (grid: Float32Array, x: number, y: number) =>
    grid[Math.max(0, y - 1) * W + x] +
    grid[Math.min(H - 1, y + 1) * W + x] +
    grid[y * W + Math.max(0, x - 1)] +
    grid[y * W + Math.min(W - 1, x + 1)] -
    4 * grid[y * W + x];

  for (let iter = 0; iter < iterations; iter++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const a = A[idx];
        const b = B[idx];
        const abb = a * b * b;
        nextA[idx] = Math.max(0, Math.min(1,
          a + diffusionA * laplacian(A, x, y) - abb + feed * (1 - a)
        ));
        nextB[idx] = Math.max(0, Math.min(1,
          b + diffusionB * laplacian(B, x, y) + abb - (kill + feed) * b
        ));
      }
    }
    A.set(nextA);
    B.set(nextB);
  }

  // Render output: encode A/B state in green/blue for temporal persistence,
  // visual output uses A-B scaled by original colors
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const i = getBufferIndex(x, y, W);
      const v = Math.max(0, Math.min(1, A[idx] - B[idx]));

      // Encode A/B in green/blue channels for _prevOutput persistence
      const encR = Math.round(v * 255);
      const encG = Math.round(A[idx] * 255);
      const encB = Math.round(B[idx] * 255);

      const color = paletteGetColor(palette, rgba(encR, encG, encB, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Reaction-diffusion",
  func: reactionDiffusion,
  options: defaults,
  optionTypes,
  defaults,
  mainThread: true
};
