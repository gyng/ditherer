import { PALETTE, RANGE } from "../constants/controlTypes";
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
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "Heat exposure and outward growth of the destroyed emulsion core" },
  warmth: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "Amber dye shift in the heat-affected emulsion and exposed projector light" },
  hotspots: { type: RANGE, range: [0, 5], step: 1, default: 2, desc: "Number of independent projector-gate burn origins" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Deterministic placement and shape seed for the damage" },
  distortion: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "Local image warping from film-base shrinkage and buckling" },
  blistering: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "Strength of the hardened dark crust and bright blister boundary" },
  roughness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "Multi-scale irregularity of the growing burn front" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  warmth: optionTypes.warmth.default,
  hotspots: optionTypes.hotspots.default,
  seed: optionTypes.seed.default,
  distortion: optionTypes.distortion.default,
  blistering: optionTypes.blistering.default,
  roughness: optionTypes.roughness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const MAX_SPOTS = 5;

const FILM_BURN_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_spotCount;
uniform vec3 u_spots[${MAX_SPOTS}];
uniform float u_intensity;
uniform float u_warmth;
uniform float u_distortion;
uniform float u_blistering;
uniform float u_roughness;
uniform float u_seed;

float hash21(vec2 point) {
  vec3 p = fract(vec3(point.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell + u_seed);
  float b = hash21(cell + vec2(1.0, 0.0) + u_seed);
  float c = hash21(cell + vec2(0.0, 1.0) + u_seed);
  float d = hash21(cell + vec2(1.0) + u_seed);
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 point) {
  float result = 0.0;
  float weight = 0.57;
  for (int octave = 0; octave < 4; octave++) {
    result += valueNoise(point) * weight;
    point = point * 2.03 + vec2(17.1, 9.7);
    weight *= 0.5;
  }
  return result / 1.06875;
}

void main() {
  vec2 pixel = v_uv * u_res;
  float closestFront = 10.0;
  vec2 closestDirection = vec2(0.0);
  float closestRadius = 1.0;

  for (int index = 0; index < ${MAX_SPOTS}; index++) {
    if (index >= u_spotCount) break;
    vec3 spot = u_spots[index];
    vec2 delta = pixel - spot.xy;
    float radius = max(spot.z, 1.0);
    vec2 normalizedDelta = delta / radius;
    float distanceFromOrigin = length(normalizedDelta);
    float angle = atan(normalizedDelta.y, normalizedDelta.x);
    float organicNoise = fbm(pixel / max(radius * 0.18, 2.0) + float(index) * 8.3) - 0.5;
    float lobes = sin(angle * (5.0 + float(index)) + u_seed * 3.1) * 0.045;
    float irregularity = (organicNoise * 0.3 + lobes) * u_roughness;
    float front = 0.12 + u_intensity * 0.75;
    float signedDistance = distanceFromOrigin - front - irregularity;
    if (signedDistance < closestFront) {
      closestFront = signedDistance;
      closestDirection = normalizedDelta;
      closestRadius = radius;
    }
  }

  float activity = smoothstep(0.0, 0.25, u_intensity) * step(1.0, float(u_spotCount));
  float heat = (1.0 - smoothstep(0.0, 0.42, closestFront)) * activity;
  float blister = (1.0 - smoothstep(0.025, 0.13, abs(closestFront))) * activity;
  float destroyedCore = (1.0 - smoothstep(-0.2, -0.045, closestFront)) * activity;

  vec2 direction = length(closestDirection) > 0.0001 ? normalize(closestDirection) : vec2(0.0);
  float buckleBand = heat * (1.0 - destroyedCore) * (1.0 - blister * 0.4);
  float buckleWave = sin(length(closestDirection) * 34.0 + fbm(pixel * 0.035) * 5.0);
  vec2 warpPixels = direction * buckleWave * u_distortion * min(12.0, closestRadius * 0.08) * buckleBand;
  warpPixels += vec2(valueNoise(pixel * 0.08) - 0.5, valueNoise(pixel.yx * 0.075 + 23.0) - 0.5)
    * u_distortion * 4.0 * buckleBand;

  vec2 sourceUv = clamp((pixel + warpPixels) / u_res, vec2(0.0), vec2(1.0));
  vec4 source = texture(u_source, sourceUv);
  float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));

  vec3 fadedDyes = mix(vec3(luminance), vec3(luminance * 1.12, luminance * 0.72, luminance * 0.32), u_warmth);
  vec3 result = mix(source.rgb, fadedDyes, buckleBand * 0.72);

  float crackPattern = smoothstep(0.91, 0.985, abs(sin(
    atan(closestDirection.y, closestDirection.x) * 11.0
    + length(closestDirection) * 47.0
    + fbm(pixel * 0.06) * 7.0
  ))) * blister;
  vec3 crust = mix(vec3(0.055, 0.012, 0.004), vec3(0.24, 0.045, 0.006), u_warmth);
  result = mix(result, crust, blister * u_blistering * (0.82 + crackPattern * 0.18));

  float innerBlister = smoothstep(-0.21, -0.08, closestFront) * (1.0 - smoothstep(-0.08, 0.015, closestFront));
  vec3 hotEdge = mix(vec3(1.0, 0.78, 0.22), vec3(1.0, 0.95, 0.72), u_warmth);
  result = mix(result, hotEdge, innerBlister * u_blistering * activity * 0.9);

  float coreTexture = fbm(pixel * 0.055 + u_seed * 4.0);
  vec3 projectorLight = mix(vec3(1.0, 0.93, 0.72), vec3(1.0, 0.995, 0.96), coreTexture);
  float coreBreakup = destroyedCore * smoothstep(0.08, 0.42, -closestFront + (coreTexture - 0.5) * 0.1);
  result = mix(result, projectorLight, coreBreakup);

  fragColor = vec4(clamp(result, 0.0, 1.0), source.a);
}
`;

type Cache = { burn: Program };
let cache: Cache | null = null;

const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (!cache) {
    cache = {
      burn: linkProgram(gl, FILM_BURN_FS, [
        "u_source", "u_res", "u_spotCount", "u_spots[0]", "u_intensity", "u_warmth",
        "u_distortion", "u_blistering", "u_roughness", "u_seed",
      ] as const),
    };
  }
  return cache.burn;
};

const mulberry32 = (seed: number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const renderFilmBurn = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  options: Omit<typeof defaults, "palette">,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const program = getProgram(gl);
  const vao = getQuadVAO(gl);
  const random = mulberry32(options.seed);
  const spots = new Float32Array(MAX_SPOTS * 3);
  const count = Math.max(0, Math.min(MAX_SPOTS, Math.round(options.hotspots)));
  const scale = Math.max(width, height);
  for (let index = 0; index < count; index += 1) {
    spots[index * 3] = (0.12 + random() * 0.76) * width;
    spots[index * 3 + 1] = (0.12 + random() * 0.76) * height;
    spots[index * 3 + 2] = (0.2 + random() * 0.2) * scale;
  }

  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "filmBurn:source", width, height);
  uploadSourceTexture(gl, sourceTexture, source);
  drawPass(gl, null, width, height, program, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(program.uniforms.u_source, 0);
    gl.uniform2f(program.uniforms.u_res, width, height);
    gl.uniform1i(program.uniforms.u_spotCount, count);
    gl.uniform3fv(program.uniforms["u_spots[0]"], spots);
    gl.uniform1f(program.uniforms.u_intensity, options.intensity);
    gl.uniform1f(program.uniforms.u_warmth, options.warmth);
    gl.uniform1f(program.uniforms.u_distortion, options.distortion);
    gl.uniform1f(program.uniforms.u_blistering, options.blistering);
    gl.uniform1f(program.uniforms.u_roughness, options.roughness);
    gl.uniform1f(program.uniforms.u_seed, options.seed * 0.017);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};

const filmBurn = (input: any, options: Partial<typeof defaults> = defaults) => {
  const resolved = { ...defaults, ...options };
  const { palette, ...damage } = resolved;
  const width = input.width;
  const height = input.height;
  const rendered = renderFilmBurn(input, width, height, damage);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const output = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
  logFilterBackend("Film Burn", "WebGL2", `spots=${damage.hotspots} intensity=${damage.intensity}${identity ? "" : "+palettePass"}`);
  return output ?? input;
};

export default defineFilter({
  name: "Film Burn",
  func: filmBurn,
  optionTypes,
  options: defaults,
  defaults,
  description: "Projection-gate heat damage with warped dyes, blistered crust, cracked emulsion, and exposed-lamp cores",
  requiresGL: true,
});
