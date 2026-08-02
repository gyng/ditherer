import { ACTION, BOOL, RANGE } from "../constants/controlTypes";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";
import { logFilterBackend } from "../utils/index";
import { pxlTiming } from "./retroHardwareCodecs";
import { defineFilter, type FilterCanvas, type FilterOptionValues } from "./types";

export const optionTypes = {
  autoIris: {
    type: BOOL,
    default: true,
    desc: "Meter the center 40% of the frame, matching the camera's automatic iris region",
  },
  exposure: {
    type: RANGE,
    range: [-2, 2],
    step: 0.05,
    default: 0,
    desc: "Manual exposure compensation in stops, applied around the automatic iris",
  },
  contrast: {
    type: RANGE,
    range: [0.5, 2.5],
    step: 0.05,
    default: 1.25,
    desc: "Monochrome video contrast after CCD exposure and AGC",
  },
  signalBandwidth: {
    type: RANGE,
    range: [0.25, 1],
    step: 0.05,
    default: 0.5,
    desc: "Luma bandwidth relative to the 180 kHz pixel stream; 0.5 matches the documented 90 kHz low-pass filter",
  },
  cassetteNoise: {
    type: RANGE,
    range: [0, 0.3],
    step: 0.01,
    default: 0.055,
    desc: "Deterministic FM cassette grain added at the recorded signal stage",
  },
  dropout: {
    type: RANGE,
    range: [0, 0.15],
    step: 0.005,
    default: 0.012,
    desc: "Probability of short horizontal tape signal losses per CCD capture",
  },
  tracking: {
    type: RANGE,
    range: [0, 6],
    step: 0.1,
    default: 0.7,
    desc: "Horizontal line displacement from cassette transport instability, in sensor pixels",
  },
  animSpeed: {
    type: RANGE,
    range: [15, 60],
    step: 1,
    default: 30,
    desc: "Preview rate; the 15 Hz CCD cadence is retained exactly at any selected rate",
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Run the 15 Hz CCD and cassette transport",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, Number(options.animSpeed) || 30);
    },
  },
};

export const defaults = {
  autoIris: optionTypes.autoIris.default,
  exposure: optionTypes.exposure.default,
  contrast: optionTypes.contrast.default,
  signalBandwidth: optionTypes.signalBandwidth.default,
  cassetteNoise: optionTypes.cassetteNoise.default,
  dropout: optionTypes.dropout.default,
  tracking: optionTypes.tracking.default,
  animSpeed: optionTypes.animSpeed.default,
};

type PxlOptions = FilterOptionValues &
  Partial<typeof defaults> & {
    _frameIndex?: number;
    _prevOutput?: Uint8ClampedArray | null;
  };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_history;
uniform vec2 u_res;
uniform int u_haveHistory;
uniform int u_newCapture;
uniform int u_autoIris;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_bandwidth;
uniform float u_noise;
uniform float u_dropout;
uniform float u_tracking;
uniform float u_capture;

float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33 + u_capture * 0.019);
  return fract((p.x + p.y) * p.x);
}

float lumaAt(float x, float y) {
  vec3 rgb = texture(u_source, vec2((clamp(x, 0.0, 119.0) + 0.5) / 120.0, 1.0 - (clamp(y, 0.0, 89.0) + 0.5) / 90.0)).rgb;
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

float centerMeter() {
  float total = 0.0;
  for (int y = 0; y < 5; y++) {
    for (int x = 0; x < 5; x++) {
      total += lumaAt(42.0 + float(x) * 9.0, 31.0 + float(y) * 7.0);
    }
  }
  return total / 25.0;
}

void main() {
  if (u_haveHistory == 1 && u_newCapture == 0) {
    fragColor = texture(u_history, v_uv);
    return;
  }
  float jsX = floor(v_uv.x * u_res.x);
  float jsY = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  float sx = floor(jsX * 120.0 / u_res.x);
  float sy = floor(jsY * 90.0 / u_res.y);
  float lineShift = (hash(vec2(sy, floor(u_capture * 0.5))) - 0.5) * 2.0 * u_tracking;
  sx += lineShift;

  float radius = mix(4.0, 1.0, u_bandwidth);
  float signal = 0.0;
  float weight = 0.0;
  for (int tap = -4; tap <= 4; tap++) {
    float useTap = abs(float(tap)) <= radius ? 1.0 : 0.0;
    float tapWeight = useTap * (radius + 1.0 - abs(float(tap)));
    signal += lumaAt(sx + float(tap), sy) * tapWeight;
    weight += tapWeight;
  }
  signal /= max(weight, 1.0);
  float iris = u_autoIris == 1 ? clamp(0.46 / max(centerMeter(), 0.03), 0.25, 4.0) : 1.0;
  signal = clamp(signal * iris * exp2(u_exposure), 0.0, 1.0);
  signal = clamp(0.5 + (signal - 0.5) * u_contrast, 0.0, 1.0);

  float grain = (hash(vec2(sx * 1.7 + sy * 0.11, sy + u_capture * 13.0)) - 0.5) * 2.0 * u_noise;
  float dropoutRoll = hash(vec2(floor(sy * 0.5), u_capture * 7.0 + 83.0));
  if (dropoutRoll < u_dropout) {
    float start = hash(vec2(sy, u_capture + 19.0)) * 90.0;
    float length = 8.0 + hash(vec2(sy, u_capture + 37.0)) * 42.0;
    if (sx >= start && sx <= start + length) signal = mix(signal, 0.92, 0.72);
  }
  signal = clamp(signal + grain, 0.0, 1.0);
  fragColor = vec4(vec3(signal), 1.0);
}
`;

let program: Program | null = null;

const clamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const number = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(number) ? number : fallback));
};

const pxl2000 = (input: FilterCanvas, options: PxlOptions = defaults): FilterCanvas => {
  const context = getGLCtx();
  if (!context || input.width < 1 || input.height < 1) return input;
  const { gl, canvas } = context;
  program ??= linkProgram(gl, FS, [
    "u_source",
    "u_history",
    "u_res",
    "u_haveHistory",
    "u_newCapture",
    "u_autoIris",
    "u_exposure",
    "u_contrast",
    "u_bandwidth",
    "u_noise",
    "u_dropout",
    "u_tracking",
    "u_capture",
  ]);
  const source = ensureTexture(gl, "pxl-2000:source", input.width, input.height);
  const history = ensureTexture(gl, "pxl-2000:history", input.width, input.height);
  uploadSourceTexture(gl, source, input);
  const previous = options._prevOutput ?? null;
  const haveHistory = previous?.length === input.width * input.height * 4;
  if (haveHistory) {
    gl.bindTexture(gl.TEXTURE_2D, history.tex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      input.width,
      input.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      previous!,
    );
  }
  const frame = Math.max(0, Math.floor(Number(options._frameIndex) || 0));
  const speed = clamp(options.animSpeed, defaults.animSpeed, 15, 60);
  const timing = pxlTiming(frame, speed);
  resizeGLCanvas(canvas, input.width, input.height);
  const vao = getQuadVAO(gl);
  drawPass(
    gl,
    null,
    input.width,
    input.height,
    program,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.tex);
      gl.uniform1i(program?.uniforms.u_source ?? null, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, haveHistory ? history.tex : source.tex);
      gl.uniform1i(program?.uniforms.u_history ?? null, 1);
      gl.uniform2f(program?.uniforms.u_res ?? null, input.width, input.height);
      gl.uniform1i(program?.uniforms.u_haveHistory ?? null, haveHistory ? 1 : 0);
      gl.uniform1i(program?.uniforms.u_newCapture ?? null, timing.newCapture ? 1 : 0);
      gl.uniform1i(program?.uniforms.u_autoIris ?? null, options.autoIris === false ? 0 : 1);
      gl.uniform1f(
        program?.uniforms.u_exposure ?? null,
        clamp(options.exposure, defaults.exposure, -2, 2),
      );
      gl.uniform1f(
        program?.uniforms.u_contrast ?? null,
        clamp(options.contrast, defaults.contrast, 0.5, 2.5),
      );
      gl.uniform1f(
        program?.uniforms.u_bandwidth ?? null,
        clamp(options.signalBandwidth, defaults.signalBandwidth, 0.25, 1),
      );
      gl.uniform1f(
        program?.uniforms.u_noise ?? null,
        clamp(options.cassetteNoise, defaults.cassetteNoise, 0, 0.3),
      );
      gl.uniform1f(
        program?.uniforms.u_dropout ?? null,
        clamp(options.dropout, defaults.dropout, 0, 0.15),
      );
      gl.uniform1f(
        program?.uniforms.u_tracking ?? null,
        clamp(options.tracking, defaults.tracking, 0, 6),
      );
      gl.uniform1f(program?.uniforms.u_capture ?? null, timing.captureIndex);
    },
    vao,
  );
  const output = readoutToCanvas(canvas, input.width, input.height);
  if (!output) return input;
  logFilterBackend(
    "PXL-2000",
    "WebGL2",
    `120x90 CCD capture ${timing.captureIndex} at 15 Hz + FM cassette`,
  );
  return output;
};

export default defineFilter({
  name: "PXL-2000",
  func: pxl2000,
  optionTypes,
  defaults,
  options: defaults,
  description:
    "Fisher-Price PXL-2000: 120×90 monochrome CCD, 15 Hz ping-pong capture, 90 kHz luma, and FM cassette defects",
  requiresGL: true,
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
});
