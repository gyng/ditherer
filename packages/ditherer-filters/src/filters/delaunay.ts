import { RANGE, BOOL, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor, logFilterBackend } from "../utils/index";
import { computeLuminance, sobelEdges } from "../utils/edges";
import { defineFilter } from "./types";

// Upper bound that the audio-modulation path can't push past. Bowyer-Watson
// is O(n²) in the bad-triangle edge-sharing inner loop, and in pathological
// inputs (duplicate/nearly-collinear points) the constant gets large enough
// to trip Firefox's slow-script timeout. 800 tops out around 400ms on a
// modern laptop; above that we saw slideshow chains hang on beat spikes.
const POINT_COUNT_CAP = 800;

export const optionTypes = {
  pointCount: { type: RANGE, range: [50, POINT_COUNT_CAP], step: 10, default: 300, desc: "Number of triangulation vertices" },
  edgeWeight: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Bias points toward image edges vs random" },
  showEdges: { type: BOOL, default: false, desc: "Draw triangle outlines" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for point placement" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
};

export const defaults = {
  pointCount: optionTypes.pointCount.default,
  edgeWeight: optionTypes.edgeWeight.default,
  showEdges: optionTypes.showEdges.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// Simple Bowyer-Watson Delaunay triangulation
const triangulate = (points: { x: number; y: number }[], W: number, H: number) => {
  type Tri = [number, number, number];
  const triangles: Tri[] = [];

  // Super-triangle encompassing all points
  const margin = Math.max(W, H) * 2;
  const superPts = [
    { x: -margin, y: -margin },
    { x: W + margin * 2, y: -margin },
    { x: W / 2, y: H + margin * 2 }
  ];
  const allPts = [...superPts, ...points];
  triangles.push([0, 1, 2]);

  const circumscribes = (tri: Tri, px: number, py: number) => {
    const [ai, bi, ci] = tri;
    const ax = allPts[ai].x, ay = allPts[ai].y;
    const bx = allPts[bi].x, by = allPts[bi].y;
    const cx = allPts[ci].x, cy = allPts[ci].y;
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return false;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
    return (px - ux) * (px - ux) + (py - uy) * (py - uy) < r2;
  };

  for (let i = 3; i < allPts.length; i++) {
    const { x, y } = allPts[i];
    const bad: Tri[] = [];
    for (const tri of triangles) {
      if (circumscribes(tri, x, y)) bad.push(tri);
    }

    // Find boundary polygon
    const edges: [number, number][] = [];
    for (const tri of bad) {
      const triEdges: [number, number][] = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
      for (const [a, b] of triEdges) {
        const shared = bad.some(t => t !== tri &&
          ((t[0] === a || t[1] === a || t[2] === a) && (t[0] === b || t[1] === b || t[2] === b)));
        if (!shared) edges.push([a, b]);
      }
    }

    // Remove bad triangles
    for (const tri of bad) {
      const idx = triangles.indexOf(tri);
      if (idx !== -1) triangles.splice(idx, 1);
    }

    // Create new triangles
    for (const [a, b] of edges) {
      triangles.push([a, b, i]);
    }
  }

  // Remove triangles that share vertices with super-triangle
  return { triangles: triangles.filter(t => t[0] > 2 && t[1] > 2 && t[2] > 2), points: allPts };
};

const barycentricAt = (
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): [number, number, number] | null => {
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denominator) < 1e-9) return null;
  const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator;
  const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator;
  const w = 1 - u - v;
  return u >= -1e-7 && v >= -1e-7 && w >= -1e-7 ? [u, v, w] : null;
};

const delaunay = (input: any, options = defaults) => {
  const normalized = { ...defaults, ...options };
  const pointCount = Number(normalized.pointCount) || defaults.pointCount;
  const edgeWeight = Math.max(0, Math.min(1, Number(normalized.edgeWeight) || 0));
  const showEdges = Boolean(normalized.showEdges);
  const seed = Number(normalized.seed) || 0;
  const palette = normalized.palette ?? defaults.palette;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(seed);

  if (W <= 1 || H <= 1) {
    outputCtx.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
    return output;
  }

  // Performance guard: cap points for large images, and clamp against the
  // module-level ceiling in case audio modulation pushed the raw pointCount
  // above the option range (modulation bypasses the slider bounds).
  const totalPixels = W * H;
  const cap = Math.min(POINT_COUNT_CAP, totalPixels > 500000 ? 500 : POINT_COUNT_CAP);
  const effectivePoints = Math.max(4, Math.min(pointCount | 0, cap));
  // The slider still reads 800 while we quietly render 500, so say so rather
  // than leaving the user to wonder why the control stopped doing anything.
  if (effectivePoints < (pointCount | 0)) {
    logFilterBackend(
      "Delaunay",
      "JS",
      `points=${effectivePoints}<-${pointCount | 0} (capped for ${W}x${H} image)`,
    );
  }

  // Generate points weighted toward edges
  const lum = computeLuminance(buf, W, H);
  const { magnitude } = sobelEdges(lum, W, H);

  // A Delaunay triangulation covers the convex hull of its sites. Reserve the
  // four raster corners so that hull is the complete image rather than a
  // random inset polygon, then deduplicate stochastic sites.
  const points: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: W - 1, y: 0 },
    { x: W - 1, y: H - 1 },
    { x: 0, y: H - 1 },
  ];
  const occupied = new Set(points.map(point => `${point.x},${point.y}`));
  const randomPointCount = Math.max(0, effectivePoints - points.length);
  let attempts = 0;
  while (points.length < effectivePoints && attempts < Math.max(32, randomPointCount * 8)) {
    attempts++;
    let candidate: { x: number; y: number };
    if (rng() < edgeWeight) {
      // Edge-biased: try several random positions, pick the one with highest edge magnitude
      let bestX = 0, bestY = 0, bestMag = -1;
      for (let attempt = 0; attempt < 5; attempt++) {
        const x = Math.floor(rng() * W);
        const y = Math.floor(rng() * H);
        if (magnitude[y * W + x] > bestMag) {
          bestMag = magnitude[y * W + x]; bestX = x; bestY = y;
        }
      }
      candidate = { x: bestX, y: bestY };
    } else {
      candidate = { x: Math.floor(rng() * W), y: Math.floor(rng() * H) };
    }
    const key = `${candidate.x},${candidate.y}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    points.push(candidate);
  }

  const { triangles, points: allPts } = triangulate(points, W, H);

  const assigned = new Uint8Array(W * H);
  // Build per-pixel triangle assignment via bounded rasterization.
  for (const tri of triangles) {
    const [ai, bi, ci] = tri;
    const ax = allPts[ai].x, ay = allPts[ai].y;
    const bx = allPts[bi].x, by = allPts[bi].y;
    const cx = allPts[ci].x, cy = allPts[ci].y;

    // Bounding box
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));

    // Alpha-weighted visible mean: hidden RGB must not steer a pane color.
    let sr = 0, sg = 0, sb = 0, weight = 0;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        if (!barycentricAt(x, y, ax, ay, bx, by, cx, cy)) continue;
        const si = getBufferIndex(x, y, W);
        const alphaWeight = (buf[si + 3] ?? 0) / 255;
        if (alphaWeight <= 0) continue;
        sr += buf[si] * alphaWeight;
        sg += buf[si + 1] * alphaWeight;
        sb += buf[si + 2] * alphaWeight;
        weight += alphaWeight;
      }

    const avgR = weight > 0 ? Math.round(sr / weight) : 0;
    const avgG = weight > 0 ? Math.round(sg / weight) : 0;
    const avgB = weight > 0 ? Math.round(sb / weight) : 0;
    const mapped = paletteGetColor(palette, rgba(avgR, avgG, avgB, 255), palette.options, false);

    // Fill triangle
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const barycentric = barycentricAt(x, y, ax, ay, bx, by, cx, cy);
        if (!barycentric) continue;
        const [u, v, w] = barycentric;

        const di = getBufferIndex(x, y, W);
        assigned[y * W + x] = 1;
        const alpha = buf[di + 3] ?? 0;
        // Edge detection: near triangle boundary
        const isNearEdge = showEdges && (u < 0.02 || v < 0.02 || w < 0.02);
        if (isNearEdge) {
          fillBufferPixel(outBuf, di, 30, 30, 30, alpha);
        } else {
          fillBufferPixel(outBuf, di, mapped[0], mapped[1], mapped[2], alpha);
        }
      }
  }

  // Defensive numerical fallback. Corner hull sites should cover every raster
  // sample; retaining the source here prevents a future precision regression
  // from turning an unassigned pixel into a transparent crack.
  for (let pixel = 0; pixel < assigned.length; pixel++) {
    if (assigned[pixel]) continue;
    const offset = pixel * 4;
    fillBufferPixel(outBuf, offset, buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Delaunay",
  func: delaunay,
  optionTypes,
  options: defaults,
  defaults,
  noWASM: "Bowyer-Watson triangulation is an incremental pointer-chasing algorithm with per-insertion work dominated by bad-triangle searches — no parallelism to unlock.",
  noGL: "Triangulation is irreducibly sequential; even rendering the per-triangle fills from CPU-computed triangles would be dwarfed by the triangulation itself.",
});
