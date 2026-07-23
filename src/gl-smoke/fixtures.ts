import type { CheckResult } from "./types";

const gradientPixels = new Map<string, Uint8ClampedArray<ArrayBuffer>>();
const reusableGradientCanvases = new Map<string, HTMLCanvasElement>();

const fixtureKey = (width: number, height: number): string => `${width}x${height}`;

const buildGradientPixels = (width: number, height: number): Uint8ClampedArray<ArrayBuffer> => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const xBand = Math.floor((x / Math.max(1, width)) * 4) / 3;
      const yBand = Math.floor((y / Math.max(1, height)) * 4) / 3;
      pixels[index] = Math.round(Math.min(1, xBand) * 255);
      pixels[index + 1] = Math.round(Math.min(1, yBand) * 255);
      pixels[index + 2] = 255 - pixels[index];
      if (x >= width / 4 && x < (width * 3) / 4
        && y >= height / 4 && y < (height * 3) / 4) {
        const high = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
        pixels[index] = high ? 245 : 10;
        pixels[index + 1] = high ? 245 : 24;
        pixels[index + 2] = high ? 245 : 48;
      }
      pixels[index + 3] = 255;
    }
  }
  return pixels;
};

const gradientTemplate = (width: number, height: number): Uint8ClampedArray<ArrayBuffer> => {
  const key = fixtureKey(width, height);
  const cached = gradientPixels.get(key);
  if (cached) return cached;
  const pixels = buildGradientPixels(width, height);
  gradientPixels.set(key, pixels);
  return pixels;
};

const paintGradient = (canvas: HTMLCanvasElement, width: number, height: number): void => {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d context unavailable");
  context.putImageData(new ImageData(gradientTemplate(width, height), width, height), 0, 0);
};

/** Fresh canvas for contracts that retain or compare multiple outputs. */
export const makeGradientCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paintGradient(canvas, width, height);
  return canvas;
};

/** Single-owner immutable fixture for the sequential registry sweep. */
export const acquireGradientCanvas = (width: number, height: number): HTMLCanvasElement => {
  const key = fixtureKey(width, height);
  let canvas = reusableGradientCanvases.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    paintGradient(canvas, width, height);
    reusableGradientCanvases.set(key, canvas);
  }
  return canvas;
};

export const makeSmoothRamp = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d context unavailable");
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const checker = (x + y) % 2 === 0;
      const fine = (x % 3 === 0) !== (y % 2 === 0);
      image.data[index] = checker ? 110 : 150;
      image.data[index + 1] = fine ? 105 : 145;
      image.data[index + 2] = x % 2 === 0 ? 115 : 155;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
};

export const makeSolidCanvas = (width: number, height: number, value: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("solid fixture has no 2d context");
  context.fillStyle = `rgb(${value}, ${value}, ${value})`;
  context.fillRect(0, 0, width, height);
  return canvas;
};

export const canvasPixels = (canvas: HTMLCanvasElement): Uint8ClampedArray | null =>
  canvas.getContext("2d", { willReadFrequently: true })
    ?.getImageData(0, 0, canvas.width, canvas.height).data.slice() ?? null;

const readPixels = (canvas: HTMLCanvasElement | OffscreenCanvas): Uint8ClampedArray | null => {
  const context = (canvas as HTMLCanvasElement).getContext(
    "2d",
    { willReadFrequently: true },
  ) as CanvasRenderingContext2D | null;
  return context?.getImageData(0, 0, canvas.width, canvas.height).data ?? null;
};

export const maxAlpha = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const pixels = readPixels(canvas);
  if (!pixels) return -1;
  let maximum = 0;
  for (let index = 3; index < pixels.length; index += 4) maximum = Math.max(maximum, pixels[index]);
  return maximum;
};

export const lumaRange = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const pixels = readPixels(canvas);
  if (!pixels) return -1;
  let low = 255;
  let high = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const luma = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    low = Math.min(low, luma);
    high = Math.max(high, luma);
  }
  return high - low;
};

export const peakLuma = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const pixels = readPixels(canvas);
  if (!pixels) return -1;
  let high = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    high = Math.max(
      high,
      pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114,
    );
  }
  return high;
};

const runtimePrevious = gradientTemplate(16, 16).slice();
for (let index = 0; index < runtimePrevious.length; index += 4) {
  runtimePrevious[index] = 255 - runtimePrevious[index];
  runtimePrevious[index + 1] = 255 - runtimePrevious[index + 1];
  runtimePrevious[index + 2] = 255 - runtimePrevious[index + 2];
}
const runtimeInput = runtimePrevious.slice();
const runtimeOutput = runtimePrevious.slice();
const runtimeEma = Float32Array.from(runtimePrevious);

const checksum = (values: ArrayLike<number>): number => {
  let hash = 2166136261;
  for (let index = 0; index < values.length; index += 1) {
    hash = Math.imul(hash ^ Math.round(values[index] * 257), 16777619) >>> 0;
  }
  return hash;
};

const runtimeChecksums = {
  input: checksum(runtimeInput),
  output: checksum(runtimeOutput),
  ema: checksum(runtimeEma),
};

const runtimeState: Readonly<Record<string, unknown>> = Object.freeze({
  _webglAcceleration: true,
  _wasmAcceleration: false,
  _frameIndex: 2,
  _isAnimating: true,
  _prevInput: runtimeInput,
  _prevOutput: runtimeOutput,
  _ema: runtimeEma,
});

/** Shared read-only runtime state; integrity is checked after every full run. */
export const runtimeOptions = (): Readonly<Record<string, unknown>> => runtimeState;

export const runtimeFixtureIntegrity = (): CheckResult => {
  const actual = {
    input: checksum(runtimeInput),
    output: checksum(runtimeOutput),
    ema: checksum(runtimeEma),
  };
  const mutatedCanvas = [...reusableGradientCanvases.entries()].find(([key, canvas]) => {
    const pixels = canvasPixels(canvas);
    return !pixels || checksum(pixels) !== checksum(gradientPixels.get(key) ?? []);
  });
  return actual.input === runtimeChecksums.input
    && actual.output === runtimeChecksums.output
    && actual.ema === runtimeChecksums.ema
    && !mutatedCanvas
    ? { ok: true }
    : {
        ok: false,
        reason: mutatedCanvas
          ? `filter mutated pooled ${mutatedCanvas[0]} input canvas`
          : `shared runtime history was mutated (${runtimeChecksums.input}/${runtimeChecksums.output}/${runtimeChecksums.ema} -> ${actual.input}/${actual.output}/${actual.ema})`,
      };
};
