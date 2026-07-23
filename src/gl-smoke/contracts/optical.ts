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
