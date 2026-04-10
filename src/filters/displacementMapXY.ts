import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const CHANNEL = { R: 0, G: 1, B: 2 };

export const optionTypes = {
  strength: { type: RANGE, range: [0, 200], step: 1, default: 30, desc: "Maximum pixel displacement" },
  blurRadius: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Pre-blur the displacement map for smoother warps" },
  channelX: { type: ENUM, options: [
    { name: "Red", value: CHANNEL.R }, { name: "Green", value: CHANNEL.G }, { name: "Blue", value: CHANNEL.B }
  ], default: CHANNEL.R, desc: "Color channel driving horizontal displacement" },
  channelY: { type: ENUM, options: [
    { name: "Red", value: CHANNEL.R }, { name: "Green", value: CHANNEL.G }, { name: "Blue", value: CHANNEL.B }
  ], default: CHANNEL.G, desc: "Color channel driving vertical displacement" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  blurRadius: optionTypes.blurRadius.default,
  channelX: optionTypes.channelX.default,
  channelY: optionTypes.channelY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const displacementMapXY = (input, options: any = defaults) => {
  const { strength, blurRadius, channelX, channelY, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Optional blur for smoother displacement
  let mapBuf = buf;
  if (blurRadius > 0) {
    const blurred = new Uint8ClampedArray(buf.length);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (let ky = -blurRadius; ky <= blurRadius; ky++)
          for (let kx = -blurRadius; kx <= blurRadius; kx++) {
            const ni = getBufferIndex(Math.max(0, Math.min(W - 1, x + kx)), Math.max(0, Math.min(H - 1, y + ky)), W);
            sr += buf[ni]; sg += buf[ni + 1]; sb += buf[ni + 2]; cnt++;
          }
        const di = getBufferIndex(x, y, W);
        blurred[di] = sr / cnt; blurred[di + 1] = sg / cnt; blurred[di + 2] = sb / cnt; blurred[di + 3] = buf[di + 3];
      }
    mapBuf = blurred;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const mi = getBufferIndex(x, y, W);
      const dx = (mapBuf[mi + channelX] / 255 - 0.5) * strength * 2;
      const dy = (mapBuf[mi + channelY] / 255 - 0.5) * strength * 2;

      const sx = x + dx, sy = y + dy;
      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;

      const sample = (ch: number) => {
        const get = (px: number, py: number) => buf[getBufferIndex(Math.max(0, Math.min(W - 1, px)), Math.max(0, Math.min(H - 1, py)), W) + ch];
        return get(sx0, sy0) * (1 - fx) * (1 - fy) + get(sx0 + 1, sy0) * fx * (1 - fy) + get(sx0, sy0 + 1) * (1 - fx) * fy + get(sx0 + 1, sy0 + 1) * fx * fy;
      };

      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Displacement Map XY", func: displacementMapXY, optionTypes, options: defaults, defaults };
