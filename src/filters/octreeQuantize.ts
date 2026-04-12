import { RANGE, ENUM } from "constants/controlTypes";
import { cloneCanvas, fillBufferPixel, getBufferIndex } from "utils";
import { defineFilter } from "filters/types";

const REDUCE = {
  POPULARITY: "POPULARITY",
  MERGE: "MERGE"
};

type OctreeNode = {
  children: Array<OctreeNode | null>;
  isLeaf: boolean;
  pixelCount: number;
  rSum: number;
  gSum: number;
  bSum: number;
  level: number;
  nextReducible: OctreeNode | null;
};

const createNode = (level: number, leafLevel: number): OctreeNode => ({
  children: [null, null, null, null, null, null, null, null],
  isLeaf: level === leafLevel,
  pixelCount: 0,
  rSum: 0,
  gSum: 0,
  bSum: 0,
  level,
  nextReducible: null
});

const colorIndexForLevel = (r: number, g: number, b: number, level: number) => {
  const shift = 7 - level;
  return (
    (((r >> shift) & 1) << 2) |
    (((g >> shift) & 1) << 1) |
    ((b >> shift) & 1)
  );
};

const collectLeaves = (node: OctreeNode, out: OctreeNode[]) => {
  if (node.isLeaf) {
    if (node.pixelCount > 0) out.push(node);
    return;
  }

  for (let i = 0; i < 8; i += 1) {
    const child = node.children[i];
    if (child) collectLeaves(child, out);
  }
};

const nearestColor = (pixel: number[], palette: number[][]) => {
  let best = palette[0];
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const color = palette[i];
    const d =
      (pixel[0] - color[0]) ** 2 +
      (pixel[1] - color[1]) ** 2 +
      (pixel[2] - color[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = color;
    }
  }
  return best;
};

export const optionTypes = {
  levels: { type: RANGE, range: [2, 64], step: 1, default: 12, desc: "Maximum number of colors kept after octree reduction" },
  sampleRate: { type: RANGE, range: [1, 16], step: 1, default: 2, desc: "Use every Nth source pixel while building the octree" },
  reduceMode: {
    type: ENUM,
    options: [
      { name: "Merge sparse leaves", value: REDUCE.MERGE },
      { name: "Favor popular leaves", value: REDUCE.POPULARITY }
    ],
    default: REDUCE.MERGE,
    desc: "How the octree chooses which branches to collapse when shrinking the palette"
  }
};

export const defaults = {
  levels: optionTypes.levels.default,
  sampleRate: optionTypes.sampleRate.default,
  reduceMode: optionTypes.reduceMode.default
};

const octreeQuantize = (input: any, options = defaults) => {
  const { levels, sampleRate, reduceMode } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const maxColors = Math.max(2, Math.round(levels));
  const leafLevel = 7;
  const reducible: Array<OctreeNode | null> = Array.from({ length: leafLevel }, (): OctreeNode | null => null);
  const root = createNode(0, leafLevel);
  let leafCount = 0;

  const registerReducible = (node: OctreeNode) => {
    node.nextReducible = reducible[node.level];
    reducible[node.level] = node;
  };

  const insertColor = (node: OctreeNode, r: number, g: number, b: number) => {
    if (node.isLeaf) {
      node.pixelCount += 1;
      node.rSum += r;
      node.gSum += g;
      node.bSum += b;
      return;
    }

    const index = colorIndexForLevel(r, g, b, node.level);
    if (!node.children[index]) {
      const child = createNode(node.level + 1, leafLevel);
      node.children[index] = child;
      if (child.isLeaf) leafCount += 1;
      else registerReducible(child);
    }
    insertColor(node.children[index] as OctreeNode, r, g, b);
  };

  const reduceTree = () => {
    for (let level = leafLevel - 1; level >= 0; level -= 1) {
      let best: OctreeNode | null = null;
      let bestPrev: OctreeNode | null = null;
      let prev: OctreeNode | null = null;
      let node = reducible[level];

      while (node) {
        const score = reduceMode === REDUCE.POPULARITY ? node.pixelCount : -node.pixelCount;
        const bestScore = best
          ? (reduceMode === REDUCE.POPULARITY ? best.pixelCount : -best.pixelCount)
          : -Infinity;
        if (!best || score > bestScore) {
          best = node;
          bestPrev = prev;
        }
        prev = node;
        node = node.nextReducible;
      }

      if (!best) continue;

      if (bestPrev) bestPrev.nextReducible = best.nextReducible;
      else reducible[level] = best.nextReducible;

      let childLeaves = 0;
      for (let i = 0; i < 8; i += 1) {
        const child = best.children[i];
        if (!child) continue;
        best.rSum += child.rSum;
        best.gSum += child.gSum;
        best.bSum += child.bSum;
        best.pixelCount += child.pixelCount;
        if (child.isLeaf) childLeaves += 1;
      }

      best.children = [null, null, null, null, null, null, null, null];
      best.isLeaf = true;
      leafCount -= Math.max(0, childLeaves - 1);
      return;
    }
  };

  const step = Math.max(1, Math.round(sampleRate));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = getBufferIndex(x, y, width);
      if (buf[i + 3] === 0) continue;
      insertColor(root, buf[i], buf[i + 1], buf[i + 2]);
      while (leafCount > maxColors) reduceTree();
    }
  }

  const paletteLeaves: OctreeNode[] = [];
  collectLeaves(root, paletteLeaves);
  const palette = paletteLeaves
    .filter(node => node.pixelCount > 0)
    .map(node => [
      Math.round(node.rSum / node.pixelCount),
      Math.round(node.gSum / node.pixelCount),
      Math.round(node.bSum / node.pixelCount)
    ]);

  const resolvedPalette = palette.length > 0 ? palette : [[0, 0, 0]];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      const color = nearestColor([buf[i], buf[i + 1], buf[i + 2]], resolvedPalette);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Octree Quantize",
  func: octreeQuantize,
  optionTypes,
  options: defaults,
  defaults,
  description: "Adaptive palette reduction using octree subdivision, with a different bias than median-cut"
});
