import { RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { rgba, srgbPaletteGetColor, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { paletteIsIdentity, applyPalettePassToCanvas } from "palettes/backend";
import { renderCrossStitchGL } from "./crossStitchGL";

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

// Palette handling:
//   • SOURCE thread mode — JS doesn't palette-map anything, so GL renders
//     source-sampled thread + raw fabric and skips the palette pass.
//   • PALETTE thread mode with identity palette — nothing to do.
//   • PALETTE thread mode with non-identity palette — pre-palette-map the
//     fabric colour so it's idempotent under the post-readout palette
//     pass; the shader writes raw source colours on thread pixels, and
//     the palette pass maps them to palette colours while fabric pixels
//     (already in the palette) stay put.
const crossStitch = (input: any, options: typeof defaults = defaults) => {
  const { stitchSize, threadColor, fabricColor, gapBetween, palette } = options;
  const W = input.width, H = input.height;
  const identity = paletteIsIdentity(palette);
  const needsPalettePass = threadColor === THREAD.PALETTE && !identity;
  const fabricForShader = needsPalettePass
    ? srgbPaletteGetColor(palette, rgba(fabricColor[0], fabricColor[1], fabricColor[2], 255), palette.options)
    : [fabricColor[0], fabricColor[1], fabricColor[2]];
  const rendered = renderCrossStitchGL(
    input, W, H,
    stitchSize, gapBetween,
    [fabricForShader[0], fabricForShader[1], fabricForShader[2]],
    threadColor === THREAD.PALETTE,
  );
  if (!rendered) return input;
  const out = needsPalettePass ? applyPalettePassToCanvas(rendered, W, H, palette) : rendered;
  logFilterBackend("Cross Stitch", "WebGL2", `size=${stitchSize} mode=${threadColor}${needsPalettePass ? "+palettePass" : ""}`);
  return out ?? input;
};

export default defineFilter({
  name: "Cross Stitch",
  func: crossStitch,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
