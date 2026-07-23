import { filterIndex } from "@gyng/ditherer-filters";
import { canvasPixels, runtimeOptions } from "../fixtures";
import type { FilterLike } from "../types";

type Result = { ok: true } | { ok: false; reason: string };

const paintCanvas = (
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      image.data[o] = r; image.data[o + 1] = g; image.data[o + 2] = b; image.data[o + 3] = a;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

const luma = (px: Uint8ClampedArray, i: number): number =>
  0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

const meanLuma = (px: Uint8ClampedArray): number => {
  let s = 0;
  for (let i = 0; i < px.length; i += 4) s += luma(px, i);
  return s / (px.length / 4);
};

const run = (name: string, canvas: HTMLCanvasElement, extra: Record<string, unknown> = {}): Uint8ClampedArray | null => {
  const filter = filterIndex[name] as FilterLike | undefined;
  if (!filter) return null;
  return canvasPixels(filter.func(canvas, { ...(filter.defaults ?? {}), ...runtimeOptions(), ...extra }) as HTMLCanvasElement);
};

/** Despeckle must remove impulse (salt) noise and keep a step edge sharp. */
export const runDespeckleImpulseRemoval = (): Result => {
  const w = 48, h = 48;
  const field = paintCanvas(w, h, (x, y) => {
    const impulse = (x * 7 + y * 5) % 23 === 0; // scattered salt
    const v = impulse ? 250 : 64;
    return [v, v, v, 255];
  });
  const before = canvasPixels(field);
  const after = run("Despeckle", field, { radius: 2, threshold: 20 });
  if (!before || !after) return { ok: false, reason: "Despeckle readback failed" };
  const bright = (px: Uint8ClampedArray): number => {
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (luma(px, i) > 200) n += 1;
    return n;
  };
  const b0 = bright(before), b1 = bright(after);
  if (b0 === 0) return { ok: false, reason: "fixture had no impulses" };
  return b1 < b0 * 0.4
    ? { ok: true }
    : { ok: false, reason: `Despeckle left ${b1}/${b0} impulses (expected < 40%)` };
};

/** A step edge is preserved (not box-blurred) after despeckle. */
export const runDespeckleEdgePreserved = (): Result => {
  const w = 32, h = 32;
  const edge = paintCanvas(w, h, (x) => { const v = x < w / 2 ? 40 : 210; return [v, v, v, 255]; });
  const after = run("Despeckle", edge, { radius: 2, threshold: 20 });
  if (!after) return { ok: false, reason: "Despeckle readback failed" };
  let lo = 255, hi = 0;
  for (let i = 0; i < after.length; i += 4) { const l = luma(after, i); lo = Math.min(lo, l); hi = Math.max(hi, l); }
  return hi - lo > 150
    ? { ok: true }
    : { ok: false, reason: `Despeckle smeared the edge (contrast ${(hi - lo).toFixed(0)})` };
};

/** Sharpen (Gaussian unsharp) raises edge contrast beyond the source range. */
export const runSharpenEdgeContrast = (): Result => {
  const w = 32, h = 16;
  const edge = paintCanvas(w, h, (x) => { const v = x < w / 2 ? 80 : 176; return [v, v, v, 255]; });
  const before = canvasPixels(edge);
  const after = run("Sharpen", edge, { strength: 1.5, radius: 3, threshold: 0 });
  if (!before || !after) return { ok: false, reason: "Sharpen readback failed" };
  const range = (px: Uint8ClampedArray): number => {
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 4) { const l = luma(px, i); lo = Math.min(lo, l); hi = Math.max(hi, l); }
    return hi - lo;
  };
  const r0 = range(before), r1 = range(after);
  return r1 > r0 + 5
    ? { ok: true }
    : { ok: false, reason: `Sharpen did not overshoot (range ${r0.toFixed(0)} -> ${r1.toFixed(0)})` };
};

/**
 * Frequency Filter's low-pass must be a GAUSSIAN, not a box. Blurring a 1-px
 * bright line in LOW mode gives a centre-peaked, monotonically-decaying profile;
 * a box blur gives a flat plateau of equal values out to its radius, which fails
 * the strict decay check.
 */
export const runFrequencyGaussianLowpass = (): Result => {
  const filter = filterIndex["Frequency Filter"] as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Frequency Filter missing from registry" };
  const w = 48, h = 16, cx = 24;
  const line = document.createElement("canvas");
  line.width = w; line.height = h;
  const ctx = line.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: "line fixture has no 2d context" };
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const o = (y * w + x) * 4;
    const v = x === cx ? 255 : 0; // opaque black background, one white line
    img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const out = canvasPixels(filter.func(line, {
    ...(filter.defaults ?? {}), ...runtimeOptions(), mode: "LOW", radius: 10,
  }) as HTMLCanvasElement);
  if (!out) return { ok: false, reason: "Frequency Filter readback failed" };

  const colLuma = (x: number): number => {
    let s = 0;
    for (let y = 0; y < h; y += 1) { const i = (y * w + x) * 4; s += 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]; }
    return s / h;
  };
  // Within a box's radius the profile is flat (all equal); a Gaussian decays.
  const c0 = colLuma(cx), c4 = colLuma(cx + 4), c8 = colLuma(cx + 8);
  if (!(c0 > c4 + 5 && c4 > c8 + 1)) {
    return { ok: false, reason: `low-pass not a centre-peaked Gaussian (profile ${c0.toFixed(1)}, ${c4.toFixed(1)}, ${c8.toFixed(1)} — a box would be flat)` };
  }
  return { ok: true };
};

/** Bloom adds a spreading glow around bright sources; zero strength is inert. */
export const runBloomLinearGlow = (): Result => {
  const w = 48, h = 48;
  const spot = paintCanvas(w, h, (x, y) => {
    const inSquare = x >= 20 && x < 28 && y >= 20 && y < 28;
    const v = inSquare ? 255 : 0;
    return [v, v, v, 255];
  });
  const before = canvasPixels(spot);
  const glow = run("Bloom", spot, { threshold: 180, strength: 1.0, radius: 8 });
  const inert = run("Bloom", spot, { threshold: 180, strength: 0, radius: 8 });
  if (!before || !glow || !inert) return { ok: false, reason: "Bloom readback failed" };
  if (!(meanLuma(glow) > meanLuma(before) + 0.5)) {
    return { ok: false, reason: `Bloom added no glow (mean ${meanLuma(before).toFixed(2)} -> ${meanLuma(glow).toFixed(2)})` };
  }
  // A background pixel next to the square (source 0) must be lifted by the glow.
  const nearIdx = (18 * w + 24) * 4;
  if (!(luma(glow, nearIdx) > 4)) {
    return { ok: false, reason: `Bloom glow did not spread to neighbours (${luma(glow, nearIdx).toFixed(1)})` };
  }
  return Math.abs(meanLuma(inert) - meanLuma(before)) < 1
    ? { ok: true }
    : { ok: false, reason: `Bloom strength 0 not inert (mean ${meanLuma(before).toFixed(2)} -> ${meanLuma(inert).toFixed(2)})` };
};

/** Bokeh spreads a point highlight into a disc larger than the source point. */
export const runBokehHighlightSpread = (): Result => {
  const w = 64, h = 64;
  const dot = paintCanvas(w, h, (x, y) => {
    const isDot = Math.abs(x - 32) <= 1 && Math.abs(y - 32) <= 1;
    const v = isDot ? 255 : 0;
    return [v, v, v, 255];
  });
  const before = canvasPixels(dot);
  const after = run("Bokeh", dot);
  if (!before || !after) return { ok: false, reason: "Bokeh readback failed" };
  const litCount = (px: Uint8ClampedArray): number => {
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (luma(px, i) > 20) n += 1;
    return n;
  };
  const c0 = litCount(before), c1 = litCount(after);
  return c1 > c0
    ? { ok: true }
    : { ok: false, reason: `Bokeh did not spread the highlight (lit ${c0} -> ${c1})` };
};

// ---------------------------------------------------------------------------
// Plan 113 — linear-light accumulation contracts. Each of these filters names a
// camera/film/optical process that integrates or averages *light*; the math now
// runs in linear light (SRGB_GLSL / oc_srgbToLinear ... oc_linearToSrgb) so a
// bright signal smeared over dark no longer crushes toward black.
// ---------------------------------------------------------------------------

/** Motion Blur must average light in linear space: a horizontal blur across a
 *  dark/bright step lands brighter than the naive gamma average of the tones. */
export const runMotionBlurLinearStreak = (): Result => {
  const w = 64, h = 8;
  const dark = 20, bright = 235;
  const field = paintCanvas(w, h, (x) => {
    const v = x < w / 2 ? dark : bright;
    return [v, v, v, 255];
  });
  const after = run("Motion Blur", field, { angle: 0, length: 20 });
  if (!after) return { ok: false, reason: "Motion Blur readback failed" };
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = w / 2 - 2; x < w / 2 + 2; x++) {
      sum += luma(after, (y * w + x) * 4);
      n += 1;
    }
  }
  const boundaryLuma = sum / n;
  const naiveGammaMean = (dark + bright) / 2;
  return boundaryLuma > naiveGammaMean + 20
    ? { ok: true }
    : { ok: false, reason: `Motion Blur boundary luma ${boundaryLuma.toFixed(1)} not brighter than gamma mean ${naiveGammaMean.toFixed(1)} + margin` };
};

/** Radial Blur must average light in linear space: a black/white checkerboard
 *  averages brighter than the naive gamma-space midpoint (127.5 -> ~188). */
export const runRadialBlurLinearAverage = (): Result => {
  const w = 48, h = 48;
  const field = paintCanvas(w, h, (x, y) => {
    const v = (x + y) % 2 === 0 ? 255 : 0;
    return [v, v, v, 255];
  });
  const after = run("Radial Blur", field, { strength: 40, centerX: -1, centerY: -1 });
  if (!after) return { ok: false, reason: "Radial Blur readback failed" };
  const mean = meanLuma(after);
  return mean > 155
    ? { ok: true }
    : { ok: false, reason: `Radial Blur averaged in gamma space, not linear (mean luma ${mean.toFixed(1)}, expected > 155)` };
};

/** Long Exposure shutter-average integrates frames in LINEAR light: a dark then
 *  bright frame must average brighter than the gamma-space byte midpoint. */
export const runLongExposureLinearAccumulation = (): Result => {
  const w = 32, h = 32;
  const gray = (v: number) => paintCanvas(w, h, () => [v, v, v, 255]);
  const filter = filterIndex["Long Exposure"] as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Long Exposure not in index" };
  const dark = 16, bright = 240;
  const base = { ...(filter.defaults ?? {}), ...runtimeOptions(), mode: "SHUTTER", windowSize: 2 };
  filter.func(gray(dark), { ...base, _frameIndex: 0 });
  const out = canvasPixels(filter.func(gray(bright), { ...base, _frameIndex: 1 }) as HTMLCanvasElement);
  if (!out) return { ok: false, reason: "Long Exposure readback failed" };
  const measured = meanLuma(out);
  const gammaMid = (dark + bright) / 2;
  return measured > gammaMid + 20
    ? { ok: true }
    : { ok: false, reason: `shutter average ${measured.toFixed(0)} not linear-bright (gamma midpoint ${gammaMid}, expected > ${gammaMid + 20})` };
};

/** Halation must diffuse and screen-composite the glow in LINEAR light: a bright
 *  highlight over a dark field spreads a coloured bleed onto its neighbours and
 *  lifts them more than a naive gamma screen would. */
export const runHalationLinearScreen = (): Result => {
  const w = 48, h = 48;
  const spot = paintCanvas(w, h, (x, y) => {
    const inSquare = x >= 20 && x < 28 && y >= 20 && y < 28;
    const v = inSquare ? 255 : 0;
    return [v, v, v, 255];
  });
  const before = canvasPixels(spot);
  const after = run("Halation", spot, { radius: 18, threshold: 100, strength: 0.9, tint: [255, 60, 40] });
  if (!before || !after) return { ok: false, reason: "Halation readback failed" };
  const nearIdx = (18 * w + 24) * 4;
  const litNeighbours = (px: Uint8ClampedArray): number => {
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (luma(px, i) > 8) n += 1;
    return n;
  };
  if (!(litNeighbours(after) > litNeighbours(before))) {
    return { ok: false, reason: "Halation glow did not spread onto the dark field" };
  }
  if (!(after[nearIdx] > after[nearIdx + 2] && after[nearIdx] > 10)) {
    return { ok: false, reason: `Halation neighbour not lifted/tinted (rgb ${after[nearIdx]},${after[nearIdx + 1]},${after[nearIdx + 2]})` };
  }
  return meanLuma(after) > meanLuma(before) + 0.5
    ? { ok: true }
    : { ok: false, reason: `Halation added no glow (mean ${meanLuma(before).toFixed(2)} -> ${meanLuma(after).toFixed(2)})` };
};

/** Orton screen-composites a blurred glow over the source in linear light; a
 *  dark background pixel next to a bright highlight must be visibly lifted. */
export const runOrtonLinearGlow = (): Result => {
  const w = 48, h = 48;
  const spot = paintCanvas(w, h, (x, y) => {
    const inSquare = x >= 20 && x < 28 && y >= 20 && y < 28;
    const v = inSquare ? 255 : 0;
    return [v, v, v, 255];
  });
  const before = canvasPixels(spot);
  const glowed = run("Orton", spot, { radius: 10, strength: 1.0, contrast: 0, saturation: 1 });
  if (!before || !glowed) return { ok: false, reason: "Orton readback failed" };
  const nearIdx = (18 * w + 24) * 4;
  if (!(luma(glowed, nearIdx) > 8)) {
    return { ok: false, reason: `Orton glow did not lift the dark neighbour (${luma(glowed, nearIdx).toFixed(1)})` };
  }
  return meanLuma(glowed) > meanLuma(before) + 0.5
    ? { ok: true }
    : { ok: false, reason: `Orton added no net glow (mean ${meanLuma(before).toFixed(2)} -> ${meanLuma(glowed).toFixed(2)})` };
};

/** Tilt Shift's defocus blur is a lens PSF convolution — linear light, not gamma.
 *  A bright highlight over dark, fully defocused, must average brighter than a
 *  naive gamma-space blur of the same footprint would (muddy-bokeh regression). */
export const runTiltShiftLinearDefocus = (): Result => {
  const w = 48, h = 48, bg = 8, fg = 255;
  const scene = paintCanvas(w, h, (x, y) =>
    (x >= 20 && x < 28 && y >= 20 && y < 28) ? [fg, fg, fg, 255] : [bg, bg, bg, 255]);
  const after = run("Tilt Shift", scene, { focusPosition: 0, focusWidth: 0.01, blurAmount: 8, saturationBoost: 0 });
  if (!after) return { ok: false, reason: "Tilt Shift readback failed" };
  const window = 24, squareArea = 8 * 8;
  const gammaExpected = (squareArea * fg + (window * window - squareArea) * bg) / (window * window);
  const observed = luma(after, (24 * w + 24) * 4);
  return observed > gammaExpected + 8
    ? { ok: true }
    : { ok: false, reason: `Tilt Shift defocus not brighter than gamma baseline (observed ${observed.toFixed(1)}, gamma ${gammaExpected.toFixed(1)})` };
};

/** Volumetric Light must ray-march a bright emitter into shafts and lift a dark
 *  field (linear integration); exposure 0 must be inert. */
export const runVolumetricLightLinearShafts = (): Result => {
  const w = 48, h = 48;
  const scene = paintCanvas(w, h, (x, y) => {
    const emitter = y < 6 && x >= 20 && x < 28;
    const v = emitter ? 255 : 0;
    return [v, v, v, 255];
  });
  const before = canvasPixels(scene);
  const shafts = run("Volumetric Light", scene, {
    lightX: 0.5, lightY: 0.1, exposure: 0.12, density: 1.2, threshold: 0.5, noise: 0,
  });
  const inert = run("Volumetric Light", scene, { exposure: 0, noise: 0 });
  if (!before || !shafts || !inert) return { ok: false, reason: "Volumetric Light readback failed" };
  if (!(meanLuma(shafts) > meanLuma(before) + 0.5)) {
    return { ok: false, reason: `no shafts added (mean ${meanLuma(before).toFixed(2)} -> ${meanLuma(shafts).toFixed(2)})` };
  }
  const midIdx = (24 * w + 24) * 4;
  if (!(luma(shafts, midIdx) > 4)) {
    return { ok: false, reason: `shaft did not reach the dark field (${luma(shafts, midIdx).toFixed(1)})` };
  }
  return Math.abs(meanLuma(inert) - meanLuma(before)) < 1
    ? { ok: true }
    : { ok: false, reason: `exposure 0 not inert (mean ${meanLuma(before).toFixed(2)} -> ${meanLuma(inert).toFixed(2)})` };
};

/** CCD Charge Smear must estimate full-well overflow from LINEAR luma and
 *  accumulate/composite the spill in linear light. A mid-bright column pixel
 *  blooms into the trail by its *linear* excess above threshold. */
export const runCcdChargeLinearBloom = (): Result => {
  const filter = filterIndex["CCD Charge Smear"] as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "CCD Charge Smear not in index" };
  const w = 1, h = 16;
  const brightGamma = 192, darkGamma = 16;
  const source = paintCanvas(w, h, (_x, y) =>
    y === 0 ? [brightGamma, brightGamma, brightGamma, 255] : [darkGamma, darkGamma, darkGamma, 255]);
  const threshold = 0.6, decay = 0.85, length = 6, strength = 1;
  const output = run("CCD Charge Smear", source, {
    threshold, strength, decay, length, direction: "DOWN", antiBlooming: 0,
  });
  if (!output) return { ok: false, reason: "CCD Charge Smear readback failed" };
  const s2l = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const l2s = (c: number): number =>
    c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const thresholdLin = s2l(threshold * 255);
  const excessLin = Math.max(0, s2l(brightGamma) - thresholdLin) / Math.max(0.001, 1 - thresholdLin);
  const darkLin = s2l(darkGamma);
  for (let r = 1; r <= length; r += 1) {
    const spilled = excessLin * decay ** r;
    const expectedGamma = l2s(darkLin + spilled) * 255;
    const got = output[r * 4];
    if (Math.abs(got - expectedGamma) > 8) {
      return { ok: false, reason: `row ${r}: expected ~${expectedGamma.toFixed(1)} (linear-weighted), got ${got}` };
    }
  }
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Plan 113 — alpha-preservation contracts. Colour/geometric transforms that used
// to force opaque output now carry source alpha.
// ---------------------------------------------------------------------------

/** Color Cycle's hue rotation must not clobber source alpha (GL path). */
export const runTemporalColorCycleAlphaPreserved = (): Result => {
  const w = 8, h = 8;
  const semi = paintCanvas(w, h, (x, y) =>
    x === 3 && y === 3 ? [200, 60, 30, 128] : [10, 220, 90, 255]);
  const after = run("Color Cycle", semi, { _frameIndex: 0 });
  if (!after) return { ok: false, reason: "Color Cycle readback failed" };
  const idx = (3 * w + 3) * 4;
  return after[idx + 3] === 128
    ? { ok: true }
    : { ok: false, reason: `Color Cycle changed alpha 128 -> ${after[idx + 3]}` };
};

/** Scanline Warp displaces alpha identically to rgb — a translucent region stays
 *  translucent, not forced opaque. */
export const runScanlineWarpAlphaWarped = (): Result => {
  const w = 32, h = 32;
  const src = paintCanvas(w, h, (x) =>
    x < w / 2 ? [220, 40, 40, 80] : [40, 220, 40, 255]);
  const after = run("Scanline Warp", src, { amplitude: 12, frequency: 3, phase: 90 });
  if (!after) return { ok: false, reason: "Scanline Warp readback failed" };
  let sawTranslucent = false, sawOpaque = false;
  for (let i = 3; i < after.length; i += 4) {
    if (after[i] < 250) sawTranslucent = true;
    if (after[i] === 255) sawOpaque = true;
  }
  if (!sawTranslucent) return { ok: false, reason: "alpha forced fully opaque after warp" };
  if (!sawOpaque) return { ok: false, reason: "fixture lost its opaque region entirely" };
  return { ok: true };
};

/** Color Gradient Noise must carry the source alpha channel, not force opaque. */
export const runColorGradientNoiseAlphaPreserved = (): Result => {
  const w = 32, h = 32;
  const source = paintCanvas(w, h, (x, y) => [160, 90, 210, ((x + y * w) * 37) & 255]);
  const before = canvasPixels(source);
  const after = run("Color Gradient Noise", source, { mix: 0.4 });
  if (!before || !after) return { ok: false, reason: "Color Gradient Noise readback failed" };
  for (let i = 3; i < after.length; i += 4) {
    if (after[i] !== before[i]) {
      return { ok: false, reason: `Color Gradient Noise changed alpha at byte ${i} (${before[i]} -> ${after[i]})` };
    }
  }
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Plan 114 — spec-accuracy and GL/CPU parity contracts.
// ---------------------------------------------------------------------------

/** Dubois red/cyan must not ghost pure left-eye (red) content into the cyan
 *  (G,B) channels — regression guard for the transposed-left-matrix bug. */
export const runAnaglyphDuboisNoLeftLeak = (): Result => {
  const w = 64, h = 32;
  const stripe = paintCanvas(w, h, (x) =>
    x >= 20 && x < 28 ? [255, 0, 0, 255] : [0, 0, 0, 255]);
  const after = run("Anaglyph", stripe, {
    mode: "RED_CYAN",
    depthSource: "CONSTANT",
    convergence: 0,
    strength: 16,
  });
  if (!after) return { ok: false, reason: "Anaglyph readback failed" };
  let redPixels = 0, maxG = 0, maxB = 0;
  for (let i = 0; i < after.length; i += 4) {
    if (after[i] > 120 && after[i + 1] < 120 && after[i + 2] < 120) {
      redPixels += 1;
      maxG = Math.max(maxG, after[i + 1]);
      maxB = Math.max(maxB, after[i + 2]);
    }
  }
  if (redPixels === 0) return { ok: false, reason: "no red-eye pixels produced" };
  if (maxG > 40 || maxB > 40) {
    return { ok: false, reason: `left leaks into cyan: maxG=${maxG} maxB=${maxB}` };
  }
  return { ok: true };
};

/** Convolve's CPU and GL paths must agree at the right/bottom edges: both clamp
 *  to edge, so no wrap-around seam. */
export const runConvolveEdgeClamp = (): Result => {
  const w = 8, h = 8;
  const field = paintCanvas(w, h, (x, y) => {
    const edge = x === w - 1 || y === h - 1;
    const v = edge ? 220 : 40;
    return [v, v, v, 255];
  });
  const cpu = run("Convolve", field, { kernel: "SHARPEN_3X3", strength: 1, _webglAcceleration: false });
  const gl = run("Convolve", field, { kernel: "SHARPEN_3X3", strength: 1, _webglAcceleration: true });
  if (!cpu || !gl) return { ok: false, reason: "Convolve readback failed" };
  let maxDiff = 0;
  for (let y = 1; y < h - 1; y++) { const i = ((w - 1) + w * y) * 4; maxDiff = Math.max(maxDiff, Math.abs(cpu[i] - gl[i])); }
  for (let x = 1; x < w - 1; x++) { const i = (x + w * (h - 1)) * 4; maxDiff = Math.max(maxDiff, Math.abs(cpu[i] - gl[i])); }
  return maxDiff > 2 ? { ok: false, reason: `CPU/GL edge clamp mismatch: max diff ${maxDiff} LSB` } : { ok: true };
};

/** Halftone GL must derive each cell's dot tone from the cell AVERAGE, not a
 *  single centre texel: a half-black/half-white cell must render the same
 *  mid-tone dot as a uniformly grey cell of the same mean. */
export const runHalftoneCellAverageParity = (): Result => {
  const filter = filterIndex.Halftone as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Halftone not in registry" };
  const S = 8;
  const glRun = (paint: (x: number, y: number) => [number, number, number, number]) => {
    const out = filter.func(paintCanvas(S, S, paint), {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      size: S,
      offset: 0,
      levels: 256,
      _linearize: false,
      _webglAcceleration: true,
    }) as HTMLCanvasElement;
    return canvasPixels(out);
  };
  const grey = glRun(() => [128, 128, 128, 255]);
  const edge = glRun((x) => (x < S / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const white = glRun(() => [255, 255, 255, 255]);
  if (!grey || !edge || !white) return { ok: false, reason: "Halftone GL readback failed" };
  const gL = meanLuma(grey), eL = meanLuma(edge), wL = meanLuma(white);
  if (eL >= wL * 0.9) {
    return { ok: false, reason: `edge cell dot not mid-tone: edge=${eL.toFixed(1)} vs white=${wL.toFixed(1)} (centre point-sample?)` };
  }
  const rel = Math.abs(eL - gL) / Math.max(1, wL);
  if (rel > 0.12) {
    return { ok: false, reason: `edge cell (${eL.toFixed(1)}) != grey cell (${gL.toFixed(1)}); GL not averaging the block` };
  }
  return { ok: true };
};

/** Halftone GL must average the ENTIRE cell (striding), not a fixed top-left
 *  window: a 40px cell (> the 32-sample cap) with its first 32 columns black
 *  and the rest white has full-cell mean ~0.2; a top-left-32 window would read
 *  all black. The dot must track the full-cell mean. */
export const runHalftoneLargeCellParity = (): Result => {
  const filter = filterIndex.Halftone as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Halftone not in registry" };
  const S = 40;
  const glRun = (paint: (x: number, y: number) => [number, number, number, number]) => {
    const out = filter.func(paintCanvas(S, S, paint), {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      size: S,
      offset: 0,
      levels: 256,
      _linearize: false,
      _webglAcceleration: true,
    }) as HTMLCanvasElement;
    return canvasPixels(out);
  };
  const biased = glRun((x) => (x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const grey = glRun(() => [51, 51, 51, 255]);
  const black = glRun(() => [0, 0, 0, 255]);
  if (!biased || !grey || !black) return { ok: false, reason: "Halftone GL readback failed" };
  const bL = meanLuma(biased), gL = meanLuma(grey), kL = meanLuma(black);
  if (Math.abs(bL - gL) > Math.max(2, gL * 0.2)) {
    return { ok: false, reason: `large cell dot != full-cell mean: biased=${bL.toFixed(1)} grey0.2=${gL.toFixed(1)}` };
  }
  if (Math.abs(bL - kL) < Math.abs(bL - gL)) {
    return { ok: false, reason: `large cell dot tracks a top-left window (black=${kL.toFixed(1)}) not the full cell` };
  }
  return { ok: true };
};
