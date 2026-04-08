import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const TELETEXT_COLORS: [number, number, number][] = [
  [0, 0, 0],       // black
  [255, 0, 0],     // red
  [0, 255, 0],     // green
  [255, 255, 0],   // yellow
  [0, 0, 255],     // blue
  [255, 0, 255],   // magenta
  [0, 255, 255],   // cyan
  [255, 255, 255]  // white
];

export const optionTypes = {
  columns: { type: RANGE, range: [20, 80], step: 1, default: 40 },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128 },
  blockGap: { type: RANGE, range: [0, 3], step: 1, default: 1 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  columns: optionTypes.columns.default,
  threshold: optionTypes.threshold.default,
  blockGap: optionTypes.blockGap.default,
  palette: { ...optionTypes.palette.default, options: { levels: 8 } }
};

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

const nearestTeletextColor = (
  r: number,
  g: number,
  b: number
): [number, number, number] => {
  let bestDist = Infinity;
  let best = TELETEXT_COLORS[0];
  for (let i = 0; i < TELETEXT_COLORS.length; i++) {
    const c = TELETEXT_COLORS[i];
    const dr = r - c[0];
    const dg = g - c[1];
    const db = b - c[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
};

const teletext = (
  input,
  options: any = defaults
) => {
  const { columns, threshold, blockGap, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Calculate cell dimensions based on column count
  // Teletext aspect ratio: each cell is 2 blocks wide x 3 blocks tall
  const cellW = Math.max(1, Math.floor(W / columns));
  const cellH = Math.max(1, Math.round(cellW * (10 / 12))); // maintain ~10:12 aspect
  const rows = Math.ceil(H / cellH);

  // Sub-block dimensions (2 columns x 3 rows per cell)
  const blockW = Math.max(1, Math.floor(cellW / 2));
  const blockH = Math.max(1, Math.floor(cellH / 3));

  // Fill background black first
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = 0;
    outBuf[i + 1] = 0;
    outBuf[i + 2] = 0;
    outBuf[i + 3] = 255;
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const cellX = cx * cellW;
      const cellY = cy * cellH;

      // Compute average color for the entire cell to determine fg/bg
      let totalR = 0;
      let totalG = 0;
      let totalB = 0;
      let brightR = 0;
      let brightG = 0;
      let brightB = 0;
      let darkR = 0;
      let darkG = 0;
      let darkB = 0;
      let brightCount = 0;
      let darkCount = 0;
      let count = 0;

      for (let py = cellY; py < Math.min(cellY + cellH, H); py++) {
        for (let px = cellX; px < Math.min(cellX + cellW, W); px++) {
          const idx = getBufferIndex(px, py, W);
          const r = buf[idx];
          const g = buf[idx + 1];
          const b = buf[idx + 2];
          totalR += r;
          totalG += g;
          totalB += b;
          count++;

          const lum = luminance(r, g, b);
          if (lum > threshold) {
            brightR += r;
            brightG += g;
            brightB += b;
            brightCount++;
          } else {
            darkR += r;
            darkG += g;
            darkB += b;
            darkCount++;
          }
        }
      }

      if (count === 0) continue;

      // Determine foreground color from bright pixels, background from dark pixels
      let fgColor: [number, number, number];
      let bgColor: [number, number, number];

      if (brightCount > 0) {
        fgColor = nearestTeletextColor(
          brightR / brightCount,
          brightG / brightCount,
          brightB / brightCount
        );
      } else {
        fgColor = nearestTeletextColor(
          totalR / count,
          totalG / count,
          totalB / count
        );
      }

      if (darkCount > 0) {
        bgColor = nearestTeletextColor(
          darkR / darkCount,
          darkG / darkCount,
          darkB / darkCount
        );
      } else {
        bgColor = TELETEXT_COLORS[0]; // black
      }

      // Ensure fg and bg differ; if they match, use black as bg
      if (fgColor[0] === bgColor[0] && fgColor[1] === bgColor[1] && fgColor[2] === bgColor[2]) {
        bgColor = TELETEXT_COLORS[0];
        if (fgColor[0] === 0 && fgColor[1] === 0 && fgColor[2] === 0) {
          fgColor = TELETEXT_COLORS[7]; // white
        }
      }

      // Apply palette mapping to fg and bg
      const fgMapped = paletteGetColor(
        palette,
        rgba(fgColor[0], fgColor[1], fgColor[2], 255),
        palette.options,
        false
      );
      const bgMapped = paletteGetColor(
        palette,
        rgba(bgColor[0], bgColor[1], bgColor[2], 255),
        palette.options,
        false
      );

      // Process each sub-block (2 wide x 3 tall)
      for (let by = 0; by < 3; by++) {
        for (let bx = 0; bx < 2; bx++) {
          const subX = cellX + bx * blockW;
          const subY = cellY + by * blockH;

          // Average luminance of this sub-block
          let subLum = 0;
          let subCount = 0;
          for (let py = subY; py < Math.min(subY + blockH, H); py++) {
            for (let px = subX; px < Math.min(subX + blockW, W); px++) {
              const idx = getBufferIndex(px, py, W);
              subLum += luminance(buf[idx], buf[idx + 1], buf[idx + 2]);
              subCount++;
            }
          }

          const avgLum = subCount > 0 ? subLum / subCount : 0;
          const isOn = avgLum > threshold;
          const color = isOn ? fgMapped : bgMapped;

          // Fill the sub-block pixels, leaving a gap
          for (let py = subY; py < Math.min(subY + blockH, H); py++) {
            for (let px = subX; px < Math.min(subX + blockW, W); px++) {
              // Check if this pixel is in the gap region
              const localX = px - subX;
              const localY = py - subY;
              const inGapX = localX >= blockW - blockGap;
              const inGapY = localY >= blockH - blockGap;

              if (inGapX || inGapY) {
                // Gap pixel: use a darker shade of the background
                const idx = getBufferIndex(px, py, W);
                fillBufferPixel(
                  outBuf,
                  idx,
                  Math.round(bgMapped[0] * 0.3),
                  Math.round(bgMapped[1] * 0.3),
                  Math.round(bgMapped[2] * 0.3),
                  255
                );
              } else {
                const idx = getBufferIndex(px, py, W);
                fillBufferPixel(outBuf, idx, color[0], color[1], color[2], 255);
              }
            }
          }
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Teletext",
  func: teletext,
  options: defaults,
  optionTypes,
  defaults
};
