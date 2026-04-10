import { RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const BASE_MODE = {
  ORIGINAL: "ORIGINAL",
  GRAYSCALE: "GRAYSCALE",
  TINT: "TINT"
};

export const optionTypes = {
  lightAngle: { type: RANGE, range: [0, 360], step: 1, default: 135, desc: "Direction of the fake surface light" },
  height: { type: RANGE, range: [0.1, 8], step: 0.1, default: 2, desc: "How strongly luminance differences act like surface height" },
  specular: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Add a glossy highlight on bright-facing slopes" },
  baseColorMode: {
    type: ENUM,
    options: [
      { name: "Original color", value: BASE_MODE.ORIGINAL },
      { name: "Grayscale relief", value: BASE_MODE.GRAYSCALE },
      { name: "Tinted stone", value: BASE_MODE.TINT }
    ],
    default: BASE_MODE.ORIGINAL,
    desc: "How the relit surface color is derived"
  },
  tintColor: { type: COLOR, default: [196, 186, 170], desc: "Stone-like tint used in tinted mode" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  lightAngle: optionTypes.lightAngle.default,
  height: optionTypes.height.default,
  specular: optionTypes.specular.default,
  baseColorMode: optionTypes.baseColorMode.default,
  tintColor: optionTypes.tintColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const reliefMap = (input, options: any = defaults) => {
  const { lightAngle, height, specular, baseColorMode, tintColor, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const heightPx = input.height;
  const buf = inputCtx.getImageData(0, 0, width, heightPx).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lightRad = (lightAngle * Math.PI) / 180;
  const lightX = Math.cos(lightRad);
  const lightY = -Math.sin(lightRad);

  const lum = new Float32Array(width * heightPx);
  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      lum[y * width + x] = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
    }
  }

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const ym = Math.max(0, y - 1);
      const yp = Math.min(heightPx - 1, y + 1);
      const dx = (lum[y * width + xp] - lum[y * width + xm]) * height;
      const dy = (lum[yp * width + x] - lum[ym * width + x]) * height;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const nnx = nx / len;
      const nny = ny / len;
      const nnz = nz / len;
      const diffuse = Math.max(0, nnx * lightX + nny * lightY + nnz * 0.85);
      const spec = specular > 0 ? Math.pow(diffuse, 18) * specular : 0;

      const i = getBufferIndex(x, y, width);
      const l = lum[y * width + x];
      let baseR = buf[i];
      let baseG = buf[i + 1];
      let baseB = buf[i + 2];

      if (baseColorMode === BASE_MODE.GRAYSCALE) {
        const gray = clamp255(l * 255);
        baseR = gray;
        baseG = gray;
        baseB = gray;
      } else if (baseColorMode === BASE_MODE.TINT) {
        baseR = clamp255(tintColor[0] * (0.45 + l * 0.8));
        baseG = clamp255(tintColor[1] * (0.45 + l * 0.8));
        baseB = clamp255(tintColor[2] * (0.45 + l * 0.8));
      }

      const shading = 0.35 + diffuse * 0.9;
      const r = clamp255(baseR * shading + spec * 255);
      const g = clamp255(baseG * shading + spec * 255);
      const b = clamp255(baseB * shading + spec * 255);
      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, heightPx), 0, 0);
  return output;
};

export default {
  name: "Relief Map",
  func: reliefMap,
  options: defaults,
  optionTypes,
  defaults,
  description: "Treat luminance like a height field and relight it as a faux 3D surface"
};
