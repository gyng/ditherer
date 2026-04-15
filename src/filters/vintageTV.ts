import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  wasmVintageTvBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
} from "utils";

export const optionTypes = {
  banding: { type: RANGE, range: [0, 1], step: 0.01, default: 0.4, desc: "Horizontal interference banding intensity" },
  colorFringe: { type: RANGE, range: [0, 10], step: 1, default: 3, desc: "Color fringing/bleeding in pixels" },
  verticalRoll: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Vertical hold instability" },
  glow: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "CRT phosphor glow intensity" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  banding: optionTypes.banding.default,
  colorFringe: optionTypes.colorFringe.default,
  verticalRoll: optionTypes.verticalRoll.default,
  glow: optionTypes.glow.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const vintageTV = (
  input: any,
  options: typeof defaults & { _frameIndex?: number; _wasmAcceleration?: boolean } = defaults
) => {
  const {
    banding,
    colorFringe,
    verticalRoll,
    glow,
    palette
  } = options;

  const frameIndex = options._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Vertical roll offset
  const rollOffset = Math.round(verticalRoll * Math.sin(frameIndex * 0.1));
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    wasmVintageTvBuffer(buf, outBuf, W, H, banding, colorFringe, rollOffset, frameIndex, glow);
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      }
    }
    logFilterWasmStatus("Vintage TV", true, paletteIsIdentity ? "tv" : "tv+palettePass");
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("Vintage TV", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Apply vertical roll
      const srcY = ((y + rollOffset) % H + H) % H;

      // Color fringe: offset R channel
      const srcXR = Math.max(0, Math.min(W - 1, x + colorFringe));
      const srcXB = x;
      const srcXG = x;

      const iR = getBufferIndex(srcXR, srcY, W);
      const iG = getBufferIndex(srcXG, srcY, W);
      const iB = getBufferIndex(srcXB, srcY, W);

      let r = buf[iR];
      let g = buf[iG + 1];
      let b = buf[iB + 2];

      // Banding: horizontal brightness bands
      if (banding > 0) {
        const bandVal = Math.sin(y * 0.05 + frameIndex * 0.3) * banding * 40;
        r += bandVal;
        g += bandVal;
        b += bandVal;
      }

      // Glow: slight additive bloom on bright pixels
      if (glow > 0) {
        const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
        if (luma > 180) {
          const boost = (luma - 180) / 75 * glow * 50;
          r += boost;
          g += boost;
          b += boost;
        }
      }

      r = clamp(r);
      g = clamp(g);
      b = clamp(b);

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default defineFilter({
  name: "Vintage TV",
  func: vintageTV,
  options: defaults,
  optionTypes,
  defaults
});
