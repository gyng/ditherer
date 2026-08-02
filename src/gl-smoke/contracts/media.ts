import { filterIndex } from "@gyng/ditherer-filters";
import { canvasPixels, makeGradientCanvas, makeSolidCanvas, runtimeOptions } from "../fixtures";
import { runEquivalent } from "../harness";
import type { FilterLike } from "../types";

export const runPhotocopierFrameInvariance = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Photocopier as FilterLike;
  const base = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    speckle: 0.8,
    generationLoss: 0.8,
  };
  return runEquivalent(filter, { ...base, _frameIndex: 1 }, { ...base, _frameIndex: 91 }, 0);
};

export const runPhotocopierToneContinuity = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Photocopier as FilterLike;
  const width = 256;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = 8;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "copy ramp fixture has no 2d context" };
  const image = context.createImageData(width, 8);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      image.data[offset] = x;
      image.data[offset + 1] = x;
      image.data[offset + 2] = x;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(source, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        contrast: 1.55,
        edgeDarken: 0,
        speckle: 0,
        generationLoss: 1,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `copy ramp render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "copy ramp readback failed" };
  const levels = new Set<number>();
  let previous = -1;
  for (let x = 0; x < width; x += 1) {
    const value = pixels[x * 4];
    levels.add(value);
    if (value < previous)
      return { ok: false, reason: `copy ramp reversed at ${x}: ${previous} -> ${value}` };
    previous = value;
  }
  return levels.size > 128
    ? { ok: true }
    : { ok: false, reason: `generation loss posterized ramp to ${levels.size} levels` };
};

export const runPaperTextureHighScaleBounded = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Paper Texture"] as FilterLike;
  const width = 160,
    height = 120;
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(width, height, 128), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        type: "CANVAS",
        blendMode: "OVERLAY",
        scale: 40,
        strength: 1,
        contrast: 3,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `high-scale paper render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "high-scale paper readback failed" };
  let totalDelta = 0,
    comparisons = 0,
    low = 255,
    high = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixels[(y * width + x) * 4];
      low = Math.min(low, value);
      high = Math.max(high, value);
      if (x > 0) {
        totalDelta += Math.abs(value - pixels[(y * width + x - 1) * 4]);
        comparisons += 1;
      }
      if (y > 0) {
        totalDelta += Math.abs(value - pixels[((y - 1) * width + x) * 4]);
        comparisons += 1;
      }
    }
  }
  const meanDelta = totalDelta / Math.max(1, comparisons);
  return high - low >= 6 && meanDelta < 38
    ? { ok: true }
    : {
        ok: false,
        reason: `high-scale weave range=${high - low}, adjacent delta=${meanDelta.toFixed(2)}`,
      };
};

export const runSumiFiberCorrelation = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Sumi-e"] as FilterLike;
  const width = 160,
    height = 120;
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(width, height, 255), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        washStrength: 0,
        edgeStrength: 0,
        paperColor: [128, 128, 128],
        grain: 0.6,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `washi correlation render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "washi correlation readback failed" };
  let adjacent = 0,
    distant = 0,
    samples = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 20; x += 1) {
      const value = pixels[(y * width + x) * 4];
      adjacent += Math.abs(value - pixels[(y * width + x + 1) * 4]);
      distant += Math.abs(value - pixels[(y * width + x + 20) * 4]);
      samples += 1;
    }
  }
  adjacent /= Math.max(1, samples);
  distant /= Math.max(1, samples);
  return distant > 2 && adjacent < distant * 0.5
    ? { ok: true }
    : {
        ok: false,
        reason: `washi was not spatially correlated (adjacent=${adjacent.toFixed(2)}, distant=${distant.toFixed(2)})`,
      };
};

export const runFixedLayeredPrintFrameInvariance = (
  name: "Risograph" | "Risograph (multi-layer)",
): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex[name] as FilterLike;
  const base = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    grain: 0.8,
  };
  return runEquivalent(filter, { ...base, _frameIndex: 2 }, { ...base, _frameIndex: 73 }, 0);
};

export const runRisographNoForcedBleed = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Risograph as FilterLike;
  const size = 17;
  const source = makeSolidCanvas(size, size, 255);
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "riso impulse fixture has no 2d context" };
  const center = Math.floor(size / 2);
  context.fillStyle = "black";
  context.fillRect(center, center, 1, 1);
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(source, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        color1: [0, 0, 0],
        color2: [245, 240, 235],
        misregX: 0,
        misregY: 0,
        grain: 0,
        inkBleed: 0,
        threshold: 128,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `riso impulse render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "riso impulse readback failed" };
  const centerValue = pixels[(center * size + center) * 4];
  if (centerValue > 20)
    return { ok: false, reason: `riso impulse center was not printed (${centerValue})` };
  for (let y = center - 1; y <= center + 1; y += 1) {
    for (let x = center - 1; x <= center + 1; x += 1) {
      if (x === center && y === center) continue;
      const index = (y * size + x) * 4;
      if (pixels[index] < 240 || pixels[index + 1] < 235 || pixels[index + 2] < 230) {
        return { ok: false, reason: `zero bleed spread the impulse to ${x},${y}` };
      }
    }
  }
  return { ok: true };
};

export const runDuplexPaperHighlights = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Duplex Print"] as FilterLike;
  const paper: [number, number, number] = [244, 237, 224];
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(32, 32, 255), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        paperColor: paper,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `duplex highlight render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "duplex highlight readback failed" };
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      Math.abs(pixels[index] - paper[0]) > 1 ||
      Math.abs(pixels[index + 1] - paper[1]) > 1 ||
      Math.abs(pixels[index + 2] - paper[2]) > 1
    ) {
      return {
        ok: false,
        reason: `paper highlight was inked rgb=${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`,
      };
    }
  }
  return { ok: true };
};

export const runScreenPrintHalftone = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Screen Print"] as FilterLike;
  const paper: [number, number, number] = [244, 237, 224];
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(96, 72, 128), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        plates: 2,
        offset: 0,
        angleJitter: 0,
        paperColor: paper,
        inkStrength: 0.7,
        screenFrequency: 16,
        dotGain: 0,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `screen halftone render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "screen halftone readback failed" };
  let paperPixels = 0,
    inkPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const distance =
      Math.abs(pixels[index] - paper[0]) +
      Math.abs(pixels[index + 1] - paper[1]) +
      Math.abs(pixels[index + 2] - paper[2]);
    if (distance <= 3) paperPixels += 1;
    if (distance >= 80) inkPixels += 1;
  }
  return paperPixels > 300 && inkPixels > 300
    ? { ok: true }
    : {
        ok: false,
        reason: `screen lacked discrete paper/ink dots (paper=${paperPixels}, ink=${inkPixels})`,
      };
};

export const runStaticArtifactFrameInvariance = (
  name: "Newspaper" | "Polaroid" | "Thermal Printer",
): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex[name] as FilterLike;
  const base = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
  };
  return runEquivalent(filter, { ...base, _frameIndex: 1 }, { ...base, _frameIndex: 47 }, 0);
};

export const runThermalPrinterCellCoherence = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Thermal Printer"] as FilterLike;
  const width = 64;
  const height = 48;
  const cellSize = 4;
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(width, height, 128), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        resolution: width / cellSize,
        fadeGradient: 1,
        dotDensity: 0.8,
        _frameIndex: 9,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `thermal-cell render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "thermal-cell readback failed" };
  for (let cellY = 0; cellY < height; cellY += cellSize) {
    for (let cellX = 0; cellX < width; cellX += cellSize) {
      const origin = (cellY * width + cellX) * 4;
      for (let y = cellY; y < Math.min(height, cellY + cellSize); y += 1) {
        for (let x = cellX; x < Math.min(width, cellX + cellSize); x += 1) {
          const index = (y * width + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            if (pixels[index + channel] !== pixels[origin + channel]) {
              return {
                ok: false,
                reason: `thermal cell ${cellX / cellSize},${cellY / cellSize} contains output-resolution noise`,
              };
            }
          }
        }
      }
    }
  }
  return { ok: true };
};

export const runPolaroidNoForcedBlur = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Polaroid as FilterLike;
  const size = 17;
  const source = document.createElement("canvas");
  source.width = size;
  source.height = size;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "Polaroid impulse fixture has no 2d context" };
  context.fillStyle = "black";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "white";
  context.fillRect(Math.floor(size / 2), Math.floor(size / 2), 1, 1);
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(source, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        warmth: 0,
        fadedBlacks: 0,
        saturation: 1,
        grain: 0,
        vignette: 0,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `Polaroid impulse render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "Polaroid impulse readback failed" };
  const center = Math.floor(size / 2);
  for (let y = center - 1; y <= center + 1; y += 1) {
    for (let x = center - 1; x <= center + 1; x += 1) {
      if (x === center && y === center) continue;
      const index = (y * size + x) * 4;
      if (pixels[index] > 1 || pixels[index + 1] > 1 || pixels[index + 2] > 1) {
        return { ok: false, reason: `neutral Polaroid spread an impulse to ${x},${y}` };
      }
    }
  }
  return { ok: true };
};

export const runFilmGrainContinuousClusters = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Film Grain"] as FilterLike;
  const size = 4;
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(64, 48, 128), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        amount: 0.7,
        size,
        monochrome: true,
        _frameIndex: 3,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `film-grain render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "film-grain readback failed" };
  let internallyVaried = 0;
  for (let cellY = 0; cellY < 48; cellY += size) {
    for (let cellX = 0; cellX < 64; cellX += size) {
      const values = new Set<number>();
      for (let y = cellY; y < cellY + size; y += 1) {
        for (let x = cellX; x < cellX + size; x += 1) {
          values.add(pixels[(y * 64 + x) * 4]);
        }
      }
      if (values.size >= 3) internallyVaried += 1;
    }
  }
  return internallyVaried >= 24
    ? { ok: true }
    : {
        ok: false,
        reason: `grain remained square/block-constant (${internallyVaried} varied cells)`,
      };
};

export const runLightLeakNeutrality = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Light Leak"] as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(64, 48, 0), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        intensity: 1,
        position: "TL",
        color: [255, 255, 255],
        spread: 1,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `light-leak render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "light-leak readback failed" };
  let brightest = 0;
  let channels: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < pixels.length; index += 4) {
    const luma = pixels[index] + pixels[index + 1] + pixels[index + 2];
    if (luma > brightest) {
      brightest = luma;
      channels = [pixels[index], pixels[index + 1], pixels[index + 2]];
    }
  }
  const spread = Math.max(...channels) - Math.min(...channels);
  return brightest > 600 && spread <= 2
    ? { ok: true }
    : { ok: false, reason: `neutral leak gained channel bias rgb=${channels.join(",")}` };
};

export const runProjectionDustOcclusion = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Projection film"] as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(320, 240, 128), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        gateWeave: 0,
        grain: 0,
        dustAmount: 1,
        scratchAmount: 0,
        flicker: 0,
        vignette: 0,
        warmth: 0,
        bloom: 0,
        _frameIndex: 2,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `projection-dust render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "projection-dust readback failed" };
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    minimum = Math.min(minimum, pixels[index], pixels[index + 1], pixels[index + 2]);
    maximum = Math.max(maximum, pixels[index], pixels[index + 1], pixels[index + 2]);
  }
  return minimum < 110 && maximum <= 130
    ? { ok: true }
    : {
        ok: false,
        reason: `projected dust did not occlude neutral film (range=${minimum}..${maximum})`,
      };
};

export const runProjectionScratchDiversity = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Projection film"] as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(
      filter.func(makeSolidCanvas(320, 240, 128), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        gateWeave: 0,
        grain: 0,
        dustAmount: 0,
        scratchAmount: 1,
        flicker: 0,
        vignette: 0,
        warmth: 0,
        bloom: 0,
        _frameIndex: 8,
      }) as HTMLCanvasElement,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `projection-scratch render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "projection-scratch readback failed" };
  let dark = 0;
  let bright = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const value = pixels[index];
    if (value < 105) dark += 1;
    if (value > 155) bright += 1;
  }
  return dark > 80 && bright > 80
    ? { ok: true }
    : {
        ok: false,
        reason: `scratches lacked base/emulsion diversity (dark=${dark}, bright=${bright})`,
      };
};

export const runInfraredNeutrality = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Infrared as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    const output = filter.func(makeSolidCanvas(32, 32, 128), {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      intensity: 1,
      falseColor: 1,
      foliageResponse: 1,
      skySuppression: 0.65,
      contrast: 1,
      grain: 0,
    }) as HTMLCanvasElement;
    pixels = canvasPixels(output);
  } catch (error) {
    return {
      ok: false,
      reason: `neutral render threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!pixels) return { ok: false, reason: "neutral infrared readback failed" };
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (Math.max(Math.abs(red - green), Math.abs(red - blue), Math.abs(green - blue)) > 1) {
      return { ok: false, reason: `neutral gray gained a color cast (${red},${green},${blue})` };
    }
    if (Math.abs(red - 128) > 2) {
      return { ok: false, reason: `neutral reflectance drifted from 128 to ${red}` };
    }
  }
  return { ok: true };
};

export const runNokiaLcdStates = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Nokia LCD"] as FilterLike;
  const legal = new Set(["67,82,61", "199,207,161"]);
  const render = (width: number, height: number, pixelGrid: boolean): Uint8ClampedArray | null => {
    try {
      return canvasPixels(
        filter.func(makeGradientCanvas(width, height), {
          ...(filter.defaults ?? {}),
          ...runtimeOptions(),
          pixelGrid,
        }) as HTMLCanvasElement,
      );
    } catch {
      return null;
    }
  };
  const small = render(64, 48, true);
  const previewWithoutGrid = render(256, 192, false);
  const previewWithGrid = render(256, 192, true);
  const largeWithoutGrid = render(672, 384, false);
  const largeWithGrid = render(672, 384, true);
  if (!small || !previewWithoutGrid || !previewWithGrid || !largeWithoutGrid || !largeWithGrid) {
    return { ok: false, reason: "LCD state render/readback failed" };
  }
  for (const [label, pixels] of [
    ["small", small],
    ["large", largeWithGrid],
  ] as const) {
    const seen = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) {
      const color = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
      if (!legal.has(color))
        return { ok: false, reason: `${label} LCD emitted non-physical color ${color}` };
      seen.add(color);
    }
    if (seen.size !== 2)
      return { ok: false, reason: `${label} LCD did not use both optical states` };
  }
  for (let index = 0; index < previewWithGrid.length; index += 1) {
    if (previewWithGrid[index] !== previewWithoutGrid[index]) {
      return { ok: false, reason: `unresolvable preview grid altered channel ${index}` };
    }
  }
  let changed = 0;
  for (let index = 0; index < largeWithGrid.length; index += 1) {
    if (largeWithGrid[index] !== largeWithoutGrid[index]) changed += 1;
  }
  return changed > 100
    ? { ok: true }
    : { ok: false, reason: `large-canvas pixel grid was inert (${changed} changed channels)` };
};

export const runThermalNoiseContract = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Thermal camera"] as FilterLike;
  const source = makeGradientCanvas(64, 48);
  const render = (frame: number, noiseAmount: number): Uint8ClampedArray | null => {
    try {
      return canvasPixels(
        filter.func(source, {
          ...(filter.defaults ?? {}),
          ...runtimeOptions(),
          crosshair: false,
          fixedPatternNoise: 0,
          noiseAmount,
          _frameIndex: frame,
        }) as HTMLCanvasElement,
      );
    } catch {
      return null;
    }
  };
  const noisyA = render(1, 0.1);
  const noisyB = render(2, 0.1);
  const stillA = render(1, 0);
  const stillB = render(2, 0);
  if (!noisyA || !noisyB || !stillA || !stillB) {
    return { ok: false, reason: "thermal noise render/readback failed" };
  }
  let movingChanges = 0;
  let stillChanges = 0;
  for (let index = 0; index < noisyA.length; index += 1) {
    if (noisyA[index] !== noisyB[index]) movingChanges += 1;
    if (stillA[index] !== stillB[index]) stillChanges += 1;
  }
  if (movingChanges === 0)
    return { ok: false, reason: "enabled temporal noise was frame-invariant" };
  if (stillChanges !== 0)
    return { ok: false, reason: `disabled temporal noise changed ${stillChanges} channels` };
  return { ok: true };
};

export const runDaguerreotypeViewAngle = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Daguerreotype as FilterLike;
  const source = makeGradientCanvas(64, 48);
  const render = (viewAngle: number): Uint8ClampedArray | null => {
    try {
      return canvasPixels(
        filter.func(source, {
          ...(filter.defaults ?? {}),
          ...runtimeOptions(),
          viewAngle,
        }) as HTMLCanvasElement,
      );
    } catch {
      return null;
    }
  };
  const facing = render(0);
  const opposite = render(180);
  if (!facing || !opposite) return { ok: false, reason: "view-angle render/readback failed" };
  let changed = 0;
  for (let index = 0; index < facing.length; index += 4) {
    if (facing[index] !== opposite[index]) changed += 1;
    if (facing[index + 1] !== opposite[index + 1]) changed += 1;
    if (facing[index + 2] !== opposite[index + 2]) changed += 1;
  }
  return changed > 1000
    ? { ok: true }
    : { ok: false, reason: `view-angle reflection was inert (${changed} changed channels)` };
};
