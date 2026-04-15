import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmLcdDisplayBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
  logFilterBackend,
  LCD_SUBPIXEL_LAYOUT,
} from "utils";
import { defineFilter } from "filters/types";
import { lcdDisplayGLAvailable, renderLcdDisplayGL } from "./lcdDisplayGL";

const LAYOUT = { STRIPE: "STRIPE", PENTILE: "PENTILE", DIAMOND: "DIAMOND" };

const LAYOUT_TO_WASM: Record<string, number> = {
  [LAYOUT.STRIPE]: LCD_SUBPIXEL_LAYOUT.STRIPE,
  [LAYOUT.PENTILE]: LCD_SUBPIXEL_LAYOUT.PENTILE,
  [LAYOUT.DIAMOND]: LCD_SUBPIXEL_LAYOUT.DIAMOND,
};

export const optionTypes = {
  pixelSize: { type: RANGE, range: [3, 20], step: 1, default: 6, desc: "LCD pixel cell size" },
  subpixelLayout: { type: ENUM, options: [
    { name: "RGB Stripe", value: LAYOUT.STRIPE },
    { name: "PenTile", value: LAYOUT.PENTILE },
    { name: "Diamond", value: LAYOUT.DIAMOND }
  ], default: LAYOUT.STRIPE, desc: "Subpixel arrangement pattern" },
  brightness: { type: RANGE, range: [0.5, 2], step: 0.1, default: 1.2, desc: "Backlight brightness multiplier" },
  gapDarkness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Darkness of grid gaps between pixels" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  pixelSize: optionTypes.pixelSize.default,
  subpixelLayout: optionTypes.subpixelLayout.default,
  brightness: optionTypes.brightness.default,
  gapDarkness: optionTypes.gapDarkness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lcdDisplay = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { pixelSize, subpixelLayout, brightness, gapDarkness, palette } = options;
  const W = input.width, H = input.height;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  // GL fast path: the whole filter maps to a single fragment shader. Only
  // applies for nearest-type palettes (handled via in-shader quantisation);
  // custom palettes fall through to the WASM/JS paths that run a palette pass.
  if (
    lcdDisplayGLAvailable()
    && options._webglAcceleration !== false
    && (palette as { name?: string })?.name === "nearest"
  ) {
    const levels = paletteOpts?.levels ?? 256;
    const rendered = renderLcdDisplayGL(input, W, H, pixelSize, subpixelLayout, brightness, gapDarkness, levels);
    if (rendered) {
      logFilterBackend("LCD Display", "WebGL2", `layout=${subpixelLayout} levels=${levels}`);
      return rendered;
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    const layoutCode = LAYOUT_TO_WASM[subpixelLayout] ?? LCD_SUBPIXEL_LAYOUT.STRIPE;
    wasmLcdDisplayBuffer(buf, outBuf, W, H, pixelSize, layoutCode, brightness, gapDarkness);
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      }
    }
    logFilterWasmStatus("LCD Display", true, paletteIsIdentity ? `layout=${subpixelLayout}` : `layout=${subpixelLayout}+palettePass`);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("LCD Display", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  const subW = Math.max(1, Math.floor(pixelSize / 3));
  const gapColor = Math.round(10 * (1 - gapDarkness));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Sample from grid-aligned position
      const gx = Math.floor(x / pixelSize) * pixelSize + Math.floor(pixelSize / 2);
      const gy = Math.floor(y / pixelSize) * pixelSize + Math.floor(pixelSize / 2);
      const si = getBufferIndex(Math.min(W - 1, gx), Math.min(H - 1, gy), W);
      const sr = buf[si], sg = buf[si + 1], sb = buf[si + 2];

      // Position within pixel cell
      const localX = x % pixelSize;
      const localY = y % pixelSize;

      // Gap between pixels
      if (localX >= pixelSize - 1 || localY >= pixelSize - 1) {
        const di = getBufferIndex(x, y, W);
        fillBufferPixel(outBuf, di, gapColor, gapColor, gapColor, 255);
        continue;
      }

      let r = 0, g = 0, b = 0;

      if (subpixelLayout === LAYOUT.STRIPE) {
        // RGB vertical stripes
        const subIdx = Math.floor(localX / subW);
        if (subIdx === 0) r = Math.round(sr * brightness);
        else if (subIdx === 1) g = Math.round(sg * brightness);
        else b = Math.round(sb * brightness);
      } else if (subpixelLayout === LAYOUT.PENTILE) {
        // PenTile: alternating RG and BG rows
        const isEvenRow = (Math.floor(y / pixelSize) % 2) === 0;
        const subIdx = Math.floor(localX / subW);
        if (isEvenRow) {
          if (subIdx === 0) r = Math.round(sr * brightness);
          else g = Math.round(sg * brightness);
        } else {
          if (subIdx === 0) b = Math.round(sb * brightness);
          else g = Math.round(sg * brightness);
        }
      } else {
        // Diamond: rotated subpixel arrangement
        const cx = localX - pixelSize / 2;
        const cy = localY - pixelSize / 2;
        const angle = ((Math.atan2(cy, cx) * 180 / Math.PI) + 360) % 360;
        if (angle < 120) r = Math.round(sr * brightness);
        else if (angle < 240) g = Math.round(sg * brightness);
        else b = Math.round(sb * brightness);
      }

      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "LCD Display", func: lcdDisplay, optionTypes, options: defaults, defaults });
