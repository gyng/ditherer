import { RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  rgba2hsva,
  paletteGetColor
} from "utils";

export const optionTypes = {
  bandCount: { type: RANGE, range: [3, 16], step: 1, default: 6, desc: "Number of hue families to divide the image into" },
  hueOffset: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Rotate the hue-band mapping around the color wheel" },
  preserveLuma: { type: BOOL, default: true, desc: "Keep the original luminance while remapping only the hue family" },
  saturationBoost: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Boost or reduce the remapped palette color saturation" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  bandCount: optionTypes.bandCount.default,
  hueOffset: optionTypes.hueOffset.default,
  preserveLuma: optionTypes.preserveLuma.default,
  saturationBoost: optionTypes.saturationBoost.default,
  palette: { ...optionTypes.palette.default, options: { levels: 16 } }
};

type PaletteMapperPalette = typeof defaults.palette;

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const buildBandPalette = (bandCount: number, hueOffset: number, palette: PaletteMapperPalette) => {
  const colors: number[][] = [];
  for (let band = 0; band < bandCount; band += 1) {
    const hue = (((band / bandCount) * 360 + hueOffset) % 360 + 360) % 360;
    const base = paletteGetColor(
      palette,
      rgba(
        clamp255((Math.sin((hue / 180) * Math.PI) * 0.5 + 0.5) * 255),
        clamp255((Math.sin(((hue + 120) / 180) * Math.PI) * 0.5 + 0.5) * 255),
        clamp255((Math.sin(((hue + 240) / 180) * Math.PI) * 0.5 + 0.5) * 255),
        255
      ),
      palette.options,
      false
    );
    colors.push([base[0], base[1], base[2]]);
  }
  return colors;
};

const paletteMapper = (input, options = defaults) => {
  const { bandCount, hueOffset, preserveLuma, saturationBoost, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const bandColors = buildBandPalette(bandCount, hueOffset, palette);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const a = buf[i + 3];
      const hsv = rgba2hsva([r, g, b, a]);
      const hue = Number.isFinite(hsv[0]) ? hsv[0] : 0;
      const sat = hsv[1];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const shiftedHue = (((hue - hueOffset) % 360) + 360) % 360;
      const bandIndex = Math.min(bandCount - 1, Math.floor((shiftedHue / 360) * bandCount));
      const target = bandColors[bandIndex];

      const gray = (target[0] * 0.2126 + target[1] * 0.7152 + target[2] * 0.0722) || 1;
      let rr = target[0];
      let gg = target[1];
      let bb = target[2];

      if (preserveLuma) {
        const scale = (lum * 255) / gray;
        rr *= scale;
        gg *= scale;
        bb *= scale;
      }

      const satMix = sat * saturationBoost;
      const center = (rr + gg + bb) / 3;
      rr = lerp(center, rr, satMix);
      gg = lerp(center, gg, satMix);
      bb = lerp(center, bb, satMix);

      const color = paletteGetColor(
        palette,
        rgba(clamp255(rr), clamp255(gg), clamp255(bb), a),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Palette Mapper",
  func: paletteMapper,
  options: defaults,
  optionTypes,
  defaults,
  description: "Remap hue families into fixed palette slots while optionally preserving the original lightness"
});
