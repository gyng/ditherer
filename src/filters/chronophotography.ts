import { RANGE, ENUM, BOOL, ACTION } from "constants/controlTypes";
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

const BLEND = { LIGHTEN: "LIGHTEN", AVERAGE: "AVERAGE", DARKEN: "DARKEN" };
const FADE = { LINEAR: "LINEAR", TAIL: "TAIL", HEAD: "HEAD" };

const MAX_EXPOSURES = 16;

export const optionTypes = {
  exposures: { type: RANGE, range: [2, 16], step: 1, default: 8, desc: "Number of ghost copies visible" },
  interval: { type: RANGE, range: [1, 10], step: 1, default: 2, desc: "Frames between each exposure capture" },
  blendMode: {
    type: ENUM,
    options: [
      { name: "Lighten (Marey-style stroboscopic)", value: BLEND.LIGHTEN },
      { name: "Average (ghost trails)", value: BLEND.AVERAGE },
      { name: "Darken (dark subject on light bg)", value: BLEND.DARKEN },
    ],
    default: BLEND.LIGHTEN,
    desc: "How exposures combine. Lighten keeps the brightest pixel from any exposure (best for bright subject on dark bg).",
  },
  fadeMode: {
    type: ENUM,
    options: [
      { name: "Linear (equal weight)", value: FADE.LINEAR },
      { name: "Tail (oldest fades most)", value: FADE.TAIL },
      { name: "Head (newest fades most)", value: FADE.HEAD },
    ],
    default: FADE.LINEAR,
    desc: "Per-exposure weighting (Average mode only)",
  },
  isolateSubject: { type: BOOL, default: false, desc: "Only show moving parts of each exposure (uses EMA background model)" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  exposures: optionTypes.exposures.default,
  interval: optionTypes.interval.default,
  blendMode: optionTypes.blendMode.default,
  fadeMode: optionTypes.fadeMode.default,
  isolateSubject: optionTypes.isolateSubject.default,
  animSpeed: optionTypes.animSpeed.default,
};

type ChronoOptions = FilterOptionValues & {
  exposures?: number;
  interval?: number;
  blendMode?: string;
  fadeMode?: string;
  isolateSubject?: boolean;
  animSpeed?: number;
  _ema?: Float32Array | null;
  _frameIndex?: number;
};

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2DArray u_frames;
uniform sampler2D u_ema;
uniform int   u_filled;
uniform int   u_oldestLayer;
uniform int   u_capacity;
uniform int   u_blendMode;     // 0 LIGHTEN, 1 AVERAGE, 2 DARKEN
uniform int   u_fadeMode;      // 0 LINEAR, 1 TAIL, 2 HEAD
uniform float u_isolate;       // 1 if isolating subject
uniform float u_haveEma;

void main() {
  if (u_filled == 0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 emaC = texture(u_ema, v_uv).rgb;

  vec3 acc = u_blendMode == 2 ? vec3(1.0) : vec3(0.0);
  vec3 weighted = vec3(0.0);
  float weightSum = 0.0;

  for (int i = 0; i < ${MAX_EXPOSURES}; i++) {
    if (i >= u_filled) break;
    int layer = (u_oldestLayer + i) - (((u_oldestLayer + i) / u_capacity) * u_capacity);
    vec3 f = texture(u_frames, vec3(v_uv, float(layer))).rgb;
    if (u_isolate > 0.5 && u_haveEma > 0.5) {
      float diff = (abs(f.r - emaC.r) + abs(f.g - emaC.g) + abs(f.b - emaC.b)) / 3.0;
      if (diff < 15.0/255.0) continue;
    }
    if (u_blendMode == 0) {
      acc = max(acc, f);
    } else if (u_blendMode == 2) {
      acc = min(acc, f);
    } else {
      float w = u_fadeMode == 1 ? float(i + 1)
              : u_fadeMode == 2 ? float(u_filled - i)
              : 1.0;
      weighted += f * w;
      weightSum += w;
    }
  }

  if (u_blendMode == 1 && weightSum > 0.0) {
    fragColor = vec4(weighted / weightSum, 1.0);
  } else {
    fragColor = vec4(acc, 1.0);
  }
}
`;

let _prog: Program | null = null;
let _arrTex: WebGLTexture | null = null;
let _emaScratch: Uint8ClampedArray | null = null;
let _expW = 0;
let _expH = 0;
let _expCount = 0;
let _expHead = 0;
let _expFilled = 0;
let _frameSinceCapture = 0;
let _expInterval = 0;

const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_frames", "u_ema", "u_filled", "u_oldestLayer", "u_capacity",
    "u_blendMode", "u_fadeMode", "u_isolate", "u_haveEma",
  ] as const);
  return _prog;
};

const ensureArrayTex = (gl: WebGL2RenderingContext, w: number, h: number, capacity: number) => {
  if (_arrTex && _expW === w && _expH === h && _expCount === capacity) return _arrTex;
  if (_arrTex) gl.deleteTexture(_arrTex);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, capacity, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  _arrTex = tex;
  return tex;
};

const blendId = (m: string) => m === BLEND.AVERAGE ? 1 : m === BLEND.DARKEN ? 2 : 0;
const fadeId = (m: string) => m === FADE.TAIL ? 1 : m === FADE.HEAD ? 2 : 0;

const chronophotography = (input: any, options: ChronoOptions = defaults) => {
  const exposures = Math.max(2, Math.min(MAX_EXPOSURES, Math.round(Number(options.exposures ?? defaults.exposures))));
  const interval = Math.max(1, Math.round(Number(options.interval ?? defaults.interval)));
  const blendMode = String(options.blendMode ?? defaults.blendMode);
  const fadeMode = String(options.fadeMode ?? defaults.fadeMode);
  const isolate = Boolean(options.isolateSubject ?? defaults.isolateSubject);
  const ema = options._ema ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  if (_expW !== W || _expH !== H || _expCount !== exposures || _expInterval !== interval || frameIndex === 0) {
    _expW = W; _expH = H; _expCount = exposures; _expInterval = interval;
    _expHead = 0; _expFilled = 0; _frameSinceCapture = interval;
  }

  const arrTex = ensureArrayTex(gl, W, H, exposures);
  if (!arrTex) return glUnavailableStub(W, H);

  _frameSinceCapture++;
  if (_frameSinceCapture >= interval) {
    const layer = _expHead % exposures;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, W, H, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, input as TexImageSource);
    _expHead++;
    _expFilled = Math.min(_expFilled + 1, exposures);
    _frameSinceCapture = 0;
  }

  if (_expFilled === 0) {
    const sourceTex = ensureTexture(gl, "chronophotography:passthrough", W, H);
    uploadSourceTexture(gl, sourceTex, input);
    // Quick passthrough — just let the input pass through unchanged.
    return input;
  }

  const emaTex = ensureTexture(gl, "chronophotography:ema", W, H);
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

  const oldestLayer = ((_expHead - _expFilled) % exposures + exposures) % exposures;

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
    gl.uniform1i(prog.uniforms.u_frames, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, emaTex.tex);
    gl.uniform1i(prog.uniforms.u_ema, 1);
    gl.uniform1i(prog.uniforms.u_filled, _expFilled);
    gl.uniform1i(prog.uniforms.u_oldestLayer, oldestLayer);
    gl.uniform1i(prog.uniforms.u_capacity, exposures);
    gl.uniform1i(prog.uniforms.u_blendMode, blendId(blendMode));
    gl.uniform1i(prog.uniforms.u_fadeMode, fadeId(fadeMode));
    gl.uniform1f(prog.uniforms.u_isolate, isolate ? 1 : 0);
    gl.uniform1f(prog.uniforms.u_haveEma, haveEma ? 1 : 0);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Chronophotography", "WebGL2", `exp=${exposures} blend=${blendMode}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Chronophotography",
  func: chronophotography,
  optionTypes,
  options: defaults,
  defaults,
  description: "Multiple exposures of moving subjects — Marey's stroboscopic photography",
  temporal: true,
  requiresGL: true,
});
