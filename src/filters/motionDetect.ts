import { ACTION, COLOR, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

const SOURCE = {
  EMA: "EMA",
  PREVIOUS_FRAME: "PREVIOUS_FRAME",
};

const RENDER = {
  MASK: "MASK",
  HEATMAP: "HEATMAP",
  SOURCE: "SOURCE",
  DIFFERENCE: "DIFFERENCE",
  ACCUMULATED_HEAT: "ACCUMULATED_HEAT",
};

const COLORMAP = {
  INFERNO: "INFERNO",
  VIRIDIS: "VIRIDIS",
  HOT: "HOT",
};

const infernoMap = (t: number): [number, number, number] => {
  if (t < 0.25) { const s = t * 4; return [Math.round(s * 100), 0, Math.round(s * 150)]; }
  if (t < 0.5) { const s = (t - 0.25) * 4; return [Math.round(100 + s * 155), Math.round(s * 50), Math.round(150 - s * 100)]; }
  if (t < 0.75) { const s = (t - 0.5) * 4; return [255, Math.round(50 + s * 150), Math.round(50 - s * 50)]; }
  const s = (t - 0.75) * 4; return [255, Math.round(200 + s * 55), Math.round(s * 200)];
};

const viridisMap = (t: number): [number, number, number] => {
  if (t < 0.33) { const s = t * 3; return [Math.round(68 - s * 40), Math.round(1 + s * 120), Math.round(84 + s * 80)]; }
  if (t < 0.66) { const s = (t - 0.33) * 3; return [Math.round(28 + s * 60), Math.round(121 + s * 70), Math.round(164 - s * 80)]; }
  const s = (t - 0.66) * 3; return [Math.round(88 + s * 165), Math.round(191 + s * 40), Math.round(84 - s * 40)];
};

const hotMap = (t: number): [number, number, number] => {
  if (t < 0.33) { const s = t * 3; return [Math.round(s * 255), 0, 0]; }
  if (t < 0.66) { const s = (t - 0.33) * 3; return [255, Math.round(s * 255), 0]; }
  const s = (t - 0.66) * 3; return [255, 255, Math.round(s * 255)];
};

const getMapFn = (mode: string) =>
  mode === COLORMAP.VIRIDIS ? viridisMap : mode === COLORMAP.HOT ? hotMap : infernoMap;

export const optionTypes = {
  source: {
    type: ENUM,
    options: [
      { name: "EMA background", value: SOURCE.EMA },
      { name: "Previous frame", value: SOURCE.PREVIOUS_FRAME },
    ],
    default: SOURCE.EMA,
    desc: "Compare against the running background model or just the immediately previous frame",
  },
  renderMode: {
    type: ENUM,
    options: [
      { name: "Mask", value: RENDER.MASK },
      { name: "Heatmap", value: RENDER.HEATMAP },
      { name: "Source color", value: RENDER.SOURCE },
      { name: "Difference highlight", value: RENDER.DIFFERENCE },
      { name: "Accumulated heat", value: RENDER.ACCUMULATED_HEAT },
    ],
    default: RENDER.MASK,
    desc: "How to visualize detected motion",
  },
  threshold: { type: RANGE, range: [0, 50], step: 1, default: 10, desc: "Minimum pixel change to register as motion" },
  sensitivity: {
    type: RANGE,
    range: [1, 10],
    step: 0.5,
    default: 3,
    desc: "Amplify detected motion intensity",
    visibleWhen: (options: any) => options.renderMode !== RENDER.ACCUMULATED_HEAT,
  },
  backgroundColor: {
    type: COLOR,
    default: [0, 0, 0],
    desc: "Background color where no motion is detected",
    visibleWhen: (options: any) => options.renderMode !== RENDER.ACCUMULATED_HEAT,
  },
  colorMap: {
    type: ENUM,
    options: [
      { name: "Inferno", value: COLORMAP.INFERNO },
      { name: "Viridis", value: COLORMAP.VIRIDIS },
      { name: "Hot", value: COLORMAP.HOT },
    ],
    default: COLORMAP.INFERNO,
    desc: "Color palette for heat visualization",
    visibleWhen: (options: any) => options.renderMode === RENDER.HEATMAP || options.renderMode === RENDER.ACCUMULATED_HEAT,
  },
  accumRate: {
    type: RANGE,
    range: [0.01, 0.2],
    step: 0.01,
    default: 0.05,
    desc: "How quickly motion builds heat over time",
    visibleWhen: (options: any) => options.renderMode === RENDER.ACCUMULATED_HEAT,
  },
  coolRate: {
    type: RANGE,
    range: [0.001, 0.05],
    step: 0.001,
    default: 0.01,
    desc: "How quickly idle areas cool in accumulated heat mode",
    visibleWhen: (options: any) => options.renderMode === RENDER.ACCUMULATED_HEAT,
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  } },
};

export const defaults = {
  source: optionTypes.source.default,
  renderMode: optionTypes.renderMode.default,
  threshold: optionTypes.threshold.default,
  sensitivity: optionTypes.sensitivity.default,
  backgroundColor: optionTypes.backgroundColor.default,
  colorMap: optionTypes.colorMap.default,
  accumRate: optionTypes.accumRate.default,
  coolRate: optionTypes.coolRate.default,
  animSpeed: optionTypes.animSpeed.default,
};

type MotionDetectOptions = FilterOptionValues & {
  source?: string;
  renderMode?: string;
  threshold?: number;
  sensitivity?: number;
  backgroundColor?: number[];
  colorMap?: string;
  accumRate?: number;
  coolRate?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _prevInput?: Uint8ClampedArray | null;
  _prevOutput?: Uint8ClampedArray | null;
};

const motionAnalysis = (input: any, options: MotionDetectOptions = defaults) => {
  const source = String(options.source ?? defaults.source);
  const renderMode = String(options.renderMode ?? defaults.renderMode);
  const threshold = Number(options.threshold ?? defaults.threshold);
  const sensitivity = Number(options.sensitivity ?? defaults.sensitivity);
  const backgroundColor = Array.isArray(options.backgroundColor)
    ? options.backgroundColor
    : defaults.backgroundColor;
  const colorMap = String(options.colorMap ?? defaults.colorMap);
  const accumRate = Number(options.accumRate ?? defaults.accumRate);
  const coolRate = Number(options.coolRate ?? defaults.coolRate);
  const ema = options._ema ?? null;
  const prevInput = options._prevInput ?? null;
  const prevOutput = options._prevOutput ?? null;
  const reference = source === SOURCE.PREVIOUS_FRAME ? prevInput : ema;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const mapFn = getMapFn(colorMap);

  for (let i = 0; i < buf.length; i += 4) {
    if (!reference) {
      if (renderMode === RENDER.ACCUMULATED_HEAT) {
        outBuf[i] = 0;
        outBuf[i + 1] = 0;
        outBuf[i + 2] = 0;
      } else {
        outBuf[i] = Math.round(buf[i] * 0.3);
        outBuf[i + 1] = Math.round(buf[i + 1] * 0.3);
        outBuf[i + 2] = Math.round(buf[i + 2] * 0.3);
      }
      outBuf[i + 3] = 255;
      continue;
    }

    const diff = (Math.abs(buf[i] - reference[i]) + Math.abs(buf[i + 1] - reference[i + 1]) + Math.abs(buf[i + 2] - reference[i + 2])) / 3;
    const motion = Math.min(1, Math.max(0, ((diff - threshold) / 80) * sensitivity));

    if (renderMode === RENDER.ACCUMULATED_HEAT) {
      const prevHeat = prevOutput ? prevOutput[i] / 255 : 0;
      const heat = Math.min(1, prevHeat * (1 - coolRate) + (diff / 255) * accumRate);
      const [r, g, b] = mapFn(heat);
      outBuf[i] = r;
      outBuf[i + 1] = g;
      outBuf[i + 2] = b;
      outBuf[i + 3] = 255;
      continue;
    }

    if (diff < threshold) {
      outBuf[i] = backgroundColor[0];
      outBuf[i + 1] = backgroundColor[1];
      outBuf[i + 2] = backgroundColor[2];
      outBuf[i + 3] = 255;
      continue;
    }

    if (renderMode === RENDER.MASK) {
      const v = Math.round(motion * 255);
      outBuf[i] = v;
      outBuf[i + 1] = v;
      outBuf[i + 2] = v;
    } else if (renderMode === RENDER.HEATMAP) {
      const [r, g, b] = mapFn(motion);
      outBuf[i] = r;
      outBuf[i + 1] = g;
      outBuf[i + 2] = b;
    } else if (renderMode === RENDER.SOURCE) {
      outBuf[i] = buf[i];
      outBuf[i + 1] = buf[i + 1];
      outBuf[i + 2] = buf[i + 2];
    } else {
      const v = Math.round(Math.min(255, 64 + diff * 3));
      outBuf[i] = v;
      outBuf[i + 1] = v;
      outBuf[i + 2] = v;
    }
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Motion Analysis",
  func: motionAnalysis,
  optionTypes,
  options: defaults,
  defaults,
  description: "Analyze motion against the background model or previous frame and render it as a mask, highlight, or persistent heatmap",
});
