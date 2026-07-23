import { filterIndex } from "@gyng/ditherer-filters";
import { canvasPixels, runtimeOptions } from "../fixtures";
import type { FilterLike } from "../types";

type Result = { ok: true } | { ok: false; reason: string };

/**
 * Anamorphic Cylinder must map the annulus radius LINEARLY to the source height
 * (the reflection law), not logarithmically. On a vertical black→white source,
 * the ring at the midpoint radius must sample the middle of the image (~mid
 * grey), and the rings step monotonically near→far. The old log map would put
 * the midpoint tone off-centre.
 */
export const runAnamorphicLinearRadial = (): Result => {
  const filter = filterIndex["Anamorphic Cylinder"] as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Anamorphic Cylinder missing from registry" };

  const w = 200, h = 200, cylR = 30, maxR = 90;
  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  const ctx = src.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: "gradient fixture has no 2d context" };
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    const lum = Math.round((y / (h - 1)) * 255); // top black, bottom white
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      img.data[o] = lum; img.data[o + 1] = lum; img.data[o + 2] = lum; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const out = canvasPixels(filter.func(src, {
    ...(filter.defaults ?? {}), ...runtimeOptions(),
    cylinderRadius: cylR, maxRadius: maxR, twist: 0,
  }) as HTMLCanvasElement);
  if (!out) return { ok: false, reason: "Anamorphic Cylinder readback failed" };

  const cx = w / 2, cy = h / 2;
  const ringLuma = (radius: number): number => {
    let sum = 0, n = 0;
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const px = Math.round(cx + radius * Math.cos(rad));
      const py = Math.round(cy + radius * Math.sin(rad));
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = (py * w + px) * 4;
      sum += 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]; n += 1;
    }
    return n ? sum / n : -1;
  };

  // v = (maxR - r)/(maxR - cylR): near wall (r=35) -> v~0.92 (bright);
  // mid (r=60) -> v=0.5 (mid grey); far (r=85) -> v~0.08 (dark).
  const near = ringLuma(35), mid = ringLuma(60), far = ringLuma(85);
  if (near < 0 || mid < 0 || far < 0) return { ok: false, reason: "ring sampling failed" };
  if (!(near > mid && mid > far)) {
    return { ok: false, reason: `radial gradient not monotone (near ${near.toFixed(0)}, mid ${mid.toFixed(0)}, far ${far.toFixed(0)})` };
  }
  // Linear map => the midpoint radius samples ~mid grey (128). A log map would
  // pull this well off-centre.
  if (Math.abs(mid - 128) > 22) {
    return { ok: false, reason: `midpoint radius not linear (mid-ring luma ${mid.toFixed(0)}, expected ~128)` };
  }
  return { ok: true };
};

/**
 * Stamp must concentrate ink break-up at shape EDGES (distance-to-edge), not
 * spray uniform white noise. On a solid dark die, the boundary band must average
 * lighter (more ink flaked to paper) than the deep interior, and source alpha is
 * preserved. The old white-noise implementation broke up uniformly and fails
 * the edge-vs-interior contrast.
 */
export const runStampEdgeBreakup = (): Result => {
  const filter = filterIndex.Stamp as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Stamp missing from registry" };
  const w = 64, h = 64, lo = 14, hi = 50; // dark die square [lo, hi)

  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  const ctx = src.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: "die fixture has no 2d context" };
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const inDie = x >= lo && x < hi && y >= lo && y < hi;
    const o = (y * w + x) * 4;
    const v = inDie ? 20 : 245;
    img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v;
    img.data[o + 3] = inDie ? 130 : 255; // varying alpha
  }
  ctx.putImageData(img, 0, 0);
  const expectedAlpha = ctx.getImageData(0, 0, w, h).data;

  const out = canvasPixels(filter.func(src, {
    ...(filter.defaults ?? {}), ...runtimeOptions(),
    threshold: 136, roughness: 0.7,
  }) as HTMLCanvasElement);
  if (!out) return { ok: false, reason: "Stamp readback failed" };

  // mode "edge": average the `band`-px boundary ring; mode "core": average the
  // interior inset by `band` px.
  const meanLuma = (band: number, mode: "edge" | "core"): number => {
    let sum = 0, n = 0;
    for (let y = lo; y < hi; y += 1) for (let x = lo; x < hi; x += 1) {
      const nearEdge = x < lo + band || x >= hi - band || y < lo + band || y >= hi - band;
      if (mode === "edge" ? !nearEdge : nearEdge) continue;
      const i = (y * w + x) * 4;
      sum += 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]; n += 1;
    }
    return n ? sum / n : -1;
  };
  const interior = meanLuma(6, "core"); // deep interior, >6px from any edge
  const edgeBand = meanLuma(3, "edge"); // 3px boundary band
  if (interior < 0 || edgeBand < 0) return { ok: false, reason: "die sampling failed" };
  if (!(interior < 120)) {
    return { ok: false, reason: `die interior not solid ink (luma ${interior.toFixed(0)})` };
  }
  if (!(edgeBand > interior + 12)) {
    return { ok: false, reason: `break-up not concentrated at edges (edge ${edgeBand.toFixed(0)} vs interior ${interior.toFixed(0)})` };
  }
  for (let i = 3; i < out.length; i += 4) {
    if (Math.abs(out[i] - expectedAlpha[i]) > 2) {
      return { ok: false, reason: `Stamp altered alpha at ${i}: ${expectedAlpha[i]} -> ${out[i]}` };
    }
  }
  return { ok: true };
};
