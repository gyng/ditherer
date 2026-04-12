import { RANGE, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas, getBufferIndex } from "utils";

// Module-level energy buffer persists across frames
let energyBuf: Float32Array | null = null;
let energyW = 0;
let energyH = 0;

export const optionTypes = {
  intensity: { type: RANGE, range: [1, 20], step: 1, default: 8, desc: "Max pixel displacement" },
  turbulence: { type: RANGE, range: [1, 5], step: 0.5, default: 2, desc: "Noise frequency in the warp pattern" },
  settleSpeed: { type: RANGE, range: [0.02, 0.2], step: 0.01, default: 0.08, desc: "How fast distortion fades after motion stops" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  turbulence: optionTypes.turbulence.default,
  settleSpeed: optionTypes.settleSpeed.default,
  animSpeed: optionTypes.animSpeed.default,
};

type WakeTurbulenceOptions = FilterOptionValues & {
  intensity?: number;
  turbulence?: number;
  settleSpeed?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _frameIndex?: number;
};

const wakeTurbulence = (input: any, options: WakeTurbulenceOptions = defaults) => {
  const intensity = Number(options.intensity ?? defaults.intensity);
  const turbulence = Number(options.turbulence ?? defaults.turbulence);
  const settleSpeed = Number(options.settleSpeed ?? defaults.settleSpeed);
  const ema = options._ema ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const pixelCount = W * H;

  // Reset energy buffer if dimensions changed
  if (!energyBuf || energyW !== W || energyH !== H) {
    energyBuf = new Float32Array(pixelCount);
    energyW = W;
    energyH = H;
  }

  // Update energy: decay + inject from motion
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const motion = ema
      ? (Math.abs(buf[i] - ema[i]) + Math.abs(buf[i + 1] - ema[i + 1]) + Math.abs(buf[i + 2] - ema[i + 2])) / 765
      : 0;
    energyBuf[p] = Math.min(1, energyBuf[p] * (1 - settleSpeed) + motion * 0.5);
  }

  // Displace pixels based on energy
  const t = frameIndex * 0.15;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const e = energyBuf[p];
      const dx = Math.round(e * intensity * Math.sin(x * turbulence * 0.1 + t));
      const dy = Math.round(e * intensity * Math.cos(y * turbulence * 0.1 + t * 0.7));
      const sx = Math.max(0, Math.min(W - 1, x + dx));
      const sy = Math.max(0, Math.min(H - 1, y + dy));
      const si = getBufferIndex(sx, sy, W);
      const di = getBufferIndex(x, y, W);
      outBuf[di] = buf[si]; outBuf[di + 1] = buf[si + 1];
      outBuf[di + 2] = buf[si + 2]; outBuf[di + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Wake Turbulence", func: wakeTurbulence, optionTypes, options: defaults, defaults, mainThread: true, description: "Moving objects leave rippling distortion in their wake — heat shimmer effect" });
