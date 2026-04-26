import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import {
  applyPalettePassToCanvas,
  paletteIsIdentity,
  PALETTE_NEAREST_GLSL,
} from "palettes/backend";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glUnavailableStub,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

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
  _wasmAcceleration?: boolean;
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
  const {
    amountX = defaults.amountX,
    amountY = defaults.amountY,
    rotation = defaults.rotation,
    zoomJitter = defaults.zoomJitter,
    frequency = defaults.frequency,
    inertia = defaults.inertia,
    tremor = defaults.tremor,
  } = options;
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

// Reverse-map sample with NEAREST snapping + edge clamp, then optionally
// quantize via the shared `nearest` palette GLSL (no-op when levels >= 256).
// Color-distance palettes are handled by the post-pass below.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_resolution;
uniform vec2  u_centerPx;
uniform vec2  u_offsetPx;
uniform float u_cosA;
uniform float u_sinA;
uniform float u_invZoom;
uniform int   u_paletteLevels;

${PALETTE_NEAREST_GLSL}

void main() {
  vec2 p = v_uv * u_resolution;
  vec2 d = (p - u_centerPx) * u_invZoom;
  // [c -s; s c] * d  matches the JS: srcX = cx + dx*c - dy*s + offX
  vec2 sample = u_centerPx + vec2(d.x * u_cosA - d.y * u_sinA, d.x * u_sinA + d.y * u_cosA) + u_offsetPx;
  vec2 snapped = clamp(floor(sample + 0.5) + 0.5, vec2(0.5), u_resolution - vec2(0.5));
  vec4 c = texture(u_source, snapped / u_resolution);
  vec3 q = c.rgb * 255.0;
  if (u_paletteLevels >= 2 && u_paletteLevels < 256) {
    q = applyNearestLevelsRGB(q, u_paletteLevels);
  }
  fragColor = vec4(q / 255.0, c.a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_resolution", "u_centerPx", "u_offsetPx",
    "u_cosA", "u_sinA", "u_invZoom", "u_paletteLevels",
  ] as const);
  return _prog;
};

const cameraShake = (input: any, options: CameraShakeOptions = defaults) => {
  const frameIndex = typeof options._frameIndex === "number" ? options._frameIndex : 0;
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;

  const currentStateKey = getStateKey(W, H, options);
  if (currentStateKey !== stateKey || frameIndex <= lastFrameIndex) {
    stateKey = currentStateKey;
    resetRigState();
  }
  for (let i = lastFrameIndex + 1; i <= frameIndex; i++) stepRig(i, options);
  lastFrameIndex = frameIndex;

  const palette = options.palette ?? defaults.palette;
  const pOpts = (palette as { options?: { levels?: number } }).options;
  // Default `nearest` palette with levels=256 is identity → skip quantization.
  // Custom levels go in-shader; color-distance palettes get a post-pass.
  const isNearestPalette = palette === defaults.palette ||
    (palette as { name?: string }).name === "nearest";
  const shaderLevels = isNearestPalette ? (pOpts?.levels ?? 256) : 256;

  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "cameraShake:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const cosA = Math.cos(rigState.rotation);
  const sinA = Math.sin(rigState.rotation);
  const zoom = Math.max(0.75, rigState.zoom);

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_resolution, W, H);
    gl.uniform2f(prog.uniforms.u_centerPx, (W - 1) * 0.5, (H - 1) * 0.5);
    gl.uniform2f(prog.uniforms.u_offsetPx, rigState.x, rigState.y);
    gl.uniform1f(prog.uniforms.u_cosA, cosA);
    gl.uniform1f(prog.uniforms.u_sinA, sinA);
    gl.uniform1f(prog.uniforms.u_invZoom, 1 / zoom);
    gl.uniform1i(prog.uniforms.u_paletteLevels, Math.max(1, Math.min(256, Math.round(shaderLevels))));
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return glUnavailableStub(W, H);

  // Color-distance palettes (User/Adaptive/etc.) need a CPU-side post-pass.
  // No-op when the palette is identity or already handled in-shader.
  const skipPostPass = isNearestPalette || paletteIsIdentity(palette);
  const out = skipPostPass
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, palette, options._wasmAcceleration !== false) || rendered);
  logFilterBackend("Camera Shake", "WebGL2", `rot=${rigState.rotation.toFixed(3)} zoom=${zoom.toFixed(3)}${skipPostPass ? "" : "+palettePass"}`);
  return out;
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
  description: "More realistic handheld shake with drift targets, inertia, settling, and fine tremor",
  temporal: true,
  requiresGL: true,
});
