import { ACTION, BOOL, ENUM, RANGE, PALETTE, TEXT } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { CHARSET, SHARED_CHARSET_GROUPS, getCharsetString } from "./charsets";
import { cloneCanvas, fillBufferPixel, getBufferIndex, srgbPaletteGetColor, logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { matrixRainGLAvailable, renderMatrixRainGL } from "./matrixRainGL";

const MOTION_MODE = {
  GATE: "GATE",
  TRIGGER_DROPS: "TRIGGER_DROPS",
} as const;

const CUSTOM_CHARSET = "CUSTOM";

type MatrixRainPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type MatrixRainOptions = FilterOptionValues & {
  columnWidth?: number;
  columnSizeVariation?: number;
  characterSizeVariation?: number;
  characterFlip?: number;
  speed?: number;
  trailLength?: number;
  density?: number;
  columnOverlap?: number;
  charset?: string;
  customCharset?: string;
  sourceInfluence?: number;
  classicGreen?: boolean;
  motionMode?: string;
  motionSensitivity?: number;
  motionDropStrength?: number;
  animSpeed?: number;
  palette?: MatrixRainPalette;
  _frameIndex?: number;
  _ema?: Float32Array | null;
};

export const optionTypes = {
  columnWidth: { type: RANGE, range: [4, 20], step: 1, default: 10, desc: "Width of each character cell in pixels" },
  columnSizeVariation: { type: RANGE, range: [0, 0.75], step: 0.05, default: 0, desc: "How much neighboring rain lanes vary in apparent column width" },
  characterSizeVariation: { type: RANGE, range: [0, 0.75], step: 0.05, default: 0, desc: "How much glyph size varies from cell to cell within the rain" },
  characterFlip: { type: RANGE, range: [0, 1], step: 0.05, default: 0, desc: "How often glyphs get mirrored or rotated for a scrambled rain feel; 0 keeps characters upright" },
  speed: { type: RANGE, range: [1, 20], step: 1, default: 2, desc: "How fast rain streams fall" },
  trailLength: { type: RANGE, range: [3, 40], step: 1, default: 16, desc: "Number of lit characters behind each rain head" },
  density: { type: RANGE, range: [0.05, 3], step: 0.05, default: 1, desc: "How much rain to generate overall" },
  columnOverlap: { type: RANGE, range: [0, 1.5], step: 0.05, default: 0.1, desc: "How much adjacent columns blend together; raise this to visibly overlap neighboring character lanes" },
  charset: {
    type: ENUM,
    options: [
      ...SHARED_CHARSET_GROUPS,
      {
        label: "Custom",
        options: [
          { name: "Custom set", value: CUSTOM_CHARSET },
        ],
      },
    ],
    default: CHARSET.MATRIX_FILM,
    desc: "Choose the visual vocabulary of the falling glyphs",
  },
  editSelectedCharset: {
    type: ACTION,
    label: "Edit Selected Charset",
    visibleWhen: (options: FilterOptionValues) =>
      (options.charset || CHARSET.MATRIX_FILM) !== CUSTOM_CHARSET,
    action: (actions: any, _inputCanvas: any, _filterFunc: any, options: any) => {
      const selected = options.charset || CHARSET.MATRIX_FILM;
      const chars = getCharsetString(selected);
      actions.setFilterOption("customCharset", chars);
      actions.setFilterOption("charset", CUSTOM_CHARSET);
    },
  },
  customCharset: {
    type: TEXT,
    default: getCharsetString(CHARSET.MATRIX_FILM),
    visibleWhen: (options: FilterOptionValues) =>
      (options.charset || CHARSET.MATRIX_FILM) === CUSTOM_CHARSET,
    desc: "Editable glyph set used when Charset is set to Custom",
  },
  sourceInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "How much the source image brightness drives glyph intensity" },
  classicGreen: { type: BOOL, default: true, desc: "Use authentic Matrix green palette instead of source colors" },
  motionMode: {
    type: ENUM,
    options: [
      { name: "Gate rain", value: MOTION_MODE.GATE },
      { name: "Trigger drops", value: MOTION_MODE.TRIGGER_DROPS },
    ],
    default: MOTION_MODE.TRIGGER_DROPS,
    desc: "Either gate existing rain by motion or let movement spawn local character drops",
  },
  motionSensitivity: { type: RANGE, range: [0, 3], step: 0.1, default: 0.3, desc: "Rain reacts to motion — high values show rain only where movement is detected" },
  motionDropStrength: { type: RANGE, range: [0.25, 2], step: 0.05, default: 1, desc: "How bursty and persistent movement-triggered drops feel in Trigger drops mode" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12, desc: "Animation frames per second" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  columnWidth: optionTypes.columnWidth.default,
  columnSizeVariation: optionTypes.columnSizeVariation.default,
  characterSizeVariation: optionTypes.characterSizeVariation.default,
  characterFlip: optionTypes.characterFlip.default,
  speed: optionTypes.speed.default,
  trailLength: optionTypes.trailLength.default,
  density: optionTypes.density.default,
  columnOverlap: optionTypes.columnOverlap.default,
  charset: optionTypes.charset.default,
  customCharset: optionTypes.customCharset.default,
  sourceInfluence: optionTypes.sourceInfluence.default,
  classicGreen: optionTypes.classicGreen.default,
  motionMode: optionTypes.motionMode.default,
  motionSensitivity: optionTypes.motionSensitivity.default,
  motionDropStrength: optionTypes.motionDropStrength.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// Rasterize characters to alpha bitmaps at a given cell size.
const charBitmapCache = new Map<string, Uint8Array[]>();

const getCharBitmaps = (cellSize: number, chars: string): Uint8Array[] => {
  const cacheKey = `${cellSize}:${chars}`;
  const cached = charBitmapCache.get(cacheKey);
  if (cached) return cached;

  const bitmaps: Uint8Array[] = [];
  const glyphs = Array.from(chars);
  const c = typeof document !== "undefined"
    ? document.createElement("canvas")
    : new OffscreenCanvas(cellSize, cellSize);
  c.width = cellSize;
  c.height = cellSize;
  const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  if (!ctx) return bitmaps;

  const fontSize = Math.max(6, cellSize - 1);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < glyphs.length; i++) {
    ctx.clearRect(0, 0, cellSize, cellSize);
    ctx.fillStyle = "white";
    ctx.fillText(glyphs[i], cellSize / 2, cellSize / 2 + 1);
    const data = ctx.getImageData(0, 0, cellSize, cellSize).data;
    const alpha = new Uint8Array(cellSize * cellSize);
    for (let j = 0; j < alpha.length; j++) alpha[j] = data[j * 4 + 3];
    bitmaps.push(alpha);
  }

  charBitmapCache.set(cacheKey, bitmaps);
  return bitmaps;
};

// Pre-compute a static character assignment per lane and its cycle speed.
// Characters are fixed on the lane grid; only illumination moves.
const getLaneGrid = (laneCount: number, rows: number, charCount: number) => {
  const grid = new Uint8Array(laneCount * rows);
  const cyclePeriod = new Uint8Array(laneCount * rows);
  const rng = mulberry32(0xCAFE);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.floor(rng() * charCount);
    // ~30% of cells cycle characters, rest are static
    cyclePeriod[i] = rng() < 0.3 ? (2 + Math.floor(rng() * 6)) : 0;
  }
  return { grid, cyclePeriod };
};

let cachedLaneGrid: { laneCount: number; rows: number; charCount: number; grid: Uint8Array; cyclePeriod: Uint8Array } | null = null;

const sampleBitmapAlpha = (
  bitmap: Uint8Array,
  bitmapCellSize: number,
  srcX: number,
  srcY: number,
  transformMode: number
) => {
  let tx = srcX;
  let ty = srcY;
  const last = bitmapCellSize - 1;

  switch (transformMode) {
    case 1:
      tx = last - srcX;
      break;
    case 2:
      ty = last - srcY;
      break;
    case 3:
      tx = last - srcX;
      ty = last - srcY;
      break;
    case 4:
      tx = srcY;
      ty = last - srcX;
      break;
    case 5:
      tx = last - srcY;
      ty = srcX;
      break;
    default:
      break;
  }

  return bitmap[ty * bitmapCellSize + tx] / 255;
};

export const __testing = {
  sampleBitmapAlpha,
};

const matrixRain = (input: any, options: MatrixRainOptions = defaults) => {
  const columnWidth = Number(options.columnWidth ?? defaults.columnWidth);
  const columnSizeVariation = Number(options.columnSizeVariation ?? defaults.columnSizeVariation);
  const characterSizeVariation = Number(options.characterSizeVariation ?? defaults.characterSizeVariation);
  const characterFlip = Number(options.characterFlip ?? defaults.characterFlip);
  const speed = Number(options.speed ?? defaults.speed);
  const trailLength = Number(options.trailLength ?? defaults.trailLength);
  const density = Number(options.density ?? defaults.density);
  const columnOverlap = Number(options.columnOverlap ?? defaults.columnOverlap);
  const charset = options.charset ?? defaults.charset;
  const customCharset = options.customCharset ?? defaults.customCharset;
  const sourceInfluence = Number(options.sourceInfluence ?? defaults.sourceInfluence);
  const classicGreen = Boolean(options.classicGreen ?? defaults.classicGreen);
  const motionMode = options.motionMode ?? defaults.motionMode;
  const motionSensitivity = Number(options.motionSensitivity ?? defaults.motionSensitivity);
  const motionDropStrength = Number(options.motionDropStrength ?? defaults.motionDropStrength);
  const palette = options.palette ?? defaults.palette;
  const frameIndex = Number(options._frameIndex ?? 0);
  const ema = options._ema ?? null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const chars = charset === CUSTOM_CHARSET
    ? String(customCharset || "").trim() || getCharsetString(CHARSET.MATRIX_FILM)
    : getCharsetString(charset);

  const cols = Math.ceil(W / columnWidth);
  const charH = columnWidth;
  const rows = Math.ceil(H / charH);
  const bitmapCellSize = Math.max(
    4,
    Math.round(columnWidth * (1 + columnSizeVariation + characterSizeVariation))
  );
  const charBitmaps = getCharBitmaps(bitmapCellSize, chars);
  if (charBitmaps.length === 0) return input;
  const laneCount = Math.max(1, Math.round(cols * density * (1 + columnOverlap)));
  const laneInset = Math.min(0.45, 0.18 + columnOverlap * 0.22);
  const laneSpan = Math.max(0.1, cols - 1 - laneInset * 2);
  const laneSpacing = laneCount > 1 ? laneSpan / (laneCount - 1) : 0;

  // Dark background
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = 0; outBuf[i + 1] = 2; outBuf[i + 2] = 0; outBuf[i + 3] = 255;
  }

  // Static lane grid — characters are fixed, illumination sweeps down
  if (!cachedLaneGrid || cachedLaneGrid.laneCount !== laneCount || cachedLaneGrid.rows !== rows || cachedLaneGrid.charCount !== charBitmaps.length) {
    const g = getLaneGrid(laneCount, rows, charBitmaps.length);
    cachedLaneGrid = { laneCount, rows, charCount: charBitmaps.length, ...g };
  }
  const { grid: laneGrid, cyclePeriod } = cachedLaneGrid;

  // Floating rain lanes let column overlap create additional visible columns
  // rather than just thickening a snapped column.
  const laneSeeds: { center: number; speed: number; phases: number[]; widthScale: number }[] = [];
  const cycleLen = rows + trailLength;
  const overlapJitter = columnOverlap * 0.6;
  for (let lane = 0; lane < laneCount; lane++) {
    const laneRng = mulberry32(lane * 997 + 42);
    const baseLaneCenter = laneCount > 1
      ? laneInset + lane * laneSpacing
      : (cols - 1) * 0.5;
    const laneCenter = Math.max(
      0,
      Math.min(
        cols - 1,
        baseLaneCenter + (laneRng() - 0.5) * overlapJitter
      )
    );
    const phases: number[] = [];
    const streamsForLane = 1 + (density > 1.5 && laneRng() < Math.min(1, density - 1) ? 1 : 0);
    for (let s = 0; s < streamsForLane; s++) phases.push(Math.round(laneRng() * cycleLen));
    const widthScale = 1 + (laneRng() - 0.5) * 2 * columnSizeVariation;
    laneSeeds.push({
      center: laneCenter,
      speed: Math.max(1, Math.round(speed * (0.5 + laneRng() * 1.0))),
      phases,
      widthScale,
    });
  }

  // Pre-compute per-cell motion from EMA
  let motionMap: Float32Array | null = null;
  if (ema && motionSensitivity > 0) {
    motionMap = new Float32Array(laneCount * rows);
    for (let lane = 0; lane < laneCount; lane++) {
      const laneCenter = laneSeeds[lane]?.center ?? (lane + 0.5) * laneSpacing - 0.5;
      for (let row = 0; row < rows; row++) {
        const laneWidthPx = Math.max(3, Math.round(columnWidth * (laneSeeds[lane]?.widthScale ?? 1)));
        const cx = Math.min(W - 1, Math.max(0, Math.round(laneCenter * columnWidth + laneWidthPx * 0.5)));
        const cy = Math.min(H - 1, row * charH + (charH >> 1));
        const pi = (cx + W * cy) * 4;
        const dr = Math.abs(buf[pi] - ema[pi]);
        const dg = Math.abs(buf[pi + 1] - ema[pi + 1]);
        const db = Math.abs(buf[pi + 2] - ema[pi + 2]);
        motionMap[lane + laneCount * row] = Math.min(1, (dr + dg + db) / (3 * 38));
      }
    }
  }

  // Illumination pass — sweep "rain waves" down each visible lane.
  const illumination = new Float32Array(laneCount * rows);

  for (let lane = 0; lane < laneSeeds.length; lane++) {
    const { speed: laneSpeed, phases } = laneSeeds[lane];
    for (let s = 0; s < phases.length; s++) {
      const headRow = (Math.floor(frameIndex * laneSpeed / 2) + phases[s]) % cycleLen;
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
        if (motionMode === MOTION_MODE.GATE && motionMap && motionSensitivity > 0) {
          const motion = motionMap[lane + laneCount * row];
          // Blend between always-on (sensitivity=0) and motion-gated (sensitivity=1)
          const gate = (1 - motionSensitivity) + motion * motionSensitivity * 4;
          illum *= Math.min(gate, 2);
        }

        const idx = lane + laneCount * row;
        illumination[idx] = Math.max(illumination[idx], illum);
      }
    }
  }

  if (motionMode === MOTION_MODE.TRIGGER_DROPS && motionMap && motionSensitivity > 0) {
    const triggerThreshold = Math.max(0.04, 0.42 - motionSensitivity * (0.07 + motionDropStrength * 0.02));
    const dropLaneSpread = Math.round(columnOverlap * 1.5 + Math.max(0, motionDropStrength - 1));
    for (let lane = 0; lane < laneCount; lane++) {
      for (let row = 0; row < rows; row++) {
        const motion = motionMap[lane + laneCount * row];
        if (motion <= triggerThreshold) continue;

        const triggerStrength = Math.min(1.8, (motion - triggerThreshold) / Math.max(0.05, 1 - triggerThreshold) * (0.9 + motionDropStrength * 0.9));
        const dropTrail = Math.max(2, Math.round(trailLength * (0.12 + triggerStrength * (0.22 + motionDropStrength * 0.14))));
        const rowStride = motionDropStrength > 1.3 ? 1 : 2;
        const laneJitter = ((frameIndex + lane * 3 + row * 5) % rowStride);

        for (let dropRow = row; dropRow < rows && dropRow <= row + dropTrail; dropRow++) {
          const dist = dropRow - row;
          if (dist > 0 && ((dist + laneJitter) % rowStride !== 0)) continue;
          let illum: number;
          if (dist === 0) illum = 1.05 * triggerStrength;
          else if (dist === 1) illum = 0.72 * triggerStrength;
          else illum = Math.pow(1 - dist / (dropTrail + 1), 2.4) * triggerStrength * 0.45;

          const idx = lane + laneCount * dropRow;
          illumination[idx] = Math.max(illumination[idx], illum);
          if (dropLaneSpread > 0) {
            const leftLane = lane - dropLaneSpread;
            const rightLane = lane + dropLaneSpread;
            if (leftLane >= 0) {
              const leftIdx = leftLane + laneCount * dropRow;
              illumination[leftIdx] = Math.max(illumination[leftIdx], illum * 0.55);
            }
            if (rightLane < laneCount) {
              const rightIdx = rightLane + laneCount * dropRow;
              illumination[rightIdx] = Math.max(illumination[rightIdx], illum * 0.55);
            }
          }
        }
      }
    }
  }

  // GL fast path — package the already-computed lane/illum state into
  // textures and let the shader handle the final per-pixel glyph
  // rasterisation. CPU (worker or main) keeps all temporal state.
  if ((options as { _webglAcceleration?: boolean })._webglAcceleration !== false && matrixRainGLAvailable()) {
    const laneInfo = new Float32Array(laneCount * 4);
    const cellData = new Float32Array(laneCount * rows * 4);

    for (let lane = 0; lane < laneCount; lane++) {
      const { center, widthScale } = laneSeeds[lane] ?? { center: 0, widthScale: 1 };
      const laneWidthPx = Math.max(3, Math.round(columnWidth * widthScale));
      const laneCenterPx = center * columnWidth + laneWidthPx * 0.5;
      laneInfo[lane * 4] = laneCenterPx;
      laneInfo[lane * 4 + 1] = laneWidthPx;
    }

    for (let lane = 0; lane < laneCount; lane++) {
      for (let row = 0; row < rows; row++) {
        const cellIdx = lane + laneCount * row;
        const illum = illumination[cellIdx];
        let charIdx = laneGrid[cellIdx];
        const period = cyclePeriod[cellIdx];
        if (period > 0) {
          charIdx = (charIdx + Math.floor(frameIndex / period)) % charBitmaps.length;
        }
        const cellRng = mulberry32((lane + 1) * 13007 + (row + 1) * 17011);
        const glyphScale = 1 + (cellRng() - 0.5) * 2 * characterSizeVariation;
        const flipRoll = cellRng();
        const transformMode = flipRoll < characterFlip ? 1 + Math.floor(cellRng() * 5) : 0;
        const di = (row * laneCount + lane) * 4;
        cellData[di] = charIdx;
        cellData[di + 1] = transformMode;
        cellData[di + 2] = illum;
        cellData[di + 3] = glyphScale;
      }
    }

    const rendered = renderMatrixRainGL(input, W, H, {
      charBitmaps,
      bitmapCellSize,
      laneCount,
      rows,
      charH,
      laneInfo,
      cellData,
      sourceInfluence,
      classicGreen,
    });
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Matrix Rain", "WebGL2", `lanes=${laneCount} rows=${rows}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  // Render characters — fixed per-lane grid, modulated by illumination and source.
  for (let lane = 0; lane < laneCount; lane++) {
    const laneCenter = laneSeeds[lane]?.center ?? (lane + 0.5) * laneSpacing - 0.5;
    const laneWidthPx = Math.max(3, Math.round(columnWidth * (laneSeeds[lane]?.widthScale ?? 1)));
    const laneCenterPx = laneCenter * columnWidth + laneWidthPx * 0.5;
    for (let row = 0; row < rows; row++) {
      const cellIdx = lane + laneCount * row;
      const illum = illumination[cellIdx];
      if (illum < 0.01) continue;

      const cellY = row * charH;
      if (cellY >= H) continue;

      // Character: static per-lane grid with optional cycling
      let charIdx = laneGrid[cellIdx];
      const period = cyclePeriod[cellIdx];
      if (period > 0) {
        charIdx = (charIdx + Math.floor(frameIndex / period)) % charBitmaps.length;
      }
      const charBitmap = charBitmaps[charIdx];
      const cellRng = mulberry32((lane + 1) * 13007 + (row + 1) * 17011);
      const glyphScale = 1 + (cellRng() - 0.5) * 2 * characterSizeVariation;
      const flipRoll = cellRng();
      const transformMode = flipRoll < characterFlip
        ? 1 + Math.floor(cellRng() * 5)
        : 0;
      const glyphW = Math.max(2, Math.round(laneWidthPx * glyphScale));
      const glyphH = Math.max(2, Math.round(charH * glyphScale));
      const cellX = Math.round(laneCenterPx - glyphW * 0.5);
      if (cellX <= -glyphW || cellX >= W) continue;
      const glyphY = Math.round(cellY + (charH - glyphH) * 0.5);

      const isHead = illum > 1.2;
      const isNearHead = illum > 0.9 && !isHead;

      for (let dy = 0; dy < glyphH && glyphY + dy < H; dy++) {
        if (glyphY + dy < 0) continue;
        const srcY = Math.min(bitmapCellSize - 1, Math.floor(dy / glyphH * bitmapCellSize));
        for (let dx = 0; dx < glyphW && cellX + dx < W; dx++) {
          if (cellX + dx < 0) continue;
          const srcX = Math.min(bitmapCellSize - 1, Math.floor(dx / glyphW * bitmapCellSize));
          const glyphAlpha = sampleBitmapAlpha(charBitmap, bitmapCellSize, srcX, srcY, transformMode);
          if (glyphAlpha < 0.05) continue;

          const px = cellX + dx, py = glyphY + dy;
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

export default defineFilter<MatrixRainOptions>({
  name: "Matrix Rain",
  func: matrixRain,
  optionTypes,
  options: defaults,
  defaults,
  description: "Digital rain — static character grid with illumination sweep, source overlay, motion gating, and movement-triggered drops",
  temporal: true,
});
