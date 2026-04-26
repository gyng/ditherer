import { RANGE, ENUM, ACTION } from "constants/controlTypes";
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

const BASELINE = { BLACK: "BLACK", ORIGINAL: "ORIGINAL" };

export const optionTypes = {
  gain: { type: RANGE, range: [0.5, 5], step: 0.1, default: 2, desc: "Strength of the motion-reactive echo against the static background" },
  baseline: {
    type: ENUM,
    options: [
      { name: "Black", value: BASELINE.BLACK },
      { name: "Original", value: BASELINE.ORIGINAL }
    ],
    default: BASELINE.ORIGINAL,
    desc: "Whether the stable parts of the image stay visible or fall to black"
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  gain: optionTypes.gain.default,
  baseline: optionTypes.baseline.default,
  animSpeed: optionTypes.animSpeed.default,
};

type EchoCombinerOptions = FilterOptionValues & {
  gain?: number;
  baseline?: string;
  animSpeed?: number;
  _ema?: Float32Array | null;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_ema;
uniform float u_gain;
uniform int   u_baseline; // 0 BLACK, 1 ORIGINAL
uniform float u_haveEma;

void main() {
  vec3 cur = texture(u_source, v_uv).rgb;
  vec3 base = u_baseline == 1 ? cur : vec3(0.0);
  if (u_haveEma < 0.5) {
    fragColor = vec4(base, 1.0);
    return;
  }
  vec3 e = texture(u_ema, v_uv).rgb;
  vec3 d = abs(cur - e) * u_gain;
  fragColor = vec4(clamp(base + d, 0.0, 1.0), 1.0);
}
`;

let _prog: Program | null = null;
let _emaScratch: Uint8ClampedArray | null = null;

const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, ["u_source", "u_ema", "u_gain", "u_baseline", "u_haveEma"] as const);
  return _prog;
};

const echoCombiner = (input: any, options: EchoCombinerOptions = defaults) => {
  const gain = Number(options.gain ?? defaults.gain);
  const baseline = String(options.baseline ?? defaults.baseline);
  const ema = options._ema ?? null;
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "echoCombiner:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const emaTex = ensureTexture(gl, "echoCombiner:ema", W, H);
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

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, emaTex.tex);
    gl.uniform1i(prog.uniforms.u_ema, 1);
    gl.uniform1f(prog.uniforms.u_gain, gain);
    gl.uniform1i(prog.uniforms.u_baseline, baseline === BASELINE.ORIGINAL ? 1 : 0);
    gl.uniform1f(prog.uniforms.u_haveEma, haveEma ? 1 : 0);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Echo Combiner", "WebGL2", `gain=${gain} baseline=${baseline}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Echo Combiner",
  func: echoCombiner,
  optionTypes,
  options: defaults,
  defaults,
  description: "Amplify the difference from the recent average so moving regions resonate while static ones stay grounded",
  temporal: true,
  requiresGL: true,
});
