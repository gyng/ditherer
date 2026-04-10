import { RANGE, COLOR } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";

export const optionTypes = {
  outlineColor: { type: COLOR, default: [0, 0, 0], desc: "Border color painted around sharp color changes" },
  outlineWidth: { type: RANGE, range: [1, 4], step: 1, default: 1, desc: "Thickness of the sprite-like outline" },
  mergeThreshold: { type: RANGE, range: [0, 128], step: 1, default: 24, desc: "Neighbor color difference required before drawing an outline" }
};

export const defaults = {
  outlineColor: optionTypes.outlineColor.default,
  outlineWidth: optionTypes.outlineWidth.default,
  mergeThreshold: optionTypes.mergeThreshold.default
};

const colorDelta = (buf: Uint8ClampedArray, a: number, b: number) => (
  (Math.abs(buf[a] - buf[b]) + Math.abs(buf[a + 1] - buf[b + 1]) + Math.abs(buf[a + 2] - buf[b + 2])) / 3
);

const pixelOutline = (input, options: any = defaults) => {
  const { outlineColor, outlineWidth, mergeThreshold } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const edgeMap = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let edge = false;

      if (x > 0 && colorDelta(buf, i, getBufferIndex(x - 1, y, W)) > mergeThreshold) edge = true;
      if (!edge && x < W - 1 && colorDelta(buf, i, getBufferIndex(x + 1, y, W)) > mergeThreshold) edge = true;
      if (!edge && y > 0 && colorDelta(buf, i, getBufferIndex(x, y - 1, W)) > mergeThreshold) edge = true;
      if (!edge && y < H - 1 && colorDelta(buf, i, getBufferIndex(x, y + 1, W)) > mergeThreshold) edge = true;

      edgeMap[y * W + x] = edge ? 1 : 0;
    }
  }

  if (outlineWidth > 1) {
    const dilated = new Uint8Array(W * H);
    const radius = outlineWidth - 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let edge = 0;
        for (let ky = -radius; ky <= radius && !edge; ky++) {
          for (let kx = -radius; kx <= radius && !edge; kx++) {
            const nx = x + kx;
            const ny = y + ky;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            edge = edgeMap[ny * W + nx];
          }
        }
        dilated[y * W + x] = edge;
      }
    }
    edgeMap.set(dilated);
  }

  const outBuf = new Uint8ClampedArray(buf);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!edgeMap[y * W + x]) continue;
      const i = getBufferIndex(x, y, W);
      outBuf[i] = outlineColor[0];
      outBuf[i + 1] = outlineColor[1];
      outBuf[i + 2] = outlineColor[2];
      outBuf[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Pixel Outline",
  func: pixelOutline,
  optionTypes,
  options: defaults,
  defaults
};
