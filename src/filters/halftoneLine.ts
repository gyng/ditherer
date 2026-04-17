import { RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { rgba, srgbPaletteGetColor, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { renderHalftoneLineGL } from "./halftoneLineGL";

const ANGLE_MODE = {
  CONSTANT: "CONSTANT",
  LUMINANCE: "LUMINANCE",
  GRADIENT: "GRADIENT"
};

export const optionTypes = {
  cellSize: { type: RANGE, range: [8, 48], step: 1, default: 16, desc: "Grid cell size in pixels" },
  angleMode: {
    type: ENUM,
    options: [
      { name: "Constant", value: ANGLE_MODE.CONSTANT },
      { name: "Vary by luminance", value: ANGLE_MODE.LUMINANCE },
      { name: "Vary by gradient", value: ANGLE_MODE.GRADIENT }
    ],
    default: ANGLE_MODE.CONSTANT,
    desc: "How line angle is chosen per cell"
  },
  baseAngle: { type: RANGE, range: [0, 180], step: 1, default: 45, desc: "Base line angle in degrees" },
  inkColor: { type: COLOR, default: [20, 18, 15], desc: "Ink color of the rendered line marks" },
  paperColor: { type: COLOR, default: [245, 240, 226], desc: "Paper color behind the halftone lines" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  angleMode: optionTypes.angleMode.default,
  baseAngle: optionTypes.baseAngle.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Pre-palette-map ink and paper on the CPU so the shader renders final
// colours directly. Every output pixel is either ink or paper, so
// palette-mapping those two colours once is equivalent to mapping every
// pixel afterward — skips the post-readout palette pass entirely.
const halftoneLine = (input: any, options: typeof defaults = defaults) => {
  const { cellSize, angleMode, baseAngle, inkColor, paperColor, palette } = options;
  const W = input.width, H = input.height;
  const inkMapped = srgbPaletteGetColor(palette, rgba(inkColor[0], inkColor[1], inkColor[2], 255), palette.options);
  const paperMapped = srgbPaletteGetColor(palette, rgba(paperColor[0], paperColor[1], paperColor[2], 255), palette.options);
  const modeInt = angleMode === ANGLE_MODE.CONSTANT ? 0 : angleMode === ANGLE_MODE.LUMINANCE ? 1 : 2;
  const rendered = renderHalftoneLineGL(
    input, W, H, cellSize,
    modeInt as 0 | 1 | 2,
    (baseAngle * Math.PI) / 180,
    [inkMapped[0], inkMapped[1], inkMapped[2]],
    [paperMapped[0], paperMapped[1], paperMapped[2]],
  );
  if (!rendered) return input;
  logFilterBackend("Halftone Line", "WebGL2", `cell=${cellSize} mode=${angleMode}`);
  return rendered;
};

export default defineFilter({
  name: "Halftone Line",
  func: halftoneLine,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
