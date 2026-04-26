import { ACTION, COLOR, ENUM, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { logFilterBackend } from "utils";
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

const MODE = { FOREGROUND: "FOREGROUND", BACKGROUND: "BACKGROUND", FREEZE_STILL: "FREEZE_STILL" };
const BACKGROUND = { TRANSPARENT: "TRANSPARENT", SOLID: "SOLID", SOURCE_DIM: "SOURCE_DIM" };
const FROZEN = { FIRST: "FIRST", AVERAGE: "AVERAGE" };

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Foreground", value: MODE.FOREGROUND },
      { name: "Background", value: MODE.BACKGROUND },
      { name: "Freeze still areas", value: MODE.FREEZE_STILL },
    ],
    default: MODE.FOREGROUND,
    desc: "Keep moving subjects, reveal the stable background, or freeze still regions while motion stays live",
  },
  threshold: { type: RANGE, range: [5, 80], step: 1, default: 20, desc: "Pixel difference needed to classify a region as moving" },
  feather: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Soft edge around the motion mask" },
  background: {
    type: ENUM,
    options: [
      { name: "Transparent", value: BACKGROUND.TRANSPARENT },
      { name: "Solid color", value: BACKGROUND.SOLID },
      { name: "Dim source", value: BACKGROUND.SOURCE_DIM },
    ],
    default: BACKGROUND.TRANSPARENT,
    desc: "What to show behind the moving subject in foreground mode",
    visibleWhen: (options: BackgroundSubtractionOptions) => options.mode === MODE.FOREGROUND,
  },
  bgColor: {
    type: COLOR, default: [0, 0, 0, 255],
    desc: "Background color when using solid background mode",
    visibleWhen: (options: BackgroundSubtractionOptions) => options.mode === MODE.FOREGROUND && options.background === BACKGROUND.SOLID,
  },
  learnRate: {
    type: RANGE, range: [0.001, 0.1], step: 0.001, default: 0.02,
    desc: "How quickly the reconstructed background adapts to new static content",
    visibleWhen: (options: BackgroundSubtractionOptions) => options.mode === MODE.BACKGROUND,
  },
  frozenFrame: {
    type: ENUM,
    options: [
      { name: "First", value: FROZEN.FIRST },
      { name: "Average", value: FROZEN.AVERAGE },
    ],
    default: FROZEN.FIRST,
    desc: "Reference image used for frozen regions in freeze-still mode (Average uses the EMA background model)",
    visibleWhen: (options: BackgroundSubtractionOptions) => options.mode === MODE.FREEZE_STILL,
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15, desc: "Playback speed when using the built-in animation toggle" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  } },
};

export const defaults = {
  mode: optionTypes.mode.default,
  threshold: optionTypes.threshold.default,
  feather: optionTypes.feather.default,
  background: optionTypes.background.default,
  bgColor: optionTypes.bgColor.default,
  learnRate: optionTypes.learnRate.default,
  frozenFrame: optionTypes.frozenFrame.default,
  animSpeed: optionTypes.animSpeed.default,
};

type BackgroundSubtractionOptions = FilterOptionValues & {
  mode?: string;
  threshold?: number;
  feather?: number;
  background?: string;
  bgColor?: number[];
  learnRate?: number;
  frozenFrame?: string;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _frameIndex?: number;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_ema;
uniform sampler2D u_frozen;
uniform vec3  u_bgColor;
uniform float u_threshold;     // 0..1
uniform float u_feather;       // 0..1
uniform float u_bgBlend;       // 0..1
uniform float u_haveEma;
uniform int   u_mode;          // 0 FG, 1 BG, 2 FREEZE
uniform int   u_bg;            // 0 TRANSP, 1 SOLID, 2 DIM
uniform int   u_frozenMode;    // 0 FIRST, 1 AVERAGE

void main() {
  vec4 c = texture(u_source, v_uv);
  vec3 cur = c.rgb;
  if (u_haveEma < 0.5) {
    fragColor = vec4(cur, 1.0);
    return;
  }
  vec3 ema = texture(u_ema, v_uv).rgb;
  float diff = (abs(cur.r - ema.r) + abs(cur.g - ema.g) + abs(cur.b - ema.b)) / 3.0;
  float edge0 = max(0.0, u_threshold - u_feather);
  float edge1 = u_threshold + u_feather;
  float moving = smoothstep(edge0, edge1, diff);
  float still = 1.0 - moving;

  if (u_mode == 1) {
    vec3 bg = ema * (1.0 - u_bgBlend) + cur * u_bgBlend;
    fragColor = vec4(ema * still + bg * moving, 1.0);
    return;
  }
  if (u_mode == 2) {
    vec3 frozen = u_frozenMode == 1 ? ema : texture(u_frozen, v_uv).rgb;
    fragColor = vec4(frozen * still + cur * moving, 1.0);
    return;
  }
  // FOREGROUND
  if (u_bg == 0) {
    fragColor = vec4(cur, moving);
    return;
  }
  if (u_bg == 2) {
    fragColor = vec4(cur * moving + cur * 0.2 * still, 1.0);
    return;
  }
  fragColor = vec4(cur * moving + u_bgColor * still, 1.0);
}
`;

let _prog: Program | null = null;
let _emaScratch: Uint8ClampedArray | null = null;
let _frozenW = 0;
let _frozenH = 0;
let _frozenInitialized = false;

const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_ema", "u_frozen", "u_bgColor",
    "u_threshold", "u_feather", "u_bgBlend",
    "u_haveEma", "u_mode", "u_bg", "u_frozenMode",
  ] as const);
  return _prog;
};

const modeId = (m: string) => m === MODE.BACKGROUND ? 1 : m === MODE.FREEZE_STILL ? 2 : 0;
const bgId = (b: string) => b === BACKGROUND.SOLID ? 1 : b === BACKGROUND.SOURCE_DIM ? 2 : 0;
const frozenId = (f: string) => f === FROZEN.AVERAGE ? 1 : 0;

const sceneSeparation = (input: any, options: BackgroundSubtractionOptions = defaults) => {
  const mode = String(options.mode ?? defaults.mode);
  const threshold = Number(options.threshold ?? defaults.threshold);
  const feather = Number(options.feather ?? defaults.feather);
  const background = String(options.background ?? defaults.background);
  const bgColor = Array.isArray(options.bgColor) ? options.bgColor : defaults.bgColor;
  const learnRate = Number(options.learnRate ?? defaults.learnRate);
  const frozenMode = String(options.frozenFrame ?? defaults.frozenFrame);
  const ema = options._ema ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "backgroundSubtraction:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const emaTex = ensureTexture(gl, "backgroundSubtraction:ema", W, H);
  let haveEma = false;
  if (ema && ema.length === W * H * 4) {
    if (!_emaScratch || _emaScratch.length !== ema.length) {
      _emaScratch = new Uint8ClampedArray(ema.length);
    }
    for (let i = 0; i < ema.length; i++) _emaScratch[i] = ema[i];
    gl.bindTexture(gl.TEXTURE_2D, emaTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, _emaScratch);
    haveEma = true;
  }

  const frozenTex = ensureTexture(gl, "backgroundSubtraction:frozen", W, H);
  // Capture first frame as frozen reference. Re-capture on size change or
  // on frame 0 (animation restart).
  if (mode === MODE.FREEZE_STILL && frozenMode === FROZEN.FIRST &&
      (!_frozenInitialized || _frozenW !== W || _frozenH !== H || frameIndex === 0)) {
    gl.bindTexture(gl.TEXTURE_2D, frozenTex.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
    _frozenInitialized = true;
    _frozenW = W;
    _frozenH = H;
  }

  const bgBlend = Math.max(0, Math.min(1, learnRate * 12));

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, emaTex.tex);
    gl.uniform1i(prog.uniforms.u_ema, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, frozenTex.tex);
    gl.uniform1i(prog.uniforms.u_frozen, 2);
    gl.uniform3f(prog.uniforms.u_bgColor, bgColor[0] / 255, bgColor[1] / 255, bgColor[2] / 255);
    gl.uniform1f(prog.uniforms.u_threshold, threshold / 255);
    gl.uniform1f(prog.uniforms.u_feather, feather / 255);
    gl.uniform1f(prog.uniforms.u_bgBlend, bgBlend);
    gl.uniform1f(prog.uniforms.u_haveEma, haveEma ? 1 : 0);
    gl.uniform1i(prog.uniforms.u_mode, modeId(mode));
    gl.uniform1i(prog.uniforms.u_bg, bgId(background));
    gl.uniform1i(prog.uniforms.u_frozenMode, frozenId(frozenMode));
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Scene Separation", "WebGL2", `mode=${mode} thr=${threshold}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Scene Separation",
  func: sceneSeparation,
  optionTypes,
  options: defaults,
  defaults,
  description: "Separate moving and static regions to isolate foreground, reconstruct the background, or freeze still parts of the scene",
  temporal: true,
  requiresGL: true,
});
