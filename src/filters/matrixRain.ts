import { ACTION, BOOL, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, srgbPaletteGetColor } from "utils";

export const optionTypes = {
  columnWidth: { type: RANGE, range: [4, 20], step: 1, default: 10, desc: "Width of each character cell in pixels" },
  speed: { type: RANGE, range: [1, 20], step: 1, default: 5, desc: "How fast rain streams fall" },
  trailLength: { type: RANGE, range: [3, 40], step: 1, default: 16, desc: "Number of lit characters behind each rain head" },
  density: { type: RANGE, range: [0.05, 1], step: 0.05, default: 0.8, desc: "Fraction of columns that have rain streams" },
  sourceInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "How much the source image brightness drives glyph intensity" },
  classicGreen: { type: BOOL, default: false, desc: "Use authentic Matrix green palette instead of source colors" },
  motionSensitivity: { type: RANGE, range: [0, 3], step: 0.1, default: 0.3, desc: "Rain reacts to motion — high values show rain only where movement is detected" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12, desc: "Animation frames per second" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _filterFunc, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  columnWidth: optionTypes.columnWidth.default,
  speed: optionTypes.speed.default,
  trailLength: optionTypes.trailLength.default,
  density: optionTypes.density.default,
  sourceInfluence: optionTypes.sourceInfluence.default,
  classicGreen: optionTypes.classicGreen.default,
  motionSensitivity: optionTypes.motionSensitivity.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// Half-width katakana + digits + symbols from the Matrix films
const MATRIX_CHARS = "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ012345789Z:.*+=¦日";

// Rasterize characters to alpha bitmaps at a given cell size.
const charBitmapCache = new Map<number, Uint8Array[]>();

const getCharBitmaps = (cellSize: number): Uint8Array[] => {
  const cached = charBitmapCache.get(cellSize);
  if (cached) return cached;

  const bitmaps: Uint8Array[] = [];
  const c = typeof document !== "undefined"
    ? document.createElement("canvas")
    : new OffscreenCanvas(cellSize, cellSize);
  c.width = cellSize;
  c.height = cellSize;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) return bitmaps;

  const fontSize = Math.max(6, cellSize - 1);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < MATRIX_CHARS.length; i++) {
    ctx.clearRect(0, 0, cellSize, cellSize);
    ctx.fillStyle = "white";
    ctx.fillText(MATRIX_CHARS[i], cellSize / 2, cellSize / 2 + 1);
    const data = ctx.getImageData(0, 0, cellSize, cellSize).data;
    const alpha = new Uint8Array(cellSize * cellSize);
    for (let j = 0; j < alpha.length; j++) alpha[j] = data[j * 4 + 3];
    bitmaps.push(alpha);
  }

  charBitmapCache.set(cellSize, bitmaps);
  return bitmaps;
};

// Pre-compute a static character assignment per cell and its cycle speed.
// Characters are fixed on the grid; only illumination moves.
const getCellGrid = (cols: number, rows: number) => {
  const grid = new Uint8Array(cols * rows);    // character index
  const cyclePeriod = new Uint8Array(cols * rows); // frames between char changes (0 = static)
  const rng = mulberry32(0xCAFE);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.floor(rng() * MATRIX_CHARS.length);
    // ~30% of cells cycle characters, rest are static
    cyclePeriod[i] = rng() < 0.3 ? (2 + Math.floor(rng() * 6)) : 0;
  }
  return { grid, cyclePeriod };
};

let cachedCellGrid: { cols: number; rows: number; grid: Uint8Array; cyclePeriod: Uint8Array } | null = null;

const matrixRain = (input, options: any = defaults) => {
  const {
    columnWidth, speed, trailLength, density,
    sourceInfluence, classicGreen, motionSensitivity, palette
  } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const ema: Float32Array | null = (options as any)._ema || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const cols = Math.ceil(W / columnWidth);
  const charH = columnWidth;
  const rows = Math.ceil(H / charH);
  const charBitmaps = getCharBitmaps(columnWidth);
  if (charBitmaps.length === 0) return input;

  // Dark background
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = 0; outBuf[i + 1] = 2; outBuf[i + 2] = 0; outBuf[i + 3] = 255;
  }

  // Static character grid — characters are fixed, illumination sweeps down
  if (!cachedCellGrid || cachedCellGrid.cols !== cols || cachedCellGrid.rows !== rows) {
    const g = getCellGrid(cols, rows);
    cachedCellGrid = { cols, rows, ...g };
  }
  const { grid: cellGrid, cyclePeriod } = cachedCellGrid;

  // Per-column rain parameters (deterministic)
  const colSeeds: { speed: number; phases: number[] }[] = [];
  const streamsPerCol = 2;
  const cycleLen = rows + trailLength;
  for (let col = 0; col < cols; col++) {
    const colRng = mulberry32(col * 997 + 42);
    // Density controls what fraction of columns have rain
    if (colRng() > density) {
      colSeeds.push({ speed: 0, phases: [] });
      continue;
    }
    const phases: number[] = [];
    for (let s = 0; s < streamsPerCol; s++) {
      phases.push(Math.round(colRng() * cycleLen));
    }
    colSeeds.push({
      speed: Math.max(1, Math.round(speed * (0.5 + colRng() * 1.0))),
      phases,
    });
  }

  // Pre-compute per-cell motion from EMA
  let motionMap: Float32Array | null = null;
  if (ema && motionSensitivity > 0) {
    motionMap = new Float32Array(cols * rows);
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const cx = Math.min(W - 1, col * columnWidth + (columnWidth >> 1));
        const cy = Math.min(H - 1, row * charH + (charH >> 1));
        const pi = (cx + W * cy) * 4;
        const dr = Math.abs(buf[pi] - ema[pi]);
        const dg = Math.abs(buf[pi + 1] - ema[pi + 1]);
        const db = Math.abs(buf[pi + 2] - ema[pi + 2]);
        motionMap[col + cols * row] = Math.min(1, (dr + dg + db) / (3 * 38));
      }
    }
  }

  // Illumination pass — sweep "rain waves" down each column
  // Each cell gets an illumination value (0 = dark, 1 = head-bright)
  const illumination = new Float32Array(cols * rows);

  for (let col = 0; col < cols; col++) {
    const { speed: colSpeed, phases } = colSeeds[col];
    if (colSpeed === 0) continue; // column skipped by density
    for (let s = 0; s < streamsPerCol; s++) {
      const headRow = (Math.floor(frameIndex * colSpeed / 2) + phases[s]) % cycleLen;
      for (let row = 0; row < rows; row++) {
        const dist = headRow - row;
        if (dist < 0 || dist > trailLength) continue;

        let illum: number;
        if (dist === 0) {
          illum = 1.5; // head is extra bright (will be clamped by color logic)
        } else if (dist === 1) {
          illum = 1.0;
        } else {
          illum = Math.pow(1 - dist / trailLength, 1.8);
        }

        // Motion gating: at high sensitivity, rain only appears where
        // there's movement. At 0, rain falls everywhere normally.
        if (motionMap && motionSensitivity > 0) {
          const motion = motionMap[col + cols * row];
          // Blend between always-on (sensitivity=0) and motion-gated (sensitivity=1)
          const gate = (1 - motionSensitivity) + motion * motionSensitivity * 4;
          illum *= Math.min(gate, 2);
        }

        const idx = col + cols * row;
        illumination[idx] = Math.max(illumination[idx], illum);
      }
    }
  }

  // Render characters — fixed grid, modulated by illumination and source
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const cellIdx = col + cols * row;
      const illum = illumination[cellIdx];
      if (illum < 0.01) continue;

      const cellX = col * columnWidth;
      const cellY = row * charH;
      if (cellX >= W || cellY >= H) continue;

      // Character: static grid with optional cycling
      let charIdx = cellGrid[cellIdx];
      const period = cyclePeriod[cellIdx];
      if (period > 0) {
        charIdx = (charIdx + Math.floor(frameIndex / period)) % charBitmaps.length;
      }
      const charBitmap = charBitmaps[charIdx];

      const isHead = illum > 1.2;
      const isNearHead = illum > 0.9 && !isHead;

      for (let dy = 0; dy < charH && cellY + dy < H; dy++) {
        for (let dx = 0; dx < columnWidth && cellX + dx < W; dx++) {
          const glyphAlpha = charBitmap[dy * columnWidth + dx] / 255;
          if (glyphAlpha < 0.05) continue;

          const px = cellX + dx, py = cellY + dy;
          const pi = getBufferIndex(px, py, W);

          const srcR = buf[pi], srcG = buf[pi + 1], srcB = buf[pi + 2];
          const srcLum = (0.2126 * srcR + 0.7152 * srcG + 0.0722 * srcB) / 255;
          const effectiveLum = srcLum * sourceInfluence + (1 - sourceInfluence);

          const brightness = Math.min(1, effectiveLum * Math.min(illum, 1) * glyphAlpha);
          if (brightness < 0.01) continue;

          let cr: number, cg: number, cb: number;

          if (classicGreen) {
            // Colors referenced from Rezmason/matrix:
            // trail: hsl(108°, 90%, L), head/cursor: hsl(87°, 100%, 73%)
            if (isHead) {
              // Cursor: bright yellow-green white
              const v = Math.round(brightness * 255);
              cr = Math.round(v * 0.70); cg = v; cb = Math.round(v * 0.46);
            } else if (isNearHead) {
              const v = Math.round(brightness * 230);
              cr = Math.round(v * 0.05); cg = v; cb = Math.round(v * 0.05);
            } else {
              // Trail: deep saturated green
              const v = Math.round(brightness * 180);
              cr = Math.round(v * 0.05); cg = v; cb = Math.round(v * 0.05);
            }
          } else {
            const scale = brightness * 230 / Math.max(1, Math.max(srcR, srcG, srcB));
            cr = Math.round(srcR * scale);
            cg = Math.round(srcG * scale);
            cb = Math.round(srcB * scale);
            if (isHead) {
              const headLum = Math.round(brightness * 230);
              cr = Math.round(cr * 0.3 + headLum * 0.7);
              cg = Math.round(cg * 0.3 + headLum * 0.7);
              cb = Math.round(cb * 0.3 + headLum * 0.7);
            }
          }

          cr = Math.max(0, Math.min(255, cr));
          cg = Math.max(0, Math.min(255, cg));
          cb = Math.max(0, Math.min(255, cb));
          if (cr < 3 && cg < 3 && cb < 3) continue;

          // Additive: glow over background (brighter chars win)
          const di = getBufferIndex(px, py, W);
          const curLum = outBuf[di] + outBuf[di + 1] + outBuf[di + 2];
          const newLum = cr + cg + cb;
          if (newLum > curLum) {
            const color = srgbPaletteGetColor(palette, [cr, cg, cb, 255], palette.options);
            fillBufferPixel(outBuf, di, color[0], color[1], color[2], 255);
          }
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Matrix Rain", func: matrixRain, optionTypes, options: defaults, defaults, description: "Digital rain — static character grid with illumination sweep, source overlay, and motion reactivity" };
