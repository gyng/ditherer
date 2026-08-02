import { ENUM, RANGE } from "../constants/controlTypes";
import {
  cloneCanvas,
  logFilterBackend,
  releasePooledCanvas,
  takePooledCanvas,
} from "../utils/index";
import { encodeHam6Scanline } from "./retroHardwareCodecs";
import { defineFilter, type FilterCanvas, type FilterOptionValues } from "./types";

const STANDARD_NTSC = "NTSC";
const STANDARD_PAL = "PAL";
const PALETTE_ADAPTIVE = "ADAPTIVE";
const PALETTE_OCS = "OCS";

export const optionTypes = {
  standard: {
    type: ENUM,
    options: [
      { name: "NTSC 320×200", value: STANDARD_NTSC },
      { name: "PAL 320×256", value: STANDARD_PAL },
    ],
    default: STANDARD_NTSC,
    desc: "Nominal low-resolution Amiga display geometry used for HAM6 encoding",
  },
  paletteMode: {
    type: ENUM,
    options: [
      { name: "Adaptive 16 registers", value: PALETTE_ADAPTIVE },
      { name: "OCS demonstration palette", value: PALETTE_OCS },
    ],
    default: PALETTE_ADAPTIVE,
    desc: "Six-plane HAM reserves direct opcodes for 16 base color registers; adaptive mode derives them from the image",
  },
  paletteIterations: {
    type: RANGE,
    range: [1, 12],
    step: 1,
    default: 6,
    desc: "Deterministic clustering passes used to fill the 16 direct-color registers",
  },
};

export const defaults = {
  standard: optionTypes.standard.default,
  paletteMode: optionTypes.paletteMode.default,
  paletteIterations: optionTypes.paletteIterations.default,
};

type Ham6Options = FilterOptionValues & Partial<typeof defaults>;

const OCS_PALETTE = [
  0x000, 0xfff, 0x05a, 0xf80, 0x08f, 0x0c0, 0xf00, 0x0dd, 0x06f, 0x0a0, 0x608, 0xc30, 0x777, 0xaaa,
  0xddd, 0x444,
];

const packedPalette = (colors: number[]): Uint8Array =>
  Uint8Array.from(
    colors.flatMap((color) => [
      ((color >>> 8) & 15) * 17,
      ((color >>> 4) & 15) * 17,
      (color & 15) * 17,
      255,
    ]),
  );

const quantize4 = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value / 17) * 17));

export const buildHam6Palette = (pixels: Uint8ClampedArray, iterations = 6): Uint8Array => {
  const count = Math.floor(pixels.length / 4);
  if (count < 1) return packedPalette(OCS_PALETTE);
  const stride = Math.max(1, Math.floor(count / 4096));
  const samples: number[][] = [];
  for (let pixel = 0; pixel < count; pixel += stride) {
    const offset = pixel * 4;
    samples.push([pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0]);
  }
  samples.sort((a, b) => a[0]! * 3 + a[1]! * 6 + a[2]! - (b[0]! * 3 + b[1]! * 6 + b[2]!));
  const centroids = Array.from({ length: 16 }, (_, index) => {
    const sample =
      samples[Math.min(samples.length - 1, Math.floor(((index + 0.5) * samples.length) / 16))]!;
    return [...sample];
  });
  const passes = Math.max(1, Math.min(12, Math.round(iterations)));
  for (let pass = 0; pass < passes; pass++) {
    const sums = Array.from({ length: 16 }, () => [0, 0, 0, 0]);
    for (const sample of samples) {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < centroids.length; index++) {
        const center = centroids[index]!;
        const dr = sample[0]! - center[0]!;
        const dg = sample[1]! - center[1]!;
        const db = sample[2]! - center[2]!;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      const sum = sums[best]!;
      sum[0]! += sample[0]!;
      sum[1]! += sample[1]!;
      sum[2]! += sample[2]!;
      sum[3]! += 1;
    }
    for (let index = 0; index < centroids.length; index++) {
      const sum = sums[index]!;
      if (sum[3]! > 0) centroids[index] = [sum[0]! / sum[3]!, sum[1]! / sum[3]!, sum[2]! / sum[3]!];
    }
  }
  centroids.sort((a, b) => a[0]! * 3 + a[1]! * 6 + a[2]! - (b[0]! * 3 + b[1]! * 6 + b[2]!));
  return Uint8Array.from(
    centroids.flatMap((color) => [
      quantize4(color[0]!),
      quantize4(color[1]!),
      quantize4(color[2]!),
      255,
    ]),
  );
};

const amigaHam6 = (input: FilterCanvas, options: Ham6Options = defaults): FilterCanvas => {
  if (input.width < 1 || input.height < 1) return input;
  const width = 320;
  const height = options.standard === STANDARD_PAL ? 256 : 200;
  const reduced = takePooledCanvas(width, height);
  const reducedContext = reduced.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!reducedContext) {
    releasePooledCanvas(reduced);
    return input;
  }
  reducedContext.imageSmoothingEnabled = true;
  reducedContext.drawImage(input as CanvasImageSource, 0, 0, width, height);
  const image = reducedContext.getImageData(0, 0, width, height);
  const iterations = Math.max(
    1,
    Math.min(12, Math.round(Number(options.paletteIterations) || defaults.paletteIterations)),
  );
  const palette =
    options.paletteMode === PALETTE_OCS
      ? packedPalette(OCS_PALETTE)
      : buildHam6Palette(image.data, iterations);

  const row = new Uint8Array(width * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceOffset = (y * width + x) * 4;
      const rowOffset = x * 3;
      row[rowOffset] = image.data[sourceOffset] ?? 0;
      row[rowOffset + 1] = image.data[sourceOffset + 1] ?? 0;
      row[rowOffset + 2] = image.data[sourceOffset + 2] ?? 0;
    }
    const encoded = encodeHam6Scanline(row, palette);
    image.data.set(encoded.output, y * width * 4);
  }
  reducedContext.putImageData(image, 0, 0);

  const output = cloneCanvas(input, false);
  const outputContext = output.getContext("2d");
  if (!outputContext) {
    releasePooledCanvas(reduced);
    return input;
  }
  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(reduced, 0, 0, output.width, output.height);
  releasePooledCanvas(reduced);
  logFilterBackend(
    "Amiga HAM6",
    "JavaScript",
    `${width}x${height} sequential hold-and-modify scanlines`,
  );
  return output;
};

export default defineFilter({
  name: "Amiga HAM6",
  func: amigaHam6,
  optionTypes,
  defaults,
  options: defaults,
  description:
    "Amiga OCS six-plane hold-and-modify encoding with legal direct, red, green, and blue opcodes",
  noGL: "HAM6 output is a left-to-right state machine: each modify opcode changes the color held by the next pixel",
});
