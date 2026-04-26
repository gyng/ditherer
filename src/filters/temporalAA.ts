import { ACTION, RANGE } from "constants/controlTypes";
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

export const optionTypes = {
  blend: {
    type: RANGE,
    range: [0, 0.95],
    step: 0.01,
    default: 0.85,
    desc: "How much of the clamped history to keep — higher smooths more but can soften detail",
  },
  slack: {
    type: RANGE,
    range: [0, 32],
    step: 1,
    default: 4,
    desc: "Extra slack on the 3×3 neighborhood AABB before history clipping — higher allows more ghosting on motion",
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    },
  },
};

export const defaults = {
  blend: optionTypes.blend.default,
  slack: optionTypes.slack.default,
  animSpeed: optionTypes.animSpeed.default,
};

type TemporalAAOptions = FilterOptionValues & {
  blend?: number;
  slack?: number;
  animSpeed?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

const TAA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_history;
uniform vec2  u_texel;
uniform float u_blend;
uniform float u_slack;

void main() {
  vec4 curC = texture(u_source, v_uv);
  vec3 cur = curC.rgb;

  // 3x3 neighborhood AABB from the current frame.
  vec3 mn = cur, mx = cur;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      vec3 s = texture(u_source, v_uv + vec2(float(dx), float(dy)) * u_texel).rgb;
      mn = min(mn, s);
      mx = max(mx, s);
    }
  }

  vec3 hist = texture(u_history, v_uv).rgb;
  vec3 clipped = clamp(hist, mn - u_slack, mx + u_slack);
  vec3 outRgb = mix(cur, clipped, u_blend);
  fragColor = vec4(outRgb, curC.a);
}
`;

let _prog: Program | null = null;

const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, TAA_FS, [
    "u_source", "u_history", "u_texel", "u_blend", "u_slack",
  ] as const);
  return _prog;
};

const temporalAA = (input: any, options: TemporalAAOptions = defaults) => {
  const blend = Math.min(0.95, Math.max(0, Number(options.blend ?? defaults.blend)));
  const slack = Math.max(0, Number(options.slack ?? defaults.slack));
  const prev = options._prevOutput ?? null;
  const W = input.width, H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "temporalAA:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const histEntry = ensureTexture(gl, "temporalAA:history", W, H);
  const haveHist = !!prev && prev.length === W * H * 4 && blend > 0;
  if (haveHist) {
    gl.bindTexture(gl.TEXTURE_2D, histEntry.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, prev!);
  }

  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, haveHist ? histEntry.tex : sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_history, 1);
    gl.uniform2f(prog.uniforms.u_texel, 1 / W, 1 / H);
    gl.uniform1f(prog.uniforms.u_blend, haveHist ? blend : 0);
    gl.uniform1f(prog.uniforms.u_slack, slack / 255);
  }, vao);

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend("Temporal AA", "WebGL2", `blend=${blend} slack=${slack}`);
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  name: "Temporal AA",
  func: temporalAA,
  optionTypes,
  options: defaults,
  defaults,
  description: "Blend the previous output back into the current frame, neighborhood-clamped to suppress ghosting — temporal anti-aliasing for video",
  temporal: true,
  requiresGL: true,
  autoAnimate: true,
});
