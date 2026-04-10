import { ACTION, BOOL, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, srgbPaletteGetColor } from "utils";

export const optionTypes = {
  columnWidth: { type: RANGE, range: [4, 20], step: 1, default: 8 },
  speed: { type: RANGE, range: [1, 20], step: 1, default: 5 },
  trailLength: { type: RANGE, range: [3, 40], step: 1, default: 20 },
  sourceInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7 },
  overlay: { type: BOOL, default: true },
  classicGreen: { type: BOOL, default: false },
  motionSensitivity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3 },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _filterFunc, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  columnWidth: optionTypes.columnWidth.default,
  speed: optionTypes.speed.default,
  trailLength: optionTypes.trailLength.default,
  sourceInfluence: optionTypes.sourceInfluence.default,
  overlay: optionTypes.overlay.default,
  classicGreen: optionTypes.classicGreen.default,
  motionSensitivity: optionTypes.motionSensitivity.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// Half-width katakana + digits + symbols from the actual Matrix films
const MATRIX_CHARS = "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ012345789Z:.*+=¦日";

// Rasterize characters to alpha bitmaps at a given cell size.
const charBitmapCache = new Map<number, Uint8Array[]>();

const getCharBitmaps = (cellSize: number): Uint8Array[] => {
  const cached = charBitmapCache.get(cellSize);
  if (cached) return cached;

  const bitmaps: Uint8Array[] = [];
  const canvas = typeof document !== "undefined"
    ? document.createElement("canvas")
    : new OffscreenCanvas(cellSize, cellSize);
  canvas.width = cellSize;
  canvas.height = cellSize;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
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
    for (let j = 0; j < alpha.length; j++) {
      alpha[j] = data[j * 4 + 3];
    }
    bitmaps.push(alpha);
  }

  charBitmapCache.set(cellSize, bitmaps);
  return bitmaps;
};

const matrixRain = (input, options: any = defaults) => {
  const {
    columnWidth, speed, trailLength, sourceInfluence,
    overlay, classicGreen, motionSensitivity, palette
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

  if (overlay) {
    // Start with the source image (dimmed slightly for contrast)
    for (let i = 0; i < buf.length; i += 4) {
      outBuf[i]     = Math.round(buf[i] * 0.4);
      outBuf[i + 1] = Math.round(buf[i + 1] * 0.4);
      outBuf[i + 2] = Math.round(buf[i + 2] * 0.4);
      outBuf[i + 3] = 255;
    }
  } else {
    // Dark background
    for (let i = 0; i < outBuf.length; i += 4) {
      outBuf[i] = 0; outBuf[i + 1] = 2; outBuf[i + 2] = 0; outBuf[i + 3] = 255;
    }
  }

  // Compute per-cell motion map from EMA if available
  const cols = Math.ceil(W / columnWidth);
  const charH = columnWidth;
  const rows = Math.ceil(H / charH);
  const charBitmaps = getCharBitmaps(columnWidth);
  const cycleLen = rows + trailLength;

  // Pre-compute per-cell motion intensity from EMA diff
  let motionMap: Float32Array | null = null;
  if (ema && motionSensitivity > 0) {
    motionMap = new Float32Array(cols * rows);
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const cx = Math.min(W - 1, col * columnWidth + (columnWidth >> 1));
        const cy = Math.min(H - 1, row * charH + (charH >> 1));
        const pi = (cx + W * cy) * 4;
        // Diff current input vs EMA (background model)
        const dr = Math.abs(buf[pi] - ema[pi]);
        const dg = Math.abs(buf[pi + 1] - ema[pi + 1]);
        const db = Math.abs(buf[pi + 2] - ema[pi + 2]);
        const motion = (dr + dg + db) / (3 * 255);
        motionMap[col + cols * row] = Math.min(1, motion * (1 / 0.15)); // normalize ~15% diff = full motion
      }
    }
  }

  const streamsPerCol = 2;

  for (let col = 0; col < cols; col++) {
    for (let stream = 0; stream < streamsPerCol; stream++) {
      const colRng = mulberry32(col * 997 + stream * 3571 + 42);

      const colSpeed = Math.max(1, Math.round(speed * (0.5 + colRng() * 1.0)));
      const phase = Math.round(colRng() * cycleLen);
      const headRow = (Math.floor(frameIndex * colSpeed / 2) + phase) % cycleLen;

      for (let row = 0; row < rows; row++) {
        const distFromHead = headRow - row;
        if (distFromHead < 0 || distFromHead > trailLength) continue;

        const cellX = col * columnWidth;
        const cellY = row * charH;
        if (cellX >= W || cellY >= H) continue;

        // Motion boost: cells with motion get brighter rain
        const cellMotion = motionMap ? motionMap[col + cols * row] : 0;
        const motionBoost = 1 + cellMotion * motionSensitivity * 3;

        // Trail fade
        const isHead = distFromHead === 0;
        const fadeFactor = isHead ? 1.0 : Math.pow(1 - distFromHead / trailLength, 1.5);
        if (fadeFactor < 0.01) continue;

        // Character changes every few frames
        const charFrame = Math.floor(frameIndex / 3);
        const charSalt = (row * 7 + col * 13 + stream * 31 + charFrame) & 0xFFFF;

        for (let dy = 0; dy < charH && cellY + dy < H; dy++) {
          for (let dx = 0; dx < columnWidth && cellX + dx < W; dx++) {
            const px = cellX + dx, py = cellY + dy;
            const pi = getBufferIndex(px, py, W);

            const srcR = buf[pi], srcG = buf[pi + 1], srcB = buf[pi + 2];
            const srcLum = (0.2126 * srcR + 0.7152 * srcG + 0.0722 * srcB) / 255;
            const effectiveLum = srcLum * sourceInfluence + (1 - sourceInfluence);

            const charBitmap = charBitmaps[charSalt % charBitmaps.length];
            const glyphAlpha = charBitmap[dy * columnWidth + dx] / 255;

            if (glyphAlpha > 0.05) {
              const brightness = Math.min(1, effectiveLum * fadeFactor * glyphAlpha * motionBoost);
              if (brightness < 0.01) continue;

              let cr: number, cg: number, cb: number;

              if (classicGreen) {
                const gi = Math.round(brightness * 230);
                cr = isHead ? Math.round(gi * 0.9) : (distFromHead <= 2 ? Math.round(gi * 0.12) : 0);
                cg = gi;
                cb = isHead ? Math.round(gi * 0.6) : (distFromHead <= 2 ? Math.round(gi * 0.04) : 0);
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
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Matrix Rain", func: matrixRain, optionTypes, options: defaults, defaults, description: "Digital rain with source overlay and motion-reactive intensity" };
