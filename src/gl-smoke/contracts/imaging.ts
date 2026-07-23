import {
  filterIndex,
  getCanvasPoolStats,
  getGLStats,
  nearest,
  releasePooledCanvas,
  resetCanvasPoolStats,
  resetGLStats,
} from "@gyng/ditherer-filters";
import { canvasPixels, makeGradientCanvas, makeSolidCanvas, runtimeOptions } from "../fixtures";
import type { FilterLike } from "../types";

export const runStainedGlassColorModes = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Stained Glass"];
  if (!filter) return { ok: false, reason: "Stained glass not in registry" };
  const width = 48;
  const height = 32;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return { ok: false, reason: "Stained glass fixture has no 2d context" };
  const image = context.createImageData(width, height);
  const swatches = [
    [240, 20, 20], [240, 20, 20], [240, 20, 20], [240, 20, 20],
    [20, 20, 240], [20, 20, 240], [20, 20, 240],
    [20, 240, 20], [20, 240, 20], [20, 240, 20],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const swatch = swatches[(x + y * 3) % swatches.length];
      image.data[offset] = swatch[0];
      image.data[offset + 1] = swatch[1];
      image.data[offset + 2] = swatch[2];
      image.data[offset + 3] = (x * 37 + y * 19) & 255;
    }
  }
  context.putImageData(image, 0, 0);

  for (const webgl of [false, true]) {
    const signatures = new Set<string>();
    for (const colorMode of ["AVERAGE", "MEDIAN", "DOMINANT"]) {
      const output = filter.func(source, {
        ...(filter.defaults ?? {}),
        cellSize: 24,
        irregularity: 0.35,
        leadingWidth: 2,
        colorMode,
        palette: { ...nearest, options: { ...nearest.options, levels: 256 } },
        _webglAcceleration: webgl,
      }) as HTMLCanvasElement;
      const pixels = output.getContext("2d", { willReadFrequently: true })
        ?.getImageData(0, 0, width, height).data;
      if (!pixels) return { ok: false, reason: `Stained glass ${webgl ? "GL" : "CPU"} readback failed` };
      let signature = 2166136261;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] !== image.data[offset + 3]) {
          return { ok: false, reason: `Stained glass ${webgl ? "GL" : "CPU"} changed source alpha in ${colorMode}` };
        }
        signature ^= pixels[offset]; signature = Math.imul(signature, 16777619);
        signature ^= pixels[offset + 1]; signature = Math.imul(signature, 16777619);
        signature ^= pixels[offset + 2]; signature = Math.imul(signature, 16777619);
      }
      signatures.add(String(signature >>> 0));
    }
    if (signatures.size !== 3) {
      return { ok: false, reason: `Stained glass ${webgl ? "GL" : "CPU"} color modes are not all live` };
    }

    const customPalette = {
      name: "contract-bright-panes",
      options: {},
      getColor: (pixel: number[]) => [230, 210, 190, pixel[3]],
    };
    const customOutput = filter.func(source, {
      ...(filter.defaults ?? {}),
      cellSize: 24,
      irregularity: 0.35,
      leadingWidth: 3,
      leadingColor: [5, 7, 9],
      colorMode: "AVERAGE",
      palette: customPalette,
      _webglAcceleration: webgl,
    }) as HTMLCanvasElement;
    const customPixels = customOutput.getContext("2d", { willReadFrequently: true })
      ?.getImageData(0, 0, width, height).data;
    if (!customPixels) return { ok: false, reason: `Stained glass ${webgl ? "GL" : "CPU"} custom-palette readback failed` };
    let darkLeadingPixels = 0;
    for (let offset = 0; offset < customPixels.length; offset += 4) {
      if (customPixels[offset] < 40 && customPixels[offset + 1] < 40 && customPixels[offset + 2] < 40) {
        darkLeadingPixels++;
      }
    }
    if (darkLeadingPixels < width) {
      return { ok: false, reason: `Stained glass ${webgl ? "GL" : "CPU"} custom palette recolored its lead network` };
    }
  }
  return { ok: true };
};

const meanChannel = (pixels: Uint8ClampedArray, channel: number): number => {
  let sum = 0;
  for (let offset = channel; offset < pixels.length; offset += 4) sum += pixels[offset];
  return sum / (pixels.length / 4) / 255;
};

const makeSolidColorCanvas = (width: number, height: number, rgba: readonly number[]): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(width, height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = rgba[0] ?? 0; image.data[offset + 1] = rgba[1] ?? 0;
    image.data[offset + 2] = rgba[2] ?? 0; image.data[offset + 3] = rgba[3] ?? 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
};

export const runScreenToneContracts = (): { ok: true } | { ok: false; reason: string } => {
  const line = filterIndex["Halftone Line"];
  const color = filterIndex["Color Halftone Separate"];
  if (!line || !color) return { ok: false, reason: "screen-tone filters missing from registry" };
  const palette = { ...nearest, options: { ...nearest.options, levels: 256 } };

  for (const cellSize of [8, 16, 48]) {
    const means: number[] = [];
    for (const value of [255, 128, 0]) {
      const source = makeSolidCanvas(192, 192, value);
      const output = line.func(source, {
        ...(line.defaults ?? {}), cellSize, angleMode: "CONSTANT", baseAngle: 37,
        inkColor: [0, 0, 0], paperColor: [255, 255, 255], palette,
        _webglAcceleration: true,
      }) as HTMLCanvasElement;
      const pixels = canvasPixels(output);
      if (!pixels) return { ok: false, reason: "Halftone Line readback failed" };
      means.push(meanChannel(pixels, 0));
    }
    if (means[0] < 0.98 || means[2] > 0.02 || Math.abs(means[1] - 0.5) > 0.09) {
      return { ok: false, reason: `Halftone Line tone response failed at pitch ${cellSize}: ${means.map(v => v.toFixed(3)).join(",")}` };
    }
  }

  for (const value of [64, 128, 192, 255]) {
    const source = makeSolidColorCanvas(192, 192, [value, 0, 0, 255]);
    const output = color.func(source, {
      ...(color.defaults ?? {}), dotSize: 16, offsetR: 0, offsetG: 0, offsetB: 0,
      palette, _webglAcceleration: true,
    }) as HTMLCanvasElement;
    const pixels = canvasPixels(output);
    if (!pixels) return { ok: false, reason: "Color Halftone readback failed" };
    if (Math.abs(meanChannel(pixels, 0) - value / 255) > 0.08 || meanChannel(pixels, 1) > 0.01 || meanChannel(pixels, 2) > 0.01) {
      return { ok: false, reason: `Color Halftone area response failed at ${value}` };
    }
  }
  const registrationSource = makeSolidColorCanvas(96, 64, [128, 0, 0, 255]);
  const registrationRenders = [0, 3].map(offsetR => canvasPixels(color.func(registrationSource, {
    ...(color.defaults ?? {}), dotSize: 16, offsetR, offsetG: 0, offsetB: 0,
    palette, _webglAcceleration: true,
  }) as HTMLCanvasElement));
  if (!registrationRenders[0] || !registrationRenders[1]) return { ok: false, reason: "Color Halftone registration readback failed" };
  let registrationChanges = 0;
  for (let i = 0; i < registrationRenders[0].length; i += 4) {
    if (registrationRenders[0][i] !== registrationRenders[1][i]) registrationChanges++;
  }
  if (registrationChanges < 96) return { ok: false, reason: "Color Halftone registration does not move its plate geometry" };

  const alphaSource = document.createElement("canvas");
  alphaSource.width = 64; alphaSource.height = 48;
  const alphaContext = alphaSource.getContext("2d");
  if (!alphaContext) return { ok: false, reason: "screen alpha fixture unavailable" };
  const alphaImage = alphaContext.createImageData(64, 48);
  for (let i = 0; i < alphaImage.data.length; i += 4) {
    alphaImage.data[i] = 160; alphaImage.data[i + 1] = 90; alphaImage.data[i + 2] = 210;
    alphaImage.data[i + 3] = ((i / 4) * 37) & 255;
  }
  alphaContext.putImageData(alphaImage, 0, 0);
  for (const filter of [line, color]) {
    const output = filter.func(alphaSource, { ...(filter.defaults ?? {}), palette, _webglAcceleration: true }) as HTMLCanvasElement;
    const pixels = canvasPixels(output);
    if (!pixels) return { ok: false, reason: `${filter.name} alpha readback failed` };
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== alphaImage.data[i]) return { ok: false, reason: `${filter.name} changed source alpha` };
    }
  }
  return { ok: true };
};

export const runJpegSubsamplingModes = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["JPEG Artifact"];
  if (!filter) return { ok: false, reason: "JPEG Artifact missing from registry" };
  const source = document.createElement("canvas");
  source.width = 64; source.height = 64;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "JPEG chroma fixture unavailable" };
  const image = context.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4;
    const vertical = x < 32;
    const choose = vertical ? x % 2 === 0 : y % 2 === 0;
    image.data[offset] = choose ? 255 : 0;
    image.data[offset + 1] = 0;
    image.data[offset + 2] = choose ? 0 : 255;
    image.data[offset + 3] = (x * 11 + y * 17) & 255;
  }
  context.putImageData(image, 0, 0);
  const signatures = new Set<string>();
  for (const subsampling of ["444", "422", "420"]) {
    const output = filter.func(source, {
      ...(filter.defaults ?? {}), qualityLuma: 100, qualityChroma: 100,
      subsampling, ringing: 0, mosquito: 0, gridJitter: 0,
      corruptBurstChance: 0, deblock: 0, temporalHold: 0,
      preserveAlpha: true, _webglAcceleration: true,
    }) as HTMLCanvasElement;
    const pixels = canvasPixels(output);
    if (!pixels) return { ok: false, reason: `JPEG ${subsampling} readback failed` };
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] !== image.data[i + 3]) return { ok: false, reason: `JPEG ${subsampling} changed alpha` };
      hash ^= pixels[i]; hash = Math.imul(hash, 16777619);
      hash ^= pixels[i + 1]; hash = Math.imul(hash, 16777619);
      hash ^= pixels[i + 2]; hash = Math.imul(hash, 16777619);
    }
    signatures.add(String(hash >>> 0));
  }
  if (signatures.size !== 3) return { ok: false, reason: "JPEG subsampling modes are not all live" };

  const partial = makeSolidCanvas(13, 11, 128);
  const partialOutput = filter.func(partial, {
    ...(filter.defaults ?? {}), qualityLuma: 100, qualityChroma: 100, subsampling: "444",
    ringing: 0, mosquito: 0, gridJitter: 0, corruptBurstChance: 0, deblock: 0,
    temporalHold: 0, _webglAcceleration: true,
  }) as HTMLCanvasElement;
  const partialPixels = canvasPixels(partialOutput);
  if (!partialPixels) return { ok: false, reason: "JPEG partial-block readback failed" };
  let low = 255; let high = 0;
  for (let i = 0; i < partialPixels.length; i += 4) {
    low = Math.min(low, partialPixels[i], partialPixels[i + 1], partialPixels[i + 2]);
    high = Math.max(high, partialPixels[i], partialPixels[i + 1], partialPixels[i + 2]);
  }
  return high - low <= 3 ? { ok: true } : { ok: false, reason: `JPEG partial 8x8 edge drifted by ${high - low} levels` };
};

export const runLegacyFieldContracts = (): { ok: true } | { ok: false; reason: string } => {
  const contour = filterIndex["Contour Lines"];
  const diffusion = filterIndex["Anisotropic diffusion"];
  if (!contour || !diffusion) return { ok: false, reason: "legacy field filters missing from registry" };
  const palette = { ...nearest, options: { ...nearest.options, levels: 256 } };

  const ramp = document.createElement("canvas");
  ramp.width = 256; ramp.height = 8;
  const rampContext = ramp.getContext("2d");
  if (!rampContext) return { ok: false, reason: "Contour ramp fixture unavailable" };
  const rampImage = rampContext.createImageData(256, 8);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 256; x += 1) {
    const offset = (y * 256 + x) * 4;
    rampImage.data[offset] = x; rampImage.data[offset + 1] = x; rampImage.data[offset + 2] = x;
    rampImage.data[offset + 3] = 255;
  }
  rampContext.putImageData(rampImage, 0, 0);
  const rampInput = canvasPixels(ramp);
  const filled = canvasPixels(contour.func(ramp, {
    ...(contour.defaults ?? {}), levels: 5, fillMode: "FILLED", palette,
    _webglAcceleration: true,
  }) as HTMLCanvasElement);
  if (!rampInput || !filled) return { ok: false, reason: "Contour filled-band readback failed" };
  const tones = new Set<number>();
  for (let offset = 0; offset < filled.length; offset += 4) {
    tones.add((filled[offset] << 16) | (filled[offset + 1] << 8) | filled[offset + 2]);
    if (filled[offset + 3] !== rampInput[offset + 3]) return { ok: false, reason: "Contour Lines changed source alpha" };
  }
  if (tones.size !== 5) return { ok: false, reason: `Contour filled mode produced ${tones.size} tones instead of 5` };

  const checker = document.createElement("canvas");
  checker.width = 32; checker.height = 32;
  const checkerContext = checker.getContext("2d");
  if (!checkerContext) return { ok: false, reason: "diffusion fixture unavailable" };
  const checkerImage = checkerContext.createImageData(32, 32);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const offset = (y * 32 + x) * 4;
    const value = (x + y) % 2 === 0 ? 100 : 102;
    checkerImage.data[offset] = value; checkerImage.data[offset + 1] = value; checkerImage.data[offset + 2] = value;
    checkerImage.data[offset + 3] = 255;
  }
  checkerContext.putImageData(checkerImage, 0, 0);
  const diffused = canvasPixels(diffusion.func(checker, {
    ...(diffusion.defaults ?? {}), iterations: 10, kappa: 200, lambda: 0.2,
    conductance: "EXP", palette, _webglAcceleration: true,
  }) as HTMLCanvasElement);
  if (!diffused) return { ok: false, reason: "Anisotropic Diffusion readback failed" };
  let min = 255; let max = 0;
  for (let offset = 0; offset < diffused.length; offset += 4) {
    min = Math.min(min, diffused[offset]); max = Math.max(max, diffused[offset]);
    if (diffused[offset + 3] !== 255) return { ok: false, reason: "Anisotropic Diffusion changed opaque source alpha" };
  }
  if (max - min > 1) return { ok: false, reason: `Anisotropic Diffusion low-noise checker did not converge (range ${min}..${max})` };

  const alphaSource = makeSolidCanvas(16, 8, 128);
  const alphaContext = alphaSource.getContext("2d");
  if (!alphaContext) return { ok: false, reason: "field alpha fixture unavailable" };
  const alphaImage = alphaContext.getImageData(0, 0, 16, 8);
  for (let offset = 3; offset < alphaImage.data.length; offset += 4) alphaImage.data[offset] = ((offset / 4) * 37) & 255;
  alphaContext.putImageData(alphaImage, 0, 0);
  for (const filter of [contour, diffusion]) {
    const output = canvasPixels(filter.func(alphaSource, {
      ...(filter.defaults ?? {}), palette, _webglAcceleration: true,
    }) as HTMLCanvasElement);
    if (!output) return { ok: false, reason: `${filter.name} alpha readback failed` };
    for (let offset = 3; offset < output.length; offset += 4) {
      if (output[offset] !== alphaImage.data[offset]) return { ok: false, reason: `${filter.name} changed source alpha` };
    }
  }
  return { ok: true };
};

export const runLegacyPrinterAndOutlineContracts = (): { ok: true } | { ok: false; reason: string } => {
  const dot = filterIndex["Dot Matrix"];
  const outline = filterIndex["Pixel Outline"];
  if (!dot || !outline) return { ok: false, reason: "legacy printer/outline filters missing from registry" };
  const palette = { ...nearest, options: { ...nearest.options, levels: 256 } };
  const expectedFractions = [0.25, 0.5, 0.75];
  for (let toneIndex = 0; toneIndex < expectedFractions.length; toneIndex += 1) {
    const darkness = expectedFractions[toneIndex];
    const source = makeSolidCanvas(96, 96, Math.round((1 - darkness) * 255));
    const output = canvasPixels(dot.func(source, {
      ...(dot.defaults ?? {}), dotSize: 4, spacing: 2, inkDensity: 1,
      inkColor: [0, 0, 0], paperColor: [255, 255, 255], palette,
      _webglAcceleration: true,
    }) as HTMLCanvasElement);
    if (!output) return { ok: false, reason: "Dot Matrix readback failed" };
    let fired = 0; let cells = 0;
    for (let cy = 0; cy < 96; cy += 6) for (let cx = 0; cx < 96; cx += 6) {
      const centerX = Math.min(95, cx + 3);
      const centerY = Math.min(95, cy + 3);
      if (output[(centerY * 96 + centerX) * 4] < 128) fired += 1;
      cells += 1;
    }
    const fraction = fired / cells;
    if (Math.abs(fraction - darkness) > 0.07) {
      return { ok: false, reason: `Dot Matrix strike density ${fraction.toFixed(3)} did not track ${darkness}` };
    }
  }

  const alphaSource = document.createElement("canvas");
  alphaSource.width = 48; alphaSource.height = 32;
  const alphaContext = alphaSource.getContext("2d");
  if (!alphaContext) return { ok: false, reason: "outline alpha fixture unavailable" };
  const alphaImage = alphaContext.createImageData(48, 32);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 48; x += 1) {
    const offset = (y * 48 + x) * 4;
    const foreground = x >= 24;
    alphaImage.data[offset] = foreground ? 230 : 20;
    alphaImage.data[offset + 1] = foreground ? 40 : 200;
    alphaImage.data[offset + 2] = 80;
    alphaImage.data[offset + 3] = (x * 31 + y * 13) & 255;
  }
  alphaContext.putImageData(alphaImage, 0, 0);
  for (const filter of [dot, outline]) {
    for (const webgl of [false, true]) {
      const output = canvasPixels(filter.func(alphaSource, {
        ...(filter.defaults ?? {}), palette, _webglAcceleration: webgl,
      }) as HTMLCanvasElement);
      if (!output) return { ok: false, reason: `${filter.name} alpha readback failed` };
      for (let offset = 3; offset < output.length; offset += 4) {
        if (output[offset] !== alphaImage.data[offset]) return { ok: false, reason: `${filter.name} ${webgl ? "GL" : "CPU"} changed source alpha` };
      }
    }
  }
  return { ok: true };
};

export const runCoreToneEdgeContracts = (): { ok: true } | { ok: false; reason: string } => {
  const posterize = filterIndex["Posterize Dither"];
  const cmyk = filterIndex["CMYK Halftone"];
  const edge = filterIndex["Edge Trace"];
  const clahe = filterIndex.CLAHE;
  if (!posterize || !cmyk || !edge || !clahe) return { ok: false, reason: "core tone/edge filters missing" };
  const palette = { ...nearest, options: { ...nearest.options, levels: 256 } };

  for (const value of [64, 128, 191]) {
    const output = canvasPixels(posterize.func(makeSolidCanvas(64, 64, value), {
      ...(posterize.defaults ?? {}), levelsR: 2, levelsG: 2, levelsB: 2,
      matrixSize: "4x4", palette, _webglAcceleration: true,
    }) as HTMLCanvasElement);
    if (!output) return { ok: false, reason: "Posterize Dither readback failed" };
    const mean = meanChannel(output, 0);
    if (Math.abs(mean - value / 255) > 0.02) {
      return { ok: false, reason: `Posterize Dither mean ${mean.toFixed(3)} did not preserve ${value / 255}` };
    }
  }

  for (const pitch of [2, 6, 12]) {
    const cyan = makeSolidColorCanvas(192, 192, [128, 255, 255, 255]);
    const output = canvasPixels(cmyk.func(cyan, {
      ...(cmyk.defaults ?? {}), dotSize: pitch, angleC: 0, angleM: 0, angleY: 0, angleK: 0,
      paperColor: [255, 255, 255], palette, _webglAcceleration: true,
    }) as HTMLCanvasElement);
    if (!output) return { ok: false, reason: "CMYK Halftone readback failed" };
    const red = meanChannel(output, 0);
    if (Math.abs(red - 128 / 255) > 0.08 || meanChannel(output, 1) < 0.98 || meanChannel(output, 2) < 0.98) {
      return { ok: false, reason: `CMYK Halftone pitch ${pitch} area response was ${red.toFixed(3)}` };
    }
  }
  const periodicSource = makeSolidColorCanvas(94, 70, [128, 255, 255, 255]);
  const periodic = [0, 180].map(angle => canvasPixels(cmyk.func(periodicSource, {
    ...(cmyk.defaults ?? {}), dotSize: 6, angleC: angle, angleM: 0, angleY: 0, angleK: 0,
    paperColor: [255, 255, 255], palette, _webglAcceleration: true,
  }) as HTMLCanvasElement));
  if (!periodic[0] || !periodic[1]) return { ok: false, reason: "CMYK angle-periodicity readback failed" };
  let periodicChanges = 0;
  for (let i = 0; i < periodic[0].length; i += 1) if (periodic[0][i] !== periodic[1][i]) periodicChanges += 1;
  if (periodicChanges > periodic[0].length * 0.01) return { ok: false, reason: `CMYK 0/180 screens differed in ${periodicChanges} channels` };

  const mixed = document.createElement("canvas");
  mixed.width = 96; mixed.height = 96;
  const mixedContext = mixed.getContext("2d");
  if (!mixedContext) return { ok: false, reason: "CMYK mixed-cell fixture unavailable" };
  const mixedImage = mixedContext.createImageData(96, 96);
  for (let y = 0; y < 96; y += 1) for (let x = 0; x < 96; x += 1) {
    const offset = (y * 96 + x) * 4;
    const red = (x + y) % 2 === 0;
    mixedImage.data[offset] = red ? 255 : 0;
    mixedImage.data[offset + 1] = red ? 0 : 255;
    mixedImage.data[offset + 2] = red ? 0 : 255;
    mixedImage.data[offset + 3] = 255;
  }
  mixedContext.putImageData(mixedImage, 0, 0);
  const mixedOutput = canvasPixels(cmyk.func(mixed, {
    ...(cmyk.defaults ?? {}), dotSize: 8, palette, _webglAcceleration: true,
  }) as HTMLCanvasElement);
  if (!mixedOutput) return { ok: false, reason: "CMYK mixed-cell readback failed" };
  let chromaticPixels = 0;
  for (let offset = 0; offset < mixedOutput.length; offset += 4) {
    if (Math.max(mixedOutput[offset], mixedOutput[offset + 1], mixedOutput[offset + 2])
      - Math.min(mixedOutput[offset], mixedOutput[offset + 1], mixedOutput[offset + 2]) > 32) chromaticPixels += 1;
  }
  if (chromaticPixels < 500) return { ok: false, reason: "CMYK separated the averaged RGB cell instead of averaging plate coverages" };

  const sigmoid = document.createElement("canvas");
  sigmoid.width = 64; sigmoid.height = 32;
  const sigmoidContext = sigmoid.getContext("2d");
  if (!sigmoidContext) return { ok: false, reason: "edge fixture unavailable" };
  const sigmoidImage = sigmoidContext.createImageData(64, 32);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 64; x += 1) {
    const offset = (y * 64 + x) * 4;
    const value = Math.round(255 / (1 + Math.exp(-(x - 31.5) / 4)));
    sigmoidImage.data[offset] = value; sigmoidImage.data[offset + 1] = value; sigmoidImage.data[offset + 2] = value;
    sigmoidImage.data[offset + 3] = 255;
  }
  sigmoidContext.putImageData(sigmoidImage, 0, 0);
  const traced = canvasPixels(edge.func(sigmoid, {
    ...(edge.defaults ?? {}), threshold: 10, lineWidth: 1, renderMode: "SOLID",
    lineColor: [0, 0, 0], bgColor: [255, 255, 255], palette, _webglAcceleration: true,
  }) as HTMLCanvasElement);
  if (!traced) return { ok: false, reason: "Edge Trace readback failed" };
  const darkColumns = new Set<number>();
  for (let y = 2; y < 30; y += 1) for (let x = 1; x < 63; x += 1) {
    if (traced[(y * 64 + x) * 4] < 128) darkColumns.add(x);
  }
  if (darkColumns.size > 6) return { ok: false, reason: `Edge Trace NMS retained ${darkColumns.size} gradient columns` };
  const alphaSource = document.createElement("canvas");
  alphaSource.width = 64; alphaSource.height = 32;
  const alphaContext = alphaSource.getContext("2d");
  if (!alphaContext) return { ok: false, reason: "tone/edge alpha fixture unavailable" };
  const alphaImage = alphaContext.createImageData(64, 32);
  alphaImage.data.set(sigmoidImage.data);
  for (let offset = 3; offset < alphaImage.data.length; offset += 4) alphaImage.data[offset] = ((offset / 4) * 37) & 255;
  alphaContext.putImageData(alphaImage, 0, 0);
  const identity = canvasPixels(edge.func(alphaSource, {
    ...(edge.defaults ?? {}), renderMode: "OVERLAY", overlayMix: 0, palette, _webglAcceleration: true,
  }) as HTMLCanvasElement);
  const alphaPixels = canvasPixels(alphaSource);
  if (!identity || !alphaPixels) return { ok: false, reason: "Edge Trace identity readback failed" };
  for (let i = 0; i < identity.length; i += 1) {
    if (identity[i] !== alphaPixels[i]) return { ok: false, reason: "Edge Trace overlay mix zero is not RGBA identity" };
  }
  const paletteIdentity = canvasPixels(edge.func(alphaSource, {
    ...(edge.defaults ?? {}), renderMode: "OVERLAY", overlayMix: 0,
    palette: { ...nearest, options: { ...nearest.options, levels: 2 } }, _webglAcceleration: true,
  }) as HTMLCanvasElement);
  if (!paletteIdentity) return { ok: false, reason: "Edge Trace palette identity readback failed" };
  for (let i = 0; i < paletteIdentity.length; i += 1) {
    if (paletteIdentity[i] !== alphaPixels[i]) return { ok: false, reason: "Edge Trace zero mix applied a nonidentity palette" };
  }

  const binaryPalette = { ...nearest, options: { ...nearest.options, levels: 2 } };
  const claheOutput = canvasPixels(clahe.func(alphaSource, {
    ...(clahe.defaults ?? {}), tileSize: 8, clipLimit: 3, palette: binaryPalette,
    _webglAcceleration: true,
  }) as HTMLCanvasElement);
  if (!claheOutput) return { ok: false, reason: "CLAHE readback failed" };
  const channelValues = new Set<number>();
  for (let offset = 0; offset < claheOutput.length; offset += 4) {
    channelValues.add(claheOutput[offset]);
    if (claheOutput[offset + 3] !== alphaImage.data[offset + 3]) return { ok: false, reason: "CLAHE changed source alpha" };
  }
  if (channelValues.size !== 2 || !channelValues.has(0) || !channelValues.has(255)) {
    return { ok: false, reason: `CLAHE binary palette produced ${[...channelValues].join(",")}` };
  }
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) return { ok: false, reason: "CLAHE atlas probe has no WebGL2 context" };
  const atlasTiles = Math.floor((probe.getParameter(probe.MAX_TEXTURE_SIZE) as number) / 256) + 1;
  const multirow = document.createElement("canvas");
  multirow.width = atlasTiles * 8; multirow.height = 8;
  const multirowContext = multirow.getContext("2d");
  if (!multirowContext) return { ok: false, reason: "CLAHE multi-row fixture unavailable" };
  const multirowImage = multirowContext.createImageData(multirow.width, 8);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < multirow.width; x += 1) {
    const offset = (y * multirow.width + x) * 4;
    const value = (Math.floor(x / 8) * 29 + (x & 7) * 17 + y * 11) & 255;
    multirowImage.data[offset] = value; multirowImage.data[offset + 1] = value;
    multirowImage.data[offset + 2] = value; multirowImage.data[offset + 3] = 255;
  }
  multirowContext.putImageData(multirowImage, 0, 0);
  const multirowOutputs = [false, true].map(webgl => canvasPixels(clahe.func(multirow, {
    ...(clahe.defaults ?? {}), tileSize: 8, palette, _webglAcceleration: webgl,
  }) as HTMLCanvasElement));
  if (!multirowOutputs[0] || !multirowOutputs[1]) return { ok: false, reason: "CLAHE multi-row CDF atlas failed" };
  let atlasDelta = 0;
  for (let i = 0; i < multirowOutputs[0].length; i += 1) {
    atlasDelta = Math.max(atlasDelta, Math.abs(multirowOutputs[0][i] - multirowOutputs[1][i]));
  }
  if (atlasDelta > 1) return { ok: false, reason: `CLAHE second atlas row disagreed with CPU by ${atlasDelta}` };
  const edgeWidths = [32, 33].map(width => {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const image = context.createImageData(width, 16);
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = x % 2 === 0 ? 64 : 192;
      image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvasPixels(clahe.func(canvas, {
      ...(clahe.defaults ?? {}), tileSize: 32, palette, _webglAcceleration: true,
    }) as HTMLCanvasElement);
  });
  if (!edgeWidths[0] || !edgeWidths[1]) return { ok: false, reason: "CLAHE partial-tile readback failed" };
  let partialTileDelta = 0;
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 32; x += 1) {
    const left = (y * 32 + x) * 4;
    const right = (y * 33 + x) * 4;
    partialTileDelta = Math.max(partialTileDelta,
      Math.abs(edgeWidths[0][left] - edgeWidths[1][right]),
      Math.abs(edgeWidths[0][left + 1] - edgeWidths[1][right + 1]),
      Math.abs(edgeWidths[0][left + 2] - edgeWidths[1][right + 2]));
  }
  if (partialTileDelta > 3) return { ok: false, reason: `CLAHE one-pixel edge tile changed overlap by ${partialTileDelta}` };

  const hiddenFixtures = [0, 1].map(variant => {
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    const image = context.createImageData(32, 16);
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 32; x += 1) {
      const offset = (y * 32 + x) * 4;
      if (x < 16) {
        image.data[offset] = variant ? 255 : 0;
        image.data[offset + 1] = variant ? 0 : 255;
        image.data[offset + 2] = variant ? 180 : 20;
        image.data[offset + 3] = 0;
      } else {
        image.data[offset] = 80; image.data[offset + 1] = 80; image.data[offset + 2] = 80; image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  });
  for (const filter of [edge, clahe, cmyk]) {
    const renders = hiddenFixtures.map(source => canvasPixels(filter.func(source, {
      ...(filter.defaults ?? {}), tileSize: 8, renderMode: "SOLID", lineWidth: 1,
      threshold: 10, palette, _webglAcceleration: true,
    }) as HTMLCanvasElement));
    if (!renders[0] || !renders[1]) return { ok: false, reason: `${filter.name} hidden-RGB readback failed` };
    for (let y = 0; y < 16; y += 1) for (let x = 16; x < 32; x += 1) {
      const offset = (y * 32 + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        if (renders[0][offset + channel] !== renders[1][offset + channel]) return { ok: false, reason: `${filter.name} visible output depends on hidden RGB` };
      }
    }
    if (filter === edge) {
      let silhouetteInk = 0;
      for (let y = 2; y < 14; y += 1) if (renders[0][(y * 32 + 16) * 4] < 64) silhouetteInk += 1;
      if (silhouetteInk < 10) return { ok: false, reason: "Edge Trace missed an alpha silhouette" };
    }
  }
  for (const filter of [posterize, cmyk]) {
    const output = canvasPixels(filter.func(alphaSource, {
      ...(filter.defaults ?? {}), palette, _webglAcceleration: true,
    }) as HTMLCanvasElement);
    if (!output) return { ok: false, reason: `${filter.name} alpha readback failed` };
    for (let offset = 3; offset < output.length; offset += 4) {
      if (output[offset] !== alphaImage.data[offset]) return { ok: false, reason: `${filter.name} changed source alpha` };
    }
  }
  return { ok: true };
};

export const runUpgradedAlphaPreservation = (): { ok: true } | { ok: false; reason: string } => {
  const width = 64;
  const height = 48;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return { ok: false, reason: "alpha fixture has no 2d context" };
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      image.data[offset] = Math.round(x / (width - 1) * 255);
      image.data[offset + 1] = Math.round(y / (height - 1) * 255);
      image.data[offset + 2] = (x * 31 + y * 17) & 255;
      image.data[offset + 3] = (x * 19 + y * 23) & 255;
    }
  }
  context.putImageData(image, 0, 0);

  const cases: [string, Record<string, unknown>][] = [
    ["Infrared", {}],
    ["Mezzotint", {}],
    ["Nokia LCD", {}],
    ["Nokia LCD", { columns: 168, rows: 96 }],
    ["Daguerreotype", {}],
    ["Daguerreotype", { softFocus: 4 }],
    ["Film Burn", {}],
    ["Film Burn", { intensity: 1, distortion: 1 }],
    ["Ink Bleed", {}],
    ["Cyanotype", {}],
    ["Thermal camera", {}],
    ["Newspaper", {}],
    ["Thermal Printer", {}],
    ["Watercolor Bleed", {}],
    ["Watercolor Bleed", { iterations: 32, flow: 0.6, paperTexture: 1 }],
    ["Polaroid", {}],
    ["Film Grain", { amount: 1, size: 4 }],
    ["Light Leak", { intensity: 1, spread: 1 }],
    ["Projection film", {
      gateWeave: 0,
      grain: 0,
      flicker: 0,
      vignette: 0,
      dustAmount: 1,
      scratchAmount: 1,
      bloom: 2,
    }],
    ["Photocopier", { speckle: 1, generationLoss: 1 }],
    ["Paper Texture", { type: "CANVAS", scale: 40, strength: 1 }],
    ["Sumi-e", { grain: 0.6, edgeStrength: 1.2 }],
    ["Risograph", { grain: 1, inkBleed: 1 }],
    ["Risograph (multi-layer)", { grain: 1, misregistration: 20 }],
    ["Screen Print", { offset: 24, inkStrength: 1 }],
    ["Duplex Print", { mixCurve: 2 }],
    ["Night vision", { grain: 1, bloomStrength: 2 }],
    ["Ultrasound", { speckle: 1, markers: true }],
    ["Mavica FD7", { captureMode: "FIELD", smear: true }],
    ["Mavica FD7", { captureMode: "FRAME", frameJitter: "3" }],
    ["Lenticular", { viewAngle: 0.8, crosstalk: 0.4 }],
    ["LCD Display", { subpixelLayout: "STRIPE", pixelSize: 11 }],
    ["LCD Display", { subpixelLayout: "PENTILE", pixelSize: 11 }],
    ["LCD Display", { subpixelLayout: "DIAMOND", pixelSize: 11 }],
    ["Spectrogram", { logScale: true, dynamicRange: 80 }],
    ["Anaglyph", { mode: "RED_CYAN", depthSource: "LUMINANCE", strength: 18 }],
    ["Bayer Sensor", { method: "EDGE_AWARE", sensorNoise: 0.08, readNoise: 0.01 }],
    ["Moiré / Aliasing", { pattern: "SCREEN", sourcePitch: 3.5, cellSize: 4 }],
    ["CCD Charge Smear", { direction: "BOTH", antiBlooming: 0 }],
    ["Laser Speckle Projector", { diversity: 4, scanStrength: 0.2 }],
    ["E-ink", { texture: 0.2, ghosting: 0.5, pixelGrid: true }],
    ["Vintage TV", { colorFringe: 3, chromaBandwidth: 6, glow: 0.5 }],
    ["Digicam Flash", { flashPower: 1.2, warmth: 0.2, edgeBurn: 0.4 }],
    ["Lens Flare", {}],
    ["Pop Art", {}],
  ];
  for (const [name, override] of cases) {
    const filter = filterIndex[name] as FilterLike | undefined;
    if (!filter) return { ok: false, reason: `${name} missing from registry` };
    let output: HTMLCanvasElement;
    try {
      output = filter.func(source, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        ...override,
      }) as HTMLCanvasElement;
    } catch (error) {
      return { ok: false, reason: `${name} alpha render threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    const pixels = canvasPixels(output);
    if (!pixels) return { ok: false, reason: `${name} alpha readback failed` };
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== image.data[index]) {
        return {
          ok: false,
          reason: `${name} changed alpha at pixel ${(index - 3) / 4}: ${image.data[index]} -> ${pixels[index]}`,
        };
      }
    }
  }
  return { ok: true };
};

export const runLegacyGpuStylizerContracts = (): { ok: true } | { ok: false; reason: string } => {
  const identityPalette = { ...nearest, options: { ...nearest.options, levels: 256 } };
  const patterned = document.createElement("canvas");
  patterned.width = 64;
  patterned.height = 48;
  const patternedContext = patterned.getContext("2d");
  if (!patternedContext) return { ok: false, reason: "legacy stylizer fixture has no 2d context" };
  const sourceImage = patternedContext.createImageData(patterned.width, patterned.height);
  for (let y = 0; y < patterned.height; y += 1) {
    for (let x = 0; x < patterned.width; x += 1) {
      const offset = (y * patterned.width + x) * 4;
      sourceImage.data[offset] = (x * 13 + y * 7) & 255;
      sourceImage.data[offset + 1] = (x * 3 + y * 17) & 255;
      sourceImage.data[offset + 2] = (x * 19 + y * 5) & 255;
      sourceImage.data[offset + 3] = 255;
    }
  }
  patternedContext.putImageData(sourceImage, 0, 0);

  const lens = filterIndex["Lens Flare"] as FilterLike | undefined;
  const popArt = filterIndex["Pop Art"] as FilterLike | undefined;
  const facet = filterIndex.Facet as FilterLike | undefined;
  if (!lens || !popArt || !facet) return { ok: false, reason: "legacy stylizer registry entry missing" };

  for (const [name, filter] of [["Lens Flare", lens], ["Pop Art", popArt], ["Facet", facet]] as const) {
    let sparseOutput: HTMLCanvasElement;
    try {
      sparseOutput = filter.func(patterned, runtimeOptions()) as HTMLCanvasElement;
    } catch (error) {
      return { ok: false, reason: `${name} sparse-state render threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (sparseOutput.width !== patterned.width || sparseOutput.height !== patterned.height) {
      return { ok: false, reason: `${name} sparse-state size=${sparseOutput.width}x${sparseOutput.height}` };
    }
  }

  let inactiveLens: Uint8ClampedArray | null;
  try {
    inactiveLens = canvasPixels(lens.func(patterned, {
      ...(lens.defaults ?? {}),
      ...runtimeOptions(),
      palette: identityPalette,
      intensity: 0,
    }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `Lens Flare identity render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!inactiveLens || inactiveLens.length !== sourceImage.data.length) {
    return { ok: false, reason: "Lens Flare identity readback failed" };
  }
  for (let index = 0; index < inactiveLens.length; index += 1) {
    if (inactiveLens[index] !== sourceImage.data[index]) {
      return { ok: false, reason: `Lens Flare intensity=0 changed byte ${index}: ${sourceImage.data[index]} -> ${inactiveLens[index]}` };
    }
  }

  const patch = makeSolidCanvas(128, 128, 127);
  let halftone: Uint8ClampedArray | null;
  try {
    halftone = canvasPixels(popArt.func(patch, {
      ...(popArt.defaults ?? {}),
      ...runtimeOptions(),
      palette: identityPalette,
      dotSize: 16,
      levels: 3,
      saturationBoost: 1,
      screenAngle: 0,
      paperColor: [255, 255, 255],
    }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `Pop Art tone render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!halftone) return { ok: false, reason: "Pop Art tone readback failed" };
  let redTotal = 0;
  for (let index = 0; index < halftone.length; index += 4) redTotal += halftone[index];
  const meanRed = redTotal / (halftone.length / 4);
  const measuredCoverage = (255 - meanRed) / (255 - 128);
  const requestedCoverage = 1 - 128 / 255;
  if (Math.abs(measuredCoverage - requestedCoverage) > 0.08) {
    return {
      ok: false,
      reason: `Pop Art midtone coverage=${measuredCoverage.toFixed(3)}, expected=${requestedCoverage.toFixed(3)}`,
    };
  }

  const transparent = makeSolidCanvas(64, 48, 255);
  transparent.getContext("2d")?.clearRect(0, 0, transparent.width, transparent.height);
  for (const fillMode of ["AVERAGE", "CENTER"]) {
    let output: Uint8ClampedArray | null;
    try {
      output = canvasPixels(facet.func(transparent, {
        ...(facet.defaults ?? {}),
        ...runtimeOptions(),
        palette: identityPalette,
        fillMode,
      }) as HTMLCanvasElement);
    } catch (error) {
      return { ok: false, reason: `Facet ${fillMode} transparent render threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!output) return { ok: false, reason: `Facet ${fillMode} transparent readback failed` };
    for (let index = 3; index < output.length; index += 4) {
      if (output[index] !== 0) {
        return { ok: false, reason: `Facet ${fillMode} made transparent pixel ${index / 4} alpha=${output[index]}` };
      }
    }
  }
  return { ok: true };
};

export const runPainterlyStylizerContracts = (): { ok: true } | { ok: false; reason: string } => {
  const pencil = filterIndex["Pencil Sketch"] as FilterLike;
  const mosaic = filterIndex["Mosaic Tile"] as FilterLike;
  const oil = filterIndex["Oil Painting"] as FilterLike;
  if (!pencil || !mosaic || !oil) return { ok: false, reason: "painterly stylizer registry entry missing" };
  const identityPalette = { ...nearest, options: { ...nearest.options, levels: 256 } };

  const source = document.createElement("canvas");
  source.width = 37;
  source.height = 29;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "painterly fixture has no 2d context" };
  const image = context.createImageData(source.width, source.height);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      image.data[offset] = (x * 31 + y * 7) & 255;
      image.data[offset + 1] = (x * 5 + y * 37) & 255;
      image.data[offset + 2] = (x * 17 + y * 19) & 255;
      image.data[offset + 3] = (x + y) % 7 === 0 ? 0 : ((x * 13 + y * 29) & 255);
    }
  }
  context.putImageData(image, 0, 0);

  for (const [name, filter, backends] of [
    ["Pencil sketch", pencil, [false, true]],
    ["Mosaic tile", mosaic, [false, true]],
    ["Oil painting", oil, [true]],
  ] as const) {
    for (const webgl of backends) {
      let pixels: Uint8ClampedArray | null;
      try {
        pixels = canvasPixels(filter.func(source, {
          ...(filter.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
          _webglAcceleration: webgl,
        }) as HTMLCanvasElement);
      } catch (error) {
        return { ok: false, reason: `${name} ${webgl ? "GL" : "CPU"} alpha render threw: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (!pixels) return { ok: false, reason: `${name} alpha readback failed` };
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset] !== image.data[offset]) {
          return { ok: false, reason: `${name} ${webgl ? "GL" : "CPU"} changed alpha at ${offset / 4}` };
        }
      }
    }
  }

  const opaque = makeGradientCanvas(48, 40);
  for (const [name, filter] of [["Pencil sketch", pencil], ["Mosaic tile", mosaic]] as const) {
    const base = { ...(filter.defaults ?? {}), ...runtimeOptions(), palette: identityPalette };
    const cpu = canvasPixels(filter.func(opaque, { ...base, _webglAcceleration: false }) as HTMLCanvasElement);
    const gpu = canvasPixels(filter.func(opaque, { ...base, _webglAcceleration: true }) as HTMLCanvasElement);
    if (!cpu || !gpu) return { ok: false, reason: `${name} parity readback failed` };
    let totalDelta = 0;
    let maxDelta = 0;
    for (let offset = 0; offset < cpu.length; offset += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(cpu[offset + channel] - gpu[offset + channel]);
        totalDelta += delta;
        maxDelta = Math.max(maxDelta, delta);
      }
    }
    const meanDelta = totalDelta / (cpu.length / 4 * 3);
    if (meanDelta > 1 || maxDelta > 40) {
      return { ok: false, reason: `${name} CPU/GL delta mean=${meanDelta.toFixed(3)} max=${maxDelta}` };
    }
  }

  const hiddenVariant = document.createElement("canvas");
  hiddenVariant.width = source.width;
  hiddenVariant.height = source.height;
  const hiddenContext = hiddenVariant.getContext("2d");
  if (!hiddenContext) return { ok: false, reason: "hidden-RGB fixture has no 2d context" };
  const hiddenImage = new ImageData(new Uint8ClampedArray(image.data), source.width, source.height);
  for (let offset = 0; offset < hiddenImage.data.length; offset += 4) {
    if (hiddenImage.data[offset + 3] === 0) {
      hiddenImage.data[offset] = 255 - hiddenImage.data[offset];
      hiddenImage.data[offset + 1] = 255 - hiddenImage.data[offset + 1];
      hiddenImage.data[offset + 2] = 255 - hiddenImage.data[offset + 2];
    }
  }
  hiddenContext.putImageData(hiddenImage, 0, 0);
  for (const [name, filter, webgl] of [
    ["Pencil sketch CPU", pencil, false], ["Pencil sketch GL", pencil, true],
    ["Mosaic tile CPU", mosaic, false], ["Mosaic tile GL", mosaic, true],
    ["Oil painting", oil, true],
  ] as const) {
    const options = { ...(filter.defaults ?? {}), ...runtimeOptions(), palette: identityPalette, _webglAcceleration: webgl };
    const first = canvasPixels(filter.func(source, options) as HTMLCanvasElement);
    const second = canvasPixels(filter.func(hiddenVariant, options) as HTMLCanvasElement);
    if (!first || !second) return { ok: false, reason: `${name} hidden-RGB readback failed` };
    for (let offset = 0; offset < first.length; offset += 4) {
      if (image.data[offset + 3] > 0
        && (first[offset] !== second[offset] || first[offset + 1] !== second[offset + 1] || first[offset + 2] !== second[offset + 2])) {
        return { ok: false, reason: `${name} leaked hidden RGB into visible pixel ${offset / 4}` };
      }
    }
  }

  const densitySource = makeSolidCanvas(64, 64, 128);
  const transitionCount = (density: number, webgl: boolean): number => {
    const pixels = canvasPixels(pencil.func(densitySource, {
      ...(pencil.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
      strokeDensity: density, _webglAcceleration: webgl,
    }) as HTMLCanvasElement);
    if (!pixels) return -1;
    let transitions = 0;
    for (let x = 1; x < densitySource.width; x += 1) {
      const previous = (20 * densitySource.width + x - 1) * 4;
      const current = (20 * densitySource.width + x) * 4;
      if ((pixels[previous] < 213) !== (pixels[current] < 213)) transitions += 1;
    }
    return transitions;
  };
  for (const webgl of [false, true]) {
    const transitions = Array.from({ length: 10 }, (_, index) => transitionCount(index + 1, webgl));
    if (transitions.some((count, index) => count < 0 || (index > 0 && count < transitions[index - 1]))) {
      return { ok: false, reason: `Pencil ${webgl ? "GL" : "CPU"} density is not monotonic: ${transitions.join(",")}` };
    }
  }

  const edgeFlow = document.createElement("canvas");
  edgeFlow.width = 64; edgeFlow.height = 64;
  const edgeFlowContext = edgeFlow.getContext("2d");
  if (!edgeFlowContext) return { ok: false, reason: "Pencil edge-flow fixture has no 2d context" };
  edgeFlowContext.fillStyle = "rgb(40,40,40)"; edgeFlowContext.fillRect(0, 0, 32, 64);
  edgeFlowContext.fillStyle = "rgb(210,210,210)"; edgeFlowContext.fillRect(32, 0, 32, 64);
  const edgeFlowPixels = canvasPixels(pencil.func(edgeFlow, {
    ...(pencil.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
    strokeDensity: 6, _webglAcceleration: true,
  }) as HTMLCanvasElement);
  if (!edgeFlowPixels) return { ok: false, reason: "Pencil edge-flow readback failed" };
  let tangentDelta = 0;
  let normalDelta = 0;
  for (let y = 1; y < 64; y += 1) {
    const previous = ((y - 1) * 64 + 31) * 4;
    const current = (y * 64 + 31) * 4;
    tangentDelta += Math.abs(edgeFlowPixels[current] - edgeFlowPixels[previous]);
  }
  for (let x = 28; x < 35; x += 1) {
    const left = (32 * 64 + x) * 4;
    const right = left + 4;
    normalDelta += Math.abs(edgeFlowPixels[right] - edgeFlowPixels[left]);
  }
  if (tangentDelta > normalDelta * 0.25) {
    return { ok: false, reason: `Pencil strokes cross edge flow: tangent=${tangentDelta}, normal=${normalDelta}` };
  }

  const tileFixture = makeSolidCanvas(4, 4, 0);
  const tileContext = tileFixture.getContext("2d");
  if (!tileContext) return { ok: false, reason: "Mosaic sample fixture has no 2d context" };
  const tileImage = tileContext.getImageData(0, 0, 4, 4);
  const outlier = (2 * 4 + 2) * 4;
  tileImage.data[outlier] = 255; tileImage.data[outlier + 1] = 255; tileImage.data[outlier + 2] = 255;
  tileContext.putImageData(tileImage, 0, 0);
  const tileOptions = {
    ...(mosaic.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
    tileSize: 4, groutWidth: 1, jitter: 0,
  };
  const mosaicCpu = canvasPixels(mosaic.func(tileFixture, { ...tileOptions, _webglAcceleration: false }) as HTMLCanvasElement);
  const mosaicGpu = canvasPixels(mosaic.func(tileFixture, { ...tileOptions, _webglAcceleration: true }) as HTMLCanvasElement);
  if (!mosaicCpu || !mosaicGpu || mosaicCpu[0] < 14 || mosaicCpu[0] > 18 || mosaicGpu[0] !== mosaicCpu[0]) {
    return { ok: false, reason: `Mosaic sampled mean mismatch CPU=${mosaicCpu?.[0]} GL=${mosaicGpu?.[0]}` };
  }

  const sparseTile = document.createElement("canvas");
  sparseTile.width = 40; sparseTile.height = 40;
  const sparseTileContext = sparseTile.getContext("2d");
  if (!sparseTileContext) return { ok: false, reason: "Mosaic sparse-tile fixture has no 2d context" };
  const sparseTileImage = sparseTileContext.createImageData(40, 40);
  const sparseFeature = (9 * 40 + 7) * 4;
  sparseTileImage.data[sparseFeature] = 220;
  sparseTileImage.data[sparseFeature + 1] = 30;
  sparseTileImage.data[sparseFeature + 2] = 10;
  sparseTileImage.data[sparseFeature + 3] = 255;
  sparseTileContext.putImageData(sparseTileImage, 0, 0);
  for (const webgl of [false, true]) {
    const options = {
      ...(mosaic.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
      tileSize: 40, groutWidth: 1, jitter: 0, _webglAcceleration: webgl,
    };
    const first = canvasPixels(mosaic.func(sparseTile, options) as HTMLCanvasElement);
    const second = canvasPixels(mosaic.func(sparseTile, options) as HTMLCanvasElement);
    if (!first || !second || first[sparseFeature] < 210 || first[sparseFeature + 1] > 40
      || first.some((value, index) => value !== second[index])) {
      return { ok: false, reason: `Mosaic ${webgl ? "GL" : "CPU"} lost or destabilized a sparse opaque feature` };
    }
  }

  const partialOptions = {
    ...(mosaic.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
    tileSize: 12, groutWidth: 2, jitter: 1,
  };
  const partialCpu = canvasPixels(mosaic.func(source, { ...partialOptions, _webglAcceleration: false }) as HTMLCanvasElement);
  const partialGpu = canvasPixels(mosaic.func(source, { ...partialOptions, _webglAcceleration: true }) as HTMLCanvasElement);
  if (!partialCpu || !partialGpu) return { ok: false, reason: "Mosaic partial-alpha parity readback failed" };
  let partialMaxDelta = 0;
  for (let offset = 0; offset < partialCpu.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    partialMaxDelta = Math.max(partialMaxDelta,
      Math.abs(partialCpu[offset] - partialGpu[offset]),
      Math.abs(partialCpu[offset + 1] - partialGpu[offset + 1]),
      Math.abs(partialCpu[offset + 2] - partialGpu[offset + 2]));
  }
  if (partialMaxDelta > 2) return { ok: false, reason: `Mosaic partial-alpha CPU/GL max delta=${partialMaxDelta}` };

  const tieFixture = makeSolidColorCanvas(3, 3, [200, 200, 200, 255]);
  const tieContext = tieFixture.getContext("2d");
  if (!tieContext) return { ok: false, reason: "Oil tie fixture has no 2d context" };
  const tieImage = tieContext.getImageData(0, 0, 3, 3);
  for (const [x, y, value] of [[0, 1, 0], [1, 0, 0], [2, 1, 255], [1, 2, 255]]) {
    const offset = (y * 3 + x) * 4;
    tieImage.data[offset] = value; tieImage.data[offset + 1] = value; tieImage.data[offset + 2] = value;
  }
  tieContext.putImageData(tieImage, 0, 0);
  const oilPixels = canvasPixels(oil.func(tieFixture, {
    ...(oil.defaults ?? {}), ...runtimeOptions(), palette: identityPalette, radius: 1, levels: 20,
  }) as HTMLCanvasElement);
  const tieCenter = (1 * 3 + 1) * 4;
  if (!oilPixels || oilPixels[tieCenter] < 240) {
    return { ok: false, reason: `Oil modal tie did not prefer center-nearest bin: ${oilPixels?.[tieCenter]}` };
  }

  const partialTie = tieContext.getImageData(0, 0, 3, 3);
  partialTie.data[(1 * 3 + 0) * 4 + 3] = 64;
  partialTie.data[(0 * 3 + 1) * 4 + 3] = 192;
  partialTie.data[(1 * 3 + 2) * 4 + 3] = 128;
  partialTie.data[(2 * 3 + 1) * 4 + 3] = 128;
  tieContext.putImageData(partialTie, 0, 0);
  const partialTiePixels = canvasPixels(oil.func(tieFixture, {
    ...(oil.defaults ?? {}), ...runtimeOptions(), palette: identityPalette, radius: 1, levels: 20,
  }) as HTMLCanvasElement);
  if (!partialTiePixels || partialTiePixels[tieCenter] < 240) {
    return { ok: false, reason: `Oil partial-alpha tie was numerically biased: ${partialTiePixels?.[tieCenter]}` };
  }

  return { ok: true };
};

export const runBilateralBlurContracts = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Bilateral Blur"] as FilterLike;
  if (!filter) return { ok: false, reason: "Bilateral Blur missing from registry" };
  const identityPalette = { ...nearest, options: { ...nearest.options, levels: 256 } };
  const source = document.createElement("canvas");
  source.width = 32; source.height = 24;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "Bilateral fixture has no 2d context" };
  const image = context.createImageData(source.width, source.height);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const base = x < 16 ? 70 : 185;
      const noise = ((x * 17 + y * 29) % 31) - 15;
      image.data[offset] = base + noise;
      image.data[offset + 1] = base + Math.round(noise * 0.6);
      image.data[offset + 2] = base - Math.round(noise * 0.4);
      image.data[offset + 3] = (x + y) % 9 === 0 ? 0 : ((x * 23 + y * 11) & 255);
    }
  }
  context.putImageData(image, 0, 0);
  const baseOptions = {
    ...(filter.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
    sigmaSpatial: 5, sigmaRange: 30,
  };
  const render = (
    input: HTMLCanvasElement,
    overrides: Record<string, unknown>,
    webgl: boolean,
  ): Uint8ClampedArray | null => {
    try {
      return canvasPixels(filter.func(input, {
        ...baseOptions, ...overrides, _webglAcceleration: webgl,
      }) as HTMLCanvasElement);
    } catch {
      return null;
    }
  };

  for (const workingResolution of ["FULL", "HALF", "QUARTER"]) {
    for (const linearize of [false, true]) {
      const cpu = render(source, { workingResolution, _linearize: linearize }, false);
      const gpu = render(source, { workingResolution, _linearize: linearize }, true);
      if (!cpu || !gpu) return { ok: false, reason: `Bilateral ${workingResolution} ${linearize ? "linear" : "sRGB"} parity readback failed` };
      let totalDelta = 0;
      let maxDelta = 0;
      let samples = 0;
      for (let offset = 0; offset < cpu.length; offset += 4) {
        if (image.data[offset + 3] === 0) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          const delta = Math.abs(cpu[offset + channel] - gpu[offset + channel]);
          totalDelta += delta;
          maxDelta = Math.max(maxDelta, delta);
          samples += 1;
        }
      }
      const meanDelta = totalDelta / Math.max(1, samples);
      if (meanDelta > 1.5 || maxDelta > 8) {
        return { ok: false, reason: `Bilateral ${workingResolution} parity delta mean=${meanDelta.toFixed(3)} max=${maxDelta}` };
      }
    }
  }

  const hiddenVariant = document.createElement("canvas");
  hiddenVariant.width = source.width; hiddenVariant.height = source.height;
  const hiddenContext = hiddenVariant.getContext("2d");
  if (!hiddenContext) return { ok: false, reason: "Bilateral hidden-RGB fixture unavailable" };
  const hiddenImage = new ImageData(new Uint8ClampedArray(image.data), source.width, source.height);
  for (let offset = 0; offset < hiddenImage.data.length; offset += 4) {
    if (hiddenImage.data[offset + 3] === 0) {
      hiddenImage.data[offset] = 255; hiddenImage.data[offset + 1] = 0; hiddenImage.data[offset + 2] = 255;
    }
  }
  hiddenContext.putImageData(hiddenImage, 0, 0);
  for (const webgl of [false, true]) {
    const first = render(source, { workingResolution: "QUARTER" }, webgl);
    const second = render(hiddenVariant, { workingResolution: "QUARTER" }, webgl);
    if (!first || !second) return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} hidden-RGB readback failed` };
    for (let offset = 0; offset < first.length; offset += 4) {
      if (first[offset + 3] !== image.data[offset + 3]) {
        return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} changed alpha at ${offset / 4}` };
      }
      if (image.data[offset + 3] === 0) {
        if (first[offset] !== 0 || first[offset + 1] !== 0 || first[offset + 2] !== 0) {
          return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} did not canonicalize transparent RGB` };
        }
      } else if (first[offset] !== second[offset]
        || first[offset + 1] !== second[offset + 1]
        || first[offset + 2] !== second[offset + 2]) {
        return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} leaked hidden RGB at ${offset / 4}` };
      }
    }
  }

  const customPalette = {
    name: "bilateral-transparent-contract",
    options: { colors: [[240, 20, 40]] },
    getColor: (pixel: number[]) => [240, 20, 40, pixel[3]],
  };
  for (const webgl of [false, true]) {
    const identity = render(source, { workingResolution: "QUARTER" }, webgl);
    const pixels = render(source, { workingResolution: "QUARTER", palette: customPalette }, webgl);
    if (!identity || !pixels) return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} custom-palette readback failed` };
    let recoloredVisible = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (image.data[offset + 3] === 0
        && (pixels[offset] !== 0 || pixels[offset + 1] !== 0 || pixels[offset + 2] !== 0)) {
        return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} palette repopulated transparent RGB` };
      }
      if (image.data[offset + 3] > 0 && (pixels[offset] !== identity[offset]
        || pixels[offset + 1] !== identity[offset + 1]
        || pixels[offset + 2] !== identity[offset + 2])) recoloredVisible += 1;
    }
    if (recoloredVisible < source.width * source.height * 0.5) {
      return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} custom palette did not recolor visible output` };
    }
  }

  const sparseAlpha = document.createElement("canvas");
  sparseAlpha.width = 40; sparseAlpha.height = 40;
  const sparseAlphaContext = sparseAlpha.getContext("2d");
  if (!sparseAlphaContext) return { ok: false, reason: "Bilateral sparse-alpha fixture unavailable" };
  const sparseAlphaImage = sparseAlphaContext.createImageData(40, 40);
  for (const [x, y, alpha] of [[13, 17, 1], [29, 9, 2]]) {
    const offset = (y * 40 + x) * 4;
    sparseAlphaImage.data[offset] = 210;
    sparseAlphaImage.data[offset + 1] = 60;
    sparseAlphaImage.data[offset + 2] = 20;
    sparseAlphaImage.data[offset + 3] = alpha;
  }
  sparseAlphaContext.putImageData(sparseAlphaImage, 0, 0);
  for (const webgl of [false, true]) {
    const pixels = render(sparseAlpha, { workingResolution: "QUARTER", sigmaRange: 5 }, webgl);
    if (!pixels) return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} sparse-alpha readback failed` };
    for (const [x, y, alpha] of [[13, 17, 1], [29, 9, 2]]) {
      const offset = (y * 40 + x) * 4;
      if (pixels[offset + 3] !== alpha || pixels[offset] < 100) {
        return { ok: false, reason: `Bilateral ${webgl ? "GL" : "CPU"} lost alpha-${alpha} detail: ${pixels[offset]}/${pixels[offset + 3]}` };
      }
    }
  }

  const opaqueNoise = document.createElement("canvas");
  opaqueNoise.width = 64; opaqueNoise.height = 32;
  const noiseContext = opaqueNoise.getContext("2d");
  if (!noiseContext) return { ok: false, reason: "Bilateral noise fixture unavailable" };
  const noiseImage = noiseContext.createImageData(64, 32);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 64; x += 1) {
    const offset = (y * 64 + x) * 4;
    const value = 128 + (((x * 37 + y * 53) % 41) - 20);
    noiseImage.data[offset] = value; noiseImage.data[offset + 1] = value; noiseImage.data[offset + 2] = value;
    noiseImage.data[offset + 3] = 255;
  }
  noiseContext.putImageData(noiseImage, 0, 0);
  const variance = (pixels: Uint8ClampedArray): number => {
    let sum = 0; let sumSquares = 0; let count = 0;
    for (let y = 4; y < 28; y += 1) for (let x = 4; x < 60; x += 1) {
      const value = pixels[(y * 64 + x) * 4];
      sum += value; sumSquares += value * value; count += 1;
    }
    const mean = sum / count;
    return sumSquares / count - mean * mean;
  };
  const narrow = render(opaqueNoise, { workingResolution: "FULL", sigmaSpatial: 1, sigmaRange: 100 }, true);
  const wide = render(opaqueNoise, { workingResolution: "FULL", sigmaSpatial: 10, sigmaRange: 100 }, true);
  if (!narrow || !wide || variance(wide) >= variance(narrow) * 0.7) {
    return { ok: false, reason: `Bilateral spatial smoothing not live: ${narrow ? variance(narrow).toFixed(2) : "null"} -> ${wide ? variance(wide).toFixed(2) : "null"}` };
  }

  const edge = document.createElement("canvas");
  edge.width = 64; edge.height = 32;
  const edgeContext = edge.getContext("2d");
  if (!edgeContext) return { ok: false, reason: "Bilateral edge fixture unavailable" };
  edgeContext.fillStyle = "rgb(80,80,80)"; edgeContext.fillRect(0, 0, 32, 32);
  edgeContext.fillStyle = "rgb(180,180,180)"; edgeContext.fillRect(32, 0, 32, 32);
  const edgeTight = render(edge, { workingResolution: "FULL", sigmaSpatial: 10, sigmaRange: 5 }, true);
  const edgeLoose = render(edge, { workingResolution: "FULL", sigmaSpatial: 10, sigmaRange: 100 }, true);
  const boundary = (16 * 64 + 31) * 4;
  const boundaryRight = (16 * 64 + 32) * 4;
  if (!edgeTight || !edgeLoose || edgeLoose[boundary] <= edgeTight[boundary] + 2
    || edgeTight[boundary] > 82 || edgeTight[boundaryRight] < 178) {
    return { ok: false, reason: `Bilateral range control not live: ${edgeTight?.[boundary]} -> ${edgeLoose?.[boundary]}` };
  }

  const signatures = new Set<string>();
  for (const workingResolution of ["FULL", "HALF", "QUARTER"]) {
    const pixels = render(opaqueNoise, { workingResolution, sigmaSpatial: 8, sigmaRange: 40 }, true);
    if (!pixels) return { ok: false, reason: `Bilateral ${workingResolution} control readback failed` };
    let hash = 2166136261;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      hash ^= pixels[offset]; hash = Math.imul(hash, 16777619);
    }
    signatures.add(String(hash >>> 0));
  }
  if (signatures.size !== 3) return { ok: false, reason: "Bilateral working-resolution modes are not all live" };

  const lowContrastEdge = document.createElement("canvas");
  lowContrastEdge.width = 96; lowContrastEdge.height = 32;
  const lowContrastContext = lowContrastEdge.getContext("2d");
  if (!lowContrastContext) return { ok: false, reason: "Bilateral scale fixture unavailable" };
  lowContrastContext.fillStyle = "rgb(100,100,100)"; lowContrastContext.fillRect(0, 0, 48, 32);
  lowContrastContext.fillStyle = "rgb(140,140,140)"; lowContrastContext.fillRect(48, 0, 48, 32);
  const scaleMetrics: Array<{ center: number; width: number }> = [];
  for (const workingResolution of ["FULL", "HALF", "QUARTER"]) {
    const pixels = render(lowContrastEdge, {
      workingResolution, sigmaSpatial: 8, sigmaRange: 100,
    }, true);
    if (!pixels) return { ok: false, reason: `Bilateral ${workingResolution} scale readback failed` };
    const crossing = (level: number): number => {
      for (let x = 0; x < 96; x += 1) if (pixels[(16 * 96 + x) * 4] >= level) return x;
      return 96;
    };
    const low = crossing(110);
    const center = crossing(120);
    const high = crossing(130);
    scaleMetrics.push({ center, width: high - low });
  }
  const centers = scaleMetrics.map(metric => metric.center);
  const widths = scaleMetrics.map(metric => metric.width);
  if (Math.max(...centers) - Math.min(...centers) > 2
    || Math.max(...widths) - Math.min(...widths) > 4) {
    return { ok: false, reason: `Bilateral working scale drift centers=${centers.join("/")} widths=${widths.join("/")}` };
  }

  const linearOff = render(opaqueNoise, { workingResolution: "HALF", sigmaSpatial: 6, sigmaRange: 100, _linearize: false }, true);
  const linearOn = render(opaqueNoise, { workingResolution: "HALF", sigmaSpatial: 6, sigmaRange: 100, _linearize: true }, true);
  if (!linearOff || !linearOn || !linearOff.some((value, index) => index % 4 !== 3 && value !== linearOn[index])) {
    return { ok: false, reason: "Bilateral linear-light mode is not live" };
  }

  for (const [width, height] of [[1, 17], [19, 1], [1, 1]]) {
    const tiny = makeSolidCanvas(width, height, 123);
    const pixels = render(tiny, { workingResolution: "QUARTER", sigmaSpatial: 12, sigmaRange: 1 }, true);
    if (!pixels || pixels.some((value, index) => index % 4 !== 3 ? Math.abs(value - 123) > 1 : value !== 255)) {
      return { ok: false, reason: `Bilateral tiny raster failed at ${width}x${height}` };
    }
  }
  return { ok: true };
};

export const runEinkDisplayContracts = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["E-ink"] as FilterLike;
  const width = 96;
  const height = 48;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "E-ink fixture has no 2d context" };
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      image.data[offset] = Math.round(x / (width - 1) * 255);
      image.data[offset + 1] = Math.round(y / (height - 1) * 255);
      image.data[offset + 2] = Math.round((x + y) / (width + height - 2) * 255);
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const base = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    refreshMode: "FULL",
    ghosting: 0,
    pixelGrid: false,
    texture: 0,
    _isAnimating: false,
    _prevOutput: null,
  };
  const render = (overrides: Record<string, unknown>): Uint8ClampedArray | null => {
    try {
      return canvasPixels(filter.func(source, { ...base, ...overrides }) as HTMLCanvasElement);
    } catch {
      return null;
    }
  };

  for (const mode of ["GRAYSCALE", "COLOR"]) {
    const gpu = render({ mode, _webglAcceleration: true });
    const cpu = render({ mode, _webglAcceleration: false });
    if (!gpu || !cpu || gpu.length !== cpu.length) return { ok: false, reason: `E-ink ${mode} CPU/GL readback failed` };
    let totalDelta = 0;
    for (let index = 0; index < gpu.length; index += 4) {
      totalDelta += Math.abs(gpu[index] - cpu[index]);
      totalDelta += Math.abs(gpu[index + 1] - cpu[index + 1]);
      totalDelta += Math.abs(gpu[index + 2] - cpu[index + 2]);
    }
    const meanDelta = totalDelta / (gpu.length / 4 * 3);
    if (meanDelta > 1) return { ok: false, reason: `E-ink ${mode} CPU/GL mean delta=${meanDelta.toFixed(3)}` };
  }

  const grayscale = render({ mode: "GRAYSCALE" });
  const color = render({ mode: "COLOR" });
  if (!grayscale || !color) return { ok: false, reason: "E-ink level render failed" };
  const grayLevels = new Set<number>();
  const channelLevels = [new Set<number>(), new Set<number>(), new Set<number>()];
  for (let index = 0; index < grayscale.length; index += 4) {
    grayLevels.add(grayscale[index]);
    channelLevels[0].add(color[index]);
    channelLevels[1].add(color[index + 1]);
    channelLevels[2].add(color[index + 2]);
  }
  const sortedGray = [...grayLevels].sort((left, right) => left - right);
  const highestGray = sortedGray[sortedGray.length - 1];
  if (grayLevels.size !== 16 || sortedGray[0] !== 15 || highestGray !== 230
    || channelLevels.some((levels) => levels.size > 16 || levels.size < 8)) {
    return { ok: false, reason: `E-ink levels gray=${grayLevels.size} [${sortedGray[0]}..${highestGray}], color=${channelLevels.map((levels) => levels.size).join("/")}` };
  }
  for (let cellY = 0; cellY + 2 < height; cellY += 3) {
    for (let cellX = 0; cellX + 2 < width; cellX += 3) {
      const reference = (cellY * width + cellX) * 4;
      for (let dy = 0; dy < 3; dy += 1) {
        for (let dx = 0; dx < 3; dx += 1) {
          const offset = ((cellY + dy) * width + cellX + dx) * 4;
          if (color[offset] !== color[reference] || color[offset + 1] !== color[reference + 1] || color[offset + 2] !== color[reference + 2]) {
            return { ok: false, reason: `E-ink Kaleido cell incoherent at ${cellX + dx},${cellY + dy}` };
          }
        }
      }
    }
  }

  const texturedA = render({ mode: "GRAYSCALE", texture: 0.3, _frameIndex: 0 });
  const texturedB = render({ mode: "GRAYSCALE", texture: 0.3, _frameIndex: 91 });
  if (!texturedA || !texturedB || texturedA.some((value, index) => value !== texturedB[index])) {
    return { ok: false, reason: "E-ink fixed paper texture changed between frames" };
  }
  const previous = image.data.slice();
  for (let index = 0; index < previous.length; index += 4) {
    previous[index] = 255 - previous[index];
    previous[index + 1] = 255 - previous[index + 1];
    previous[index + 2] = 255 - previous[index + 2];
  }
  const partialClean = render({ refreshMode: "PARTIAL", ghosting: 0.8, _prevOutput: null });
  const partialResidual = render({ refreshMode: "PARTIAL", ghosting: 0.8, _prevOutput: previous });
  const fullClean = render({ refreshMode: "FULL", ghosting: 0.8, _prevOutput: null });
  const fullPrevious = render({ refreshMode: "FULL", ghosting: 0.8, _prevOutput: previous });
  if (!partialClean || !partialResidual || !fullClean || !fullPrevious) return { ok: false, reason: "E-ink refresh render failed" };
  let partialChanges = 0;
  let fullChanges = 0;
  for (let index = 0; index < partialClean.length; index += 4) {
    if (partialResidual[index] !== partialResidual[index + 1] || partialResidual[index] !== partialResidual[index + 2]) {
      return { ok: false, reason: `E-ink monochrome residual carried chroma at pixel ${index / 4}` };
    }
    if (partialClean[index] !== partialResidual[index]
      || partialClean[index + 1] !== partialResidual[index + 1]
      || partialClean[index + 2] !== partialResidual[index + 2]) partialChanges += 1;
    if (fullClean[index] !== fullPrevious[index]
      || fullClean[index + 1] !== fullPrevious[index + 1]
      || fullClean[index + 2] !== fullPrevious[index + 2]) fullChanges += 1;
  }
  return partialChanges > width * height * 0.5 && fullChanges === 0
    ? { ok: true }
    : { ok: false, reason: `E-ink refresh residual partial=${partialChanges}, full=${fullChanges}` };
};

export const runVintageTvSignalContracts = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Vintage TV"] as FilterLike;
  const identityPalette = { ...nearest, options: { ...nearest.options, levels: 256 } };
  const base = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    palette: identityPalette,
    banding: 0,
    colorFringe: 0,
    tuningError: 0,
    verticalRoll: 0,
    scanlineStrength: 0,
    glow: 0,
    rfNoise: 0,
  };
  const makeStripes = (chroma: boolean): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("stripe fixture has no 2d context");
    const data = ctx.createImageData(canvas.width, canvas.height);
    const colors = chroma ? [[188, 110, 57], [67, 145, 198]] : [[64, 64, 64], [192, 192, 192]];
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const color = colors[x & 1];
        data.data[offset] = color[0];
        data.data[offset + 1] = color[1];
        data.data[offset + 2] = color[2];
        data.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  };
  const stripeAmplitude = (pixels: Uint8ClampedArray, width: number, height: number): number => {
    let total = 0;
    let samples = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const left = (y * width + x) * 4;
        const right = left + 4;
        total += Math.hypot(
          pixels[left] - pixels[right],
          pixels[left + 1] - pixels[right + 1],
          pixels[left + 2] - pixels[right + 2],
        );
        samples += 1;
      }
    }
    return total / samples;
  };
  const lumaSource = makeStripes(false);
  const chromaSource = makeStripes(true);
  let lumaOutput: Uint8ClampedArray | null;
  let chromaOutput: Uint8ClampedArray | null;
  try {
    lumaOutput = canvasPixels(filter.func(lumaSource, { ...base, chromaBandwidth: 8 }) as HTMLCanvasElement);
    chromaOutput = canvasPixels(filter.func(chromaSource, { ...base, chromaBandwidth: 8 }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `Vintage TV bandwidth render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  const lumaInput = canvasPixels(lumaSource);
  const chromaInput = canvasPixels(chromaSource);
  if (!lumaInput || !chromaInput || !lumaOutput || !chromaOutput) return { ok: false, reason: "Vintage TV bandwidth readback failed" };
  const lumaRetention = stripeAmplitude(lumaOutput, 128, 32) / stripeAmplitude(lumaInput, 128, 32);
  const chromaRetention = stripeAmplitude(chromaOutput, 128, 32) / stripeAmplitude(chromaInput, 128, 32);
  if (lumaRetention < 0.8 || chromaRetention >= lumaRetention * 0.5) {
    return { ok: false, reason: `Vintage TV bandwidth retention luma=${lumaRetention.toFixed(3)}, chroma=${chromaRetention.toFixed(3)}` };
  }

  const renderFrame = (frameIndex: number, verticalRoll: number): Uint8ClampedArray | null => {
    try {
      return canvasPixels(filter.func(makeGradientCanvas(96, 64), { ...base, chromaBandwidth: 0, frameIndex, _frameIndex: frameIndex, verticalRoll }) as HTMLCanvasElement);
    } catch {
      return null;
    }
  };
  const stillA = renderFrame(0, 0);
  const stillB = renderFrame(17, 0);
  const rolling = renderFrame(17, 8);
  if (!stillA || !stillB || !rolling) return { ok: false, reason: "Vintage TV roll readback failed" };
  let stillChanges = 0;
  let rollChanges = 0;
  for (let index = 0; index < stillA.length; index += 4) {
    if (stillA[index] !== stillB[index] || stillA[index + 1] !== stillB[index + 1] || stillA[index + 2] !== stillB[index + 2]) stillChanges += 1;
    if (stillA[index] !== rolling[index] || stillA[index + 1] !== rolling[index + 1] || stillA[index + 2] !== rolling[index + 2]) rollChanges += 1;
  }
  if (stillChanges !== 0 || rollChanges < 96 * 64 * 0.2) {
    return { ok: false, reason: `Vintage TV roll liveness still=${stillChanges}, rolling=${rollChanges}` };
  }

  const tall = makeGradientCanvas(64, 720);
  let rasterOff: Uint8ClampedArray | null;
  let rasterOn: Uint8ClampedArray | null;
  try {
    rasterOff = canvasPixels(filter.func(tall, { ...base, chromaBandwidth: 0, scanlineStrength: 0 }) as HTMLCanvasElement);
    rasterOn = canvasPixels(filter.func(tall, { ...base, chromaBandwidth: 0, scanlineStrength: 0.8 }) as HTMLCanvasElement);
  } catch {
    return { ok: false, reason: "Vintage TV raster render threw" };
  }
  if (!rasterOff || !rasterOn) return { ok: false, reason: "Vintage TV raster readback failed" };
  let rasterChanges = 0;
  for (let index = 0; index < rasterOff.length; index += 4) {
    if (Math.abs(rasterOff[index] - rasterOn[index]) > 3
      || Math.abs(rasterOff[index + 1] - rasterOn[index + 1]) > 3
      || Math.abs(rasterOff[index + 2] - rasterOn[index + 2]) > 3) rasterChanges += 1;
  }
  return rasterChanges > 64 * 720 * 0.2
    ? { ok: true }
    : { ok: false, reason: `Vintage TV resolvable raster changed only ${rasterChanges} pixels` };
};

export const runDigicamFlashContracts = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Digicam Flash"] as FilterLike;
  const source = makeGradientCanvas(96, 64);
  const identityPalette = { ...nearest, options: { ...nearest.options, levels: 256 } };
  const base = { ...(filter.defaults ?? {}), ...runtimeOptions(), palette: identityPalette };
  for (const overrides of [
    { flashPower: 0, ambient: 1, edgeBurn: 0, whiteClip: 255, warmth: 0 },
    { flashPower: 0.8, ambient: 0.7, edgeBurn: 0.2, whiteClip: 245, warmth: 0.12 },
    { flashPower: 1.5, ambient: 0.4, edgeBurn: 0.6, whiteClip: 220, warmth: -0.2 },
  ]) {
    let gpu: Uint8ClampedArray | null;
    let cpu: Uint8ClampedArray | null;
    try {
      gpu = canvasPixels(filter.func(source, { ...base, ...overrides, _webglAcceleration: true }) as HTMLCanvasElement);
      cpu = canvasPixels(filter.func(source, { ...base, ...overrides, _webglAcceleration: false }) as HTMLCanvasElement);
    } catch (error) {
      return { ok: false, reason: `Digicam Flash parity threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!gpu || !cpu) return { ok: false, reason: "Digicam Flash parity readback failed" };
    let totalDelta = 0;
    for (let index = 0; index < gpu.length; index += 4) {
      totalDelta += Math.abs(gpu[index] - cpu[index]);
      totalDelta += Math.abs(gpu[index + 1] - cpu[index + 1]);
      totalDelta += Math.abs(gpu[index + 2] - cpu[index + 2]);
    }
    const meanDelta = totalDelta / (gpu.length / 4 * 3);
    if (meanDelta > 1.5) return { ok: false, reason: `Digicam Flash CPU/GL mean delta=${meanDelta.toFixed(3)}` };
  }

  const renderSolid = (flashPower: number, warmth: number): Uint8ClampedArray | null => {
    try {
      return canvasPixels(filter.func(makeSolidCanvas(64, 48, 96), {
        ...base,
        flashPower,
        warmth,
        ambient: 1,
        edgeBurn: 0,
        whiteClip: 255,
      }) as HTMLCanvasElement);
    } catch {
      return null;
    }
  };
  const noFlashWarm = renderSolid(0, 0.3);
  const noFlashCool = renderSolid(0, -0.3);
  const halfStop = renderSolid(0.5, 0);
  const oneStop = renderSolid(1, 0);
  if (!noFlashWarm || !noFlashCool || !halfStop || !oneStop) return { ok: false, reason: "Digicam Flash exposure readback failed" };
  const mean = (pixels: Uint8ClampedArray): number => {
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4) total += pixels[index] + pixels[index + 1] + pixels[index + 2];
    return total / (pixels.length / 4 * 3);
  };
  const warmthChanged = noFlashWarm.some((value, index) => value !== noFlashCool[index]);
  return !warmthChanged && mean(noFlashWarm) < mean(halfStop) && mean(halfStop) < mean(oneStop)
    ? { ok: true }
    : { ok: false, reason: `Digicam Flash separation warmth=${warmthChanged}, means=${mean(noFlashWarm).toFixed(1)}/${mean(halfStop).toFixed(1)}/${mean(oneStop).toFixed(1)}` };
};

export const runNightVisionSignalDependentNoise = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Night vision"] as FilterLike;
  const width = 96;
  const height = 64;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "night-vision noise fixture has no 2d context" };
  context.fillStyle = "rgb(8, 8, 8)";
  context.fillRect(0, 0, width / 2, height);
  context.fillStyle = "rgb(96, 96, 96)";
  context.fillRect(width / 2, 0, width / 2, height);
  const base = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    gain: 2,
    bloomRadius: 0,
    bloomStrength: 0,
    vignette: 0,
    _frameIndex: 13,
  };
  let clean: Uint8ClampedArray | null;
  let noisy: Uint8ClampedArray | null;
  try {
    clean = canvasPixels(filter.func(source, { ...base, grain: 0 }) as HTMLCanvasElement);
    noisy = canvasPixels(filter.func(source, { ...base, grain: 1 }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `night-vision noise render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!clean || !noisy) return { ok: false, reason: "night-vision noise readback failed" };
  let darkDelta = 0;
  let brightDelta = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width / 2; x += 1) {
      const dark = (y * width + x) * 4 + 1;
      const bright = (y * width + x + width / 2) * 4 + 1;
      darkDelta += Math.abs(noisy[dark] - clean[dark]);
      brightDelta += Math.abs(noisy[bright] - clean[bright]);
      samples += 1;
    }
  }
  darkDelta /= samples;
  brightDelta /= samples;
  return darkDelta > 0.5 && brightDelta > darkDelta * 1.5
    ? { ok: true }
    : { ok: false, reason: `intensifier noise was not signal-dependent (${darkDelta.toFixed(2)} -> ${brightDelta.toFixed(2)})` };
};

export const runAlphaStatisticsHiddenRgb = (): { ok: true } | { ok: false; reason: string } => {
  const identityPalette = { ...nearest, options: { ...nearest.options, levels: 256 } };
  const pairedCanvases = (
    width: number,
    height: number,
    sample: (x: number, y: number) => readonly [number, number, number, number],
  ): [HTMLCanvasElement, HTMLCanvasElement] | null => {
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    first.width = second.width = width; first.height = second.height = height;
    const firstContext = first.getContext("2d");
    const secondContext = second.getContext("2d");
    if (!firstContext || !secondContext) return null;
    const firstImage = firstContext.createImageData(width, height);
    const secondImage = secondContext.createImageData(width, height);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = sample(x, y);
      firstImage.data.set([red, green, blue, alpha], offset);
      secondImage.data.set(alpha === 0 ? [255, 0, 255, 0] : [red, green, blue, alpha], offset);
    }
    firstContext.putImageData(firstImage, 0, 0);
    secondContext.putImageData(secondImage, 0, 0);
    return [first, second];
  };
  const equivalentVisible = (
    name: string,
    filter: FilterLike,
    pair: [HTMLCanvasElement, HTMLCanvasElement],
    options: Record<string, unknown>,
  ): { ok: true } | { ok: false; reason: string } => {
    const source = canvasPixels(pair[0]);
    const first = canvasPixels(filter.func(pair[0], options) as HTMLCanvasElement);
    const second = canvasPixels(filter.func(pair[1], options) as HTMLCanvasElement);
    if (!source || !first || !second) return { ok: false, reason: `${name} hidden-RGB readback failed` };
    for (let offset = 0; offset < first.length; offset += 4) {
      if (source[offset + 3] > 0 && (first[offset] !== second[offset]
        || first[offset + 1] !== second[offset + 1]
        || first[offset + 2] !== second[offset + 2]
        || first[offset + 3] !== second[offset + 3])) {
        return { ok: false, reason: `${name} leaked hidden RGB into visible pixel ${offset / 4}` };
      }
    }
    return { ok: true };
  };

  const night = filterIndex["Night vision"] as FilterLike;
  const nightPair = pairedCanvases(32, 24, (x, y) => x === 16 && y === 12
    ? [0, 0, 0, 0]
    : [58 + (x % 5), 72 + (y % 7), 46, 255]);
  if (!nightPair) return { ok: false, reason: "Night vision hidden-RGB fixture unavailable" };
  for (const webgl of [false, true]) {
    const result = equivalentVisible(`Night vision ${webgl ? "GL" : "CPU"}`, night, nightPair, {
      ...(night.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
      grain: 0, vignette: 0, bloomRadius: 4, bloomStrength: 2,
      _webglAcceleration: webgl,
    });
    if (!result.ok) return result;
  }

  const ultrasound = filterIndex.Ultrasound as FilterLike;
  const ultrasoundPair = pairedCanvases(96, 80, (x, y) => x < 48 && y > 12
    ? [0, 0, 0, 0]
    : [56 + (x % 11), 72 + (y % 13), 48, 255]);
  if (!ultrasoundPair) return { ok: false, reason: "Ultrasound hidden-RGB fixture unavailable" };
  for (const webgl of [false, true]) {
    const result = equivalentVisible(`Ultrasound ${webgl ? "GL" : "CPU"}`, ultrasound, ultrasoundPair, {
      ...(ultrasound.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
      speckle: 0, scanLines: false, markers: false, brightness: 2,
      _webglAcceleration: webgl,
    });
    if (!result.ok) return result;
  }

  const spectrogram = filterIndex.Spectrogram as FilterLike;
  const spectrogramPair = pairedCanvases(24, 32, (x, y) => y === 8
    ? [0, 0, 0, 0]
    : [80 + ((x * 7 + y * 11) % 80), 64 + ((x * 5 + y * 3) % 96), 48, 255]);
  if (!spectrogramPair) return { ok: false, reason: "Spectrogram hidden-RGB fixture unavailable" };
  for (const webgl of [false, true]) {
    const result = equivalentVisible(`Spectrogram ${webgl ? "GL" : "CPU"}`, spectrogram, spectrogramPair, {
      ...(spectrogram.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
      colormap: "GRAYSCALE", logScale: false, freqBins: 16, dynamicRange: 60,
      _webglAcceleration: webgl,
    });
    if (!result.ok) return result;
  }

  const lcd = filterIndex["LCD Display"] as FilterLike;
  const lcdPair = pairedCanvases(24, 12, (x, y) => (y === 6 && (x === 6 || x === 18))
    ? [0, 0, 0, 0]
    : [72, 96, 120, 255]);
  if (!lcdPair) return { ok: false, reason: "LCD hidden-RGB fixture unavailable" };
  for (const layout of ["STRIPE", "PENTILE", "DIAMOND"]) {
    const result = equivalentVisible(`LCD ${layout}`, lcd, lcdPair, {
      ...(lcd.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
      pixelSize: 12, subpixelLayout: layout, brightness: 1, gapDarkness: 1,
    });
    if (!result.ok) return result;
  }

  const mavica = filterIndex["Mavica FD7"] as FilterLike;
  const mavicaPair = pairedCanvases(64, 48, (x, y) => x < 48
    ? [0, 0, 0, 0]
    : [72 + ((x * 7 + y * 5) % 112), 72 + ((x * 7 + y * 5) % 112), 72 + ((x * 7 + y * 5) % 112), 255]);
  if (!mavicaPair) return { ok: false, reason: "Mavica hidden-RGB fixture unavailable" };
  const mavicaResult = equivalentVisible("Mavica FD7 GL", mavica, mavicaPair, {
    ...(mavica.defaults ?? {}), ...runtimeOptions(), captureMode: "FIELD", smear: false,
  });
  if (!mavicaResult.ok) return mavicaResult;
  return { ok: true };
};

export const runLowAlphaStatisticsIsolation = (): { ok: true } | { ok: false; reason: string } => {
  const identityPalette = { ...nearest, options: { ...nearest.options, levels: 256 } };
  const makePair = (
    width: number,
    height: number,
    lowAlphaFraction: number,
    firstLowAlpha = 1,
    secondLowAlpha = 1,
    firstLowRgb: readonly [number, number, number] = [255, 8, 8],
    secondLowRgb: readonly [number, number, number] = [8, 8, 255],
  ): [HTMLCanvasElement, HTMLCanvasElement] | null => {
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    first.width = second.width = width; first.height = second.height = height;
    const firstContext = first.getContext("2d");
    const secondContext = second.getContext("2d");
    if (!firstContext || !secondContext) return null;
    const firstImage = firstContext.createImageData(width, height);
    const secondImage = secondContext.createImageData(width, height);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (x < width * lowAlphaFraction) {
        firstImage.data.set([...firstLowRgb, firstLowAlpha], offset);
        secondImage.data.set([...secondLowRgb, secondLowAlpha], offset);
      } else {
        const value = 72 + ((x * 7 + y * 5) % 112);
        firstImage.data.set([value, value, value, 255], offset);
        secondImage.data.set([value, value, value, 255], offset);
      }
    }
    firstContext.putImageData(firstImage, 0, 0);
    secondContext.putImageData(secondImage, 0, 0);
    return [first, second];
  };

  const compareOpaque = (
    label: string,
    filter: FilterLike,
    pair: [HTMLCanvasElement, HTMLCanvasElement],
    options: Record<string, unknown>,
    tolerance: number,
  ): { ok: true } | { ok: false; reason: string } => {
    const source = canvasPixels(pair[0]);
    const first = canvasPixels(filter.func(pair[0], options) as HTMLCanvasElement);
    const second = canvasPixels(filter.func(pair[1], options) as HTMLCanvasElement);
    if (!source || !first || !second) return { ok: false, reason: `${label} low-alpha readback failed` };
    let maximumDelta = 0;
    let maximumPixel = 0;
    for (let offset = 0; offset < first.length; offset += 4) {
      if (source[offset + 3] !== 255) continue;
      const pixelDelta = Math.max(
        Math.abs(first[offset] - second[offset]),
        Math.abs(first[offset + 1] - second[offset + 1]),
        Math.abs(first[offset + 2] - second[offset + 2]));
      if (pixelDelta > maximumDelta) {
        maximumDelta = pixelDelta;
        maximumPixel = offset / 4;
      }
      if (first[offset + 3] !== second[offset + 3]) {
        return { ok: false, reason: `${label} changed opaque alpha at pixel ${offset / 4}` };
      }
    }
    return maximumDelta <= tolerance
      ? { ok: true }
      : { ok: false, reason: `${label} low-alpha RGB changed opaque output by ${maximumDelta} at ${maximumPixel % pair[0].width},${Math.floor(maximumPixel / pair[0].width)}` };
  };

  const opaqueDifference = (
    first: Uint8ClampedArray,
    second: Uint8ClampedArray,
    width: number,
    opaqueStartX: number,
  ) => {
    let maximumDelta = 0;
    let maximumPixel = 0;
    let totalDelta = 0;
    let channelCount = 0;
    for (let offset = 0; offset < first.length; offset += 4) {
      const pixel = offset / 4;
      if (pixel % width < opaqueStartX) continue;
      const pixelDelta = Math.max(
        Math.abs(first[offset] - second[offset]),
        Math.abs(first[offset + 1] - second[offset + 1]),
        Math.abs(first[offset + 2] - second[offset + 2]),
      );
      if (pixelDelta > maximumDelta) {
        maximumDelta = pixelDelta;
        maximumPixel = pixel;
      }
      totalDelta += Math.abs(first[offset] - second[offset])
        + Math.abs(first[offset + 1] - second[offset + 1])
        + Math.abs(first[offset + 2] - second[offset + 2]);
      channelCount += 3;
    }
    return {
      maximumDelta,
      maximumPixel,
      meanDelta: totalDelta / Math.max(1, channelCount),
    };
  };

  const meanInteriorRgb = (
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    inset: number,
  ): [number, number, number] => {
    const sums = [0, 0, 0];
    let count = 0;
    for (let y = inset; y < height - inset; y += 1) {
      for (let x = inset; x < width - inset; x += 1) {
        const offset = (y * width + x) * 4;
        sums[0] += pixels[offset];
        sums[1] += pixels[offset + 1];
        sums[2] += pixels[offset + 2];
        count += 1;
      }
    }
    return sums.map((sum) => sum / Math.max(1, count)) as [number, number, number];
  };

  const ultrasoundPair = makePair(64, 48, 0.75);
  // Measure chroma influence at fixed coverage, then measure coverage response
  // with fixed RGB. Every opaque target pixel is included, starting at the
  // immediate chroma-delay/JPEG boundary.
  const mavicaLowColorPair = makePair(64, 48, 0.75, 32, 32);
  const mavicaFullColorPair = makePair(64, 48, 0.75, 255, 255);
  const mavicaCoverageZeroLow = makePair(
    64, 48, 0.75, 0, 32, [255, 8, 8], [255, 8, 8],
  );
  const mavicaCoverageZeroFull = makePair(
    64, 48, 0.75, 0, 255, [255, 8, 8], [255, 8, 8],
  );
  const mavicaStraightLowFull = makePair(
    48, 32, 1, 32, 255, [184, 112, 56], [184, 112, 56],
  );
  const mavicaStraightZeroLow = makePair(
    48, 32, 1, 0, 32, [184, 112, 56], [184, 112, 56],
  );
  if (!ultrasoundPair || !mavicaLowColorPair || !mavicaFullColorPair
    || !mavicaCoverageZeroLow || !mavicaCoverageZeroFull
    || !mavicaStraightLowFull || !mavicaStraightZeroLow) {
    return { ok: false, reason: "low-alpha statistics fixture unavailable" };
  }
  const ultrasound = filterIndex.Ultrasound as FilterLike;
  const mavica = filterIndex["Mavica FD7"] as FilterLike;
  for (const webgl of [false, true]) {
    const ultrasoundResult = compareOpaque(
      `Ultrasound ${webgl ? "GL" : "CPU"}`,
      ultrasound,
      ultrasoundPair,
      {
        ...(ultrasound.defaults ?? {}), ...runtimeOptions(), palette: identityPalette,
        speckle: 0, scanLines: false, markers: false, brightness: 2,
        _webglAcceleration: webgl,
      },
      3,
    );
    if (!ultrasoundResult.ok) return ultrasoundResult;
  }

  const mavicaOptions = {
    ...(mavica.defaults ?? {}), ...runtimeOptions(), captureMode: "FIELD",
    // Fixed WB isolates local chroma/JPEG coverage response. AUTO remains
    // exercised by the exact alpha-zero hidden-RGB contract above.
    lighting: "DAYLIGHT", smear: false,
  };
    const render = (source: HTMLCanvasElement) => canvasPixels(
      mavica.func(source, mavicaOptions) as HTMLCanvasElement,
    );
    const lowRed = render(mavicaLowColorPair[0]);
    const lowBlue = render(mavicaLowColorPair[1]);
    const fullRed = render(mavicaFullColorPair[0]);
    const fullBlue = render(mavicaFullColorPair[1]);
    const coverageZero = render(mavicaCoverageZeroLow[0]);
    const coverageLow = render(mavicaCoverageZeroLow[1]);
    const coverageFull = render(mavicaCoverageZeroFull[1]);
    if (!lowRed || !lowBlue || !fullRed || !fullBlue
      || !coverageZero || !coverageLow || !coverageFull) {
      return { ok: false, reason: "Mavica FD7 GL low-alpha readback failed" };
    }

    const opaqueStartX = 48;
    const lowColor = opaqueDifference(lowRed, lowBlue, 64, opaqueStartX);
    const fullColor = opaqueDifference(fullRed, fullBlue, 64, opaqueStartX);
    // Alpha 32 is 12.5% coverage. Allow 35% of the full-coverage aggregate to
    // accommodate nonlinear tone mapping and coarse JPEG threshold crossings, while a
    // 96-code-value catastrophic ceiling still catches straight-RGB leakage.
    if (lowColor.meanDelta > fullColor.meanDelta * 0.35 + 0.5
      || lowColor.maximumDelta > 96) {
      return {
        ok: false,
        reason: `Mavica FD7 GL did not attenuate fixed-coverage chroma: low mean/max ${lowColor.meanDelta.toFixed(3)}/${lowColor.maximumDelta}, full ${fullColor.meanDelta.toFixed(3)}/${fullColor.maximumDelta}, low max at ${lowColor.maximumPixel % 64},${Math.floor(lowColor.maximumPixel / 64)}`,
      };
    }

    const lowCoverage = opaqueDifference(coverageZero, coverageLow, 64, opaqueStartX);
    const fullCoverage = opaqueDifference(coverageZero, coverageFull, 64, opaqueStartX);
    if (lowCoverage.meanDelta > fullCoverage.meanDelta + 0.25
      || lowCoverage.meanDelta > fullCoverage.meanDelta * 0.35 + 0.5
      || lowCoverage.maximumDelta > 96) {
      return {
        ok: false,
        reason: `Mavica FD7 GL coverage response was not monotonic and bounded: alpha32 mean/max ${lowCoverage.meanDelta.toFixed(3)}/${lowCoverage.maximumDelta}, alpha255 ${fullCoverage.meanDelta.toFixed(3)}/${fullCoverage.maximumDelta}, low max at ${lowCoverage.maximumPixel % 64},${Math.floor(lowCoverage.maximumPixel / 64)}`,
      };
    }
    if (!(coverageZero[3] < coverageLow[3] && coverageLow[3] < coverageFull[3])) {
      return { ok: false, reason: "Mavica FD7 GL did not preserve monotonic alpha 0/32/255 coverage" };
    }

    const straightOptions = {
      ...mavicaOptions,
      quality: "FINE",
      captureMode: "FRAME",
      frameJitter: "0",
    };
    const renderStraight = (source: HTMLCanvasElement) => canvasPixels(
      mavica.func(source, straightOptions) as HTMLCanvasElement,
    );
    const straightLow = renderStraight(mavicaStraightLowFull[0]);
    const straightFull = renderStraight(mavicaStraightLowFull[1]);
    const straightZero = renderStraight(mavicaStraightZeroLow[0]);
    if (!straightLow || !straightFull || !straightZero) {
      return { ok: false, reason: "Mavica FD7 GL straight-alpha readback failed" };
    }
    for (let offset = 0; offset < straightLow.length; offset += 4) {
      if (straightZero[offset] !== 0 || straightZero[offset + 1] !== 0
        || straightZero[offset + 2] !== 0 || straightZero[offset + 3] !== 0) {
        return { ok: false, reason: `Mavica FD7 GL alpha-zero output retained RGB at pixel ${offset / 4}` };
      }
      if (straightLow[offset + 3] !== 32 || straightFull[offset + 3] !== 255) {
        return { ok: false, reason: `Mavica FD7 GL changed homogeneous alpha at pixel ${offset / 4}` };
      }
    }
    const lowRgb = meanInteriorRgb(straightLow, 48, 32, 6);
    const fullRgb = meanInteriorRgb(straightFull, 48, 32, 6);
    const lowEnergy = lowRgb[0] + lowRgb[1] + lowRgb[2];
    const fullEnergy = fullRgb[0] + fullRgb[1] + fullRgb[2];
    const lowHue = lowRgb.map((channel) => channel / Math.max(1, lowEnergy));
    const fullHue = fullRgb.map((channel) => channel / Math.max(1, fullEnergy));
    const hueDelta = Math.max(...lowHue.map((channel, index) => Math.abs(channel - fullHue[index])));
    const straightEnergyRatio = lowEnergy / Math.max(1, fullEnergy);
    const compositedEnergyRatio = straightEnergyRatio * (32 / 255);
    const expectedCompositedRatio = 32 / 255;
    if (hueDelta > 0.12 || straightEnergyRatio < 0.55 || straightEnergyRatio > 1.45
      || compositedEnergyRatio < expectedCompositedRatio * 0.55
      || compositedEnergyRatio > expectedCompositedRatio * 1.45) {
      return {
        ok: false,
        reason: `Mavica FD7 GL partial-alpha straight output diverged: low RGB ${lowRgb.map((value) => value.toFixed(1)).join("/")}, full ${fullRgb.map((value) => value.toFixed(1)).join("/")}, hue delta ${hueDelta.toFixed(3)}, straight/composited energy ratios ${straightEnergyRatio.toFixed(3)}/${compositedEnergyRatio.toFixed(3)}`,
      };
  }
  return { ok: true };
};

export const runLcdLowAlphaEnergy = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["LCD Display"] as FilterLike;
  const palette = { ...nearest, options: { ...nearest.options, levels: 256 } };
  const makeSource = (centerAlpha: number): HTMLCanvasElement => {
    const canvas = makeSolidColorCanvas(12, 12, [0, 0, 0, 255]);
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    const image = context.getImageData(0, 0, 12, 12);
    const center = (6 * 12 + 6) * 4;
    image.data.set([255, 255, 255, centerAlpha], center);
    context.putImageData(image, 0, 0);
    return canvas;
  };
  const highSource = makeSource(255);
  const lowSource = makeSource(1);
  for (const layout of ["STRIPE", "PENTILE", "DIAMOND"]) {
    const options = {
      ...(filter.defaults ?? {}), ...runtimeOptions(), palette,
      pixelSize: 12, subpixelLayout: layout, brightness: 1, gapDarkness: 1,
    };
    const high = canvasPixels(filter.func(highSource, options) as HTMLCanvasElement);
    const low = canvasPixels(filter.func(lowSource, options) as HTMLCanvasElement);
    if (!high || !low) return { ok: false, reason: `LCD ${layout} low-alpha readback failed` };
    let highEnergy = 0; let lowEnergy = 0;
    for (let offset = 0; offset < high.length; offset += 4) {
      highEnergy += high[offset] + high[offset + 1] + high[offset + 2];
      lowEnergy += low[offset] + low[offset + 1] + low[offset + 2];
    }
    if (highEnergy < 1000 || lowEnergy * 10 >= highEnergy) {
      return { ok: false, reason: `LCD ${layout} did not attenuate alpha-1 centre energy: ${lowEnergy}/${highEnergy}` };
    }
  }
  return { ok: true };
};

export const runUltrasoundBoundaryEcho = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Ultrasound as FilterLike;
  const width = 120;
  const height = 96;
  const uniform = makeSolidCanvas(width, height, 96);
  const boundary = makeSolidCanvas(width, height, 32);
  const boundaryContext = boundary.getContext("2d");
  if (!boundaryContext) return { ok: false, reason: "ultrasound boundary fixture has no 2d context" };
  boundaryContext.fillStyle = "rgb(220, 220, 220)";
  boundaryContext.fillRect(0, height / 2, width, height / 2);
  const options = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    speckle: 0,
    scanLines: false,
    markers: false,
    brightness: 1.5,
  };
  let uniformPixels: Uint8ClampedArray | null;
  let boundaryPixels: Uint8ClampedArray | null;
  try {
    uniformPixels = canvasPixels(filter.func(uniform, options) as HTMLCanvasElement);
    boundaryPixels = canvasPixels(filter.func(boundary, options) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `ultrasound boundary render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!uniformPixels || !boundaryPixels) return { ok: false, reason: "ultrasound boundary readback failed" };
  let uniformPeak = 0;
  let boundaryPeak = 0;
  for (let index = 0; index < uniformPixels.length; index += 4) {
    uniformPeak = Math.max(uniformPeak, uniformPixels[index]);
    boundaryPeak = Math.max(boundaryPeak, boundaryPixels[index]);
  }
  return uniformPeak > 0 && boundaryPeak > uniformPeak * 2
    ? { ok: true }
    : { ok: false, reason: `impedance boundary did not dominate diffuse echo (${uniformPeak} -> ${boundaryPeak})` };
};

export const runLenticularNeutralAndAngle = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Lenticular as FilterLike;
  const neutral = makeSolidCanvas(96, 64, 128);
  const base = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    stripWidth: 18,
    viewCount: 6,
    parallax: 8,
    crosstalk: 0.15,
    lensStrength: 0.5,
  };
  let neutralPixels: Uint8ClampedArray | null;
  try {
    neutralPixels = canvasPixels(filter.func(neutral, { ...base, viewAngle: 0.35 }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `lenticular neutral render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!neutralPixels) return { ok: false, reason: "lenticular neutral readback failed" };
  for (let index = 0; index < neutralPixels.length; index += 4) {
    if (Math.max(
      Math.abs(neutralPixels[index] - neutralPixels[index + 1]),
      Math.abs(neutralPixels[index + 1] - neutralPixels[index + 2]),
    ) > 1) {
      return { ok: false, reason: `lenticular added chroma at pixel ${index / 4}` };
    }
  }

  const source = makeGradientCanvas(96, 64);
  let left: Uint8ClampedArray | null;
  let right: Uint8ClampedArray | null;
  try {
    left = canvasPixels(filter.func(source, { ...base, viewAngle: -0.7 }) as HTMLCanvasElement);
    right = canvasPixels(filter.func(source, { ...base, viewAngle: 0.7 }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `lenticular angle render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!left || !right) return { ok: false, reason: "lenticular angle readback failed" };
  let changed = 0;
  for (let index = 0; index < left.length; index += 4) {
    if (left[index] !== right[index]
      || left[index + 1] !== right[index + 1]
      || left[index + 2] !== right[index + 2]) changed += 1;
  }
  return changed > 96 * 64 * 0.25
    ? { ok: true }
    : { ok: false, reason: `view angle changed only ${changed} pixels` };
};

export const runLcdEmitterTopology = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["LCD Display"] as FilterLike;
  const source = makeSolidCanvas(72, 72, 255);
  const counts = (layout: string): [number, number, number] | null => {
    let pixels: Uint8ClampedArray | null;
    try {
      pixels = canvasPixels(filter.func(source, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        subpixelLayout: layout,
        pixelSize: 12,
        brightness: 1,
        gapDarkness: 1,
      }) as HTMLCanvasElement);
    } catch {
      return null;
    }
    if (!pixels) return null;
    const result: [number, number, number] = [0, 0, 0];
    for (let index = 0; index < pixels.length; index += 4) {
      const channels = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const peak = Math.max(...channels);
      if (peak < 200) continue;
      const channel = channels.indexOf(peak);
      if (channels.filter((value, i) => i !== channel && value > 20).length === 0) result[channel] += 1;
    }
    return result;
  };
  const stripe = counts("STRIPE");
  const pentile = counts("PENTILE");
  const diamond = counts("DIAMOND");
  if (!stripe || !pentile || !diamond) return { ok: false, reason: "LCD topology render/readback failed" };
  const stripeSpread = Math.max(...stripe) - Math.min(...stripe);
  const pentileChromaDelta = Math.abs(pentile[0] - pentile[2]);
  const pentileBalance = Math.abs(pentile[1] - pentile[0] - pentile[2]);
  const diamondGreenDense = diamond[1] > diamond[0] && diamond[1] > diamond[2];
  return stripeSpread <= 72 && pentileChromaDelta <= 72 && pentileBalance <= 144 && diamondGreenDense
    ? { ok: true }
    : { ok: false, reason: `LCD topology counts stripe=${stripe} pentile=${pentile} diamond=${diamond}` };
};

export const runSpectrogramSharedMagnitude = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Spectrogram as FilterLike;
  const width = 96;
  const height = 64;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "spectrogram magnitude fixture has no 2d context" };
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const amplitude = x < width / 2 ? 0.1 : 0.8;
      const value = Math.round(127.5 + 127.5 * amplitude * Math.sin(2 * Math.PI * 8 * y / height));
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(filter.func(source, {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      colormap: "GRAYSCALE",
      logScale: false,
      freqBins: 32,
      dynamicRange: 60,
    }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `spectrogram magnitude render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!pixels) return { ok: false, reason: "spectrogram magnitude readback failed" };
  const targetRow = Math.round((1 - 8 / 31) * (height - 1));
  let lowLevel = 0;
  let highLevel = 0;
  for (let x = 0; x < width; x += 1) {
    const value = pixels[(targetRow * width + x) * 4];
    if (x < width / 2) lowLevel += value;
    else highLevel += value;
  }
  lowLevel /= width / 2;
  highLevel /= width / 2;
  return highLevel > lowLevel + 30
    ? { ok: true }
    : { ok: false, reason: `spectrogram self-normalized target-bin energy (${lowLevel.toFixed(1)} vs ${highLevel.toFixed(1)})` };
};

export const runSpectrogramTinyNyquist = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Spectrogram as FilterLike;
  const width = 16;
  const height = 2;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "tiny spectrogram fixture has no 2d context" };
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = y === 0 ? 0 : 255;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(filter.func(source, {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      colormap: "GRAYSCALE",
      logScale: false,
      freqBins: 16,
      dynamicRange: 60,
    }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `tiny spectrogram render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!pixels) return { ok: false, reason: "tiny spectrogram readback failed" };
  const nyquist = pixels[0];
  const dc = pixels[width * 4];
  return dc > 100 && Math.abs(dc - nyquist) <= 2
    ? { ok: true }
    : { ok: false, reason: `tiny DC/Nyquist scaling diverged (${dc} vs ${nyquist})` };
};

export const runAnaglyphCpuGlParity = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Anaglyph as FilterLike;
  const source = makeGradientCanvas(96, 64);
  for (const mode of ["RED_CYAN", "RED_GREEN", "MAGENTA_GREEN", "YELLOW_BLUE"]) {
    for (const depthSource of ["LUMINANCE", "EDGE", "CONSTANT"]) {
      const options = {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        mode,
        depthSource,
        strength: 18,
        convergence: 0.42,
      };
      let gpu: Uint8ClampedArray | null;
      let cpu: Uint8ClampedArray | null;
      try {
        gpu = canvasPixels(filter.func(source, options) as HTMLCanvasElement);
        cpu = canvasPixels(filter.func(source, { ...options, _webglAcceleration: false }) as HTMLCanvasElement);
      } catch (error) {
        return { ok: false, reason: `anaglyph ${mode}/${depthSource} parity threw: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (!gpu || !cpu || gpu.length !== cpu.length) {
        return { ok: false, reason: `anaglyph ${mode}/${depthSource} parity readback failed` };
      }
      let totalDelta = 0;
      let channels = 0;
      for (let index = 0; index < gpu.length; index += 4) {
        totalDelta += Math.abs(gpu[index] - cpu[index]);
        totalDelta += Math.abs(gpu[index + 1] - cpu[index + 1]);
        totalDelta += Math.abs(gpu[index + 2] - cpu[index + 2]);
        channels += 3;
      }
      const meanDelta = totalDelta / channels;
      if (meanDelta > 2) {
        return { ok: false, reason: `anaglyph ${mode}/${depthSource} CPU/GL mean delta=${meanDelta.toFixed(3)}` };
      }
    }
  }
  return { ok: true };
};

export const runBayerNativeSamplePreservation = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Bayer Sensor"] as FilterLike;
  const width = 64;
  const height = 48;
  const source = makeGradientCanvas(width, height);
  const input = canvasPixels(source);
  if (!input) return { ok: false, reason: "Bayer native-sample fixture readback failed" };
  const layouts: Record<string, readonly [number, number, number, number]> = {
    RGGB: [0, 1, 1, 2], BGGR: [2, 1, 1, 0], GRBG: [1, 0, 2, 1], GBRG: [1, 2, 0, 1],
  };
  for (const cfa of Object.keys(layouts)) {
    for (const method of ["NEAREST", "BILINEAR", "EDGE_AWARE"]) {
      let output: Uint8ClampedArray | null;
      try {
        output = canvasPixels(filter.func(source, {
          ...(filter.defaults ?? {}),
          ...runtimeOptions(),
          cfa,
          method,
          sensorNoise: 0,
          readNoise: 0,
          hotPixels: 0,
          colorBleed: 0,
          opticalBlur: 0,
        }) as HTMLCanvasElement);
      } catch (error) {
        return { ok: false, reason: `Bayer ${cfa}/${method} threw: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (!output) return { ok: false, reason: `Bayer ${cfa}/${method} readback failed` };
      const layout = layouts[cfa];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const channel = layout[(y & 1) * 2 + (x & 1)];
          const offset = (y * width + x) * 4 + channel;
          if (Math.abs(output[offset] - input[offset]) > 1) {
            return { ok: false, reason: `Bayer ${cfa}/${method} changed native sample at ${x},${y},c${channel}: ${input[offset]} -> ${output[offset]}` };
          }
        }
      }
    }
  }
  return { ok: true };
};

export const runBayerTemporalNoise = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Bayer Sensor"] as FilterLike;
  const render = (
    frameIndex: number,
    sensorNoise: number,
    readNoise: number,
    hotPixels: number,
  ): Uint8ClampedArray | null => {
    try {
      return canvasPixels(filter.func(makeSolidCanvas(64, 48, 112), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        method: "EDGE_AWARE",
        sensorNoise,
        readNoise,
        hotPixels,
        colorBleed: 0,
        opticalBlur: 0,
        _frameIndex: frameIndex,
      }) as HTMLCanvasElement);
    } catch {
      return null;
    }
  };
  const noisyA = render(1, 0.08, 0.01, 0);
  const noisyB = render(2, 0.08, 0.01, 0);
  const defectA = render(1, 0, 0, 0.02);
  const defectB = render(2, 0, 0, 0.02);
  if (!noisyA || !noisyB || !defectA || !defectB) {
    return { ok: false, reason: "Bayer temporal-noise render/readback failed" };
  }
  let noisyChanged = 0;
  let defectChanged = 0;
  for (let index = 0; index < noisyA.length; index += 4) {
    if (noisyA[index] !== noisyB[index]
      || noisyA[index + 1] !== noisyB[index + 1]
      || noisyA[index + 2] !== noisyB[index + 2]) noisyChanged += 1;
    if (defectA[index] !== defectB[index]
      || defectA[index + 1] !== defectB[index + 1]
      || defectA[index + 2] !== defectB[index + 2]) defectChanged += 1;
  }
  return noisyChanged > 64 * 48 * 0.5 && defectChanged === 0
    ? { ok: true }
    : { ok: false, reason: `Bayer frame response noisy=${noisyChanged}, fixed-defect=${defectChanged}` };
};

export const runBayerGradientCorrection = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Bayer Sensor"] as FilterLike;
  const width = 64;
  const height = 48;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d");
  if (!context) return { ok: false, reason: "Bayer gradient fixture has no 2d context" };
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = x < width / 2 ? 32 : 224;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const render = (method: string) => canvasPixels(filter.func(source, {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    cfa: "RGGB",
    method,
    sensorNoise: 0,
    readNoise: 0,
    hotPixels: 0,
    colorBleed: 0,
    opticalBlur: 0,
  }) as HTMLCanvasElement);
  let bilinear: Uint8ClampedArray | null;
  let corrected: Uint8ClampedArray | null;
  try {
    bilinear = render("BILINEAR");
    corrected = render("EDGE_AWARE");
  } catch (error) {
    return { ok: false, reason: `Bayer gradient render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!bilinear || !corrected) return { ok: false, reason: "Bayer gradient readback failed" };
  let bilinearSquared = 0;
  let correctedSquared = 0;
  let samples = 0;
  for (let y = 3; y < height - 3; y += 1) {
    for (let x = 3; x < width - 3; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        bilinearSquared += (bilinear[offset + channel] - image.data[offset + channel]) ** 2;
        correctedSquared += (corrected[offset + channel] - image.data[offset + channel]) ** 2;
        samples += 1;
      }
    }
  }
  const bilinearRmse = Math.sqrt(bilinearSquared / samples);
  const correctedRmse = Math.sqrt(correctedSquared / samples);
  return correctedRmse < bilinearRmse * 0.8
    ? { ok: true }
    : { ok: false, reason: `Bayer 5x5 did not improve neutral edge RMSE (${bilinearRmse.toFixed(3)} -> ${correctedRmse.toFixed(3)})` };
};

export const runMoireModeSeparation = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Moiré / Aliasing"] as FilterLike;
  const render = (pattern: string): Uint8ClampedArray | null => {
    try {
      return canvasPixels(filter.func(makeGradientCanvas(96, 64), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        pattern,
        cellSize: 4,
        sourcePitch: 3.5,
        angle: 7,
        strength: 0.8,
        chroma: 0.75,
        opticalBlur: 0.2,
        drift: 0,
      }) as HTMLCanvasElement);
    } catch {
      return null;
    }
  };
  const sensor = render("SENSOR");
  const screen = render("SCREEN");
  const print = render("PRINT");
  if (!sensor || !screen || !print) return { ok: false, reason: "moiré mode render/readback failed" };
  const changedFraction = (left: Uint8ClampedArray, right: Uint8ClampedArray) => {
    let changed = 0;
    for (let index = 0; index < left.length; index += 4) {
      if (Math.max(
        Math.abs(left[index] - right[index]),
        Math.abs(left[index + 1] - right[index + 1]),
        Math.abs(left[index + 2] - right[index + 2]),
      ) > 12) changed += 1;
    }
    return changed / (left.length / 4);
  };
  const sensorScreen = changedFraction(sensor, screen);
  const sensorPrint = changedFraction(sensor, print);
  const screenPrint = changedFraction(screen, print);
  return Math.min(sensorScreen, sensorPrint, screenPrint) > 0.35
    ? { ok: true }
    : { ok: false, reason: `moiré modes insufficiently distinct (${sensorScreen.toFixed(2)}, ${sensorPrint.toFixed(2)}, ${screenPrint.toFixed(2)})` };
};

export const runMoireLatticeControls = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Moiré / Aliasing"] as FilterLike;
  const render = (overrides: Record<string, unknown>): Uint8ClampedArray | null => {
    try {
      return canvasPixels(filter.func(makeGradientCanvas(96, 64), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        pattern: "SCREEN",
        cellSize: 4,
        sourcePitch: 4,
        angle: 0,
        strength: 1,
        chroma: 1,
        opticalBlur: 0.15,
        drift: 0,
        ...overrides,
      }) as HTMLCanvasElement);
    } catch {
      return null;
    }
  };
  const aligned = render({ angle: 0, sourcePitch: 4, _frameIndex: 1 });
  const angled = render({ angle: 7, sourcePitch: 4, _frameIndex: 1 });
  const mismatched = render({ angle: 0, sourcePitch: 5, _frameIndex: 1 });
  const later = render({ angle: 0, sourcePitch: 4, _frameIndex: 81 });
  if (!aligned || !angled || !mismatched || !later) {
    return { ok: false, reason: "moiré lattice-control render/readback failed" };
  }
  const changedFraction = (left: Uint8ClampedArray, right: Uint8ClampedArray) => {
    let changed = 0;
    for (let index = 0; index < left.length; index += 4) {
      if (left[index] !== right[index]
        || left[index + 1] !== right[index + 1]
        || left[index + 2] !== right[index + 2]) changed += 1;
    }
    return changed / (left.length / 4);
  };
  const angleChange = changedFraction(aligned, angled);
  const pitchChange = changedFraction(aligned, mismatched);
  const zeroDriftChange = changedFraction(aligned, later);
  return angleChange > 0.35 && pitchChange > 0.35 && zeroDriftChange === 0
    ? { ok: true }
    : { ok: false, reason: `moiré controls angle=${angleChange.toFixed(2)} pitch=${pitchChange.toFixed(2)} zero-drift=${zeroDriftChange.toFixed(2)}` };
};

export const runOscilloscopeSignalModes = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Oscilloscope as FilterLike;
  const source = makeGradientCanvas(72, 48);
  const render = (
    display: string,
    accelerated: boolean,
    overrides: Record<string, unknown> = {},
  ): Uint8ClampedArray | null => {
    try {
      return canvasPixels(filter.func(source, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        display,
        beamWidth: 1.5,
        intensity: 1.2,
        bloom: 2,
        bloomStrength: 0.5,
        noiseFloor: 0,
        persistence: 0,
        graticule: false,
        _webglAcceleration: accelerated,
        ...overrides,
      }) as HTMLCanvasElement);
    } catch {
      return null;
    }
  };
  const outputs: Uint8ClampedArray[] = [];
  for (const display of ["WAVEFORM", "TRACE", "PARADE"]) {
    const gpu = render(display, true);
    const cpu = render(display, false);
    if (!gpu || !cpu || gpu.length !== cpu.length) {
      return { ok: false, reason: `oscilloscope ${display} CPU/GL readback failed` };
    }
    let delta = 0;
    for (let index = 0; index < gpu.length; index += 4) {
      delta += Math.abs(gpu[index] - cpu[index]);
      delta += Math.abs(gpu[index + 1] - cpu[index + 1]);
      delta += Math.abs(gpu[index + 2] - cpu[index + 2]);
    }
    const meanDelta = delta / (gpu.length / 4 * 3);
    if (meanDelta > 3) {
      return { ok: false, reason: `oscilloscope ${display} CPU/GL mean delta=${meanDelta.toFixed(2)}` };
    }
    outputs.push(gpu);
  }
  const changedFraction = (left: Uint8ClampedArray, right: Uint8ClampedArray) => {
    let changed = 0;
    for (let index = 0; index < left.length; index += 4) {
      if (Math.max(
        Math.abs(left[index] - right[index]),
        Math.abs(left[index + 1] - right[index + 1]),
        Math.abs(left[index + 2] - right[index + 2]),
      ) > 8) changed += 1;
    }
    return changed / (left.length / 4);
  };
  const waveformTrace = changedFraction(outputs[0], outputs[1]);
  const waveformParade = changedFraction(outputs[0], outputs[2]);
  if (waveformTrace <= 0.2 || waveformParade <= 0.2) {
    return { ok: false, reason: `oscilloscope modes collapsed (${waveformTrace.toFixed(2)}, ${waveformParade.toFixed(2)})` };
  }

  const binaryPalette = { name: "nearest", options: { levels: 2 } };
  const binaryGpu = render("WAVEFORM", true, { palette: binaryPalette });
  const binaryCpu = render("WAVEFORM", false, { palette: binaryPalette });
  if (!binaryGpu || !binaryCpu) return { ok: false, reason: "oscilloscope binary-palette readback failed" };
  const channelValues = new Set<number>();
  let maximumDelta = 0;
  for (let index = 0; index < binaryGpu.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      channelValues.add(binaryGpu[index + channel]);
      maximumDelta = Math.max(maximumDelta, Math.abs(binaryGpu[index + channel] - binaryCpu[index + channel]));
    }
  }
  const binary = [...channelValues].every((value) => value === 0 || value === 255);
  return binary && maximumDelta <= 1
    ? { ok: true }
    : { ok: false, reason: `oscilloscope palette mismatch values=${[...channelValues]} maxDelta=${maximumDelta}` };
};

export const runCcdChargeAccumulation = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["CCD Charge Smear"] as FilterLike;
  const makeFixture = (events: number): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgb(16,16,16)";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "white";
    context.fillRect(31, 14, 2, 2);
    if (events > 1) context.fillRect(31, 24, 2, 2);
    return canvas;
  };
  const render = (events: number, antiBlooming: number) => {
    const source = makeFixture(events);
    const input = canvasPixels(source);
    const output = canvasPixels(filter.func(source, {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      threshold: 0.75,
      strength: 0.35,
      length: 24,
      decay: 0.9,
      direction: "DOWN",
      antiBlooming,
    }) as HTMLCanvasElement);
    if (!input || !output) return null;
    let energy = 0;
    let above = 0;
    let below = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const index = (y * 64 + x) * 4;
        const added = Math.max(0, output[index] - input[index])
          + Math.max(0, output[index + 1] - input[index + 1])
          + Math.max(0, output[index + 2] - input[index + 2]);
        energy += added;
        if (y < 14) above += added;
        if (y > (events > 1 ? 25 : 15)) below += added;
      }
    }
    return { energy, above, below };
  };
  let one: ReturnType<typeof render>;
  let two: ReturnType<typeof render>;
  let drained: ReturnType<typeof render>;
  try {
    one = render(1, 0);
    two = render(2, 0);
    drained = render(2, 0.8);
  } catch (error) {
    return { ok: false, reason: `CCD accumulation render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!one || !two || !drained) return { ok: false, reason: "CCD accumulation readback failed" };
  if (two.energy <= one.energy * 1.45) {
    return { ok: false, reason: `CCD overload did not accumulate (${one.energy} -> ${two.energy})` };
  }
  // Anti-blooming (drain = 1 - antiBlooming) cuts the linear spill 5x here, but
  // the spill is now accumulated and composited in linear light: a much smaller
  // linear increment added onto a near-black (16/255) background re-encodes
  // concavely to sRGB, so the *measured byte* energy drops ~58%, not the >60%
  // the old gamma-space filter produced. The drain is still clearly working;
  // assert it more-than-halves the bloom.
  if (drained.energy >= two.energy * 0.5) {
    return { ok: false, reason: `CCD anti-blooming drain was too weak (${two.energy} -> ${drained.energy})` };
  }
  return one.below > one.above * 5
    ? { ok: true }
    : { ok: false, reason: `CCD DOWN direction inverted (above=${one.above}, below=${one.below})` };
};

export const runLaserSpeckleDiversity = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Laser Speckle Projector"] as FilterLike;
  const source = makeSolidCanvas(128, 96, 128);
  const statistics = (diversity: number): { mean: number; contrast: number } | null => {
    const pixels = canvasPixels(filter.func(source, {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      laser: "RGB",
      coherence: 1,
      diversity,
      grain: 3,
      scanStrength: 0,
      bloom: 0,
      motion: 0,
      _frameIndex: 0,
    }) as HTMLCanvasElement);
    if (!pixels) return null;
    const values: number[] = [];
    for (let y = 8; y < 88; y += 1) {
      for (let x = 8; x < 120; x += 1) {
        const encoded = pixels[(y * 128 + x) * 4] / 255;
        values.push(encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4);
      }
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    return { mean, contrast: deviation / mean };
  };
  let one: ReturnType<typeof statistics>;
  let eight: ReturnType<typeof statistics>;
  try {
    one = statistics(1);
    eight = statistics(8);
  } catch (error) {
    return { ok: false, reason: `laser diversity render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!one || !eight) return { ok: false, reason: "laser diversity readback failed" };
  const meanRatio = eight.mean / one.mean;
  return eight.contrast < one.contrast * 0.55 && meanRatio > 0.8 && meanRatio < 1.2
    ? { ok: true }
    : { ok: false, reason: `laser diversity contrast ${one.contrast.toFixed(3)} -> ${eight.contrast.toFixed(3)}, mean ratio=${meanRatio.toFixed(3)}` };
};

export const runCanvasOwnershipReuse = (): { ok: true } | { ok: false; reason: string } => {
  const lcd = filterIndex["LCD Display"] as FilterLike;
  const mavica = filterIndex["Mavica FD7"] as FilterLike;
  const source = makeSolidCanvas(37, 29, 112);
  const renderAndRelease = (): { ok: true } | { ok: false; reason: string } => {
    const lcdOutput = lcd.func(source, {
      ...(lcd.defaults ?? {}), ...runtimeOptions(), pixelSize: 7,
    }) as HTMLCanvasElement;
    if (!lcdOutput || lcdOutput === source) return { ok: false, reason: "LCD ownership warm-up failed" };
    releasePooledCanvas(lcdOutput);
    const mavicaOutput = mavica.func(source, {
      ...(mavica.defaults ?? {}), ...runtimeOptions(), captureMode: "FIELD",
    }) as HTMLCanvasElement;
    if (!mavicaOutput || mavicaOutput === source) return { ok: false, reason: "Mavica ownership warm-up failed" };
    releasePooledCanvas(mavicaOutput);
    return { ok: true };
  };

  resetCanvasPoolStats();
  resetGLStats();
  const warm = renderAndRelease();
  if (!warm.ok) return warm;
  const warmCanvas = getCanvasPoolStats();
  const warmGl = getGLStats();
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const result = renderAndRelease();
    if (!result.ok) return result;
  }
  const finalCanvas = getCanvasPoolStats();
  const finalGl = getGLStats();
  if (finalCanvas.allocations !== warmCanvas.allocations) {
    return { ok: false, reason: `canvas allocations did not plateau: ${warmCanvas.allocations} -> ${finalCanvas.allocations}` };
  }
  if (finalGl.readoutCanvases !== warmGl.readoutCanvases) {
    return { ok: false, reason: `GL readout allocations did not plateau: ${warmGl.readoutCanvases} -> ${finalGl.readoutCanvases}` };
  }
  if (finalCanvas.reuses < warmCanvas.reuses + 20
    || finalGl.readoutCanvasReuses < warmGl.readoutCanvasReuses + 16) {
    return {
      ok: false,
      reason: `reuse counters did not advance: canvas ${warmCanvas.reuses}->${finalCanvas.reuses}, GL ${warmGl.readoutCanvasReuses}->${finalGl.readoutCanvasReuses}`,
    };
  }

  // Exercise the real Mavica ownership path, not only the cleanup helper: the
  // second read is the pre-JPEG complexity readback after both the CPU work
  // canvas and GL readout canvas have been acquired.
  const failureSource = makeSolidCanvas(53, 41, 96);
  const contextPrototype = CanvasRenderingContext2D.prototype;
  const originalGetImageData = contextPrototype.getImageData;
  let readCount = 0;
  let sawInjectedFailure = false;
  resetCanvasPoolStats();
  contextPrototype.getImageData = function getImageDataWithInjectedFailure(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    settings?: ImageDataSettings,
  ): ImageData {
    readCount += 1;
    if (readCount === 2) throw new Error("injected Mavica pre-JPEG read failure");
    return settings === undefined
      ? originalGetImageData.call(this, sx, sy, sw, sh)
      : originalGetImageData.call(this, sx, sy, sw, sh, settings);
  };
  try {
    mavica.func(failureSource, {
      ...(mavica.defaults ?? {}), ...runtimeOptions(), captureMode: "FIELD",
    });
  } catch (error) {
    sawInjectedFailure = error instanceof Error
      && error.message === "injected Mavica pre-JPEG read failure";
  } finally {
    contextPrototype.getImageData = originalGetImageData;
  }
  const failureStats = getCanvasPoolStats();
  if (!sawInjectedFailure || failureStats.releases < 2) {
    return {
      ok: false,
      reason: `Mavica real-path failure cleanup was incomplete: injected=${sawInjectedFailure}, reads=${readCount}, releases=${failureStats.releases}`,
    };
  }
  return { ok: true };
};
