import { ACTION, RANGE } from "constants/controlTypes";
import { cloneCanvas } from "utils";

let heldABuf: Uint8ClampedArray | null = null;
let heldBBuf: Uint8ClampedArray | null = null;
let ghostBuf: Float32Array | null = null;
let heldWidth = 0;
let heldHeight = 0;
let lastFrameIndex = -1;

const resetTriplet = (source: Uint8ClampedArray, width: number, height: number) => {
  heldABuf = new Uint8ClampedArray(source);
  heldBBuf = null;
  ghostBuf = new Float32Array(source.length);
  heldWidth = width;
  heldHeight = height;
};

export const optionTypes = {
  ghostMix: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.95,
    desc: "How strongly the stored B frame dominates the returned A beat so the ghost image stays obvious instead of reading like pure stutter",
  },
  persistence: {
    type: RANGE,
    range: [0, 0.99],
    step: 0.01,
    default: 0.85,
    desc: "How long the ghost image lingers across later beats and triplets",
  },
  flash: {
    type: RANGE,
    range: [0, 1.8],
    step: 0.05,
    default: 0.15,
    desc: "Brightness lift applied to the ghosted beat; lower values keep the persistent double exposure dominant",
  },
  cadenceDrift: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.45,
    desc: "How much the emphasized ghost beat wanders between strict ABA timing and a looser variable-frame cadence",
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
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  ghostMix: optionTypes.ghostMix.default,
  persistence: optionTypes.persistence.default,
  flash: optionTypes.flash.default,
  cadenceDrift: optionTypes.cadenceDrift.default,
  animSpeed: optionTypes.animSpeed.default,
};

const abaGhost = (input, options: any = defaults) => {
  const ghostMix = Math.max(0, Math.min(1, Number(options.ghostMix ?? defaults.ghostMix)));
  const persistence = Math.max(0, Math.min(0.999, Number(options.persistence ?? defaults.persistence)));
  const flash = Math.max(0, Number(options.flash ?? defaults.flash));
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

  if (!heldABuf || !ghostBuf || heldWidth !== width || heldHeight !== height || restartedAnimation) {
    resetTriplet(source, width, height);
  }
  lastFrameIndex = frameIndex;

  if (effectivePhase === 0) {
    heldABuf = new Uint8ClampedArray(source);
    heldBBuf = null;
  } else if (effectivePhase === 1) {
    heldBBuf = new Uint8ClampedArray(source);
  }

  const bBuf = heldBBuf || source;
  const outBuf = new Uint8ClampedArray(source.length);

  for (let i = 0; i < source.length; i += 4) {
    const injectedGhostR = (heldABuf![i] * (1 - ghostMix) + bBuf[i] * ghostMix) * flash;
    const injectedGhostG = (heldABuf![i + 1] * (1 - ghostMix) + bBuf[i + 1] * ghostMix) * flash;
    const injectedGhostB = (heldABuf![i + 2] * (1 - ghostMix) + bBuf[i + 2] * ghostMix) * flash;

    const ghostWrite = effectivePhase === 2 ? 1 : 0.18;
    ghostBuf![i] = ghostBuf![i] * persistence + injectedGhostR * ghostWrite;
    ghostBuf![i + 1] = ghostBuf![i + 1] * persistence + injectedGhostG * ghostWrite;
    ghostBuf![i + 2] = ghostBuf![i + 2] * persistence + injectedGhostB * ghostWrite;

    const carry = effectivePhase === 2 ? 1 : Math.min(0.65, persistence * 0.55);
    outBuf[i] = Math.max(0, Math.min(255, Math.round(source[i] * (1 - carry) + ghostBuf![i] * carry)));
    outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(source[i + 1] * (1 - carry) + ghostBuf![i + 1] * carry)));
    outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(source[i + 2] * (1 - carry) + ghostBuf![i + 2] * carry)));
    outBuf[i + 3] = source[i + 3];
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default {
  name: "ABA Ghost",
  func: abaGhost,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Store A and B, then replay a persistent mostly-B double exposure whose emphasized beat can drift off the strict ABA grid for a looser variable-frame ghost trail",
};
