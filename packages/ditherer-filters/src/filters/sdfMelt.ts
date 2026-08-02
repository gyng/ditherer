import { COLOR, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_threshold;
uniform float u_inflate;
uniform float u_melt;
uniform float u_noiseScale;
uniform float u_bevel;
uniform float u_metallic;
uniform float u_time;
uniform vec3 u_background;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float field(vec2 uv) {
  vec4 c = texture(u_source, clamp(uv, 0.0, 1.0));
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float wobble = (noise(uv * u_noiseScale + vec2(0.0, u_time)) - 0.5) * 0.22;
  float drip = sin((uv.x * u_noiseScale + noise(vec2(uv.x * 8.0, u_time))) * 3.14159) * u_melt * 0.08;
  return lum - u_threshold + wobble * u_melt + drip - uv.y * u_melt * 0.08;
}

void main() {
  float signHere = field(v_uv) >= 0.0 ? 1.0 : -1.0;
  float best = 48.0;
  vec2 nearestUv = v_uv;
  vec2 pixel = 1.0 / max(u_res, vec2(1.0));
  for (int i = 0; i < 64; i++) {
    float angle = float(i) * 2.399963;
    float radius = 1.0 + floor(float(i) / 8.0) * 4.0;
    vec2 probe = v_uv + vec2(cos(angle), sin(angle)) * pixel * radius;
    if ((field(probe) >= 0.0 ? 1.0 : -1.0) != signHere && radius < best) {
      best = radius;
      nearestUv = probe;
    }
  }
  float signedDistance = best * signHere - u_inflate;
  float inside = 1.0 - smoothstep(-0.75, 0.75, -signedDistance);
  if (inside <= 0.001) { fragColor = vec4(u_background / 255.0, 1.0); return; }

  vec2 direction = normalize(v_uv - nearestUv + vec2(0.00001));
  float dome = sqrt(max(0.0, 1.0 - pow(clamp(signedDistance / max(1.0, u_bevel * 12.0), -1.0, 1.0), 2.0)));
  vec3 normal = normalize(vec3(direction * u_bevel, max(0.15, dome)));
  vec3 light = normalize(vec3(-0.45, 0.65, 0.8));
  float diffuse = 0.28 + 0.85 * max(dot(normal, light), 0.0);
  float spec = pow(max(dot(reflect(-light, normal), vec3(0,0,1)), 0.0), mix(10.0, 72.0, u_metallic)) * u_metallic;
  vec3 material = texture(u_source, clamp(v_uv - vec2(0.0, u_melt * noise(vec2(v_uv.x * 9.0, u_time)) * 0.04), 0.0, 1.0)).rgb;
  fragColor = vec4(clamp(material * diffuse + spec, 0.0, 1.0), 1.0);
}`;

export const optionTypes = {
  threshold: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.48,
    desc: "Luminance isosurface used as the melt boundary",
  },
  inflate: {
    type: RANGE,
    range: [-24, 24],
    step: 1,
    default: 5,
    desc: "Expand or erode the signed-distance silhouette",
  },
  melt: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 0.85,
    desc: "Downward distortion and boundary wobble",
  },
  noiseScale: {
    type: RANGE,
    range: [1, 40],
    step: 1,
    default: 12,
    desc: "Scale of the animated melt field",
  },
  bevel: { type: RANGE, range: [0.1, 4], step: 0.1, default: 1.4, desc: "Inflated edge curvature" },
  metallic: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.5,
    desc: "Liquid-chrome highlight response",
  },
  animateSpeed: {
    type: RANGE,
    range: [0, 3],
    step: 0.05,
    default: 0.55,
    desc: "Melt-field animation speed",
  },
  background: { type: COLOR, default: [15, 12, 22], desc: "Color outside the melted silhouette" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  inflate: optionTypes.inflate.default,
  melt: optionTypes.melt.default,
  noiseScale: optionTypes.noiseScale.default,
  bevel: optionTypes.bevel.default,
  metallic: optionTypes.metallic.default,
  animateSpeed: optionTypes.animateSpeed.default,
  background: optionTypes.background.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const sdfMelt = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "sdfMelt",
    fragmentShader: FS,
    uniformNames: [
      "u_threshold",
      "u_inflate",
      "u_melt",
      "u_noiseScale",
      "u_bevel",
      "u_metallic",
      "u_time",
      "u_background",
    ],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_threshold, options.threshold);
      gl.uniform1f(u.u_inflate, options.inflate);
      gl.uniform1f(u.u_melt, options.melt);
      gl.uniform1f(u.u_noiseScale, options.noiseScale);
      gl.uniform1f(u.u_bevel, options.bevel);
      gl.uniform1f(u.u_metallic, options.metallic);
      gl.uniform1f(u.u_time, (runtime._frameIndex ?? 0) * options.animateSpeed * 0.035);
      gl.uniform3f(
        u.u_background,
        options.background[0],
        options.background[1],
        options.background[2],
      );
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend(
    "SDF Melt",
    "WebGL2",
    `inflate=${options.inflate}${identity ? "" : "+palettePass"}`,
  );
  return identity
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "SDF Melt",
  func: sdfMelt,
  optionTypes,
  options: defaults,
  defaults,
  description: "Inflate, erode, and melt a source-derived signed-distance silhouette",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
