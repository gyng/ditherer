import { ACTION, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import { cloneCanvas, logFilterBackend } from "utils";
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
import {
  MOTION_SOURCE,
  estimateMotionVector,
  prepareMotionAnalysisBuffers,
} from "utils/motionVectors";

const TRIGGER = {
  MANUAL: "MANUAL",
  MOTION: "MOTION",
  FLOW: "FLOW",
  SCENE_CUT: "SCENE_CUT",
  LUMA_SPIKE: "LUMA_SPIKE",
};

let burstStartFrame = -Infinity;
let burstEndFrame = -Infinity;
let burstCooldownUntil = -Infinity;
let previewLoopEnabled = false;
let pendingManualBurst = false;
let lastFrameIndex = -Infinity;
let lastTriggerMode = TRIGGER.MANUAL;

type CrtDegaussPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type CrtDegaussOptions = FilterOptionValues & {
  intensity?: number;
  warp?: number;
  misconvergence?: number;
  hueShimmer?: number;
  flash?: number;
  triggerMode?: string;
  triggerThreshold?: number;
  cooldownFrames?: number;
  duration?: number;
  animSpeed?: number;
  palette?: CrtDegaussPalette;
  _frameIndex?: number;
  _isAnimating?: boolean;
  _prevInput?: Uint8ClampedArray | null;
  _ema?: Float32Array | null;
  _wasmAcceleration?: boolean;
};

const sampleTemporalEnergy = (
  current: Uint8ClampedArray,
  reference: Uint8ClampedArray | Float32Array | null,
  mode: string
) => {
  if (!reference || reference.length !== current.length) return 0;
  const maxSamples = 2048;
  const pixelCount = Math.max(1, current.length / 4);
  const pixelStride = Math.max(1, Math.floor(pixelCount / maxSamples));
  let total = 0;
  let samples = 0;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += pixelStride) {
    const i = pixelIndex * 4;
    if (mode === TRIGGER.LUMA_SPIKE || mode === TRIGGER.SCENE_CUT) {
      const currentLuma = current[i] * 0.2126 + current[i + 1] * 0.7152 + current[i + 2] * 0.0722;
      const referenceLuma = reference[i] * 0.2126 + reference[i + 1] * 0.7152 + reference[i + 2] * 0.0722;
      total += Math.abs(currentLuma - referenceLuma) / 255;
    } else {
      total += (
        Math.abs(current[i] - reference[i]) +
        Math.abs(current[i + 1] - reference[i + 1]) +
        Math.abs(current[i + 2] - reference[i + 2])
      ) / (255 * 3);
    }
    samples += 1;
  }
  return samples > 0 ? total / samples : 0;
};

const sampleFlowEnergy = (
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray | null,
  width: number,
  height: number,
) => {
  if (!previous || previous.length !== current.length) return 0;
  const cellSize = Math.max(6, Math.min(20, Math.round(Math.min(width, height) / 18) || 6));
  const searchRadius = Math.max(2, Math.min(8, Math.round(cellSize * 0.45)));
  const threshold = 18;
  const analysisBuffers = prepareMotionAnalysisBuffers(current, previous, width, height, MOTION_SOURCE.LUMA);
  const stride = Math.max(cellSize, cellSize * 2);
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const vector = estimateMotionVector(
        current, previous, width, height, x, y,
        cellSize, searchRadius, threshold, MOTION_SOURCE.LUMA, analysisBuffers,
      );
      total += vector.motionStrength * (0.35 + vector.confidence * 0.65);
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
};

const startBurst = (frameIndex: number, duration: number, cooldownFrames: number) => {
  burstStartFrame = frameIndex;
  burstEndFrame = frameIndex + duration;
  burstCooldownUntil = frameIndex + cooldownFrames;
};

export const optionTypes = {
  intensity: { type: RANGE, range: [0.25, 2.5], step: 0.05, default: 1, desc: "Overall strength of the degauss pulse envelope" },
  warp: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Raster bending and ring-wave distortion amount" },
  misconvergence: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "RGB channel separation during the magnetic wobble" },
  hueShimmer: { type: RANGE, range: [0, 2], step: 0.05, default: 1, desc: "Rainbow phosphor mislanding from the changing field" },
  flash: { type: RANGE, range: [0, 2], step: 0.05, default: 0.9, desc: "Brightness pulse riding on top of the degauss sweep" },
  triggerMode: {
    type: ENUM,
    options: [
      { name: "Manual", value: TRIGGER.MANUAL },
      { name: "Motion threshold", value: TRIGGER.MOTION },
      { name: "Flow", value: TRIGGER.FLOW },
      { name: "Scene cut", value: TRIGGER.SCENE_CUT },
      { name: "Luma spike", value: TRIGGER.LUMA_SPIKE },
    ],
    default: TRIGGER.MANUAL,
    desc: "Choose whether the pulse is manual or auto-triggers from source motion and luminance changes"
  },
  triggerThreshold: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.18, desc: "Minimum sampled source energy required to fire an automatic degauss pulse" },
  cooldownFrames: { type: RANGE, range: [0, 180], step: 1, default: 36, desc: "Minimum wait after a pulse before auto-triggering again" },
  duration: { type: RANGE, range: [12, 90], step: 1, default: 45, desc: "Length of the degauss decay in rendered frames" },
  animSpeed: { type: RANGE, range: [4, 30], step: 1, default: 20, desc: "Playback speed for the burst preview" },
  degauss: {
    type: ACTION,
    label: "Degauss",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      pendingManualBurst = true;
      actions.triggerBurst(inputCanvas, Math.max(6, Math.round(options.duration || 45)), options.animSpeed || 20);
    }
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) {
        previewLoopEnabled = false;
        actions.stopAnimLoop();
      } else {
        previewLoopEnabled = true;
        actions.startAnimLoop(inputCanvas, options.animSpeed || 20);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  warp: optionTypes.warp.default,
  misconvergence: optionTypes.misconvergence.default,
  hueShimmer: optionTypes.hueShimmer.default,
  flash: optionTypes.flash.default,
  triggerMode: optionTypes.triggerMode.default,
  triggerThreshold: optionTypes.triggerThreshold.default,
  cooldownFrames: optionTypes.cooldownFrames.default,
  duration: optionTypes.duration.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_resolution;
uniform float u_age;
uniform float u_envelope;
uniform float u_decay;
uniform float u_warp;
uniform float u_misconvergence;
uniform float u_hueShimmer;
uniform float u_flashAmount;
uniform vec2  u_baseWobble;
uniform int   u_paletteLevels;

${PALETTE_NEAREST_GLSL}

vec3 readChannel(vec2 px) {
  vec2 snapped = clamp(floor(px + 0.5) + 0.5, vec2(0.5), u_resolution - vec2(0.5));
  return texture(u_source, snapped / u_resolution).rgb * 255.0;
}

vec3 rotateHue(vec3 c, float angle) {
  float cs = cos(angle);
  float sn = sin(angle);
  float r = c.r * (0.213 + 0.787 * cs - 0.213 * sn)
          + c.g * (0.715 - 0.715 * cs - 0.715 * sn)
          + c.b * (0.072 - 0.072 * cs + 0.928 * sn);
  float g = c.r * (0.213 - 0.213 * cs + 0.143 * sn)
          + c.g * (0.715 + 0.285 * cs + 0.140 * sn)
          + c.b * (0.072 - 0.072 * cs - 0.283 * sn);
  float b = c.r * (0.213 - 0.213 * cs - 0.787 * sn)
          + c.g * (0.715 - 0.715 * cs + 0.715 * sn)
          + c.b * (0.072 + 0.928 * cs + 0.072 * sn);
  return clamp(vec3(r, g, b), 0.0, 255.0);
}

void main() {
  vec2 px = v_uv * u_resolution;
  float x = px.x;
  float y = px.y;
  vec2 center = u_resolution * 0.5;
  float dx = (x - center.x) / max(1.0, center.x);
  float dy = (y - center.y) / max(1.0, center.y);
  float radial = sqrt(dx * dx + dy * dy);

  float ring = sin(radial * 18.0 - u_age * 1.85) * u_envelope * u_warp * min(u_resolution.x, u_resolution.y) * 0.04;
  float sweepX = sin(y / max(1.0, u_resolution.y) * 3.14159265 * (2.8 + u_age * 0.12) + u_age * 1.9)
               * u_envelope * u_warp * u_resolution.x * 0.045;
  float sweepY = sin(x / max(1.0, u_resolution.x) * 3.14159265 * (3.5 + u_age * 0.08) + u_age * 2.7)
               * u_envelope * u_warp * u_resolution.y * 0.024;

  vec2 src = vec2(x + sweepX + dx * ring, y + sweepY + dy * ring * 0.7);
  // Match the JS path: pixels mapping outside the frame collapse to black.
  if (src.x < 0.0 || src.x >= u_resolution.x || src.y < 0.0 || src.y >= u_resolution.y) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float channelOffset = u_misconvergence * u_envelope * (2.0 + radial * 6.0);
  vec2 wob = u_baseWobble * (0.3 + radial * 0.7);

  vec3 r = readChannel(vec2(src.x + dx * channelOffset + wob.x, src.y + dy * channelOffset * 0.35 + wob.y));
  vec3 g = readChannel(vec2(src.x + wob.x * 0.18, src.y + wob.y * 0.22));
  vec3 b = readChannel(vec2(src.x - dx * channelOffset - wob.x * 0.7, src.y - dy * channelOffset * 0.35 - wob.y * 0.7));

  vec3 rgb = vec3(r.r, g.g, b.b);
  float hueAngle = u_hueShimmer * u_envelope * 3.14159265 * 1.35
                 * sin(dx * 2.7 + u_age * 1.25)
                 * cos(dy * 2.1 + u_age * 0.92);
  rgb = rotateHue(rgb, hueAngle);

  float edgeDarken = 1.0 - min(0.22, radial * radial * u_envelope * 0.2);
  vec3 lit = clamp(rgb * u_flashAmount * edgeDarken, 0.0, 255.0);
  if (u_paletteLevels >= 2 && u_paletteLevels < 256) {
    lit = applyNearestLevelsRGB(lit, u_paletteLevels);
  }
  fragColor = vec4(lit / 255.0, 1.0);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_resolution",
    "u_age", "u_envelope", "u_decay",
    "u_warp", "u_misconvergence", "u_hueShimmer", "u_flashAmount",
    "u_baseWobble", "u_paletteLevels",
  ] as const);
  return _prog;
};

const crtDegauss = (input: any, options: CrtDegaussOptions = defaults) => {
  const {
    intensity = defaults.intensity,
    warp = defaults.warp,
    misconvergence = defaults.misconvergence,
    hueShimmer = defaults.hueShimmer,
    flash = defaults.flash,
    triggerMode = defaults.triggerMode,
    triggerThreshold = defaults.triggerThreshold,
    cooldownFrames = defaults.cooldownFrames,
    duration = defaults.duration,
    palette = defaults.palette,
  } = options;
  const frameIndex = Number(options._frameIndex ?? 0);
  const isAnimating = Boolean(options._isAnimating);
  const prevInput = options._prevInput ?? null;
  const ema = options._ema ?? null;
  const W = input.width, H = input.height;
  const safeDuration = Math.max(6, Math.round(duration || 45));

  // ── Trigger detection (small JS pass; bounded ~2k samples or coarse flow) ──
  if (frameIndex <= lastFrameIndex || triggerMode !== lastTriggerMode) {
    burstStartFrame = -Infinity;
    burstEndFrame = -Infinity;
    burstCooldownUntil = -Infinity;
    pendingManualBurst = false;
    if (triggerMode !== lastTriggerMode) previewLoopEnabled = false;
  }
  lastTriggerMode = triggerMode;

  if (!isAnimating && !pendingManualBurst) {
    burstStartFrame = -Infinity;
    burstEndFrame = -Infinity;
    lastFrameIndex = frameIndex;
    return cloneCanvas(input, true);
  }

  if (pendingManualBurst) {
    startBurst(frameIndex, safeDuration, Math.round(cooldownFrames || 0));
    pendingManualBurst = false;
  } else if (previewLoopEnabled && isAnimating && frameIndex >= burstEndFrame) {
    startBurst(frameIndex, safeDuration, 0);
  } else if (triggerMode !== TRIGGER.MANUAL && frameIndex >= burstCooldownUntil) {
    // Trigger detection only runs on input pixels — we need them. Read once.
    const inCtx = input.getContext("2d");
    if (inCtx) {
      const buf = inCtx.getImageData(0, 0, W, H).data;
      const reference = triggerMode === TRIGGER.MOTION || triggerMode === TRIGGER.FLOW
        ? prevInput : ema;
      const energy = triggerMode === TRIGGER.FLOW
        ? sampleFlowEnergy(buf, prevInput, W, H)
        : sampleTemporalEnergy(buf, reference, triggerMode);
      if (energy >= triggerThreshold) {
        startBurst(frameIndex, safeDuration, Math.round(cooldownFrames || 0));
      }
    }
  }
  lastFrameIndex = frameIndex;

  const isBurstActive = frameIndex >= burstStartFrame && frameIndex < burstEndFrame;
  if (!isBurstActive) return cloneCanvas(input, true);

  // ── GL burst render ──
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;

  const age = frameIndex - burstStartFrame;
  const normalizedAge = age / Math.max(1, safeDuration - 1);
  const decay = 1 - normalizedAge;
  const envelope = Math.max(0, decay * decay * intensity);
  const baseWobbleX = Math.sin(age * 1.7) * envelope * W * 0.05
                    + Math.sin(age * 4.1) * envelope * decay * W * 0.025;
  const baseWobbleY = Math.cos(age * 2.3) * envelope * H * 0.035
                    + Math.cos(age * 5.7) * envelope * decay * H * 0.018;
  const flashAmount = 1 + flash * envelope * (0.4 + 0.8 * Math.abs(Math.sin(age * 0.8)));

  const pOpts = (palette as { options?: { levels?: number } }).options;
  const isNearestPalette = palette === defaults.palette ||
    (palette as { name?: string }).name === "nearest";
  const shaderLevels = isNearestPalette ? (pOpts?.levels ?? 256) : 256;

  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "crtDegauss:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_resolution, W, H);
    gl.uniform1f(prog.uniforms.u_age, age);
    gl.uniform1f(prog.uniforms.u_envelope, envelope);
    gl.uniform1f(prog.uniforms.u_decay, decay);
    gl.uniform1f(prog.uniforms.u_warp, warp);
    gl.uniform1f(prog.uniforms.u_misconvergence, misconvergence);
    gl.uniform1f(prog.uniforms.u_hueShimmer, hueShimmer);
    gl.uniform1f(prog.uniforms.u_flashAmount, flashAmount);
    gl.uniform2f(prog.uniforms.u_baseWobble, baseWobbleX, baseWobbleY);
    gl.uniform1i(prog.uniforms.u_paletteLevels, Math.max(1, Math.min(256, Math.round(shaderLevels))));
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return glUnavailableStub(W, H);

  const skipPostPass = isNearestPalette || paletteIsIdentity(palette);
  const out = skipPostPass
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, palette, options._wasmAcceleration !== false) || rendered);
  logFilterBackend("CRT Degauss", "WebGL2", `age=${age}/${safeDuration}${skipPostPass ? "" : "+palettePass"}`);
  return out;
};

export default defineFilter({
  name: "CRT Degauss",
  func: crtDegauss,
  options: defaults,
  optionTypes,
  defaults,
  // First-time add kicks off the animation loop so the degauss burst is
  // visible without requiring the user to click Play on a hidden ACTION.
  // User can still stop via the same Play/Stop control.
  autoAnimate: true,
  autoAnimateFps: 20,
  description: "A decaying CRT degauss pulse with raster wobble, RGB mislanding, rainbow shimmer, and a bright magnetic flash",
  temporal: true,
  requiresGL: true,
});
