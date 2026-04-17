import { ACTION, BOOL, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas } from "utils";

const LAYOUT = {
  CENTER_STACK: "CENTER_STACK",
  GRID_2X2: "GRID_2X2",
  GRID_3X3: "GRID_3X3",
  PIP: "PIP",
};

type Rect = { x: number; y: number; w: number; h: number };

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const lig = clamp01(l);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) {
    r1 = c; g1 = x;
  } else if (hp >= 1 && hp < 2) {
    r1 = x; g1 = c;
  } else if (hp >= 2 && hp < 3) {
    g1 = c; b1 = x;
  } else if (hp >= 3 && hp < 4) {
    g1 = x; b1 = c;
  } else if (hp >= 4 && hp < 5) {
    r1 = x; b1 = c;
  } else {
    r1 = c; b1 = x;
  }

  const m = lig - c / 2;
  return [clamp255((r1 + m) * 255), clamp255((g1 + m) * 255), clamp255((b1 + m) * 255)];
};

const minPaneSize = 8;

const centeredRect = (W: number, H: number, scale: number, dx = 0, dy = 0): Rect => {
  const w = Math.max(minPaneSize, Math.round(W * scale));
  const h = Math.max(minPaneSize, Math.round(H * scale));
  const x = Math.round((W - w) / 2 + dx);
  const y = Math.round((H - h) / 2 + dy);
  return { x, y, w, h };
};

const clampRect = (rect: Rect, W: number, H: number): Rect | null => {
  let { x, y, w, h } = rect;
  if (w < minPaneSize || h < minPaneSize) return null;
  if (x >= W || y >= H || x + w <= 0 || y + h <= 0) return null;

  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > W) w = W - x;
  if (y + h > H) h = H - y;
  if (w < minPaneSize || h < minPaneSize) return null;
  return { x, y, w, h };
};

const layoutRect = (
  layout: string,
  level: number,
  frameIndex: number,
  W: number,
  H: number,
  scalePerDepth: number,
  drift: number,
): Rect | null => {
  const baseScale = Math.pow(scalePerDepth, level + 1);
  const driftPx = drift * Math.min(W, H) * (level + 1);
  const phase = frameIndex * 0.05 + level * 0.8;
  const dx = Math.cos(phase) * driftPx;
  const dy = Math.sin(phase * 1.19) * driftPx;

  if (layout === LAYOUT.CENTER_STACK) {
    return clampRect(centeredRect(W, H, baseScale, dx, dy), W, H);
  }

  if (layout === LAYOUT.PIP) {
    const pipScale = Math.max(0.14, 0.42 * baseScale);
    const w = Math.max(minPaneSize, Math.round(W * pipScale));
    const h = Math.max(minPaneSize, Math.round(H * pipScale));
    const margin = Math.round(12 + 4 * level);
    const x = Math.round(W - w - margin + dx * 0.45);
    const y = Math.round(margin + dy * 0.45);
    return clampRect({ x, y, w, h }, W, H);
  }

  const grid = layout === LAYOUT.GRID_3X3 ? 3 : 2;
  const tileW = W / grid;
  const tileH = H / grid;
  const cellIndex = ((frameIndex + level) % (grid * grid) + (grid * grid)) % (grid * grid);
  const tx = cellIndex % grid;
  const ty = Math.floor(cellIndex / grid);

  const localScale = Math.max(0.35, 0.95 * baseScale + 0.15);
  const w = Math.max(minPaneSize, Math.round(tileW * localScale));
  const h = Math.max(minPaneSize, Math.round(tileH * localScale));
  const x = Math.round(tx * tileW + (tileW - w) / 2 + dx * 0.4);
  const y = Math.round(ty * tileH + (tileH - h) / 2 + dy * 0.4);
  return clampRect({ x, y, w, h }, W, H);
};

const drawPaneChrome = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  accent: [number, number, number],
  depthAlpha: number,
) => {
  const { x, y, w, h } = rect;
  const [ar, ag, ab] = accent;
  const stripH = Math.max(4, Math.round(Math.min(20, h * 0.12)));
  const dotR = Math.max(1, Math.round(Math.min(3, stripH * 0.18)));

  ctx.save();
  ctx.globalAlpha = Math.max(0.15, Math.min(0.9, depthAlpha));
  ctx.fillStyle = `rgba(${Math.round(ar * 0.25)}, ${Math.round(ag * 0.28)}, ${Math.round(ab * 0.35)}, 0.8)`;
  ctx.fillRect(x, y, w, stripH);

  ctx.strokeStyle = `rgba(${Math.round(ar * 0.7)}, ${Math.round(ag * 0.75)}, ${Math.round(ab * 0.9)}, 0.95)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));

  const dotY = y + Math.round(stripH * 0.5);
  const dotX = x + Math.round(stripH * 0.7);
  ctx.fillStyle = "rgba(245, 245, 245, 0.85)";
  ctx.beginPath();
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(${Math.round(ar * 0.95)}, ${Math.round(ag * 0.95)}, ${Math.round(ab * 0.95)}, 0.9)`;
  ctx.beginPath();
  ctx.arc(dotX + dotR * 3, dotY, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const applyDigitalDegrade = (
  buf: Uint8ClampedArray,
  W: number,
  H: number,
  strength: number,
  frameIndex: number,
) => {
  const s = clamp01(strength);
  if (s <= 0.001) return;

  const blockSize = 3 + Math.round(s * 11);
  const quantStep = 8 + Math.round(s * 34);
  const blockBlend = 0.2 + s * 0.5;

  for (let by = 0; by < H; by += blockSize) {
    const yEnd = Math.min(H, by + blockSize);
    for (let bx = 0; bx < W; bx += blockSize) {
      const xEnd = Math.min(W, bx + blockSize);
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let y = by; y < yEnd; y += 1) {
        const row = y * W * 4;
        for (let x = bx; x < xEnd; x += 1) {
          const i = row + x * 4;
          if (buf[i + 3] === 0) continue;
          sumR += buf[i];
          sumG += buf[i + 1];
          sumB += buf[i + 2];
          count += 1;
        }
      }

      if (!count) continue;
      const noise = (((bx * 29 + by * 17 + frameIndex * 11) & 31) - 15.5) * s;
      const avgR = sumR / count;
      const avgG = sumG / count;
      const avgB = sumB / count;
      const qR = clamp255(Math.round(avgR / quantStep) * quantStep + noise);
      const qG = clamp255(Math.round(avgG / quantStep) * quantStep + noise * 0.75);
      const qB = clamp255(Math.round(avgB / quantStep) * quantStep + noise * 1.1);

      for (let y = by; y < yEnd; y += 1) {
        const row = y * W * 4;
        for (let x = bx; x < xEnd; x += 1) {
          const i = row + x * 4;
          if (buf[i + 3] === 0) continue;
          buf[i] = clamp255(buf[i] * (1 - blockBlend) + qR * blockBlend);
          buf[i + 1] = clamp255(buf[i + 1] * (1 - blockBlend) + qG * blockBlend);
          buf[i + 2] = clamp255(buf[i + 2] * (1 - blockBlend) + qB * blockBlend);
        }
      }
    }
  }

  const lineDim = 1 - s * 0.18;
  for (let y = 0; y < H; y += 1) {
    if ((y + frameIndex) % 3 !== 0) continue;
    const row = y * W * 4;
    for (let x = 0; x < W; x += 1) {
      const i = row + x * 4;
      if (buf[i + 3] === 0) continue;
      buf[i] = clamp255(buf[i] * lineDim);
      buf[i + 1] = clamp255(buf[i + 1] * lineDim);
      buf[i + 2] = clamp255(buf[i + 2] * lineDim);
    }
  }

  const shift = Math.round(s * 2);
  if (shift < 1) return;

  const src = new Uint8ClampedArray(buf);
  const chromaMix = s * 0.45;
  for (let y = 0; y < H; y += 1) {
    const row = y * W * 4;
    for (let x = 0; x < W; x += 1) {
      const i = row + x * 4;
      if (src[i + 3] === 0) continue;

      const lx = Math.max(0, x - shift);
      const rx = Math.min(W - 1, x + shift);
      const li = row + lx * 4;
      const ri = row + rx * 4;

      const shiftedR = src[ri];
      const shiftedB = src[li + 2];
      buf[i] = clamp255(src[i] * (1 - chromaMix) + shiftedR * chromaMix);
      buf[i + 2] = clamp255(src[i + 2] * (1 - chromaMix) + shiftedB * chromaMix);
    }
  }
};

export const optionTypes = {
  layout: {
    type: ENUM,
    label: "Layout",
    options: [
      { name: "Center stack", value: LAYOUT.CENTER_STACK },
      { name: "2x2 grid", value: LAYOUT.GRID_2X2 },
      { name: "3x3 grid", value: LAYOUT.GRID_3X3 },
      { name: "Picture-in-picture", value: LAYOUT.PIP },
    ],
    default: LAYOUT.CENTER_STACK,
    desc: "Choose how recursive windows are arranged across the frame",
  },
  depth: {
    type: RANGE,
    label: "Depth",
    range: [1, 12],
    step: 1,
    default: 5,
    desc: "How many recursive generations of call windows to draw",
  },
  scalePerDepth: {
    type: RANGE,
    label: "Scale per depth",
    range: [0.6, 0.98],
    step: 0.01,
    default: 0.84,
    desc: "How aggressively each deeper pane shrinks",
  },
  drift: {
    type: RANGE,
    label: "UI drift",
    range: [0, 0.08],
    step: 0.002,
    default: 0.018,
    desc: "Subtle per-depth motion offset that feels like digital window drift",
  },
  mix: {
    type: RANGE,
    label: "Mix",
    range: [0.1, 0.95],
    step: 0.05,
    default: 0.72,
    desc: "Blend amount of recursive panes over the live source",
  },
  uiChrome: {
    type: BOOL,
    label: "UI chrome",
    default: true,
    desc: "Draw subtle pane headers, borders, and status dots",
  },
  digitalDegrade: {
    type: RANGE,
    label: "Digital degrade",
    range: [0, 1],
    step: 0.05,
    default: 0.35,
    desc: "Add block quantization, chroma offset, and scanline cadence to recursive panes",
  },
  accentHue: {
    type: RANGE,
    label: "Accent hue",
    range: [0, 360],
    step: 1,
    default: 205,
    desc: "Hue used for pane chrome and UI highlights",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
      }
    },
  },
};

export const defaults = {
  layout: optionTypes.layout.default,
  depth: optionTypes.depth.default,
  scalePerDepth: optionTypes.scalePerDepth.default,
  drift: optionTypes.drift.default,
  mix: optionTypes.mix.default,
  uiChrome: optionTypes.uiChrome.default,
  digitalDegrade: optionTypes.digitalDegrade.default,
  accentHue: optionTypes.accentHue.default,
  animSpeed: optionTypes.animSpeed.default,
};

type InfiniteCallWindowsOptions = FilterOptionValues & {
  layout?: string;
  depth?: number;
  scalePerDepth?: number;
  drift?: number;
  mix?: number;
  uiChrome?: boolean;
  digitalDegrade?: number;
  accentHue?: number;
  animSpeed?: number;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
};

const infiniteCallWindows = (input: any, options: InfiniteCallWindowsOptions = defaults) => {
  const {
    layout,
    depth,
    scalePerDepth,
    drift,
    mix,
    uiChrome,
    digitalDegrade,
    accentHue,
  } = options;

  const prevOutput = options._prevOutput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const inputData = inputCtx.getImageData(0, 0, W, H);
  const buf = inputData.data;

  const outBuf = new Uint8ClampedArray(buf.length);

  // First frame or reset path: no previous temporal frame available.
  if (!prevOutput || prevOutput.length !== buf.length) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  const prevCanvas = cloneCanvas(input, false);
  const prevCtx = prevCanvas.getContext("2d");
  const overlay = cloneCanvas(input, false);
  const overlayCtx = overlay.getContext("2d");
  if (!prevCtx || !overlayCtx) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  prevCtx.putImageData(new ImageData(new Uint8ClampedArray(prevOutput), W, H), 0, 0);

  const accent = hslToRgb(accentHue || 0, 0.72, 0.58);
  const depthCount = Math.max(1, Math.round(depth || 1));

  for (let level = 0; level < depthCount; level += 1) {
    const rect = layoutRect(
      layout || LAYOUT.CENTER_STACK,
      level,
      frameIndex,
      W,
      H,
      Math.max(0.6, Math.min(0.98, scalePerDepth || 0.84)),
      Math.max(0, Math.min(0.08, drift || 0)),
    );
    if (!rect) continue;

    const paneAlpha = Math.max(0.08, Math.pow(0.84, level));
    overlayCtx.save();
    overlayCtx.globalAlpha = paneAlpha;
    overlayCtx.drawImage(prevCanvas, rect.x, rect.y, rect.w, rect.h);
    overlayCtx.restore();

    if (uiChrome) {
      drawPaneChrome(overlayCtx, rect, accent, Math.max(0.15, paneAlpha * 0.95));
    }
  }

  const overlayData = overlayCtx.getImageData(0, 0, W, H);
  const overlayBuf = overlayData.data;
  applyDigitalDegrade(overlayBuf, W, H, digitalDegrade || 0, frameIndex);

  const mixAmount = Math.max(0.1, Math.min(0.95, mix || 0.72));
  for (let i = 0; i < buf.length; i += 4) {
    const oa = (overlayBuf[i + 3] / 255) * mixAmount;
    const inv = 1 - oa;
    outBuf[i] = clamp255(buf[i] * inv + overlayBuf[i] * oa);
    outBuf[i + 1] = clamp255(buf[i + 1] * inv + overlayBuf[i + 1] * oa);
    outBuf[i + 2] = clamp255(buf[i + 2] * inv + overlayBuf[i + 2] * oa);
    outBuf[i + 3] = 255;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Infinite Call Windows",
  func: infiniteCallWindows,
  optionTypes,
  options: defaults,
  defaults,
  description: "Recursive meeting panes with digital UI chrome, blocky compression wear, and endless self-view nesting",
});
