import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  columnWidth: { type: RANGE, range: [4, 20], step: 1, default: 8 },
  speed: { type: RANGE, range: [1, 20], step: 1, default: 5 },
  density: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6 },
  trailLength: { type: RANGE, range: [3, 30], step: 1, default: 15 },
  brightness: { type: RANGE, range: [0.5, 2], step: 0.1, default: 1.2 },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _filterFunc, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  columnWidth: optionTypes.columnWidth.default,
  speed: optionTypes.speed.default,
  density: optionTypes.density.default,
  trailLength: optionTypes.trailLength.default,
  brightness: optionTypes.brightness.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// Katakana-like character set rendered as brightness patterns
const CHAR_PATTERNS = (() => {
  const patterns: number[][] = [];
  const rng = mulberry32(42);
  for (let i = 0; i < 64; i++) {
    const p: number[] = [];
    for (let j = 0; j < 16; j++) p.push(rng() > 0.5 ? 1 : 0);
    patterns.push(p);
  }
  return patterns;
})();

const matrixRain = (input, options: any = defaults) => {
  const { columnWidth, speed, density, trailLength, brightness, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Dark background
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = 0; outBuf[i + 1] = 5; outBuf[i + 2] = 0; outBuf[i + 3] = 255;
  }

  const cols = Math.ceil(W / columnWidth);
  const charH = Math.max(4, columnWidth);
  const rows = Math.ceil(H / charH);

  // Per-column rain state (deterministic from seed)
  for (let col = 0; col < cols; col++) {
    const colRng = mulberry32(col * 997 + 42);
    if (colRng() > density) continue;

    // Rain head position (moves down over time)
    const colSpeed = Math.round(speed * (0.5 + colRng() * 1));
    const headRow = (frameIndex * colSpeed + Math.round(colRng() * rows * 3)) % (rows + trailLength);

    for (let row = 0; row < rows; row++) {
      const distFromHead = headRow - row;
      if (distFromHead < 0 || distFromHead > trailLength) continue;

      // Brightness: head is brightest, trail fades
      const fadeFactor = distFromHead === 0 ? 1.5 : Math.max(0, 1 - distFromHead / trailLength);

      // Sample input luminance at this cell
      const cellX = col * columnWidth;
      const cellY = row * charH;
      if (cellX >= W || cellY >= H) continue;
      const si = getBufferIndex(Math.min(W - 1, cellX + columnWidth / 2), Math.min(H - 1, cellY + charH / 2), W);
      const srcLum = (0.2126 * buf[si] + 0.7152 * buf[si + 1] + 0.0722 * buf[si + 2]) / 255;

      // Character pattern
      const charIdx = (row * 7 + col * 13 + frameIndex) % CHAR_PATTERNS.length;
      const pattern = CHAR_PATTERNS[charIdx];

      // Draw character cell
      for (let dy = 0; dy < charH && cellY + dy < H; dy++) {
        for (let dx = 0; dx < columnWidth && cellX + dx < W; dx++) {
          const patIdx = (Math.floor(dy / (charH / 4)) * 4 + Math.floor(dx / (columnWidth / 4))) % pattern.length;
          const charBit = pattern[patIdx];

          if (charBit > 0) {
            const greenIntensity = fadeFactor * brightness * (0.5 + srcLum * 0.5);
            const gi = Math.max(0, Math.min(255, Math.round(greenIntensity * 200)));
            const ri = distFromHead === 0 ? Math.round(gi * 0.8) : 0; // Head is whiter
            const bi = distFromHead === 0 ? Math.round(gi * 0.3) : 0;

            const di = getBufferIndex(cellX + dx, cellY + dy, W);
            const color = paletteGetColor(palette, rgba(ri, gi, bi, 255), palette.options, false);
            fillBufferPixel(outBuf, di, color[0], color[1], color[2], 255);
          }
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Matrix Rain", func: matrixRain, optionTypes, options: defaults, defaults };
