import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderKuwaharaGL } from "./kuwaharaGL";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 16], step: 1, default: 3, desc: "Filter kernel radius — larger = more painterly" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const buildKuwaharaSats = (buf: Uint8ClampedArray, W: number, H: number) => {
  const stride = W + 1;
  const size = stride * (H + 1);
  const satR = new Float64Array(size);
  const satG = new Float64Array(size);
  const satB = new Float64Array(size);
  const satR2 = new Float64Array(size);
  const satG2 = new Float64Array(size);
  const satB2 = new Float64Array(size);

  for (let y = 1; y <= H; y += 1) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    let rowR2 = 0;
    let rowG2 = 0;
    let rowB2 = 0;
    const srcRow = (y - 1) * W * 4;
    const satRow = y * stride;
    const prevSatRow = (y - 1) * stride;

    for (let x = 1; x <= W; x += 1) {
      const src = srcRow + (x - 1) * 4;
      const r = buf[src];
      const g = buf[src + 1];
      const b = buf[src + 2];

      rowR += r;
      rowG += g;
      rowB += b;
      rowR2 += r * r;
      rowG2 += g * g;
      rowB2 += b * b;

      const dst = satRow + x;
      satR[dst] = satR[prevSatRow + x] + rowR;
      satG[dst] = satG[prevSatRow + x] + rowG;
      satB[dst] = satB[prevSatRow + x] + rowB;
      satR2[dst] = satR2[prevSatRow + x] + rowR2;
      satG2[dst] = satG2[prevSatRow + x] + rowG2;
      satB2[dst] = satB2[prevSatRow + x] + rowB2;
    }
  }

  return { stride, satR, satG, satB, satR2, satG2, satB2 };
};

const kuwahara = (input: any, options: typeof defaults = defaults) => {
  const { radius, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderKuwaharaGL(input, W, H, radius);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Kuwahara", "WebGL2", `radius=${radius}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Kuwahara",
  func: kuwahara,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
