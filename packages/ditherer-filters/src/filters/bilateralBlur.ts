import { ENUM, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { cloneCanvas, logFilterBackend, logFilterWasmStatus } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { glAvailable } from "../gl/index";
import { renderBilateralBlurGL } from "./bilateralBlurGL";

const WORKING_RESOLUTION = {
  FULL: "FULL",
  HALF: "HALF",
  QUARTER: "QUARTER",
} as const;

export const optionTypes = {
  sigmaSpatial: {
    type: RANGE, range: [1, 12], step: 0.5, default: 5,
    desc: "Spatial Gaussian standard deviation in output pixels",
  },
  sigmaRange: {
    type: RANGE, range: [1, 100], step: 1, default: 30,
    desc: "Color-similarity standard deviation — higher values smooth across stronger color edges",
  },
  workingResolution: {
    type: ENUM,
    options: [
      { name: "Half (balanced)", value: WORKING_RESOLUTION.HALF },
      { name: "Full (high quality)", value: WORKING_RESOLUTION.FULL },
      { name: "Quarter (fast)", value: WORKING_RESOLUTION.QUARTER },
    ],
    default: WORKING_RESOLUTION.HALF,
    desc: "Resolution used for filtering; reconstruction remains source-guided and very large images may receive a documented safety reduction",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  sigmaSpatial: optionTypes.sigmaSpatial.default,
  sigmaRange: optionTypes.sigmaRange.default,
  workingResolution: optionTypes.workingResolution.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type BilateralOptions = Omit<Partial<typeof defaults>, "workingResolution"> & Record<string, unknown> & {
  workingResolution?: unknown;
  _webglAcceleration?: boolean;
  _linearize?: boolean;
};

const finite = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};

const resolveWorkingResolution = (options: BilateralOptions): keyof typeof WORKING_RESOLUTION => {
  if (options.workingResolution === WORKING_RESOLUTION.FULL
    || options.workingResolution === WORKING_RESOLUTION.HALF
    || options.workingResolution === WORKING_RESOLUTION.QUARTER) {
    return options.workingResolution;
  }
  // Old URLs only carry these keys when they differed from the former defaults.
  if ("useDownsample" in options && options.useDownsample === false) return WORKING_RESOLUTION.FULL;
  if ("downsampleFactor" in options && typeof options.downsampleFactor === "number") {
    return options.downsampleFactor >= 3 ? WORKING_RESOLUTION.QUARTER : options.downsampleFactor <= 1
      ? WORKING_RESOLUTION.FULL
      : WORKING_RESOLUTION.HALF;
  }
  return WORKING_RESOLUTION.HALF;
};

const srgbToLinear = (value: number): number => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (value: number): number => value <= 0.0031308
  ? value * 12.92
  : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055;

type Guide = { width: number; height: number; values: Float32Array };

const buildGuide = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  factor: number,
  linearize: boolean,
): Guide => {
  const workWidth = Math.max(1, Math.ceil(width / factor));
  const workHeight = Math.max(1, Math.ceil(height / factor));
  const values = new Float32Array(workWidth * workHeight * 4);
  for (let workY = 0; workY < workHeight; workY++) {
    for (let workX = 0; workX < workWidth; workX++) {
      let red = 0; let green = 0; let blue = 0; let alphaSum = 0; let count = 0;
      const endY = Math.min(height, (workY + 1) * factor);
      const endX = Math.min(width, (workX + 1) * factor);
      for (let y = workY * factor; y < endY; y++) {
        for (let x = workX * factor; x < endX; x++) {
          const index = (y * width + x) * 4;
          const alpha = source[index + 3] / 255;
          const sourceRed = source[index] / 255;
          const sourceGreen = source[index + 1] / 255;
          const sourceBlue = source[index + 2] / 255;
          red += (linearize ? srgbToLinear(sourceRed) : sourceRed) * alpha;
          green += (linearize ? srgbToLinear(sourceGreen) : sourceGreen) * alpha;
          blue += (linearize ? srgbToLinear(sourceBlue) : sourceBlue) * alpha;
          alphaSum += alpha;
          count += 1;
        }
      }
      const output = (workY * workWidth + workX) * 4;
      if (alphaSum > 1e-6) {
        values[output] = red / alphaSum;
        values[output + 1] = green / alphaSum;
        values[output + 2] = blue / alphaSum;
      }
      values[output + 3] = count > 0 ? alphaSum / count : 0;
    }
  }
  return { width: workWidth, height: workHeight, values };
};

const guidedPass = (
  signal: Float32Array,
  guide: Guide,
  radius: number,
  sigmaSpatial: number,
  sigmaRange: number,
  horizontal: boolean,
): Float32Array => {
  const output = new Float32Array(signal.length);
  const spatialDenominator = Math.max(2 * sigmaSpatial * sigmaSpatial, 1e-6);
  const rangeDenominator = Math.max(2 * sigmaRange * sigmaRange, 1e-6);
  for (let y = 0; y < guide.height; y++) {
    for (let x = 0; x < guide.width; x++) {
      const center = (y * guide.width + x) * 4;
      const centerAlpha = guide.values[center + 3];
      if (centerAlpha <= 1e-6) continue;
      let red = 0; let green = 0; let blue = 0; let weightSum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const neighborX = horizontal ? Math.max(0, Math.min(guide.width - 1, x + offset)) : x;
        const neighborY = horizontal ? y : Math.max(0, Math.min(guide.height - 1, y + offset));
        const neighbor = (neighborY * guide.width + neighborX) * 4;
        const deltaRed = (guide.values[center] - guide.values[neighbor]) * 255;
        const deltaGreen = (guide.values[center + 1] - guide.values[neighbor + 1]) * 255;
        const deltaBlue = (guide.values[center + 2] - guide.values[neighbor + 2]) * 255;
        const spatialWeight = Math.exp(-(offset * offset) / spatialDenominator);
        const rangeWeight = Math.exp(
          -(deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue) / rangeDenominator,
        );
        const weight = spatialWeight * rangeWeight * guide.values[neighbor + 3];
        red += signal[neighbor] * weight;
        green += signal[neighbor + 1] * weight;
        blue += signal[neighbor + 2] * weight;
        weightSum += weight;
      }
      if (weightSum > 1e-6) {
        output[center] = red / weightSum;
        output[center + 1] = green / weightSum;
        output[center + 2] = blue / weightSum;
      } else {
        output[center] = signal[center];
        output[center + 1] = signal[center + 1];
        output[center + 2] = signal[center + 2];
      }
      output[center + 3] = centerAlpha;
    }
  }
  return output;
};

const reconstruct = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  guide: Guide,
  blurred: Float32Array,
  factor: number,
  sigmaRange: number,
  linearize: boolean,
): Uint8ClampedArray<ArrayBuffer> => {
  const output = new Uint8ClampedArray(new ArrayBuffer(source.length));
  const rangeDenominator = Math.max(2 * sigmaRange * sigmaRange, 1e-6);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const alpha = source[index + 3];
      output[index + 3] = alpha;
      if (alpha === 0) continue;
      const sourceRed = source[index] / 255;
      const sourceGreen = source[index + 1] / 255;
      const sourceBlue = source[index + 2] / 255;
      const centerRed = linearize ? srgbToLinear(sourceRed) : sourceRed;
      const centerGreen = linearize ? srgbToLinear(sourceGreen) : sourceGreen;
      const centerBlue = linearize ? srgbToLinear(sourceBlue) : sourceBlue;
      if (factor === 1) {
        const workIndex = (y * guide.width + x) * 4;
        let red = blurred[workIndex];
        let green = blurred[workIndex + 1];
        let blue = blurred[workIndex + 2];
        if (linearize) {
          red = linearToSrgb(red);
          green = linearToSrgb(green);
          blue = linearToSrgb(blue);
        }
        output[index] = Math.round(Math.max(0, Math.min(1, red)) * 255);
        output[index + 1] = Math.round(Math.max(0, Math.min(1, green)) * 255);
        output[index + 2] = Math.round(Math.max(0, Math.min(1, blue)) * 255);
        continue;
      }
      const workX = (x + 0.5) / factor - 0.5;
      const workY = (y + 0.5) / factor - 0.5;
      const baseX = Math.floor(workX);
      const baseY = Math.floor(workY);
      let red = 0; let green = 0; let blue = 0; let weightSum = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const candidateX = Math.max(0, Math.min(guide.width - 1, baseX + offsetX));
          const candidateY = Math.max(0, Math.min(guide.height - 1, baseY + offsetY));
          const candidate = (candidateY * guide.width + candidateX) * 4;
          const spatialX = baseX + offsetX - workX;
          const spatialY = baseY + offsetY - workY;
          const deltaRed = (centerRed - guide.values[candidate]) * 255;
          const deltaGreen = (centerGreen - guide.values[candidate + 1]) * 255;
          const deltaBlue = (centerBlue - guide.values[candidate + 2]) * 255;
          const spatialWeight = Math.exp(-(spatialX * spatialX + spatialY * spatialY) / 2);
          const rangeWeight = Math.exp(
            -(deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue) / rangeDenominator,
          );
          const weight = spatialWeight * rangeWeight * guide.values[candidate + 3];
          red += blurred[candidate] * weight;
          green += blurred[candidate + 1] * weight;
          blue += blurred[candidate + 2] * weight;
          weightSum += weight;
        }
      }
      red = weightSum > 1e-6 ? red / weightSum : centerRed;
      green = weightSum > 1e-6 ? green / weightSum : centerGreen;
      blue = weightSum > 1e-6 ? blue / weightSum : centerBlue;
      if (linearize) {
        red = linearToSrgb(red);
        green = linearToSrgb(green);
        blue = linearToSrgb(blue);
      }
      output[index] = Math.round(Math.max(0, Math.min(1, red)) * 255);
      output[index + 1] = Math.round(Math.max(0, Math.min(1, green)) * 255);
      output[index + 2] = Math.round(Math.max(0, Math.min(1, blue)) * 255);
    }
  }
  return output;
};

const canonicalizeTransparentRgb = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas => {
  const context = canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) return canvas;
  const image = context.getImageData(0, 0, width, height);
  let changed = false;
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] === 0
      && (image.data[index] !== 0 || image.data[index + 1] !== 0 || image.data[index + 2] !== 0)) {
      image.data[index] = 0;
      image.data[index + 1] = 0;
      image.data[index + 2] = 0;
      changed = true;
    }
  }
  if (changed) context.putImageData(image, 0, 0);
  return canvas;
};

const MAX_GL_WORK_PIXELS = 2_500_000;
const MAX_CPU_WORK_PIXELS = 262_144;
const MAX_CPU_OUTPUT_PIXELS = 2_500_000;

export const resolveBilateralWorkFactor = (
  width: number,
  height: number,
  requested: number,
): number | null => {
  let factor = requested;
  while (factor < 4
    && Math.ceil(width / factor) * Math.ceil(height / factor) > MAX_GL_WORK_PIXELS) factor *= 2;
  return Math.ceil(width / factor) * Math.ceil(height / factor) <= MAX_GL_WORK_PIXELS
    ? Math.min(4, factor)
    : null;
};

export const resolveBilateralCpuFactor = (
  width: number,
  height: number,
  requested: number,
): number | null => {
  if (width * height > MAX_CPU_OUTPUT_PIXELS) return null;
  let factor = requested;
  while (factor < 64
    && Math.ceil(width / factor) * Math.ceil(height / factor) > MAX_CPU_WORK_PIXELS) factor *= 2;
  return Math.ceil(width / factor) * Math.ceil(height / factor) <= MAX_CPU_WORK_PIXELS
    ? factor
    : null;
};

const bilateralBlur = (input: any, options: BilateralOptions = defaults) => {
  const sigmaSpatial = finite(options.sigmaSpatial, defaults.sigmaSpatial, 1, 12);
  const sigmaRange = finite(options.sigmaRange, defaults.sigmaRange, 1, 100);
  const workingResolution = resolveWorkingResolution(options);
  const requestedFactor = workingResolution === WORKING_RESOLUTION.FULL ? 1
    : workingResolution === WORKING_RESOLUTION.QUARTER ? 4 : 2;
  const linearize = options._linearize === true;
  const palette = options.palette ?? defaults.palette;
  const width = input.width;
  const height = input.height;

  const factor = resolveBilateralWorkFactor(width, height, requestedFactor);
  if (factor == null) {
    logFilterWasmStatus("Bilateral Blur", false, "skipped: image too large for selected quality");
    return input;
  }
  if (options._webglAcceleration !== false && glAvailable()) {
    let rendered: HTMLCanvasElement | OffscreenCanvas | null = null;
    try {
      rendered = renderBilateralBlurGL(
        input, width, height, sigmaSpatial, sigmaRange, factor, linearize,
      );
    } catch {
      // A lost/undersized GL context falls through to the bounded CPU path.
    }
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const output = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
      if (output) {
        if (!identity) canonicalizeTransparentRgb(output, width, height);
        logFilterBackend(
          "Bilateral Blur", "WebGL2",
          `σs=${sigmaSpatial} σr=${sigmaRange} ${workingResolution}${factor !== requestedFactor ? `→1/${factor} safety` : ""}${linearize ? "+linear" : ""}${identity ? "" : "+palettePass"}`,
        );
        return output;
      }
    }
  }

  const cpuFactor = resolveBilateralCpuFactor(width, height, factor);
  if (cpuFactor == null) {
    logFilterWasmStatus("Bilateral Blur", false, "skipped: enable WebGL2 or reduce image size");
    return input;
  }
  logFilterWasmStatus(
    "Bilateral Blur", false,
    `guided separable JS${cpuFactor !== factor ? ` (1/${cpuFactor} safety)` : ""}`,
  );
  const inputContext = input.getContext("2d", { willReadFrequently: true });
  if (!inputContext) return input;
  const source = inputContext.getImageData(0, 0, width, height).data;
  const guide = buildGuide(source, width, height, cpuFactor, linearize);
  const sigmaWork = sigmaSpatial / cpuFactor;
  const radius = Math.max(1, Math.min(24, Math.ceil(2 * sigmaWork)));
  const horizontal = guidedPass(guide.values, guide, radius, sigmaWork, sigmaRange, true);
  const blurred = guidedPass(horizontal, guide, radius, sigmaWork, sigmaRange, false);
  const outputPixels = reconstruct(
    source, width, height, guide, blurred, cpuFactor, sigmaRange, linearize,
  );
  const output = cloneCanvas(input, false);
  const outputContext = output.getContext("2d");
  if (!outputContext) return input;
  outputContext.putImageData(new ImageData(outputPixels, width, height), 0, 0);
  if (paletteIsIdentity(palette)) return output;
  const paletteOutput = applyPalettePassToCanvas(output, width, height, palette) ?? output;
  return canonicalizeTransparentRgb(paletteOutput, width, height);
};

export default defineFilter({
  name: "Bilateral Blur",
  func: bilateralBlur,
  optionTypes,
  options: defaults,
  defaults,
});
