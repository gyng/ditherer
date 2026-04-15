import { RANGE, PALETTE, ENUM } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor, logFilterBackend } from "utils";
import { applyPaletteToBuffer, paletteIsIdentity as isIdentityPalette } from "palettes/backend";
import { defineFilter } from "filters/types";
import { displaceGLAvailable, renderDisplaceGL } from "./displaceGL";

const DIRECTION_X    = "X";
const DIRECTION_Y    = "Y";
const DIRECTION_BOTH = "BOTH";
const WARP_RAW       = "RAW";
const WARP_BLURRED   = "BLURRED";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 500], step: 1, default: 20, desc: "Maximum pixel displacement" },
  direction: {
    type: ENUM,
    options: [
      { name: "Horizontal", value: DIRECTION_X },
      { name: "Vertical",   value: DIRECTION_Y },
      { name: "Both",       value: DIRECTION_BOTH }
    ],
    default: DIRECTION_BOTH,
    desc: "Displacement axis"
  },
  warpSource: {
    type: ENUM,
    options: [
      { name: "Raw (high-freq, noisy)",    value: WARP_RAW     },
      { name: "Blurred (low-freq, smooth)", value: WARP_BLURRED }
    ],
    default: WARP_RAW,
    desc: "Use raw luminance or pre-blurred for smoother warps"
  },
  blurRadius: { type: RANGE, range: [1, 50], step: 1, default: 15, desc: "Blur radius when using blurred warp source" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  direction: optionTypes.direction.default,
  warpSource: optionTypes.warpSource.default,
  blurRadius: optionTypes.blurRadius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Fast separable box-blur luminance map
const blurLuminance = (lum: Float32Array, W: number, H: number, r: number): Float32Array => {
  const h = new Float32Array(lum.length);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let sum = 0, count = 0;
      for (let kx = -r; kx <= r; kx += 1) {
        const nx = Math.max(0, Math.min(W - 1, x + kx));
        sum += lum[y * W + nx]; count += 1;
      }
      h[y * W + x] = sum / count;
    }
  }
  const out = new Float32Array(lum.length);
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      let sum = 0, count = 0;
      for (let ky = -r; ky <= r; ky += 1) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        sum += h[ny * W + x]; count += 1;
      }
      out[y * W + x] = sum / count;
    }
  }
  return out;
};

const displace = (input: any, options = defaults) => {
  const { strength, direction, warpSource, blurRadius, palette } = options;
  const W = input.width;
  const H = input.height;

  if (
    displaceGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    // Run the warp in GL regardless of palette. For nearest palettes the
    // shader quantises in-line; for custom palettes we read back the warped
    // image and run the standard palette pass (matches gaussianBlur's approach).
    const identity = isIdentityPalette(palette);
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest
      ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256)
      : 256;
    const rendered = renderDisplaceGL(input, W, H, strength, direction, warpSource, blurRadius, levels);
    // HTMLCanvasElement is undefined inside a Web Worker; rendered is an
    // OffscreenCanvas there. Feature-check getContext instead of instanceof.
    if (rendered && typeof (rendered as { getContext?: unknown }).getContext === "function") {
      if (identity || isNearest) {
        logFilterBackend("Displace", "WebGL2",
          `${direction} ${warpSource} strength=${strength}${isNearest && !identity ? ` levels=${levels}` : ""}`);
        return rendered;
      }
      // Custom palette: read back and apply palette on CPU.
      const rCtx = (rendered as HTMLCanvasElement | OffscreenCanvas).getContext("2d", { willReadFrequently: true }) as
        | CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (rCtx) {
        const pixels = rCtx.getImageData(0, 0, W, H).data;
        applyPaletteToBuffer(pixels, pixels, W, H, palette, true);
        rCtx.putImageData(new ImageData(pixels, W, H), 0, 0);
        logFilterBackend("Displace", "WebGL2",
          `${direction} ${warpSource} strength=${strength}+palettePass`);
        return rendered;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Build luminance map
  const rawLum = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      rawLum[y * W + x] = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
    }
  }

  const warpMap = warpSource === WARP_BLURRED
    ? blurLuminance(rawLum, W, H, blurRadius)
    : rawLum;

  const outBuf = new Uint8ClampedArray(buf.length);
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const disp = (warpMap[y * W + x] - 0.5) * strength;

      const srcX = direction !== DIRECTION_Y
        ? Math.max(0, Math.min(W - 1, Math.round(x + disp)))
        : x;
      const srcY = direction !== DIRECTION_X
        ? Math.max(0, Math.min(H - 1, Math.round(y + disp)))
        : y;

      const srcI = getBufferIndex(srcX, srcY, W);
      const col = srgbPaletteGetColor(
        palette,
        rgba(buf[srcI], buf[srcI + 1], buf[srcI + 2], buf[srcI + 3]),
        palette.options
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Displace",
  func: displace,
  options: defaults,
  optionTypes,
  defaults
});
