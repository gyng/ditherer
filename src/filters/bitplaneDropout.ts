import { ACTION, BOOL, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, paletteGetColor, rgba } from "utils";

const MODE = {
  DROP: "DROP",
  FREEZE: "FREEZE",
  FLIP: "FLIP",
};

let burstFramesRemaining = 0;
let activeMask = 0;

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const optionTypes = {
  mode: {
    type: ENUM,
    default: MODE.DROP,
    options: [
      { name: "Drop bits", value: MODE.DROP },
      { name: "Freeze from previous", value: MODE.FREEZE },
      { name: "Flip bits", value: MODE.FLIP },
    ],
    desc: "How corrupted bitplanes are applied"
  },
  targetBits: { type: RANGE, range: [1, 255], step: 1, default: 7, desc: "Bitmask of target planes (1=LSB, 128=MSB)" },
  perChannel: { type: BOOL, default: true, desc: "Corrupt R/G/B with independent masks instead of one shared mask" },
  burstChance: { type: RANGE, range: [0, 1], step: 0.01, default: 0.12, desc: "Chance that a corruption burst starts on this frame" },
  burstLength: { type: RANGE, range: [1, 180], step: 1, default: 24, desc: "Burst duration in frames before recovery" },
  recoverRate: { type: RANGE, range: [0, 1], step: 0.01, default: 0.08, desc: "Extra chance to shorten the active burst each frame" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  targetBits: optionTypes.targetBits.default,
  perChannel: optionTypes.perChannel.default,
  burstChance: optionTypes.burstChance.default,
  burstLength: optionTypes.burstLength.default,
  recoverRate: optionTypes.recoverRate.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type BitplaneDropoutOptions = FilterOptionValues & {
  mode?: string;
  targetBits?: number;
  perChannel?: boolean;
  burstChance?: number;
  burstLength?: number;
  recoverRate?: number;
  animSpeed?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  _frameIndex?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

const bitplaneDropout = (input: any, options: BitplaneDropoutOptions = defaults) => {
  const mode = String(options.mode ?? defaults.mode);
  const targetBits = Number(options.targetBits ?? defaults.targetBits);
  const perChannel = Boolean(options.perChannel ?? defaults.perChannel);
  const burstChance = Number(options.burstChance ?? defaults.burstChance);
  const burstLength = Number(options.burstLength ?? defaults.burstLength);
  const recoverRate = Number(options.recoverRate ?? defaults.recoverRate);
  const palette = options.palette ?? defaults.palette;
  const frameIndex = Number(options._frameIndex ?? 0);
  const prevOutput = options._prevOutput ?? null;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const w = input.width;
  const h = input.height;
  const src = inputCtx.getImageData(0, 0, w, h).data;
  const outBuf = new Uint8ClampedArray(src.length);

  const rng = mulberry32(frameIndex * 3571 + 9001);

  if (burstFramesRemaining <= 0 && rng() < burstChance) {
    burstFramesRemaining = Math.max(1, Math.round(burstLength));
    const rotate = Math.floor(rng() * 8);
    activeMask = ((targetBits << rotate) | (targetBits >>> (8 - rotate))) & 0xff;
    if (activeMask === 0) activeMask = targetBits;
  }

  const burstActive = burstFramesRemaining > 0;
  if (burstActive) {
    burstFramesRemaining -= 1;
    if (rng() < recoverRate) burstFramesRemaining = Math.max(0, burstFramesRemaining - 1);
  }

  const baseMask = burstActive ? activeMask : 0;

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i];
    let g = src[i + 1];
    let b = src[i + 2];

    if (baseMask !== 0) {
      const mr = perChannel ? ((baseMask << 1) | (baseMask >>> 7)) & 0xff : baseMask;
      const mg = perChannel ? baseMask : baseMask;
      const mb = perChannel ? ((baseMask >>> 1) | (baseMask << 7)) & 0xff : baseMask;

      if (mode === MODE.DROP) {
        r &= ~mr;
        g &= ~mg;
        b &= ~mb;
      } else if (mode === MODE.FLIP) {
        r ^= mr;
        g ^= mg;
        b ^= mb;
      } else if (prevOutput && prevOutput.length === src.length) {
        r = (r & ~mr) | (prevOutput[i] & mr);
        g = (g & ~mg) | (prevOutput[i + 1] & mg);
        b = (b & ~mb) | (prevOutput[i + 2] & mb);
      } else {
        r &= ~mr;
        g &= ~mg;
        b &= ~mb;
      }
    }

    const color = paletteGetColor(palette, rgba(r, g, b, src[i + 3]), palette.options, false);
    fillBufferPixel(outBuf, i, color[0], color[1], color[2], src[i + 3]);
  }

  outputCtx.putImageData(new ImageData(outBuf, w, h), 0, 0);
  return output;
};

export default defineFilter({
  name: "Bitplane Dropout",
  func: bitplaneDropout,
  optionTypes,
  options: defaults,
  defaults,
  description: "Corrupt specific RGB bitplanes in bursts so significance levels drop, freeze, or flip like real digital faults",
  temporal: true,
});
