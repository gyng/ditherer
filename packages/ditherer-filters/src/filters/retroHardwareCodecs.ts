/** Pure storage/display codecs shared by the hardware simulation filters. */

export const APPLE_HGR_COLORS = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  purple: [208, 64, 255],
  green: [64, 220, 64],
  blue: [64, 128, 255],
  orange: [255, 128, 32],
};

export const decodeAppleHgrDots = (
  bits: Uint8Array,
  bytePhases: Uint8Array,
): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(bits.length * 3);

  for (let x = 0; x < bits.length; x++) {
    let color = APPLE_HGR_COLORS.black;
    if (bits[x]) {
      if (bits[x - 1] || bits[x + 1]) {
        color = APPLE_HGR_COLORS.white;
      } else {
        const delayed = Boolean(bytePhases[Math.floor(x / 7)]);
        color = delayed
          ? (x % 2 === 0 ? APPLE_HGR_COLORS.blue : APPLE_HGR_COLORS.orange)
          : (x % 2 === 0 ? APPLE_HGR_COLORS.purple : APPLE_HGR_COLORS.green);
      }
    }
    output.set(color, x * 3);
  }

  return output;
};

export const spectrumColor = (index: number, bright: boolean): number[] => {
  const color = Math.max(0, Math.min(7, Math.trunc(index)));
  const level = bright ? 255 : 205;
  return [
    color & 2 ? level : 0,
    color & 4 ? level : 0,
    color & 1 ? level : 0,
  ];
};

/**
 * The 50 Hz ULA swaps flashing attributes every 16 frames, so a complete
 * normal → inverse → normal cycle lasts 32 frames (about 0.64 seconds).
 */
export const spectrumFlashPhase = (frameIndex: number, previewFps: number): number => {
  const frame = Number.isFinite(frameIndex) ? Math.max(0, Math.floor(frameIndex)) : 0;
  const fps = Number.isFinite(previewFps) ? Math.max(1, Math.min(60, previewFps)) : 50;
  const halfCycleFrames = Math.max(1, Math.round(fps * 16 / 50));
  return Math.floor(frame / halfCycleFrames) % 2;
};

export type SpectrumAttribute = {
  ink: number;
  paper: number;
  bright: boolean;
  bitmap: Uint8Array;
};

const rgbDistance = (
  source: Uint8Array,
  offset: number,
  color: number[],
): number => {
  const dr = (source[offset] ?? 0) - (color[0] ?? 0);
  const dg = (source[offset + 1] ?? 0) - (color[1] ?? 0);
  const db = (source[offset + 2] ?? 0) - (color[2] ?? 0);
  return dr * dr + dg * dg + db * db;
};

export const chooseSpectrumAttribute = (source: Uint8Array): SpectrumAttribute => {
  const pixels = Math.floor(source.length / 3);
  let bestError = Number.POSITIVE_INFINITY;
  let bestInk = 0;
  let bestPaper = 0;
  let bestBright = false;

  for (const bright of [false, true]) {
    const colors = Array.from({ length: 8 }, (_, index) => spectrumColor(index, bright));
    for (let paper = 0; paper < 8; paper++) {
      for (let ink = 0; ink < 8; ink++) {
        let error = 0;
        for (let pixel = 0; pixel < pixels; pixel++) {
          const offset = pixel * 3;
          error += Math.min(
            rgbDistance(source, offset, colors[paper]!),
            rgbDistance(source, offset, colors[ink]!),
          );
        }
        if (error < bestError) {
          bestError = error;
          bestInk = ink;
          bestPaper = paper;
          bestBright = bright;
        }
      }
    }
  }

  const paperColor = spectrumColor(bestPaper, bestBright);
  const inkColor = spectrumColor(bestInk, bestBright);
  const bitmap = new Uint8Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 3;
    bitmap[pixel] = rgbDistance(source, offset, inkColor)
      < rgbDistance(source, offset, paperColor) ? 1 : 0;
  }

  return { ink: bestInk, paper: bestPaper, bright: bestBright, bitmap };
};

export const HAM6_OP = {
  DIRECT: 0,
  BLUE: 1,
  RED: 2,
  GREEN: 3,
} as const;

const nibbleToByte = (value: number): number => (value & 15) * 17;

const paletteComponent = (
  palette: Uint8Array,
  color: number,
  component: number,
): number => nibbleToByte(Math.round((palette[color * 4 + component] ?? 0) / 17));

export const decodeHam6Scanline = (
  codes: Uint8Array,
  palette: Uint8Array,
): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(codes.length * 4);
  let red = paletteComponent(palette, 0, 0);
  let green = paletteComponent(palette, 0, 1);
  let blue = paletteComponent(palette, 0, 2);

  for (let pixel = 0; pixel < codes.length; pixel++) {
    const code = codes[pixel] ?? 0;
    const operation = code >>> 4 & 3;
    const data = code & 15;
    if (operation === HAM6_OP.DIRECT) {
      red = paletteComponent(palette, data, 0);
      green = paletteComponent(palette, data, 1);
      blue = paletteComponent(palette, data, 2);
    } else if (operation === HAM6_OP.BLUE) {
      blue = nibbleToByte(data);
    } else if (operation === HAM6_OP.RED) {
      red = nibbleToByte(data);
    } else {
      green = nibbleToByte(data);
    }
    output.set([red, green, blue, 255], pixel * 4);
  }

  return output;
};

export type Ham6Encoding = {
  codes: Uint8Array;
  output: Uint8ClampedArray;
};

export const encodeHam6Scanline = (
  source: Uint8Array,
  palette: Uint8Array,
): Ham6Encoding => {
  const pixels = Math.floor(source.length / 3);
  const codes = new Uint8Array(pixels);
  let red = paletteComponent(palette, 0, 0);
  let green = paletteComponent(palette, 0, 1);
  let blue = paletteComponent(palette, 0, 2);

  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 3;
    const targetRed = source[offset] ?? 0;
    const targetGreen = source[offset + 1] ?? 0;
    const targetBlue = source[offset + 2] ?? 0;
    let bestError = Number.POSITIVE_INFINITY;
    let bestCode = 0;
    let bestRed = red;
    let bestGreen = green;
    let bestBlue = blue;

    const consider = (code: number, candidateRed: number, candidateGreen: number, candidateBlue: number) => {
      const dr = targetRed - candidateRed;
      const dg = targetGreen - candidateGreen;
      const db = targetBlue - candidateBlue;
      const error = dr * dr + dg * dg + db * db;
      if (error < bestError) {
        bestError = error;
        bestCode = code;
        bestRed = candidateRed;
        bestGreen = candidateGreen;
        bestBlue = candidateBlue;
      }
    };

    for (let index = 0; index < 16; index++) {
      consider(
        (HAM6_OP.DIRECT << 4) | index,
        paletteComponent(palette, index, 0),
        paletteComponent(palette, index, 1),
        paletteComponent(palette, index, 2),
      );
    }
    const redNibble = Math.round(targetRed / 17);
    const greenNibble = Math.round(targetGreen / 17);
    const blueNibble = Math.round(targetBlue / 17);
    consider((HAM6_OP.BLUE << 4) | blueNibble, red, green, nibbleToByte(blueNibble));
    consider((HAM6_OP.RED << 4) | redNibble, nibbleToByte(redNibble), green, blue);
    consider((HAM6_OP.GREEN << 4) | greenNibble, red, nibbleToByte(greenNibble), blue);

    codes[pixel] = bestCode;
    red = bestRed;
    green = bestGreen;
    blue = bestBlue;
  }

  return { codes, output: decodeHam6Scanline(codes, palette) };
};

export type PxlTiming = {
  captureIndex: number;
  newCapture: boolean;
};

export const pxlTiming = (frameIndex: number, previewFps: number): PxlTiming => {
  const frame = Number.isFinite(frameIndex) ? Math.max(0, Math.floor(frameIndex)) : 0;
  const fps = Number.isFinite(previewFps) ? Math.max(1, Math.min(60, previewFps)) : 30;
  const captureIndex = Math.floor(frame * 15 / fps);
  const previousCapture = Math.floor(Math.max(0, frame - 1) * 15 / fps);
  return {
    captureIndex,
    newCapture: frame === 0 || captureIndex !== previousCapture,
  };
};
