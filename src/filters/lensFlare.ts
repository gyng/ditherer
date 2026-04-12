import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  positionX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Horizontal light source position" },
  positionY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Vertical light source position" },
  intensity: { type: RANGE, range: [0, 2], step: 0.1, default: 1, desc: "Overall flare brightness" },
  flareColor: { type: COLOR, default: [255, 200, 100], desc: "Tint color of the flare" },
  ghosts: { type: RANGE, range: [0, 6], step: 1, default: 3, desc: "Number of lens ghost reflections" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  positionX: optionTypes.positionX.default,
  positionY: optionTypes.positionY.default,
  intensity: optionTypes.intensity.default,
  flareColor: optionTypes.flareColor.default,
  ghosts: optionTypes.ghosts.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lensFlare = (input, options = defaults) => {
  const { positionX, positionY, intensity, flareColor, ghosts, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  outBuf.set(buf);

  const cx = W * positionX, cy = H * positionY;
  const imgCx = W / 2, imgCy = H / 2;

  // Additive blend helper
  const addLight = (px: number, py: number, fr: number, fg: number, fb: number, brightness: number) => {
    if (px < 0 || px >= W || py < 0 || py >= H) return;
    const i = getBufferIndex(Math.round(px), Math.round(py), W);
    outBuf[i] = Math.min(255, outBuf[i] + Math.round(fr * brightness));
    outBuf[i + 1] = Math.min(255, outBuf[i + 1] + Math.round(fg * brightness));
    outBuf[i + 2] = Math.min(255, outBuf[i + 2] + Math.round(fb * brightness));
  };

  // Central bloom
  const bloomR = Math.max(W, H) * 0.15;
  for (let dy = -bloomR; dy <= bloomR; dy++) {
    for (let dx = -bloomR; dx <= bloomR; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > bloomR) continue;
      const falloff = Math.pow(1 - dist / bloomR, 2) * intensity * 0.4;
      addLight(cx + dx, cy + dy, flareColor[0], flareColor[1], flareColor[2], falloff);
    }
  }

  // Ghost reflections
  for (let g = 0; g < ghosts; g++) {
    const t = (g + 1) * 0.4;
    const ghostX = cx + (imgCx - cx) * t;
    const ghostY = cy + (imgCy - cy) * t;
    const ghostR = 15 + g * 12;
    const ghostIntensity = intensity * 0.25 / (g + 1);

    for (let dy = -ghostR; dy <= ghostR; dy++) {
      for (let dx = -ghostR; dx <= ghostR; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > ghostR) continue;
        // Ring shape: brighter at edge
        const ringFalloff = Math.abs(dist / ghostR - 0.7) < 0.3
          ? (1 - Math.abs(dist / ghostR - 0.7) / 0.3) * ghostIntensity
          : 0;
        addLight(ghostX + dx, ghostY + dy, flareColor[0], flareColor[1], flareColor[2], ringFalloff);
      }
    }
  }

  // Anamorphic streak (horizontal)
  const streakLength = W * 0.4;
  const streakHeight = 3;
  for (let dy = -streakHeight; dy <= streakHeight; dy++) {
    const yFalloff = 1 - Math.abs(dy) / streakHeight;
    for (let dx = -streakLength; dx <= streakLength; dx++) {
      const xFalloff = Math.pow(1 - Math.abs(dx) / streakLength, 3);
      const brightness = xFalloff * yFalloff * intensity * 0.15;
      addLight(cx + dx, cy + dy, flareColor[0], flareColor[1], flareColor[2], brightness);
    }
  }

  // Apply palette
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Lens Flare", func: lensFlare, optionTypes, options: defaults, defaults });
