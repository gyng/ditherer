import { RANGE, PALETTE, BOOL } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { waveGLAvailable, renderWaveGL } from "./waveGL";

export const optionTypes = {
  amplitudeX: { type: RANGE, range: [0, 100], step: 0.5, default: 10, desc: "Max horizontal displacement in pixels" },
  frequencyX: { type: RANGE, range: [0, 0.2], step: 0.001, default: 0.02, desc: "Horizontal wave frequency (cycles per pixel)" },
  amplitudeY: { type: RANGE, range: [0, 100], step: 0.5, default: 0, desc: "Max vertical displacement in pixels" },
  frequencyY: { type: RANGE, range: [0, 0.2], step: 0.001, default: 0.02, desc: "Vertical wave frequency (cycles per pixel)" },
  phaseX: { type: RANGE, range: [0, 6.28], step: 0.01, default: 0, desc: "Phase offset for horizontal wave (0 to 2pi)" },
  phaseY: { type: RANGE, range: [0, 6.28], step: 0.01, default: 0, desc: "Phase offset for vertical wave (0 to 2pi)" },
  diagonal: { type: BOOL, default: false, desc: "Drive waves along diagonal (x+y) instead of axes" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amplitudeX: optionTypes.amplitudeX.default,
  frequencyX: optionTypes.frequencyX.default,
  amplitudeY: optionTypes.amplitudeY.default,
  frequencyY: optionTypes.frequencyY.default,
  phaseX: optionTypes.phaseX.default,
  phaseY: optionTypes.phaseY.default,
  diagonal: optionTypes.diagonal.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type WaveOptions = typeof defaults & { _webglAcceleration?: boolean };

const wave = (input: any, options: WaveOptions = defaults) => {
  const { amplitudeX, frequencyX, amplitudeY, frequencyY, phaseX, phaseY, diagonal, palette } = options;
  const W = input.width;
  const H = input.height;

  if (options._webglAcceleration !== false && waveGLAvailable()) {
    const rendered = renderWaveGL(
      input, W, H,
      amplitudeX, frequencyX, amplitudeY, frequencyY,
      phaseX, phaseY, diagonal,
    );
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Wave", "WebGL2", `ampX=${amplitudeX} ampY=${amplitudeY}${identity ? "" : "+palettePass"}`);
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

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      // X displacement is driven by Y coordinate (and optionally X for diagonal)
      const drivingX = diagonal ? x + y : y;
      const drivingY = diagonal ? x + y : x;
      const offsetX = Math.round(Math.sin(drivingX * frequencyX + phaseX) * amplitudeX);
      const offsetY = Math.round(Math.sin(drivingY * frequencyY + phaseY) * amplitudeY);

      const srcX = Math.max(0, Math.min(W - 1, x + offsetX));
      const srcY = Math.max(0, Math.min(H - 1, y + offsetY));
      const srcI = getBufferIndex(srcX, srcY, W);

      const col = srgbPaletteGetColor(
        palette,
        rgba(buf[srcI], buf[srcI + 1], buf[srcI + 2], buf[srcI + 3]),
        palette.options
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Wave",
  func: wave,
  options: defaults,
  optionTypes,
  defaults
});
