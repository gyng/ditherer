import { RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";

export const optionTypes = {
  pointCount: { type: RANGE, range: [50, 2000], step: 10, default: 300, desc: "Number of triangulation vertices" },
  edgeWeight: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Bias points toward image edges vs random" },
  showEdges: { type: BOOL, default: false, desc: "Draw triangle outlines" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for point placement" },
  palette: { type: PALETTE, default: nearest }
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

const delaunay = (input, options: any = defaults) => {
  const { pointCount, edgeWeight, showEdges, seed, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(seed);

  // Performance guard: cap points for large images
  const totalPixels = W * H;
  const effectivePoints = totalPixels > 500000 ? Math.min(pointCount, 500) : pointCount;

  // Generate points weighted toward edges
  const lum = computeLuminance(buf, W, H);
  const { magnitude } = sobelEdges(lum, W, H);

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < effectivePoints; i++) {
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
      points.push({ x: bestX, y: bestY });
    } else {
      points.push({ x: Math.floor(rng() * W), y: Math.floor(rng() * H) });
    }
  }

  const { triangles, points: allPts } = triangulate(points, W, H);

  // For each pixel, find which triangle it belongs to and fill with average color
  // Build per-pixel triangle assignment via scanline rasterization
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

    // Average color of triangle
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        // Barycentric test
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 0.001) continue;
        const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
        const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
        const w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        const si = getBufferIndex(x, y, W);
        sr += buf[si]; sg += buf[si + 1]; sb += buf[si + 2]; cnt++;
      }

    if (cnt === 0) continue;
    const avgR = Math.round(sr / cnt), avgG = Math.round(sg / cnt), avgB = Math.round(sb / cnt);

    // Fill triangle
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 0.001) continue;
        const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
        const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
        const w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;

        const di = getBufferIndex(x, y, W);
        // Edge detection: near triangle boundary
        const isNearEdge = showEdges && (u < 0.02 || v < 0.02 || w < 0.02);
        if (isNearEdge) {
          fillBufferPixel(outBuf, di, 30, 30, 30, 255);
        } else {
          const color = paletteGetColor(palette, rgba(avgR, avgG, avgB, 255), palette.options, false);
          fillBufferPixel(outBuf, di, color[0], color[1], color[2], 255);
        }
      }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Delaunay", func: delaunay, optionTypes, options: defaults, defaults };
