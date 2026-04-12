import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const COLORMAP = { TOPOGRAPHIC: "TOPOGRAPHIC", BATHYMETRIC: "BATHYMETRIC", THERMAL: "THERMAL" };

const COLORMAPS: Record<string, number[][]> = {
  [COLORMAP.TOPOGRAPHIC]: [[0,100,0],[34,139,34],[144,238,144],[255,255,150],[210,180,80],[160,82,45],[139,90,43],[200,200,200],[255,255,255]],
  [COLORMAP.BATHYMETRIC]: [[0,0,80],[0,0,140],[0,50,180],[0,100,200],[50,150,220],[100,200,240],[180,230,250],[220,240,255],[245,250,255]],
  [COLORMAP.THERMAL]: [[0,0,50],[20,0,100],[80,0,140],[160,0,100],[220,60,20],[255,160,0],[255,220,50],[255,255,150],[255,255,255]]
};

const sampleGradient = (stops: number[][], t: number): [number, number, number] => {
  const ct = Math.max(0, Math.min(1, t));
  const pos = ct * (stops.length - 1);
  const idx = Math.floor(pos);
  const frac = pos - idx;
  if (idx >= stops.length - 1) return [stops[stops.length-1][0], stops[stops.length-1][1], stops[stops.length-1][2]];
  const a = stops[idx], b = stops[idx + 1];
  return [Math.round(a[0]+(b[0]-a[0])*frac), Math.round(a[1]+(b[1]-a[1])*frac), Math.round(a[2]+(b[2]-a[2])*frac)];
};

export const optionTypes = {
  bands: { type: RANGE, range: [3, 20], step: 1, default: 8, desc: "Number of elevation bands" },
  colormap: { type: ENUM, options: [
    { name: "Topographic", value: COLORMAP.TOPOGRAPHIC },
    { name: "Bathymetric", value: COLORMAP.BATHYMETRIC },
    { name: "Thermal", value: COLORMAP.THERMAL }
  ], default: COLORMAP.TOPOGRAPHIC, desc: "Color scheme for the contour bands" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  bands: optionTypes.bands.default,
  colormap: optionTypes.colormap.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const contourMap = (input, options = defaults) => {
  const { bands, colormap, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const stops = COLORMAPS[colormap] || COLORMAPS[COLORMAP.TOPOGRAPHIC];

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      const band = Math.floor(lum * bands) / bands;
      const [cr, cg, cb] = sampleGradient(stops, band);
      const color = paletteGetColor(palette, rgba(cr, cg, cb, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Contour Map", func: contourMap, optionTypes, options: defaults, defaults });
