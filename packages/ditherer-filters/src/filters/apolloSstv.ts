import { ACTION, BOOL, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
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
} from "../gl/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter, type FilterOptionValues } from "./types";

const previewRate = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Math.max(1, Math.min(30, Number.isFinite(numeric) ? numeric : fallback));
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "320 lines / 10 fps", value: "320_10" },
      { name: "1280 lines / 0.625 fps", value: "1280_0625" },
    ],
    default: "320_10",
    desc: "Apollo camera scan mode from the NASA scan-converter design",
  },
  bandwidth: { type: RANGE, range: [0.1, 0.8], step: 0.01, default: 0.5, desc: "Slow-scan video bandwidth in MHz; nominal Apollo bandwidth is 0.5 MHz" },
  phosphorPersistence: { type: RANGE, range: [0, 1], step: 0.01, default: 0.62, desc: "High-persistence kinescope retention in the RCA converter" },
  vidiconLag: { type: RANGE, range: [0, 1], step: 0.01, default: 0.34, desc: "TK-22 vidicon target lag during optical recapture" },
  vidiconBloom: { type: RANGE, range: [0, 1], step: 0.01, default: 0.24, desc: "Highlight blooming in the vidicon recapture stage" },
  discHold: { type: BOOL, default: true, desc: "Hold the magnetic-disc field until the next slow-scan picture arrives" },
  interlace: { type: BOOL, default: true, desc: "Convert to 525-line, 60-field interlaced output" },
  rfNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.08, desc: "RF link and analogue tape noise" },
  syncError: { type: RANGE, range: [0, 1], step: 0.01, default: 0.08, desc: "Pulse/tone synchronizer timing and tape wow/flutter error" },
  randomSeed: { type: RANGE, range: [0, 9999], step: 1, default: 11, desc: "Deterministic RF and timing fault seed" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 30, desc: "Ground-converter preview frame rate" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Advance the slow raster, field conversion and frame hold",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, previewRate(options.animSpeed, 30));
    },
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  mode: optionTypes.mode.default,
  bandwidth: optionTypes.bandwidth.default,
  phosphorPersistence: optionTypes.phosphorPersistence.default,
  vidiconLag: optionTypes.vidiconLag.default,
  vidiconBloom: optionTypes.vidiconBloom.default,
  discHold: optionTypes.discHold.default,
  interlace: optionTypes.interlace.default,
  rfNoise: optionTypes.rfNoise.default,
  syncError: optionTypes.syncError.default,
  randomSeed: optionTypes.randomSeed.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_history;
uniform vec2 u_res;
uniform float u_haveHistory;
uniform float u_virtualLines;
uniform float u_bandwidth;
uniform float u_persistence;
uniform float u_vidiconLag;
uniform float u_bloom;
uniform float u_hold;
uniform float u_interlace;
uniform float u_frame;
uniform float u_picturePhase;
uniform float u_pictureIndex;
uniform float u_newPicture;
uniform float u_noise;
uniform float u_syncError;
uniform float u_seed;

float hash(vec2 p) { return fract(sin(dot(p + u_seed, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 srcAt(vec2 p) {
  vec2 q = clamp(p, vec2(0.0), u_res - vec2(1.0));
  return texture(u_source, vec2((q.x + 0.5) / u_res.x, 1.0 - (q.y + 0.5) / u_res.y)).rgb;
}
float lumAt(vec2 p) { return dot(srcAt(p), vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 p = vec2(floor(v_uv.x * u_res.x), floor((1.0 - v_uv.y) * u_res.y));
  float virtualY = floor(p.y * u_virtualLines / u_res.y);
  float sampleY = (virtualY + 0.5) * u_res.y / u_virtualLines;
  float wobble = sin(virtualY * 0.071 + u_pictureIndex * 1.73)
    * u_syncError * 3.5;
  float radius = clamp((0.5 / max(0.1, u_bandwidth)) * 2.0, 1.0, 6.0);
  float signal = 0.0, weight = 0.0;
  for (int k = -6; k <= 6; k++) {
    float fk = float(k);
    float w = exp(-abs(fk) / radius);
    signal += lumAt(vec2(p.x + fk + wobble, sampleY)) * w;
    weight += w;
  }
  signal /= weight;

  float bloom = 0.0;
  for (int k = -3; k <= 3; k++) {
    bloom += max(0.0, lumAt(vec2(p.x + float(k) * 2.0, sampleY)) - 0.68);
  }
  signal += bloom / 7.0 * u_bloom * 0.8;

  // These belong to the incoming slow-scan/recording path. Apply them before
  // the magnetic-disc hold so replaying a held field does not repeatedly add
  // noise or multiply the optical edge falloff into its own history.
  float n = (hash(p + vec2(u_pictureIndex, virtualY)) - 0.5) * u_noise * 0.24;
  signal += n;
  signal *= 0.93 + 0.07 * smoothstep(0.0, 0.08, p.x / u_res.x)
    * (1.0 - smoothstep(0.92, 1.0, p.x / u_res.x));

  vec3 history = texture(u_history, v_uv).rgb;
  float historyLum = dot(history, vec3(0.299, 0.587, 0.114));
  float scanned = step(p.y / u_res.y, u_picturePhase);
  if (u_haveHistory > 0.5) {
    signal = mix(historyLum, signal, mix(scanned, u_newPicture, u_hold));
    signal = max(signal, historyLum * u_persistence);
    signal = mix(signal, historyLum, u_vidiconLag * (1.0 - scanned) * 0.75);
  }
  if (u_interlace > 0.5 && mod(p.y + u_frame, 2.0) > 0.5) signal *= 0.965;
  fragColor = vec4(vec3(clamp(signal, 0.0, 1.0)), 1.0);
}
`;

let program: Program | null = null;
const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (program) return program;
  program = linkProgram(gl, FS, [
    "u_source", "u_history", "u_res", "u_haveHistory", "u_virtualLines", "u_bandwidth",
    "u_persistence", "u_vidiconLag", "u_bloom", "u_hold", "u_interlace", "u_frame",
    "u_picturePhase", "u_pictureIndex", "u_newPicture", "u_noise", "u_syncError", "u_seed",
  ] as const);
  return program;
};

type ApolloOptions = FilterOptionValues & Partial<typeof defaults> & {
  _frameIndex?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

const finiteClamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const numeric = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(numeric) ? numeric : fallback));
};

export const apolloFramesPerPicture = (mode: unknown, previewRate: unknown): number => {
  const highResolution = String(mode) === "1280_0625";
  const previewFps = finiteClamp(previewRate, defaults.animSpeed, 1, 30);
  return previewFps / (highResolution ? 0.625 : 10);
};

export interface ApolloTiming {
  pictureIndex: number;
  picturePhase: number;
  newPicture: boolean;
}

export const apolloTiming = (
  mode: unknown,
  previewRate: unknown,
  frameIndex: unknown,
): ApolloTiming => {
  const highResolution = String(mode) === "1280_0625";
  const previewFps = finiteClamp(previewRate, defaults.animSpeed, 1, 30);
  const frame = Math.floor(finiteClamp(frameIndex, 0, 0, Number.MAX_SAFE_INTEGER));
  const cameraNumerator = highResolution ? 5 : 10;
  const cameraDenominator = highResolution ? 8 : 1;
  const pictures = frame * cameraNumerator / (previewFps * cameraDenominator);
  const pictureIndex = Math.floor(pictures + 1e-12);
  const rawPhase = pictures - pictureIndex;
  const picturePhase = rawPhase < 1e-10 ? 0 : Math.min(1, Math.max(0, rawPhase));
  const previousPictures = Math.max(0, frame - 1) * cameraNumerator
    / (previewFps * cameraDenominator);
  const previousIndex = Math.floor(previousPictures + 1e-12);
  return {
    pictureIndex,
    picturePhase,
    newPicture: frame === 0 || pictureIndex !== previousIndex,
  };
};

const apolloSstv = (input: HTMLCanvasElement | OffscreenCanvas, options: ApolloOptions = defaults) => {
  const width = input.width, height = input.height;
  if (width < 1 || height < 1) return input;
  const context = getGLCtx();
  if (!context) return glUnavailableStub(width, height);
  const { gl, canvas } = context;
  const prog = getProgram(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const source = ensureTexture(gl, "apolloSstv:source", width, height);
  uploadSourceTexture(gl, source, input);
  const history = ensureTexture(gl, "apolloSstv:history", width, height);
  const previous = options._prevOutput ?? null;
  const frame = Math.floor(finiteClamp(options._frameIndex, 0, 0, Number.MAX_SAFE_INTEGER));
  const haveHistory = frame > 0
    && previous instanceof Uint8ClampedArray
    && previous.length === width * height * 4;
  if (haveHistory) {
    gl.bindTexture(gl.TEXTURE_2D, history.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, previous);
  }
  const highResolution = String(options.mode) === "1280_0625";
  const timing = apolloTiming(options.mode, options.animSpeed, frame);
  const bandwidth = finiteClamp(options.bandwidth, defaults.bandwidth, 0.1, 0.8);
  const persistence = finiteClamp(options.phosphorPersistence, defaults.phosphorPersistence, 0, 1);
  const vidiconLag = finiteClamp(options.vidiconLag, defaults.vidiconLag, 0, 1);
  const bloom = finiteClamp(options.vidiconBloom, defaults.vidiconBloom, 0, 1);
  const noise = finiteClamp(options.rfNoise, defaults.rfNoise, 0, 1);
  const syncError = finiteClamp(options.syncError, defaults.syncError, 0, 1);
  const seed = finiteClamp(options.randomSeed, defaults.randomSeed, 0, 9999);
  drawPass(gl, null, width, height, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, haveHistory ? history.tex : source.tex);
    gl.uniform1i(prog.uniforms.u_history, 1);
    gl.uniform2f(prog.uniforms.u_res, width, height);
    gl.uniform1f(prog.uniforms.u_haveHistory, haveHistory ? 1 : 0);
    gl.uniform1f(prog.uniforms.u_virtualLines, highResolution ? 1280 : 320);
    gl.uniform1f(prog.uniforms.u_bandwidth, bandwidth);
    gl.uniform1f(prog.uniforms.u_persistence, persistence);
    gl.uniform1f(prog.uniforms.u_vidiconLag, vidiconLag);
    gl.uniform1f(prog.uniforms.u_bloom, bloom);
    gl.uniform1f(prog.uniforms.u_hold, options.discHold === false ? 0 : 1);
    gl.uniform1f(prog.uniforms.u_interlace, options.interlace === false ? 0 : 1);
    gl.uniform1f(prog.uniforms.u_frame, frame);
    gl.uniform1f(prog.uniforms.u_picturePhase, timing.picturePhase);
    gl.uniform1f(prog.uniforms.u_pictureIndex, timing.pictureIndex);
    gl.uniform1f(prog.uniforms.u_newPicture, timing.newPicture ? 1 : 0);
    gl.uniform1f(prog.uniforms.u_noise, noise);
    gl.uniform1f(prog.uniforms.u_syncError, syncError);
    gl.uniform1f(prog.uniforms.u_seed, seed);
  }, vao);
  const rendered = readoutToCanvas(canvas, width, height);
  if (!rendered) return glUnavailableStub(width, height);
  const palette = options.palette ?? defaults.palette;
  const identity = paletteIsIdentity(palette);
  const output = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
  logFilterBackend("Apollo Slow-Scan TV", "WebGL2", `${highResolution ? "1280/0.625" : "320/10"} NASA converter${identity ? "" : "+palettePass"}`);
  return output ?? rendered;
};

export default defineFilter({
  name: "Apollo Slow-Scan TV",
  func: apolloSstv,
  optionTypes,
  options: defaults,
  defaults,
  description: "Apollo slow-scan camera and RCA kinescope/vidicon magnetic-disc ground conversion",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
