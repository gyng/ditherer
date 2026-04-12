import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { cloneCanvas, paletteGetColor } from "utils";

type RigState = {
  x: number;
  y: number;
  rotation: number;
  zoom: number;
  vx: number;
  vy: number;
  vRotation: number;
  vZoom: number;
};

type CameraShakeOptions = FilterOptionValues & {
  amountX?: number;
  amountY?: number;
  rotation?: number;
  zoomJitter?: number;
  frequency?: number;
  inertia?: number;
  tremor?: number;
  palette?: {
    options?: FilterOptionValues;
  } & Record<string, unknown>;
  _frameIndex?: number;
};

let rigState: RigState = {
  x: 0,
  y: 0,
  rotation: 0,
  zoom: 1,
  vx: 0,
  vy: 0,
  vRotation: 0,
  vZoom: 0,
};
let stateKey = "";
let lastFrameIndex = -Infinity;

export const optionTypes = {
  amountX: { type: RANGE, range: [0, 30], step: 1, default: 2, desc: "Maximum lateral camera drift in pixels" },
  amountY: { type: RANGE, range: [0, 24], step: 1, default: 1, desc: "Maximum vertical camera bob in pixels" },
  rotation: { type: RANGE, range: [0, 8], step: 0.1, default: 0.3, desc: "Maximum rotational shake in degrees" },
  zoomJitter: { type: RANGE, range: [0, 0.12], step: 0.01, default: 0.01, desc: "Tiny lens breathing mixed into the shake" },
  frequency: { type: RANGE, range: [0.1, 4], step: 0.1, default: 0.8, desc: "How quickly the underlying motion targets drift" },
  inertia: { type: RANGE, range: [0.2, 0.95], step: 0.05, default: 0.85, desc: "How much the camera lags and settles instead of snapping instantly" },
  tremor: { type: RANGE, range: [0, 1], step: 0.05, default: 0.18, desc: "Blend in a finer handheld tremor on top of the main shake" },
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
  amountX: optionTypes.amountX.default,
  amountY: optionTypes.amountY.default,
  rotation: optionTypes.rotation.default,
  zoomJitter: optionTypes.zoomJitter.default,
  frequency: optionTypes.frequency.default,
  inertia: optionTypes.inertia.default,
  tremor: optionTypes.tremor.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const hashNoise = (t: number, seed: number) => {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453123;
  return (x - Math.floor(x)) * 2 - 1;
};

const smoothNoise = (t: number, seed: number) => {
  const t0 = Math.floor(t);
  const t1 = t0 + 1;
  const f = t - t0;
  const ease = f * f * (3 - 2 * f);
  return hashNoise(t0, seed) * (1 - ease) + hashNoise(t1, seed) * ease;
};

const layeredNoise = (t: number, seed: number) =>
  smoothNoise(t, seed) * 0.6 +
  smoothNoise(t * 2.07, seed + 11) * 0.28 +
  smoothNoise(t * 4.61, seed + 23) * 0.12;

const resetRigState = () => {
  rigState = {
    x: 0,
    y: 0,
    rotation: 0,
    zoom: 1,
    vx: 0,
    vy: 0,
    vRotation: 0,
    vZoom: 0,
  };
  lastFrameIndex = -1;
};

const updateAxis = (
  position: number,
  velocity: number,
  target: number,
  response: number,
  damping: number
) => {
  const nextVelocity = (velocity + (target - position) * response) * damping;
  return {
    position: position + nextVelocity,
    velocity: nextVelocity,
  };
};

const stepRig = (frameIndex: number, options: CameraShakeOptions) => {
  const { amountX, amountY, rotation, zoomJitter, frequency, inertia, tremor } = options;
  const t = frameIndex * frequency * 0.12;
  const response = 0.08 + (1 - inertia) * 0.22;
  const damping = 0.72 + inertia * 0.22;

  const targetX = layeredNoise(t, 1) * amountX * 0.8 + layeredNoise(t * 5.2, 41) * amountX * tremor * 0.25;
  const targetY = layeredNoise(t + 9, 2) * amountY * 0.8 + layeredNoise(t * 4.4, 57) * amountY * tremor * 0.22;
  const targetRotation = (
    layeredNoise(t * 0.9, 3) * rotation * 0.9 +
    layeredNoise(t * 6.1, 73) * rotation * tremor * 0.18
  ) * (Math.PI / 180);
  const targetZoom = 1 + layeredNoise(t * 0.7, 5) * zoomJitter * 0.45 + layeredNoise(t * 3.9, 91) * zoomJitter * tremor * 0.1;

  const nextX = updateAxis(rigState.x, rigState.vx, targetX, response, damping);
  const nextY = updateAxis(rigState.y, rigState.vy, targetY, response, damping);
  const nextRotation = updateAxis(rigState.rotation, rigState.vRotation, targetRotation, response * 0.9, damping);
  const nextZoom = updateAxis(rigState.zoom, rigState.vZoom, targetZoom, response * 0.5, damping);

  rigState.x = nextX.position;
  rigState.vx = nextX.velocity;
  rigState.y = nextY.position;
  rigState.vy = nextY.velocity;
  rigState.rotation = nextRotation.position;
  rigState.vRotation = nextRotation.velocity;
  rigState.zoom = nextZoom.position;
  rigState.vZoom = nextZoom.velocity;
};

const getStateKey = (width: number, height: number, options: CameraShakeOptions) => [
  width,
  height,
  options.amountX,
  options.amountY,
  options.rotation,
  options.zoomJitter,
  options.frequency,
  options.inertia,
  options.tremor,
].join("|");

const cameraShake = (input: any, options: CameraShakeOptions = defaults) => {
  const frameIndex = typeof options._frameIndex === "number" ? options._frameIndex : 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const currentStateKey = getStateKey(width, height, options);
  if (currentStateKey !== stateKey || frameIndex <= lastFrameIndex) {
    stateKey = currentStateKey;
    resetRigState();
  }

  for (let i = lastFrameIndex + 1; i <= frameIndex; i += 1) {
    stepRig(i, options);
  }
  lastFrameIndex = frameIndex;

  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const { palette } = options;
  const cosA = Math.cos(rigState.rotation);
  const sinA = Math.sin(rigState.rotation);
  const cx = (width - 1) * 0.5;
  const cy = (height - 1) * 0.5;
  const zoom = Math.max(0.75, rigState.zoom);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - cx) / zoom;
      const dy = (y - cy) / zoom;
      const srcX = Math.max(0, Math.min(width - 1, Math.round(cx + dx * cosA - dy * sinA + rigState.x)));
      const srcY = Math.max(0, Math.min(height - 1, Math.round(cy + dx * sinA + dy * cosA + rigState.y)));
      const srcI = (srcY * width + srcX) * 4;
      const dstI = (y * width + x) * 4;

      const color = paletteGetColor(palette, [
        buf[srcI],
        buf[srcI + 1],
        buf[srcI + 2],
        buf[srcI + 3]
      ], palette.options, false);

      outBuf[dstI] = color[0];
      outBuf[dstI + 1] = color[1];
      outBuf[dstI + 2] = color[2];
      outBuf[dstI + 3] = color[3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export const __testing = {
  resetRigState,
};

export default defineFilter({
  name: "Camera Shake",
  func: cameraShake,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "More realistic handheld shake with drift targets, inertia, settling, and fine tremor"
});
