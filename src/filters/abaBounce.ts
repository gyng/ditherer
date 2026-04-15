import { ACTION, RANGE } from "constants/controlTypes";
import { cloneCanvas } from "utils";
import { defineFilter, type FilterOptionValues } from "filters/types";

let heldABuf: Uint8ClampedArray | null = null;
let heldBBuf: Uint8ClampedArray | null = null;
let heldWidth = 0;
let heldHeight = 0;
let lastFrameIndex = -1;

const resetTriplet = (source: Uint8ClampedArray, width: number, height: number) => {
  heldABuf = new Uint8ClampedArray(source);
  heldBBuf = null;
  heldWidth = width;
  heldHeight = height;
};

export const optionTypes = {
  strength: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 1.1,
    desc: "How hard the third beat reflects backward from B toward and past A",
  },
  cadenceDrift: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.45,
    desc: "How much the emphasized bounce beat wanders between strict ABA timing and a looser variable-frame cadence",
  },
  animSpeed: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 15,
    desc: "Playback speed when using the built-in animation toggle",
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  strength: optionTypes.strength.default,
  cadenceDrift: optionTypes.cadenceDrift.default,
  animSpeed: optionTypes.animSpeed.default,
};

type AbaBounceOptions = FilterOptionValues & typeof defaults & {
  _frameIndex?: number;
};

const abaBounce = (input: any, options: AbaBounceOptions = defaults) => {
  const strength = Math.max(0, Number(options.strength ?? defaults.strength));
  const cadenceDrift = Math.max(0, Math.min(1, Number(options.cadenceDrift ?? defaults.cadenceDrift)));
  const frameIndex = Number(options._frameIndex ?? 0);
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const source = inputCtx.getImageData(0, 0, width, height).data;
  const restartedAnimation = frameIndex === 0 && lastFrameIndex > 0;
  const phase = ((frameIndex % 3) + 3) % 3;
  const cadenceOffset = cadenceDrift <= 0
    ? 0
    : ((Math.sin(frameIndex * 0.91) + Math.sin(frameIndex * 0.37 + 1.7)) * 0.25 + 0.5) < cadenceDrift
      ? 1
      : 0;
  const effectivePhase = (phase + cadenceOffset) % 3;

  if (!heldABuf || heldWidth !== width || heldHeight !== height || restartedAnimation) {
    resetTriplet(source, width, height);
  }
  lastFrameIndex = frameIndex;

  if (effectivePhase === 0) {
    resetTriplet(source, width, height);
    outputCtx.putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0);
    return output;
  }

  if (effectivePhase === 1) {
    heldBBuf = new Uint8ClampedArray(source);
    outputCtx.putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0);
    return output;
  }

  if (!heldABuf) {
    outputCtx.putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0);
    return output;
  }

  const bBuf = heldBBuf || source;
  const outBuf = new Uint8ClampedArray(source.length);
  // The reflection math is read-two-buffers write-one — memory-bandwidth
  // bound. WASM doesn't beat the JS JIT here once you pay for three
  // cross-boundary u8 buffer copies, so this stays on the JS path.
  for (let i = 0; i < source.length; i += 4) {
    const dr = bBuf[i] - heldABuf[i];
    const dg = bBuf[i + 1] - heldABuf[i + 1];
    const db = bBuf[i + 2] - heldABuf[i + 2];
    outBuf[i] = Math.max(0, Math.min(255, Math.round(heldABuf[i] - dr * strength)));
    outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(heldABuf[i + 1] - dg * strength)));
    outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(heldABuf[i + 2] - db * strength)));
    outBuf[i + 3] = source[i + 3];
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter<AbaBounceOptions>({
  name: "ABA Bounce",
  func: abaBounce,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Store A and B, then turn the emphasized beat into a reflected reverse frame whose cadence can drift off the strict ABA grid",
});
