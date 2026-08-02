import { filterIndex, nearest } from "@gyng/ditherer-filters";
import { canvasPixels, makeGradientCanvas, makeSolidCanvas, runtimeOptions } from "../fixtures";
import type { FilterLike } from "../types";

export const runTeletextRepeatConcealment = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Teletext"] as FilterLike;
  const width = 400;
  const height = 240;
  const input = document.createElement("canvas");
  input.width = width;
  input.height = height;
  const inputContext = input.getContext("2d");
  if (!inputContext) return { ok: false, reason: "input has no 2d context" };
  inputContext.fillStyle = "white";
  inputContext.fillRect(0, 0, width, height);

  const render = (concealment: "BLANK" | "REPEAT"): HTMLCanvasElement | null => {
    try {
      return filter.func(input, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        bitErrorRate: 0.05,
        burstErrors: 0,
        concealment,
        randomSeed: 60,
      }) as HTMLCanvasElement;
    } catch {
      return null;
    }
  };
  const blank = render("BLANK");
  const repeat = render("REPEAT");
  const blankContext = blank?.getContext("2d", { willReadFrequently: true });
  const repeatContext = repeat?.getContext("2d", { willReadFrequently: true });
  if (!blankContext || !repeatContext) {
    return { ok: false, reason: "concealment render or readback failed" };
  }
  const blankPixels = blankContext.getImageData(0, 0, width, height).data;
  const repeatPixels = repeatContext.getImageData(0, 0, width, height).data;
  const darkCells = (pixels: Uint8ClampedArray, row: number): number => {
    let dark = 0;
    for (let column = 0; column < 40; column++) {
      const x = column * 10 + 2;
      const y = row * 10 + 1;
      const index = (y * width + x) * 4;
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] < 96) dark += 1;
    }
    return dark;
  };
  for (let row = 1; row < 24; row++) {
    const blankDark = darkCells(blankPixels, row);
    if (blankDark >= 30 && darkCells(repeatPixels, row) < 20) return { ok: true };
  }
  return { ok: false, reason: "a damaged packet row was not visibly restored from its prior row" };
};

export const runPalDelayLineCancellation = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["PAL / SECAM"] as FilterLike;
  const width = 64;
  const height = 32;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) return { ok: false, reason: "PAL fixture has no 2d context" };
  sourceContext.fillStyle = "rgb(220, 54, 160)";
  sourceContext.fillRect(0, 0, width, height);

  const render = (delayLine: boolean): Uint8ClampedArray | null => {
    try {
      const output = filter.func(source, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        system: "PAL",
        phaseError: 45,
        tuningError: 0,
        delayLine,
        crossColor: 0,
        crossLuma: 0,
        channelNoise: 0,
        interlace: false,
      }) as HTMLCanvasElement;
      return (
        output.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height)
          .data ?? null
      );
    } catch {
      return null;
    }
  };
  const withoutDelay = render(false);
  const withDelay = render(true);
  if (!withoutDelay || !withDelay)
    return { ok: false, reason: "PAL cancellation render/readback failed" };

  const adjacentLineError = (pixels: Uint8ClampedArray): number => {
    let total = 0;
    let samples = 0;
    for (let y = 1; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const current = (y * width + x) * 4;
        const previous = ((y - 1) * width + x) * 4;
        total += Math.abs(pixels[current] - pixels[previous]);
        total += Math.abs(pixels[current + 1] - pixels[previous + 1]);
        total += Math.abs(pixels[current + 2] - pixels[previous + 2]);
        samples += 3;
      }
    }
    return total / samples;
  };
  const uncorrected = adjacentLineError(withoutDelay);
  const corrected = adjacentLineError(withDelay);
  return uncorrected > 4 && corrected < uncorrected * 0.25
    ? { ok: true }
    : {
        ok: false,
        reason: `PAL delay line did not cancel alternating phase error (${uncorrected.toFixed(2)} -> ${corrected.toFixed(2)})`,
      };
};

export const runSdfInteriorDistance = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["SDF Stylize"] as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    const output = filter.func(makeSolidCanvas(64, 64, 255), {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      mode: "BEVEL",
      threshold: 0.5,
      spacing: 24,
      lineColor: [0, 0, 0],
      fillColor: [255, 255, 255],
      palette: { ...nearest, options: { levels: 256 } },
    }) as HTMLCanvasElement;
    pixels = canvasPixels(output);
  } catch (error) {
    return {
      ok: false,
      reason: `SDF interior render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "SDF interior readback failed" };
  const luminanceAt = (x: number, y: number): number => {
    const index = (y * 64 + x) * 4;
    return 0.2126 * pixels![index] + 0.7152 * pixels![index + 1] + 0.0722 * pixels![index + 2];
  };
  const boundary = luminanceAt(1, 32);
  const center = luminanceAt(32, 32);
  return center > boundary + 60
    ? { ok: true }
    : {
        ok: false,
        reason: `signed interior distance collapsed (boundary=${boundary.toFixed(1)}, center=${center.toFixed(1)})`,
      };
};

export const runApolloFractionalHold = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Apollo Slow-Scan TV"] as FilterLike;
  const options = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    mode: "320_10",
    animSpeed: 15,
    phosphorPersistence: 0,
    vidiconLag: 0,
    vidiconBloom: 0,
    discHold: true,
    interlace: false,
    rfNoise: 0,
    syncError: 0,
    palette: { ...nearest, options: { levels: 256 } },
  };
  let previous: Uint8ClampedArray | null = null;
  const frames: Uint8ClampedArray[] = [];
  for (const [frame, value] of [40, 120, 220].entries()) {
    try {
      const output = filter.func(makeSolidCanvas(32, 24, value), {
        ...options,
        _frameIndex: frame,
        _prevOutput: previous,
      }) as HTMLCanvasElement;
      const pixels = canvasPixels(output);
      if (!pixels) return { ok: false, reason: `Apollo frame ${frame} readback failed` };
      frames.push(pixels);
      previous = pixels;
    } catch (error) {
      return {
        ok: false,
        reason: `Apollo fractional hold threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  const maximumDelta = (left: Uint8ClampedArray, right: Uint8ClampedArray): number => {
    let delta = 0;
    for (let i = 0; i < left.length; i++) delta = Math.max(delta, Math.abs(left[i] - right[i]));
    return delta;
  };
  const heldDelta = maximumDelta(frames[0], frames[1]);
  const newPictureDelta = maximumDelta(frames[1], frames[2]);
  return heldDelta <= 1 && newPictureDelta > 50
    ? { ok: true }
    : {
        ok: false,
        reason: `Apollo 15 fps hold sequence was wrong (held=${heldDelta}, new=${newPictureDelta})`,
      };
};

export const runGameboyThresholdMatrix = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Gameboy Camera"] as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    const output = filter.func(makeSolidCanvas(64, 56, 128), {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      resolution: 64,
      contrast: 1,
      exposure: 1,
      gain: 1,
      bias: 0,
      invertSensor: false,
      edgeMode: "OFF",
      sensorNoise: 0,
      ditherStrength: 1,
      palette: { ...nearest, options: { levels: 256 } },
    }) as HTMLCanvasElement;
    pixels = canvasPixels(output);
  } catch (error) {
    return {
      ok: false,
      reason: `Game Boy matrix render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "Game Boy matrix readback failed" };
  const colorAt = (x: number, y: number): string => {
    const index = (y * 64 + x) * 4;
    return `${pixels?.[index]},${pixels?.[index + 1]},${pixels?.[index + 2]}`;
  };
  let hasFourPixelRepeat = true;
  let differsAtTwo = false;
  const colors = new Set<string>();
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const color = colorAt(x, y);
      colors.add(color);
      if (color !== colorAt(x + 4, y) || color !== colorAt(x, y + 4)) hasFourPixelRepeat = false;
      if (color !== colorAt((x + 2) % 4, y) || color !== colorAt(x, (y + 2) % 4))
        differsAtTwo = true;
    }
  }
  return hasFourPixelRepeat && differsAtTwo && colors.size >= 2
    ? { ok: true }
    : {
        ok: false,
        reason: `Game Boy threshold tile was not genuinely 4x4 (repeat=${hasFourPixelRepeat}, differsAt2=${differsAtTwo}, colors=${colors.size})`,
      };
};

export const runCgaRgbiPalette = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["CGA Composite"] as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    const output = filter.func(makeGradientCanvas(64, 48), {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      mode: "RGBI",
      scanlineStrength: 0,
    }) as HTMLCanvasElement;
    pixels = canvasPixels(output);
  } catch (error) {
    return {
      ok: false,
      reason: `CGA RGBI render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "CGA RGBI readback failed" };

  const legal = new Set([
    "0,0,0",
    "0,0,170",
    "0,170,0",
    "0,170,170",
    "170,0,0",
    "170,0,170",
    "170,85,0",
    "170,170,170",
    "85,85,85",
    "0,0,255",
    "0,255,0",
    "0,255,255",
    "255,0,0",
    "255,0,255",
    "255,255,0",
    "255,255,255",
  ]);
  for (let index = 0; index < pixels.length; index += 4) {
    const color = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
    if (!legal.has(color)) {
      return { ok: false, reason: `CGA RGBI emitted non-palette color ${color}` };
    }
  }
  return { ok: true };
};

export const runAppleHgrDotContract = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Apple II HGR"] as FilterLike;
  const input = makeSolidCanvas(280, 192, 0);
  const context = input.getContext("2d");
  if (!context) return { ok: false, reason: "Apple HGR fixture has no 2d context" };
  context.fillStyle = "white";
  context.fillRect(1, 0, 2, 1);
  context.fillRect(4, 0, 1, 1);
  context.fillRect(8, 0, 1, 1);
  const render = (phase: string): Uint8ClampedArray | null => {
    try {
      const output = filter.func(input, {
        ...(filter.defaults ?? {}),
        phase,
        threshold: 0.5,
        colorBleed: 0,
        monitor: "COLOR",
      }) as HTMLCanvasElement;
      return canvasPixels(output);
    } catch {
      return null;
    }
  };
  const phase0 = render("PURPLE_GREEN");
  const phase1 = render("BLUE_ORANGE");
  if (!phase0 || !phase1) return { ok: false, reason: "Apple HGR render/readback failed" };
  const color = (pixels: Uint8ClampedArray, x: number) =>
    Array.from(pixels.slice(x * 4, x * 4 + 3)).join(",");
  const contract =
    color(phase0, 0) === "0,0,0" &&
    color(phase0, 1) === "255,255,255" &&
    color(phase0, 2) === "255,255,255" &&
    color(phase0, 4) === "208,64,255" &&
    color(phase1, 4) === "64,128,255" &&
    color(phase1, 8) === "64,128,255";
  return contract
    ? { ok: true }
    : {
        ok: false,
        reason: `Apple HGR dot colors drifted (${color(phase0, 4)} / ${color(phase1, 4)})`,
      };
};

export const runSpectrumAttributeContract = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["ZX Spectrum"] as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    const output = filter.func(makeGradientCanvas(256, 192), {
      ...(filter.defaults ?? {}),
      flashEnabled: false,
      pixelGrid: false,
    }) as HTMLCanvasElement;
    pixels = canvasPixels(output);
  } catch {
    pixels = null;
  }
  if (!pixels) return { ok: false, reason: "Spectrum attribute render/readback failed" };
  for (let cellY = 0; cellY < 24; cellY++) {
    for (let cellX = 0; cellX < 32; cellX++) {
      const colors = new Set<string>();
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const offset = ((cellY * 8 + y) * 256 + cellX * 8 + x) * 4;
          colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
        }
      }
      if (colors.size > 2) {
        return {
          ok: false,
          reason: `Spectrum cell ${cellX},${cellY} emitted ${colors.size} colors`,
        };
      }
    }
  }
  return { ok: true };
};

export const runPxlCaptureHold = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["PXL-2000"] as FilterLike;
  const base = {
    ...(filter.defaults ?? {}),
    animSpeed: 30,
    autoIris: false,
    exposure: 0,
    contrast: 1,
    signalBandwidth: 1,
    cassetteNoise: 0,
    dropout: 0,
    tracking: 0,
  };
  const outputs: Uint8ClampedArray[] = [];
  let previous: Uint8ClampedArray | null = null;
  const sources = [
    makeGradientCanvas(120, 90),
    makeSolidCanvas(120, 90, 220),
    makeSolidCanvas(120, 90, 220),
  ];
  for (const [frame, source] of sources.entries()) {
    try {
      const output = filter.func(source, {
        ...base,
        _frameIndex: frame,
        _prevOutput: previous,
      }) as HTMLCanvasElement;
      const pixels = canvasPixels(output);
      if (!pixels) return { ok: false, reason: `PXL frame ${frame} readback failed` };
      outputs.push(pixels);
      previous = pixels;
    } catch (error) {
      return {
        ok: false,
        reason: `PXL hold threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  const maximumDelta = (left: Uint8ClampedArray, right: Uint8ClampedArray): number => {
    let delta = 0;
    for (let index = 0; index < left.length; index++)
      delta = Math.max(delta, Math.abs(left[index] - right[index]));
    return delta;
  };
  const held = maximumDelta(outputs[0]!, outputs[1]!);
  const captured = maximumDelta(outputs[1]!, outputs[2]!);
  return held <= 1 && captured > 100
    ? { ok: true }
    : {
        ok: false,
        reason: `PXL 15 Hz hold sequence was wrong (held=${held}, captured=${captured})`,
      };
};
