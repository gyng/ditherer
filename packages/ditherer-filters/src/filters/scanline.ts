import { ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import * as palettes from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
} from "../utils/index";
import { applyPalettePassToCanvas } from "../palettes/backend";
import { defineFilter } from "./types";
import { scanlineGLAvailable, renderScanlineGL } from "./scanlineGL";

const MODE = {
  BEAM_PROFILE: "BEAM_PROFILE",
  DARKEN: "DARKEN",
  RGB_SUBLINES: "RGB_SUBLINES",
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Gaussian raster beam", value: MODE.BEAM_PROFILE },
      { name: "Darken rows (legacy)", value: MODE.DARKEN },
      { name: "RGB row separation (artistic)", value: MODE.RGB_SUBLINES },
    ],
    default: MODE.BEAM_PROFILE,
    desc: "Physical Gaussian raster profile or retained legacy row effects",
  },
  visibleScanlines: {
    type: RANGE,
    range: [120, 1200],
    step: 1,
    default: 240,
    desc: "Active raster lines, independent of output resolution",
    visibleWhen: (options: any) => options.mode === MODE.BEAM_PROFILE,
  },
  beamMinWidth: {
    type: RANGE,
    range: [0.08, 0.7],
    step: 0.01,
    default: 0.18,
    desc: "Raster spot width for dark content, in line-pitch units",
    visibleWhen: (options: any) => options.mode === MODE.BEAM_PROFILE,
  },
  beamMaxWidth: {
    type: RANGE,
    range: [0.12, 0.9],
    step: 0.01,
    default: 0.42,
    desc: "Wider raster spot for bright content from beam-current blooming",
    visibleWhen: (options: any) => options.mode === MODE.BEAM_PROFILE,
  },
  beamStrength: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.68,
    desc: "Blend between the source and the integrated raster beam profile",
    visibleWhen: (options: any) => options.mode === MODE.BEAM_PROFILE,
  },
  intensity: {
    type: RANGE,
    range: [0, 4],
    step: 0.01,
    default: 0.33,
    desc: "How dark each scanline becomes in darken-lines mode",
    visibleWhen: (options: any) => options.mode === MODE.DARKEN,
  },
  gap: {
    type: RANGE,
    range: [1, 255],
    step: 1,
    default: 3,
    desc: "Spacing between scanlines in darken-lines mode",
    visibleWhen: (options: any) => options.mode === MODE.DARKEN,
  },
  height: {
    type: RANGE,
    range: [1, 255],
    step: 1,
    default: 1,
    desc: "Thickness of each darkened line in darken-lines mode",
    visibleWhen: (options: any) => options.mode === MODE.DARKEN,
  },
  lineHeight: {
    type: RANGE,
    range: [1, 6],
    step: 1,
    default: 2,
    desc: "Height of each RGB sub-line in phosphor mode",
    visibleWhen: (options: any) => options.mode === MODE.RGB_SUBLINES,
  },
  brightness: {
    type: RANGE,
    range: [0.5, 2],
    step: 0.1,
    default: 1.5,
    desc: "Brightness boost to compensate for RGB sub-line filtering",
    visibleWhen: (options: any) => options.mode === MODE.RGB_SUBLINES,
  },
  palette: {
    type: PALETTE,
    default: palettes.nearest,
    desc: "Optional output palette quantization",
  },
};

export const defaults = {
  mode: optionTypes.mode.default,
  visibleScanlines: optionTypes.visibleScanlines.default,
  beamMinWidth: optionTypes.beamMinWidth.default,
  beamMaxWidth: optionTypes.beamMaxWidth.default,
  beamStrength: optionTypes.beamStrength.default,
  intensity: optionTypes.intensity.default,
  gap: optionTypes.gap.default,
  height: optionTypes.height.default,
  lineHeight: optionTypes.lineHeight.default,
  brightness: optionTypes.brightness.default,
  palette: optionTypes.palette.default,
};

const scanline = (input: any, options = defaults) => {
  const resolved = { ...defaults, ...options };
  const {
    mode,
    visibleScanlines,
    beamMinWidth,
    beamMaxWidth,
    beamStrength,
    intensity,
    gap,
    height,
    lineHeight,
    brightness,
    palette,
  } = resolved;
  const W = input.width;
  const H = input.height;

  if (
    scanlineGLAvailable() &&
    (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest
      ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256)
      : 256;
    const rendered = renderScanlineGL(
      input,
      W,
      H,
      mode,
      visibleScanlines,
      beamMinWidth,
      beamMaxWidth,
      beamStrength,
      intensity,
      gap,
      height,
      lineHeight,
      brightness,
      levels,
    );
    if (rendered) {
      const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend(
          "Scanline",
          "WebGL2",
          `${mode}${isNearest ? ` levels=${levels}` : "+palettePass"}`,
        );
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y += 1) {
    const channelGroup = Math.floor(y / lineHeight) % 3;
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i];
      let g = buf[i + 1];
      let b = buf[i + 2];

      if (mode === MODE.BEAM_PROFILE) {
        const linearR = (r / 255) ** 2.4;
        const linearG = (g / 255) ** 2.4;
        const linearB = (b / 255) ** 2.4;
        const linearLuma = linearR * 0.2126 + linearG * 0.7152 + linearB * 0.0722;
        const sigma =
          beamMinWidth +
          (Math.max(beamMinWidth, beamMaxWidth) - beamMinWidth) * Math.sqrt(linearLuma);
        const linesPerPixel = Math.min(H, Math.max(1, visibleScanlines)) / H;
        const rasterPosition = (y + 0.5) * linesPerPixel;
        const beamAt = (position: number) => {
          const distance = Math.abs(position - Math.floor(position) - 0.5);
          return Math.exp(-0.5 * (distance / Math.max(0.01, sigma)) ** 2);
        };
        const integratedBeam =
          (beamAt(rasterPosition - linesPerPixel / 3) +
            beamAt(rasterPosition) +
            beamAt(rasterPosition + linesPerPixel / 3)) /
          3;
        const beam = 1 + (integratedBeam - 1) * beamStrength;
        r = Math.round(255 * (linearR * beam) ** (1 / 2.4));
        g = Math.round(255 * (linearG * beam) ** (1 / 2.4));
        b = Math.round(255 * (linearB * beam) ** (1 / 2.4));
      } else if (mode === MODE.DARKEN) {
        const scale = y % gap < height ? intensity : 1;
        r *= scale;
        g *= scale;
        b *= scale;
      } else {
        r = channelGroup === 0 ? Math.min(255, Math.round(r * brightness)) : 0;
        g = channelGroup === 1 ? Math.min(255, Math.round(g * brightness)) : 0;
        b = channelGroup === 2 ? Math.min(255, Math.round(b * brightness)) : 0;
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Scanline",
  func: scanline,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Resolution-independent CRT raster lines with a luminance-dependent Gaussian beam profile and legacy row modes",
});
