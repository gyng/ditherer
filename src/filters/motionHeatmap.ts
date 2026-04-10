import { RANGE, ENUM, ACTION } from "constants/controlTypes";
import { cloneCanvas } from "utils";

const COLORMAP = { INFERNO: "INFERNO", VIRIDIS: "VIRIDIS", HOT: "HOT" };

// Inferno: black → purple → red → yellow → white
const infernoMap = (t: number): [number, number, number] => {
  if (t < 0.25) { const s = t * 4; return [Math.round(s * 100), 0, Math.round(s * 150)]; }
  if (t < 0.5) { const s = (t - 0.25) * 4; return [Math.round(100 + s * 155), Math.round(s * 50), Math.round(150 - s * 100)]; }
  if (t < 0.75) { const s = (t - 0.5) * 4; return [255, Math.round(50 + s * 150), Math.round(50 - s * 50)]; }
  const s = (t - 0.75) * 4; return [255, Math.round(200 + s * 55), Math.round(s * 200)];
};

// Viridis: purple → teal → green → yellow
const viridisMap = (t: number): [number, number, number] => {
  if (t < 0.33) { const s = t * 3; return [Math.round(68 - s * 40), Math.round(1 + s * 120), Math.round(84 + s * 80)]; }
  if (t < 0.66) { const s = (t - 0.33) * 3; return [Math.round(28 + s * 60), Math.round(121 + s * 70), Math.round(164 - s * 80)]; }
  const s = (t - 0.66) * 3; return [Math.round(88 + s * 165), Math.round(191 + s * 40), Math.round(84 - s * 40)];
};

// Hot: black → red → yellow → white
const hotMap = (t: number): [number, number, number] => {
  if (t < 0.33) { const s = t * 3; return [Math.round(s * 255), 0, 0]; }
  if (t < 0.66) { const s = (t - 0.33) * 3; return [255, Math.round(s * 255), 0]; }
  const s = (t - 0.66) * 3; return [255, 255, Math.round(s * 255)];
};

export const optionTypes = {
  accumRate: { type: RANGE, range: [0.01, 0.2], step: 0.01, default: 0.05, desc: "How fast heat builds from motion" },
  coolRate: { type: RANGE, range: [0.001, 0.05], step: 0.001, default: 0.01, desc: "How fast idle areas cool down" },
  colorMap: {
    type: ENUM,
    options: [
      { name: "Inferno (black→red→yellow→white)", value: COLORMAP.INFERNO },
      { name: "Viridis (purple→green→yellow)", value: COLORMAP.VIRIDIS },
      { name: "Hot (black→red→white)", value: COLORMAP.HOT },
    ],
    default: COLORMAP.INFERNO,
    desc: "Color palette for heat visualization",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  accumRate: optionTypes.accumRate.default,
  coolRate: optionTypes.coolRate.default,
  colorMap: optionTypes.colorMap.default,
  animSpeed: optionTypes.animSpeed.default,
};

const motionHeatmap = (input, options: any = defaults) => {
  const { accumRate, coolRate, colorMap } = options;
  const ema: Float32Array | null = (options as any)._ema || null;
  const prevOutput: Uint8ClampedArray | null = (options as any)._prevOutput || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const mapFn = colorMap === COLORMAP.VIRIDIS ? viridisMap : colorMap === COLORMAP.HOT ? hotMap : infernoMap;

  for (let i = 0; i < buf.length; i += 4) {
    const motion = ema
      ? (Math.abs(buf[i] - ema[i]) + Math.abs(buf[i + 1] - ema[i + 1]) + Math.abs(buf[i + 2] - ema[i + 2])) / 765
      : 0;

    // Decode previous heat from red channel (0-255 → 0-1)
    const prevHeat = prevOutput ? prevOutput[i] / 255 : 0;
    const heat = Math.min(1, prevHeat * (1 - coolRate) + motion * accumRate);

    const [r, g, b] = mapFn(heat);
    outBuf[i] = r; outBuf[i + 1] = g; outBuf[i + 2] = b;
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Motion Heatmap", func: motionHeatmap, optionTypes, options: defaults, defaults, mainThread: true, description: "Accumulate motion over time into a persistent heatmap — sustained movement glows hotter" };
