import { PALETTE, RANGE, STRING, BOOL } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { cloneCanvas, getBufferIndex, rgba, srgbBufToLinearFloat, delinearizeColorF, srgbPaletteGetColor, linearPaletteGetColor, logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas } from "../palettes/backend";
import { defineFilter, type FilterOptionValues } from "./types";
import { halftoneGLAvailable, parseCssColorRgb, renderHalftoneGL } from "./halftoneGL";

export const optionTypes = {
  size: { type: RANGE, range: [1, 512], step: 1, default: 6, desc: "Sampling grid cell size in pixels" },
  sizeMultiplier: { type: RANGE, range: [0, 5], step: 0.1, default: 1, desc: "Multiplier for rendered dot size relative to grid cell" },
  offset: { type: RANGE, range: [0, 3], step: 0.1, default: 0.3, desc: "RGB channel separation distance as fraction of cell size" },
  levels: { type: RANGE, range: [0, 255], default: 32, desc: "Number of distinct dot sizes for quantization" },
  palette: { type: PALETTE, default: nearest },
  squareDots: { type: BOOL, default: false, desc: "Use square dots instead of circles" },
  background: { type: STRING, default: "black", desc: "Background fill color behind the halftone dots" }
};

export const defaults = {
  size: optionTypes.size.default,
  sizeMultiplier: optionTypes.sizeMultiplier.default,
  offset: optionTypes.offset.default,
  levels: optionTypes.levels.default,
  palette: { ...optionTypes.palette.default, options: { levels: 8 } },
  squareDots: optionTypes.squareDots.default,
  background: optionTypes.background.default
};

type HalftoneOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
};

const halftone = (
  input: any,
  options: HalftoneOptions = defaults
) => {
  const getOffset = (
    radians: number,
    radius: number,
    x0: number,
    y0: number
  ) => {
    const x = x0 + radius * Math.cos(radians);
    const y = y0 + radius * Math.sin(radians);
    return [x, y];
  };
  const { background, palette } = options;
  const size = parseInt(String(options.size), 10);
  // Exposed dot-size quantisation control. Only the `nearest` palette's
  // getColor honours a `levels` count, so gate the effective level count on it:
  // for a nearest palette the slider is live in BOTH backends (and they agree);
  // for a custom palette both backends pass through at 256 so they still agree
  // (the palette ignores levels — the slider is correctly inert). Mapping the
  // "no quantisation" case to 256 also avoids nearest's divide-by-zero at
  // levels=1 and matches the shader's `u_levels > 1.5` passthrough.
  const isNearest = (palette as any).name === "nearest";
  const rawLevels = Math.max(1, Number(options.levels) | 0);
  const effectiveLevels = isNearest && rawLevels > 1 ? rawLevels : 256;

  // WebGL fast path. Renders the dots + screen-composite in shader; for
  // nearest palettes the shader also handles quantisation, for custom
  // palettes we apply the standard palette pass on readback.
  // Still falls through when the background colour can't be parsed.
  if (halftoneGLAvailable() && (options as any)._webglAcceleration !== false) {
    const bgRgb = parseCssColorRgb(typeof background === "string" ? background : "black");
    if (bgRgb) {
      const W = input.width, H = input.height;
      const rendered = renderHalftoneGL(
        input, W, H, size,
        options.sizeMultiplier, options.offset,
        effectiveLevels, options.squareDots, bgRgb,
      );
      if (rendered) {
        const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Halftone", "WebGL2", `size=${size} levels=${effectiveLevels}${isNearest ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  outputCtx.globalCompositeOperation = "screen";
  if (typeof background === "string") {
    outputCtx.fillStyle = background;
    outputCtx.fillRect(0, 0, output.width, output.height);
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);

    for (let x = 0; x < input.width; x += size) {
      for (let y = 0; y < input.height; y += size) {
        const meanColor = [0, 0, 0, 0];
        const blockW = Math.min(size, input.width - x);
        const blockH = Math.min(size, input.height - y);
        const pixels = blockW * blockH;

        for (let w = 0; w < blockW; w += 1) {
          for (let h = 0; h < blockH; h += 1) {
            const sourceIdx = getBufferIndex(x + w, y + h, output.width);

            for (let c = 0; c < 4; c += 1) {
              meanColor[c] += floatBuf[sourceIdx + c] / pixels;
            }
          }
        }

        // Quantize mean color via palette (float 0-1), then convert to sRGB for drawing
        const quantizedColor = linearPaletteGetColor(palette, meanColor, { ...palette.options, levels: effectiveLevels });
        const srgbColor = delinearizeColorF(quantizedColor);
        const radii = srgbColor.map(
          (c: number) => c * (size / 2 / 255) * options.sizeMultiplier
        );

        const alphaFrac = srgbColor[3] / 255;
        const colors = [
          `rgba(255, 0, 0, ${alphaFrac}`,
          `rgba(0, 255, 0, ${alphaFrac}`,
          `rgba(0, 0, 255, ${alphaFrac}`
        ];

        const centerX = x + size / 2;
        const centerY = y + size / 2;
        const offsetDistance = size * options.offset;
        const centers = [
          getOffset((2 * Math.PI) / 3, offsetDistance, centerX, centerY),
          getOffset((2 * 2 * Math.PI) / 3, offsetDistance, centerX, centerY),
          getOffset(2 * Math.PI, offsetDistance, centerX, centerY)
        ];

        for (let c = 0; c < 3; c += 1) {
          if (options.squareDots) {
            outputCtx.fillStyle = colors[c];
            outputCtx.fillRect(centers[c][0], centers[c][1], radii[c], radii[c]);
          } else {
            outputCtx.beginPath();
            outputCtx.arc(centers[c][0], centers[c][1], radii[c], 0, Math.PI * 2);
            outputCtx.fillStyle = colors[c];
            outputCtx.fill();
          }
        }
      }
    }
  } else {
    for (let x = 0; x < input.width; x += size) {
      for (let y = 0; y < input.height; y += size) {
        const meanColor = rgba(0, 0, 0, 0);
        const blockW = Math.min(size, input.width - x);
        const blockH = Math.min(size, input.height - y);
        const pixels = blockW * blockH;

        for (let w = 0; w < blockW; w += 1) {
          for (let h = 0; h < blockH; h += 1) {
            const sourceIdx = getBufferIndex(x + w, y + h, output.width);

            for (let c = 0; c < 4; c += 1) {
              meanColor[c] += buf[sourceIdx + c] / pixels;
            }
          }
        }

        const quantizedColor = srgbPaletteGetColor(palette, meanColor, { ...palette.options, levels: effectiveLevels });
        const radii = quantizedColor.map(
          (c: number) => c * (size / 2 / 255) * options.sizeMultiplier
        );

        const colors = [
          `rgba(255, 0, 0, ${meanColor[3] / 255}`,
          `rgba(0, 255, 0, ${meanColor[3] / 255}`,
          `rgba(0, 0, 255, ${meanColor[3] / 255}`
        ];

        const centerX = x + size / 2;
        const centerY = y + size / 2;
        const offsetDistance = size * options.offset;
        const centers = [
          getOffset((2 * Math.PI) / 3, offsetDistance, centerX, centerY),
          getOffset((2 * 2 * Math.PI) / 3, offsetDistance, centerX, centerY),
          getOffset(2 * Math.PI, offsetDistance, centerX, centerY)
        ];

        for (let c = 0; c < 3; c += 1) {
          if (options.squareDots) {
            outputCtx.fillStyle = colors[c];
            outputCtx.fillRect(centers[c][0], centers[c][1], radii[c], radii[c]);
          } else {
            outputCtx.beginPath();
            outputCtx.arc(centers[c][0], centers[c][1], radii[c], 0, Math.PI * 2);
            outputCtx.fillStyle = colors[c];
            outputCtx.fill();
          }
        }
      }
    }
  }

  outputCtx.globalCompositeOperation = "source-over";
  return output;
};

export default defineFilter<HalftoneOptions>({
  name: "Halftone",
  func: halftone,
  options: defaults,
  optionTypes,
  defaults
});
