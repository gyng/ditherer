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
uniform float u_cellSize;
uniform float u_heightScale;
uniform float u_pitch;
uniform float u_yaw;
uniform float u_fog;
uniform float u_sunAngle;
uniform float u_waterLevel;
uniform vec3 u_skyColor;

float heightAt(vec2 xz) {
  vec2 cells = max(vec2(2.0), u_res / u_cellSize);
  vec2 uv = (floor(clamp(xz, 0.0, 0.9999) * cells) + 0.5) / cells;
  vec3 c = texture(u_source, vec2(uv.x, 1.0 - uv.y)).rgb;
  return max(u_waterLevel, dot(c, vec3(0.2126, 0.7152, 0.0722)) * u_heightScale);
}

void main() {
  vec2 screen = v_uv * 2.0 - 1.0;
  screen.x *= u_res.x / max(u_res.y, 1.0);
  float yaw = radians(u_yaw);
  float pitch = radians(u_pitch);
  vec3 target = vec3(0.5, 0.25, 0.5);
  vec3 ro = target + vec3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch)) * 1.45;
  vec3 forward = normalize(target - ro);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  vec3 rd = normalize(forward + right * screen.x * 0.7 + up * screen.y * 0.7);

  float hitT = -1.0;
  vec3 hit = vec3(0.0);
  for (int i = 0; i < 112; i++) {
    float t = 0.03 + float(i) * 0.025;
    vec3 p = ro + rd * t;
    if (p.x < 0.0 || p.x > 1.0 || p.z < 0.0 || p.z > 1.0 || p.y < 0.0) continue;
    if (p.y <= heightAt(p.xz)) { hitT = t; hit = p; break; }
  }
  if (hitT < 0.0) {
    float horizon = smoothstep(-0.5, 0.8, screen.y);
    fragColor = vec4((u_skyColor / 255.0) * mix(0.45, 1.25, horizon), 1.0);
    return;
  }

  vec2 cells = max(vec2(2.0), u_res / u_cellSize);
  vec2 cellUv = (floor(clamp(hit.xz, 0.0, 0.9999) * cells) + 0.5) / cells;
  vec3 base = texture(u_source, vec2(cellUv.x, 1.0 - cellUv.y)).rgb;
  vec2 eps = 1.0 / cells;
  float hL = heightAt(hit.xz - vec2(eps.x, 0.0));
  float hR = heightAt(hit.xz + vec2(eps.x, 0.0));
  float hD = heightAt(hit.xz - vec2(0.0, eps.y));
  float hU = heightAt(hit.xz + vec2(0.0, eps.y));
  vec3 n = normalize(vec3(hL - hR, eps.x + eps.y, hD - hU));
  float sa = radians(u_sunAngle);
  vec3 light = normalize(vec3(cos(sa), 0.9, sin(sa)));
  float diffuse = 0.28 + 0.9 * max(dot(n, light), 0.0);
  vec2 within = fract(hit.xz * cells);
  float grid = smoothstep(0.02, 0.08, min(min(within.x, 1.0 - within.x), min(within.y, 1.0 - within.y)));
  vec3 rgb = base * diffuse * mix(0.55, 1.0, grid);
  if (heightAt(hit.xz) <= u_waterLevel + 0.001 && u_waterLevel > 0.0) rgb = mix(rgb, vec3(0.08, 0.32, 0.48), 0.65);
  float fogMix = 1.0 - exp(-hitT * hitT * u_fog);
  rgb = mix(rgb, u_skyColor / 255.0, clamp(fogMix, 0.0, 0.9));
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

export const optionTypes = {
  cellSize: {
    type: RANGE,
    range: [2, 64],
    step: 1,
    default: 12,
    desc: "Source-pixel block size used to build terrain columns",
  },
  heightScale: {
    type: RANGE,
    range: [0.05, 1],
    step: 0.05,
    default: 0.55,
    desc: "Maximum luminance-derived column height",
  },
  pitch: { type: RANGE, range: [10, 80], step: 1, default: 35, desc: "Virtual camera elevation" },
  yaw: {
    type: RANGE,
    range: [-180, 180],
    step: 1,
    default: 28,
    desc: "Virtual camera orbit around the landscape",
  },
  fog: { type: RANGE, range: [0, 2], step: 0.05, default: 0.35, desc: "Distance fog density" },
  sunAngle: {
    type: RANGE,
    range: [0, 360],
    step: 1,
    default: 135,
    desc: "Directional terrain light",
  },
  waterLevel: {
    type: RANGE,
    range: [0, 0.8],
    step: 0.02,
    default: 0,
    desc: "Optional blue floor that fills low terrain",
  },
  skyColor: { type: COLOR, default: [104, 146, 194], desc: "Sky and distance-fog color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  heightScale: optionTypes.heightScale.default,
  pitch: optionTypes.pitch.default,
  yaw: optionTypes.yaw.default,
  fog: optionTypes.fog.default,
  sunAngle: optionTypes.sunAngle.default,
  waterLevel: optionTypes.waterLevel.default,
  skyColor: optionTypes.skyColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const voxelLandscape = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "voxelLandscape",
    fragmentShader: FS,
    uniformNames: [
      "u_cellSize",
      "u_heightScale",
      "u_pitch",
      "u_yaw",
      "u_fog",
      "u_sunAngle",
      "u_waterLevel",
      "u_skyColor",
    ],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_cellSize, options.cellSize);
      gl.uniform1f(u.u_heightScale, options.heightScale);
      gl.uniform1f(u.u_pitch, options.pitch);
      gl.uniform1f(u.u_yaw, options.yaw);
      gl.uniform1f(u.u_fog, options.fog);
      gl.uniform1f(u.u_sunAngle, options.sunAngle);
      gl.uniform1f(u.u_waterLevel, options.waterLevel);
      gl.uniform3f(u.u_skyColor, options.skyColor[0], options.skyColor[1], options.skyColor[2]);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend(
    "Voxel Landscape",
    "WebGL2",
    `cell=${options.cellSize}${identity ? "" : "+palettePass"}`,
  );
  return identity
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "Voxel Landscape",
  func: voxelLandscape,
  optionTypes,
  options: defaults,
  defaults,
  description: "Raycast source-colored voxel columns into a tiny image-derived landscape",
  requiresGL: true,
});
