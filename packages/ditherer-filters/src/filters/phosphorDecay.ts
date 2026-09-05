import { ACTION, ENUM, RANGE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { logFilterBackend } from "../utils/index";
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
import { decayRetentionFromT10 } from "./crtSimulationContracts";

export const PHOSPHOR_PROFILE = {
  P22_COLOR: "P22_COLOR",
  LONG_PERSISTENCE: "LONG_PERSISTENCE",
  CUSTOM_T10: "CUSTOM_T10",
  LEGACY_FRAME: "LEGACY_FRAME",
} as const;

export const optionTypes = {
  profile: {
    type: ENUM,
    options: [
      { name: "P22 color TV (measured)", value: PHOSPHOR_PROFILE.P22_COLOR },
      { name: "Long-persistence display", value: PHOSPHOR_PROFILE.LONG_PERSISTENCE },
      { name: "Custom decay-to-10%", value: PHOSPHOR_PROFILE.CUSTOM_T10 },
      { name: "Legacy per-frame", value: PHOSPHOR_PROFILE.LEGACY_FRAME },
    ],
    default: PHOSPHOR_PROFILE.P22_COLOR,
    desc: "Phosphor timing model; standard P22 is fast while long persistence is explicit",
  },
  refreshRate: {
    type: RANGE,
    range: [24, 240],
    step: 1,
    default: 60,
    desc: "Display refresh used to convert measured milliseconds into per-frame retention",
  },
  redT10Ms: {
    type: RANGE,
    range: [0.01, 1000],
    step: 0.01,
    default: 1,
    desc: "Custom red decay time to 10% of initial luminance, in milliseconds",
    visibleWhen: (options: any) => options.profile === PHOSPHOR_PROFILE.CUSTOM_T10,
  },
  greenT10Ms: {
    type: RANGE,
    range: [0.01, 1000],
    step: 0.01,
    default: 0.06,
    desc: "Custom green decay time to 10% of initial luminance, in milliseconds",
    visibleWhen: (options: any) => options.profile === PHOSPHOR_PROFILE.CUSTOM_T10,
  },
  blueT10Ms: {
    type: RANGE,
    range: [0.01, 1000],
    step: 0.01,
    default: 0.022,
    desc: "Custom blue decay time to 10% of initial luminance, in milliseconds",
    visibleWhen: (options: any) => options.profile === PHOSPHOR_PROFILE.CUSTOM_T10,
  },
  redDecay: {
    type: RANGE,
    range: [0.01, 0.3],
    step: 0.01,
    default: 0.15,
    desc: "Legacy red loss per rendered frame",
    visibleWhen: (options: any) => options.profile === PHOSPHOR_PROFILE.LEGACY_FRAME,
  },
  greenDecay: {
    type: RANGE,
    range: [0.01, 0.3],
    step: 0.01,
    default: 0.05,
    desc: "Legacy green loss per rendered frame",
    visibleWhen: (options: any) => options.profile === PHOSPHOR_PROFILE.LEGACY_FRAME,
  },
  blueDecay: {
    type: RANGE,
    range: [0.01, 0.3],
    step: 0.01,
    default: 0.2,
    desc: "Legacy blue loss per rendered frame",
    visibleWhen: (options: any) => options.profile === PHOSPHOR_PROFILE.LEGACY_FRAME,
  },
  animSpeed: {
    type: RANGE,
    range: [1, 60],
    step: 1,
    default: 30,
    desc: "Preview-loop frame rate; independent from the simulated tube refresh",
  },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _f: any, options: any) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed ?? defaults.animSpeed);
      }
    },
    desc: "Start or stop temporal phosphor decay",
  },
};

export const defaults = {
  profile: optionTypes.profile.default,
  refreshRate: optionTypes.refreshRate.default,
  redT10Ms: optionTypes.redT10Ms.default,
  greenT10Ms: optionTypes.greenT10Ms.default,
  blueT10Ms: optionTypes.blueT10Ms.default,
  redDecay: optionTypes.redDecay.default,
  greenDecay: optionTypes.greenDecay.default,
  blueDecay: optionTypes.blueDecay.default,
  animSpeed: optionTypes.animSpeed.default,
};

type PhosphorDecayOptions = FilterOptionValues & {
  profile?: string;
  refreshRate?: number;
  redT10Ms?: number;
  greenT10Ms?: number;
  blueT10Ms?: number;
  redDecay?: number;
  greenDecay?: number;
  blueDecay?: number;
  animSpeed?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_history;
uniform vec3  u_retain;
uniform float u_haveHist;

vec3 srgbToLinear(vec3 encoded) {
  vec3 low = encoded / 12.92;
  vec3 high = pow((encoded + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), encoded));
}

vec3 linearToSrgb(vec3 linear) {
  vec3 low = linear * 12.92;
  vec3 high = 1.055 * pow(max(linear, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), linear));
}

void main() {
  vec4 source = texture(u_source, v_uv);
  vec3 cur = srgbToLinear(source.rgb);
  if (u_haveHist > 0.5) {
    vec3 hist = srgbToLinear(texture(u_history, v_uv).rgb) * u_retain;
    cur = max(cur, hist);
  }
  fragColor = vec4(clamp(linearToSrgb(cur), 0.0, 1.0), source.a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, ["u_source", "u_history", "u_retain", "u_haveHist"] as const);
  return _prog;
};

const phosphorDecay = (input: any, options: PhosphorDecayOptions = defaults) => {
  const profile = String(options.profile ?? defaults.profile);
  const refreshRate = Number(options.refreshRate ?? defaults.refreshRate);
  let retain: [number, number, number];
  if (profile === PHOSPHOR_PROFILE.P22_COLOR) {
    retain = [
      decayRetentionFromT10(1, refreshRate),
      decayRetentionFromT10(0.06, refreshRate),
      decayRetentionFromT10(0.022, refreshRate),
    ];
  } else if (profile === PHOSPHOR_PROFILE.LONG_PERSISTENCE) {
    retain = [
      decayRetentionFromT10(90, refreshRate),
      decayRetentionFromT10(180, refreshRate),
      decayRetentionFromT10(70, refreshRate),
    ];
  } else if (profile === PHOSPHOR_PROFILE.CUSTOM_T10) {
    retain = [
      decayRetentionFromT10(Number(options.redT10Ms ?? defaults.redT10Ms), refreshRate),
      decayRetentionFromT10(Number(options.greenT10Ms ?? defaults.greenT10Ms), refreshRate),
      decayRetentionFromT10(Number(options.blueT10Ms ?? defaults.blueT10Ms), refreshRate),
    ];
  } else {
    retain = [
      1 - Number(options.redDecay ?? defaults.redDecay),
      1 - Number(options.greenDecay ?? defaults.greenDecay),
      1 - Number(options.blueDecay ?? defaults.blueDecay),
    ];
  }
  const prev = options._prevOutput ?? null;
  const W = input.width,
    H = input.height;

  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);

  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);

  const sourceTex = ensureTexture(gl, "phosphorDecay:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);

  const histEntry = ensureTexture(gl, "phosphorDecay:history", W, H);
  const haveHist = !!prev && prev.length === W * H * 4;
  if (haveHist) {
    gl.bindTexture(gl.TEXTURE_2D, histEntry.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, prev!);
  }

  drawPass(
    gl,
    null,
    W,
    H,
    prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(prog.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, haveHist ? histEntry.tex : sourceTex.tex);
      gl.uniform1i(prog.uniforms.u_history, 1);
      gl.uniform3f(prog.uniforms.u_retain, retain[0], retain[1], retain[2]);
      gl.uniform1f(prog.uniforms.u_haveHist, haveHist ? 1 : 0);
    },
    vao,
  );

  const rendered = readoutToCanvas(canvas, W, H);
  if (rendered) {
    logFilterBackend(
      "Phosphor Decay",
      "WebGL2",
      `${profile} retain=${retain.map((value) => value.toFixed(3)).join("/")}`,
    );
    return rendered;
  }
  return glUnavailableStub(W, H);
};

export default defineFilter({
  history: { prevOutput: true },
  name: "Phosphor Decay",
  func: phosphorDecay,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Refresh-aware CRT phosphor persistence with measured P22 timing, custom decay-to-10% values, and explicit long-afterglow profiles",
  temporal: true,
  requiresGL: true,
});
