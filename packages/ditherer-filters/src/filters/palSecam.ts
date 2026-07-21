import { ACTION, BOOL, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { nearest } from "../palettes/index";
import { renderGLSinglePass } from "../utils/glSinglePass";
import { logFilterBackend } from "../utils/index";
import { defineFilter, type FilterOptionValues } from "./types";

const SYSTEM = { PAL: "PAL", SECAM: "SECAM" } as const;

const previewRate = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Math.max(1, Math.min(30, Number.isFinite(numeric) ? numeric : fallback));
};

export const optionTypes = {
  system: {
    type: ENUM,
    options: [
      { name: "PAL B/G — 625/50", value: SYSTEM.PAL },
      { name: "SECAM L — 625/50", value: SYSTEM.SECAM },
    ],
    default: SYSTEM.PAL,
    desc: "BT.1700 composite color system",
  },
  chromaBandwidth: { type: RANGE, range: [0.1, 1.3], step: 0.05, default: 0.65, desc: "Decoded chroma bandwidth in MHz" },
  lumaBandwidth: { type: RANGE, range: [2, 6], step: 0.1, default: 5, desc: "Decoded luminance bandwidth in MHz" },
  phaseError: { type: RANGE, range: [-45, 45], step: 0.5, default: 8, desc: "PAL subcarrier phase error in degrees; alternating phase exposes delay-line cancellation" },
  tuningError: { type: RANGE, range: [-1, 1], step: 0.01, default: 0.08, desc: "SECAM FM discriminator mistuning or PAL burst-reference error" },
  delayLine: { type: BOOL, default: true, desc: "Use the one-line chroma delay required by PAL/SECAM decoders" },
  crossColor: { type: RANGE, range: [0, 1], step: 0.01, default: 0.16, desc: "Luma energy misidentified as chroma near the color subcarrier" },
  crossLuma: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Residual chroma subcarrier pattern visible in luminance" },
  channelNoise: { type: RANGE, range: [0, 1], step: 0.01, default: 0.03, desc: "Composite channel noise before color decoding" },
  interlace: { type: BOOL, default: true, desc: "Render the alternating 50-field 625-line scan structure" },
  randomSeed: { type: RANGE, range: [0, 9999], step: 1, default: 625, desc: "Deterministic channel noise seed" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 25, desc: "Preview field rate" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Advance field phase and channel noise",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, previewRate(options.animSpeed, 25));
    },
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  system: optionTypes.system.default,
  chromaBandwidth: optionTypes.chromaBandwidth.default,
  lumaBandwidth: optionTypes.lumaBandwidth.default,
  phaseError: optionTypes.phaseError.default,
  tuningError: optionTypes.tuningError.default,
  delayLine: optionTypes.delayLine.default,
  crossColor: optionTypes.crossColor.default,
  crossLuma: optionTypes.crossLuma.default,
  channelNoise: optionTypes.channelNoise.default,
  interlace: optionTypes.interlace.default,
  randomSeed: optionTypes.randomSeed.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_system;
uniform float u_chromaRadius;
uniform float u_lumaRadius;
uniform float u_phaseError;
uniform float u_tuningError;
uniform float u_delayLine;
uniform float u_crossColor;
uniform float u_crossLuma;
uniform float u_noise;
uniform float u_seed;
uniform float u_frame;
uniform float u_interlace;

const float PI = 3.14159265358979323846;

vec3 sampleRgb(vec2 pixel) {
  vec2 p = clamp(pixel, vec2(0.0), u_res - vec2(1.0));
  return texture(u_source, vec2((p.x + 0.5) / u_res.x, 1.0 - (p.y + 0.5) / u_res.y)).rgb;
}
vec3 toYuv(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(-0.14713, -0.28886, 0.436)),
    dot(c, vec3(0.615, -0.51499, -0.10001)));
}
vec3 toRgb(vec3 yuv) {
  return vec3(yuv.x + 1.13983 * yuv.z,
    yuv.x - 0.39465 * yuv.y - 0.58060 * yuv.z,
    yuv.x + 2.03211 * yuv.y);
}
float hash(vec2 p) {
  return fract(sin(dot(p + u_seed, vec2(12.9898, 78.233))) * 43758.5453);
}
vec3 filteredYuv(float x, float y) {
  float lum = 0.0, lw = 0.0;
  vec2 chr = vec2(0.0); float cw = 0.0;
  for (int k = -8; k <= 8; k++) {
    float fk = float(k);
    vec3 s = toYuv(sampleRgb(vec2(x + fk, y)));
    float wl = exp(-abs(fk) / max(0.35, u_lumaRadius));
    float wc = exp(-abs(fk) / max(0.35, u_chromaRadius));
    lum += s.x * wl; lw += wl; chr += s.yz * wc; cw += wc;
  }
  return vec3(lum / lw, chr / cw);
}
vec2 rotateChroma(vec2 c, float angle) {
  float cs = cos(angle), sn = sin(angle);
  return mat2(cs, -sn, sn, cs) * c;
}
vec2 palDecoded(vec3 yuv, float signV) {
  vec2 encoded = vec2(yuv.y, yuv.z * signV);
  // The channel/burst phase error has the same sign on adjacent lines. PAL's
  // alternating transmitted V sign makes its decoded crosstalk alternate;
  // averaging those decoded lines is what cancels the error.
  encoded = rotateChroma(encoded, u_phaseError + u_tuningError * 0.22);
  encoded.y *= signV;
  return encoded;
}

void main() {
  vec2 p = vec2(floor(v_uv.x * u_res.x), floor((1.0 - v_uv.y) * u_res.y));
  float line = floor(p.y);
  float parity = mod(line + (u_interlace > 0.5 ? floor(u_frame) : 0.0), 2.0);
  vec3 current = filteredYuv(p.x, p.y);
  vec3 previous = filteredYuv(p.x, max(0.0, p.y - 1.0));
  vec2 chroma;

  if (u_system == 0) {
    // PAL alternates V by 180 degrees. A one-line delay averages opposite
    // phase errors, turning uncancelled error into Hanover bars.
    float signV = parity < 0.5 ? 1.0 : -1.0;
    vec2 decoded = palDecoded(current, signV);
    vec2 delayed = palDecoded(previous, -signV);
    chroma = mix(decoded, (decoded + delayed) * 0.5, u_delayLine);
  } else {
    // SECAM sends Dr and Db on alternate lines with FM. The missing component
    // is recovered from a one-line delay; discriminator mistuning changes the
    // recovered component's gain instead of hue phase.
    bool sendsU = parity < 0.5;
    vec2 delayed = previous.yz;
    float uGain = 1.0 + u_tuningError * 0.22;
    float vGain = 1.0 - u_tuningError * 0.18;
    vec2 transmitted = sendsU
      ? vec2(current.y * uGain, 0.0)
      : vec2(0.0, current.z * vGain);
    vec2 recovered = sendsU
      ? vec2(current.y * uGain, delayed.y * vGain)
      : vec2(delayed.x * uGain, current.z * vGain);
    chroma = mix(transmitted, recovered, u_delayLine);
  }

  float carrier = sin(p.x * PI * 0.5 + line * PI * 0.5);
  float edge = toYuv(sampleRgb(p + vec2(1.0, 0.0))).x - toYuv(sampleRgb(p - vec2(1.0, 0.0))).x;
  chroma += vec2(edge * carrier, edge * cos(p.x * PI * 0.5)) * u_crossColor * 0.28;
  float luma = current.x + carrier * length(chroma) * u_crossLuma * 0.10;
  float n = (hash(p + vec2(u_frame * 17.0, line)) - 0.5) * u_noise * 0.16;
  vec3 rgb = toRgb(vec3(luma + n, chroma + n * vec2(0.35, -0.25)));
  if (u_interlace > 0.5 && parity > 0.5) rgb *= 0.985;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Options = FilterOptionValues & Partial<typeof defaults> & { _frameIndex?: number };

const finiteClamp = (value: unknown, fallback: number, low: number, high: number): number => {
  const numeric = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(numeric) ? numeric : fallback));
};

const palSecam = (input: HTMLCanvasElement | OffscreenCanvas, options: Options = defaults) => {
  const width = input.width, height = input.height;
  if (width < 1 || height < 1) return input;
  const system = String(options.system) === SYSTEM.SECAM ? 1 : 0;
  const chromaBandwidth = finiteClamp(options.chromaBandwidth, defaults.chromaBandwidth, 0.1, 1.3);
  const lumaBandwidth = finiteClamp(options.lumaBandwidth, defaults.lumaBandwidth, 2, 6);
  const chromaRadius = Math.max(0.35, 1.3 / chromaBandwidth);
  const lumaRadius = Math.max(0.35, 3.8 / lumaBandwidth);
  const phaseError = finiteClamp(options.phaseError, defaults.phaseError, -45, 45);
  const tuningError = finiteClamp(options.tuningError, defaults.tuningError, -1, 1);
  const crossColor = finiteClamp(options.crossColor, defaults.crossColor, 0, 1);
  const crossLuma = finiteClamp(options.crossLuma, defaults.crossLuma, 0, 1);
  const channelNoise = finiteClamp(options.channelNoise, defaults.channelNoise, 0, 1);
  const randomSeed = finiteClamp(options.randomSeed, defaults.randomSeed, 0, 9999);
  const frame = Math.max(0, Math.floor(finiteClamp(options._frameIndex, 0, 0, Number.MAX_SAFE_INTEGER)));
  const palette = options.palette ?? defaults.palette;
  const rendered = renderGLSinglePass({
    source: input,
    width,
    height,
    key: "pal-secam-bt1700",
    fragmentShader: FS,
    uniformNames: ["u_system", "u_chromaRadius", "u_lumaRadius", "u_phaseError", "u_tuningError", "u_delayLine", "u_crossColor", "u_crossLuma", "u_noise", "u_seed", "u_frame", "u_interlace"],
    setUniforms: (gl, u) => {
      gl.uniform1i(u.u_system, system);
      gl.uniform1f(u.u_chromaRadius, chromaRadius);
      gl.uniform1f(u.u_lumaRadius, lumaRadius);
      gl.uniform1f(u.u_phaseError, phaseError * Math.PI / 180);
      gl.uniform1f(u.u_tuningError, tuningError);
      gl.uniform1f(u.u_delayLine, options.delayLine === false ? 0 : 1);
      gl.uniform1f(u.u_crossColor, crossColor);
      gl.uniform1f(u.u_crossLuma, crossLuma);
      gl.uniform1f(u.u_noise, channelNoise);
      gl.uniform1f(u.u_seed, randomSeed);
      gl.uniform1f(u.u_frame, frame);
      gl.uniform1f(u.u_interlace, options.interlace === false ? 0 : 1);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const output = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
  logFilterBackend("PAL / SECAM", "WebGL2", `${system === 1 ? SYSTEM.SECAM : SYSTEM.PAL} 625/50${identity ? "" : "+palettePass"}`);
  return output ?? input;
};

export default defineFilter({
  name: "PAL / SECAM",
  func: palSecam,
  optionTypes,
  options: defaults,
  defaults,
  description: "BT.1700 PAL/SECAM composite modulation, delay-line decoding, bandwidth and channel faults",
  temporal: true,
  requiresGL: true,
});
