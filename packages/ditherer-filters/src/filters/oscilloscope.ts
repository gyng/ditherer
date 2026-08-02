import { ACTION, BOOL, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas } from "../palettes/backend";
import { cloneCanvas, fillBufferPixel, logFilterBackend } from "../utils/index";
import {
  oscilloscopeBeamDensity,
  oscilloscopeVoltageRow,
} from "./instrumentSensorQualityContracts";
import { oscilloscopeGLAvailable, renderOscilloscopeGL } from "./oscilloscopeGL";
import { defineFilter, type FilterOptionValues } from "./types";

const DISPLAY = {
  WAVEFORM: "WAVEFORM",
  TRACE: "TRACE",
  PARADE: "PARADE",
} as const;

const PHOSPHOR_GREEN = "GREEN";
const PHOSPHOR_BLUE = "BLUE";
const PHOSPHOR_AMBER = "AMBER";
const PHOSPHOR_WHITE = "WHITE";

const phosphorColors = {
  [PHOSPHOR_GREEN]: [32, 255, 32],
  [PHOSPHOR_BLUE]: [64, 128, 255],
  [PHOSPHOR_AMBER]: [255, 176, 32],
  [PHOSPHOR_WHITE]: [210, 225, 255],
} as const;

export const optionTypes = {
  display: {
    type: ENUM,
    options: [
      { name: "Luma waveform", value: DISPLAY.WAVEFORM },
      { name: "Column trace", value: DISPLAY.TRACE },
      { name: "RGB parade", value: DISPLAY.PARADE },
    ],
    default: DISPLAY.WAVEFORM,
    desc: "Signal representation: per-pixel luma density, one mean-luma trace, or separated RGB component levels",
  },
  phosphor: {
    type: ENUM,
    options: [
      { name: "P1/P31 Green", value: PHOSPHOR_GREEN },
      { name: "P11 Blue", value: PHOSPHOR_BLUE },
      { name: "P12 Amber", value: PHOSPHOR_AMBER },
      { name: "P4 White", value: PHOSPHOR_WHITE },
    ],
    default: PHOSPHOR_GREEN,
    desc: "CRT phosphor emission colour used for the waveform trace",
  },
  beamWidth: {
    type: RANGE,
    range: [0.5, 6],
    step: 0.1,
    default: 1.5,
    desc: "Gaussian electron-beam width in display pixels",
  },
  intensity: {
    type: RANGE,
    range: [0.25, 4],
    step: 0.05,
    default: 1.35,
    desc: "Trace exposure gain before phosphor saturation",
  },
  bloom: {
    type: RANGE,
    range: [0, 10],
    step: 1,
    default: 3,
    desc: "Radius of the optical phosphor halo in pixels",
  },
  bloomStrength: {
    type: RANGE,
    range: [0, 3],
    step: 0.05,
    default: 0.65,
    desc: "Brightness of the defocused phosphor halo",
  },
  persistence: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Fraction of the preceding phosphor image retained as afterglow",
  },
  graticule: { type: BOOL, default: true, desc: "Overlay an amplitude/time measurement graticule" },
  graticuleDivs: {
    type: RANGE,
    range: [4, 16],
    step: 1,
    default: 10,
    desc: "Number of major horizontal and vertical graticule divisions",
  },
  noiseFloor: {
    type: RANGE,
    range: [0, 0.1],
    step: 0.005,
    default: 0.008,
    desc: "Low-level display-electronics noise added behind the trace",
  },
  animSpeed: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 15,
    desc: "Refresh rate used by the play control",
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Start or stop temporal phosphor persistence",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
  palette: {
    type: PALETTE,
    default: nearest,
    desc: "Optional output palette applied after the instrument display is rendered",
  },
};

export const defaults = {
  display: optionTypes.display.default,
  phosphor: optionTypes.phosphor.default,
  beamWidth: optionTypes.beamWidth.default,
  intensity: optionTypes.intensity.default,
  bloom: optionTypes.bloom.default,
  bloomStrength: optionTypes.bloomStrength.default,
  persistence: optionTypes.persistence.default,
  graticule: optionTypes.graticule.default,
  graticuleDivs: optionTypes.graticuleDivs.default,
  noiseFloor: optionTypes.noiseFloor.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type OscilloscopePalette = { options?: FilterOptionValues } & Record<string, unknown>;
type OscilloscopeOptions = FilterOptionValues & {
  display?: string;
  phosphor?: string;
  beamWidth?: number;
  intensity?: number;
  bloom?: number;
  bloomStrength?: number;
  persistence?: number;
  graticule?: boolean;
  graticuleDivs?: number;
  noiseFloor?: number;
  animSpeed?: number;
  palette?: OscilloscopePalette;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

const mulberry32 = (seed: number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const finiteOption = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const numeric = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? numeric : fallback));
};

const sourceLevel = (data: Uint8ClampedArray, index: number, channel: number): number => {
  if (channel >= 0) return data[index + channel] / 255;
  return (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255;
};

const addBeam = (
  density: Float32Array,
  width: number,
  height: number,
  x: number,
  level: number,
  beamWidth: number,
  weight: number,
) => {
  const centre = oscilloscopeVoltageRow(level, height);
  const radius = Math.max(1, Math.ceil(beamWidth * 2));
  const y0 = Math.max(0, Math.floor(centre) - radius);
  const y1 = Math.min(height - 1, Math.ceil(centre) + radius);
  for (let y = y0; y <= y1; y += 1) {
    density[y * width + x] += oscilloscopeBeamDensity(y - centre, beamWidth) * weight;
  }
};

const buildDensity = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  display: string,
  beamWidth: number,
): Float32Array => {
  const density = new Float32Array(width * height);
  const sampleCount = Math.min(512, Math.max(1, height));
  if (display === DISPLAY.TRACE) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const sourceY = Math.min(
          height - 1,
          Math.max(0, Math.floor(((sample + 0.5) * height) / sampleCount)),
        );
        sum += sourceLevel(data, (sourceY * width + x) * 4, -1);
      }
      addBeam(density, width, height, x, sum / sampleCount, beamWidth, 4);
    }
    return density;
  }

  const parade = display === DISPLAY.PARADE;
  for (let x = 0; x < width; x += 1) {
    let sourceX = x;
    let channel = -1;
    if (parade) {
      const segment = Math.min(2, Math.floor((x * 3) / Math.max(1, width)));
      const local = (x * 3) / Math.max(1, width) - segment;
      sourceX = Math.min(width - 1, Math.max(0, Math.floor(local * width)));
      channel = segment;
    }
    const sampleWeight = 96 / sampleCount;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const sourceY = Math.min(
        height - 1,
        Math.max(0, Math.floor(((sample + 0.5) * height) / sampleCount)),
      );
      addBeam(
        density,
        width,
        height,
        x,
        sourceLevel(data, (sourceY * width + sourceX) * 4, channel),
        beamWidth,
        sampleWeight,
      );
    }
  }
  return density;
};

const boxBlur = (
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array => {
  if (radius <= 0) return source;
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        sum += source[y * width + Math.max(0, Math.min(width - 1, x + offset))];
        count += 1;
      }
      horizontal[y * width + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        sum += horizontal[Math.max(0, Math.min(height - 1, y + offset)) * width + x];
        count += 1;
      }
      output[y * width + x] = sum / count;
    }
  }
  return output;
};

const oscilloscope = (input: any, options: OscilloscopeOptions = defaults) => {
  const displayCandidate = String(options.display ?? defaults.display);
  const display =
    displayCandidate === DISPLAY.TRACE || displayCandidate === DISPLAY.PARADE
      ? displayCandidate
      : DISPLAY.WAVEFORM;
  const phosphorCandidate = String(options.phosphor ?? defaults.phosphor);
  const phosphor = phosphorCandidate in phosphorColors ? phosphorCandidate : defaults.phosphor;
  const beamWidth = finiteOption(options.beamWidth, defaults.beamWidth, 0.5, 6);
  const intensity = finiteOption(options.intensity, defaults.intensity, 0.25, 4);
  const bloom = finiteOption(options.bloom, defaults.bloom, 0, 10);
  const bloomStrength = finiteOption(options.bloomStrength, defaults.bloomStrength, 0, 3);
  const persistence = finiteOption(options.persistence, defaults.persistence, 0, 1);
  const graticule = Boolean(options.graticule ?? defaults.graticule);
  const graticuleDivs = finiteOption(options.graticuleDivs, defaults.graticuleDivs, 4, 16);
  const noiseFloor = finiteOption(options.noiseFloor, defaults.noiseFloor, 0, 0.1);
  const palette = options.palette ?? defaults.palette;
  const previous = options._prevOutput ?? null;
  const frameIndex = finiteOption(options._frameIndex, 0, 0, Number.MAX_SAFE_INTEGER);
  const width = input.width;
  const height = input.height;
  const phosphorColor =
    phosphorColors[phosphor as keyof typeof phosphorColors] ?? phosphorColors[PHOSPHOR_GREEN];
  const paletteName = (palette as { name?: string }).name;
  const paletteLevels = Number(
    (palette as { options?: { levels?: number } }).options?.levels ?? 256,
  );
  const identityPalette =
    paletteName === "nearest" && Number.isFinite(paletteLevels) && paletteLevels >= 256;

  if (oscilloscopeGLAvailable() && options._webglAcceleration !== false) {
    const rendered = renderOscilloscopeGL(input, width, height, {
      display,
      phosphorColor: [...phosphorColor],
      beamWidth,
      intensity,
      bloom,
      bloomStrength,
      persistence,
      graticule,
      graticuleDivs,
      noiseFloor,
      frameIndex,
      prevOutput: previous,
    });
    if (rendered) {
      const output = identityPalette
        ? rendered
        : applyPalettePassToCanvas(rendered, width, height, palette);
      if (output) {
        logFilterBackend(
          "Oscilloscope",
          "WebGL2",
          `${display} ${phosphor} persistence=${persistence}${identityPalette ? "" : "+palettePass"}`,
        );
        return output;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputContext = input.getContext("2d");
  const outputContext = output.getContext("2d");
  if (!inputContext || !outputContext) return input;
  const source = inputContext.getImageData(0, 0, width, height).data;
  const density = buildDensity(source, width, height, display, Math.max(0.5, beamWidth));
  const exposure = new Float32Array(density.length);
  const random = mulberry32(frameIndex * 3571 + 41);
  for (let index = 0; index < density.length; index += 1) {
    exposure[index] = Math.min(
      1,
      1 - Math.exp(-density[index] * Math.max(0, intensity)) + random() * Math.max(0, noiseFloor),
    );
  }
  const radius = Math.min(10, Math.max(0, Math.round(bloom)));
  const halo = boxBlur(exposure, width, height, radius);
  const buffer = new Uint8ClampedArray(source.length);
  const background = [2, 3, 2];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      const value = Math.min(1, exposure[pixel] + (radius > 0 ? halo[pixel] * bloomStrength : 0));
      fillBufferPixel(
        buffer,
        index,
        background[0] + value * (phosphorColor[0] - background[0]),
        background[1] + value * (phosphorColor[1] - background[1]),
        background[2] + value * (phosphorColor[2] - background[2]),
        255,
      );
    }
  }

  if (graticule) {
    const divisions = Math.max(2, Math.round(graticuleDivs));
    const cellWidth = width / divisions;
    const cellHeight = height / divisions;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const major =
          x % cellWidth < 1 || y % cellHeight < 1 || x === width - 1 || y === height - 1;
        const centre = Math.abs(x - width / 2) < 1 || Math.abs(y - height / 2) < 1;
        if (!major && !centre) continue;
        const index = (y * width + x) * 4;
        const gain = centre ? 0.1 : 0.065;
        buffer[index] = Math.min(255, buffer[index] + phosphorColor[0] * gain);
        buffer[index + 1] = Math.min(255, buffer[index + 1] + phosphorColor[1] * gain);
        buffer[index + 2] = Math.min(255, buffer[index + 2] + phosphorColor[2] * gain);
      }
    }
  }

  if (persistence > 0 && previous?.length === buffer.length) {
    const keep = Math.max(0, Math.min(1, persistence));
    for (let index = 0; index < buffer.length; index += 4) {
      buffer[index] = Math.max(buffer[index], previous[index] * keep);
      buffer[index + 1] = Math.max(buffer[index + 1], previous[index + 1] * keep);
      buffer[index + 2] = Math.max(buffer[index + 2], previous[index + 2] * keep);
    }
  }

  outputContext.putImageData(new ImageData(buffer, width, height), 0, 0);
  return identityPalette
    ? output
    : (applyPalettePassToCanvas(output, width, height, palette) ?? output);
};

export default defineFilter({
  name: "Oscilloscope",
  func: oscilloscope,
  options: defaults,
  optionTypes,
  defaults,
  description:
    "Image-derived luma waveform, column trace, or RGB parade rendered as a persistent phosphor instrument display",
  temporal: true,
});
