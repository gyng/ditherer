import { RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, getBufferIndex, rgba, srgbPaletteGetColor, fillBufferPixel, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { paletteIsIdentity } from "palettes/backend";
import { crossStitchGLAvailable, renderCrossStitchGL } from "./crossStitchGL";

const THREAD = {
  SOURCE: "SOURCE",
  PALETTE: "PALETTE"
};

export const optionTypes = {
  stitchSize: { type: RANGE, range: [4, 32], step: 1, default: 12, desc: "Size of each stitched tile in pixels" },
  threadColor: {
    type: ENUM,
    options: [
      { name: "Source color", value: THREAD.SOURCE },
      { name: "Palette-mapped", value: THREAD.PALETTE }
    ],
    default: THREAD.SOURCE,
    desc: "How stitch thread colors are chosen"
  },
  fabricColor: { type: COLOR, default: [240, 232, 214], desc: "Fabric base color behind the stitches" },
  gapBetween: { type: RANGE, range: [0, 4], step: 1, default: 1, desc: "Padding between neighboring stitched tiles" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  stitchSize: optionTypes.stitchSize.default,
  threadColor: optionTypes.threadColor.default,
  fabricColor: optionTypes.fabricColor.default,
  gapBetween: optionTypes.gapBetween.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type CrossStitchOptions = typeof defaults & { _webglAcceleration?: boolean };

const crossStitch = (input: any, options: CrossStitchOptions = defaults) => {
  const { stitchSize, threadColor, fabricColor, gapBetween, palette } = options;
  const W = input.width;
  const H = input.height;

  // GL path is safe when palette is identity (palette pass is a noop). In
  // PALETTE thread mode with a non-identity palette the JS applies the
  // palette to thread pixels only — a post-readout palette pass would
  // also recolour the fabric, which differs from the reference, so we
  // fall back to JS in that case.
  const identity = paletteIsIdentity(palette);
  const glSafe = identity || threadColor === THREAD.SOURCE;

  if (options._webglAcceleration !== false && glSafe && crossStitchGLAvailable()) {
    const rendered = renderCrossStitchGL(
      input, W, H,
      stitchSize, gapBetween,
      [fabricColor[0], fabricColor[1], fabricColor[2]],
      threadColor === THREAD.PALETTE,
    );
    if (rendered) {
      logFilterBackend("Cross Stitch", "WebGL2", `size=${stitchSize} mode=${threadColor}`);
      return rendered;
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = fabricColor[0];
    outBuf[i + 1] = fabricColor[1];
    outBuf[i + 2] = fabricColor[2];
    outBuf[i + 3] = 255;
  }

  for (let cy = 0; cy < H; cy += stitchSize) {
    for (let cx = 0; cx < W; cx += stitchSize) {
      const centerX = Math.min(W - 1, cx + Math.floor(stitchSize / 2));
      const centerY = Math.min(H - 1, cy + Math.floor(stitchSize / 2));
      const si = getBufferIndex(centerX, centerY, W);
      const srcColor = rgba(buf[si], buf[si + 1], buf[si + 2], 255);
      const thread = threadColor === THREAD.PALETTE ? srgbPaletteGetColor(palette, srcColor, palette.options) : srcColor;
      const startX = cx + gapBetween;
      const endX = Math.min(W, cx + stitchSize - gapBetween);
      const startY = cy + gapBetween;
      const endY = Math.min(H, cy + stitchSize - gapBetween);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const localX = x - cx;
          const localY = y - cy;
          const maxCoord = stitchSize - 1;
          const d1 = Math.abs(localX - localY);
          const d2 = Math.abs(localX + localY - maxCoord);
          const thickness = Math.max(0.6, stitchSize * 0.08);

          if (d1 <= thickness || d2 <= thickness) {
            const i = getBufferIndex(x, y, W);
            const shade = (d1 <= thickness * 0.5 || d2 <= thickness * 0.5) ? 0.92 : 0.75;
            fillBufferPixel(
              outBuf,
              i,
              Math.round(thread[0] * shade),
              Math.round(thread[1] * shade),
              Math.round(thread[2] * shade),
              255
            );
          }
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Cross Stitch",
  func: crossStitch,
  optionTypes,
  options: defaults,
  defaults
});
