import { RANGE, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "../utils/index";
import { normalizeEnumOption, normalizeRangeOption } from "../utils/filterOptions";
import { defineFilter } from "./types";

const EFFECT = { ECHO: "ECHO", REVERB: "REVERB", BITCRUSH: "BITCRUSH", REVERSE: "REVERSE" } as const;
const EFFECTS = [EFFECT.ECHO, EFFECT.REVERB, EFFECT.BITCRUSH, EFFECT.REVERSE] as const;

export const optionTypes = {
  effect: { type: ENUM, options: [
    { name: "Echo", value: EFFECT.ECHO },
    { name: "Reverb", value: EFFECT.REVERB },
    { name: "Bitcrush", value: EFFECT.BITCRUSH },
    { name: "Reverse", value: EFFECT.REVERSE }
  ], default: EFFECT.ECHO, desc: "Audio-style corruption applied to the raw pixel byte stream" },
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Effect strength" },
  offset: { type: RANGE, range: [1, 500], step: 1, default: 100, desc: "Byte offset for echo/reverb/reverse — unaligned to the 4-byte pixel stride, so channels bleed" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
};

export const defaults = {
  effect: optionTypes.effect.default,
  intensity: optionTypes.intensity.default,
  offset: optionTypes.offset.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp255 = (v: number): number => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);

// Databending opens the raw image byte stream in an audio editor and applies
// DSP. The glitch character comes from operating on the *flat interleaved*
// byte stream (so a delay bleeds R into G/B and shears rows) and from treating
// each byte as a bipolar audio sample about a 128 midpoint (so an echo can
// darken as well as brighten). The previous filter stepped i += 4 per channel
// and only ever added toward white — a per-channel ghost, not a databend.
const dataBend = (input: any, options: Partial<typeof defaults> = defaults) => {
  const effect = normalizeEnumOption(options.effect, EFFECTS, defaults.effect);
  const intensity = normalizeRangeOption(options.intensity, defaults.intensity, 0, 1);
  const offset = normalizeRangeOption(options.offset, defaults.offset, 1, 500, true);
  const palette = options.palette ?? defaults.palette;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  outBuf.set(buf);
  const n = outBuf.length;

  switch (effect) {
    case EFFECT.ECHO: {
      // Bipolar echo on the flat byte stream: out = signal + decay*(delayed-128).
      const delay = offset; // bytes, deliberately not a multiple of 4
      const decay = intensity;
      for (let i = delay; i < n; i++) {
        outBuf[i] = clamp255(buf[i] + (buf[i - delay] - 128) * decay);
      }
      break;
    }
    case EFFECT.REVERB: {
      const acc = new Float32Array(n);
      for (let i = 0; i < n; i++) acc[i] = buf[i];
      for (let echo = 1; echo <= 5; echo++) {
        const delay = offset * echo;
        const decay = intensity * Math.pow(0.6, echo);
        if (delay >= n) break;
        for (let i = delay; i < n; i++) {
          acc[i] += (buf[i - delay] - 128) * decay;
        }
      }
      for (let i = 0; i < n; i++) outBuf[i] = clamp255(acc[i]);
      break;
    }
    case EFFECT.BITCRUSH: {
      // Bit-depth reduction plus sample-rate decimation, on the flat stream.
      const bits = Math.max(1, Math.round(8 - intensity * 6));
      const step = Math.pow(2, 8 - bits);
      for (let i = 0; i < n; i++) outBuf[i] = Math.min(255, Math.round(buf[i] / step) * step);
      const sampleBytes = Math.max(1, Math.round(offset / 10));
      for (let i = 0; i < n; i++) {
        const aligned = Math.floor(i / sampleBytes) * sampleBytes;
        if (aligned !== i) outBuf[i] = outBuf[aligned];
      }
      break;
    }
    case EFFECT.REVERSE: {
      // Reverse raw byte chunks — scrambles channel order like a real databend.
      const chunk = Math.max(2, offset);
      for (let start = 0; start < n; start += chunk * 2) {
        const end = Math.min(start + chunk, n);
        for (let i = start, j = end - 1; i < j; i++, j--) {
          const tmp = outBuf[i]; outBuf[i] = outBuf[j]; outBuf[j] = tmp;
        }
      }
      break;
    }
  }

  // Restore alpha so transparency does not flicker from the byte-stream ops.
  for (let i = 3; i < n; i += 4) outBuf[i] = buf[i];

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Data Bend",
  func: dataBend,
  optionTypes,
  options: defaults,
  defaults,
  noGL: "Operates on the raw byte stream (echo/reverb/bitcrush/reverse) rather than pixel neighbourhoods — not a fragment-shader problem.",
});
