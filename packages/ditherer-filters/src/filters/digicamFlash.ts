import { PALETTE, RANGE } from "../constants/controlTypes";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { nearest } from "../palettes/index";
import { cloneCanvas, logFilterBackend, logFilterWasmStatus } from "../utils/index";
import { flashLinearChannel } from "./consumerImagingQualityContracts";
import { defineFilter } from "./types";

export const optionTypes = {
  flashPower: { type: RANGE, range: [0, 2], step: 0.05, default: 0.85, desc: "Additional on-axis flash exposure in stops; zero disables the flash contribution" },
  falloff: { type: RANGE, range: [0.5, 6], step: 0.05, default: 2.2, desc: "Off-axis softness of the flash beam across the flat-scene proxy" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of the projected flash beam" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.44, desc: "Vertical center of the projected flash beam" },
  ambient: { type: RANGE, range: [0, 1], step: 0.01, default: 0.78, desc: "Ambient exposure retained before the flash contribution is added" },
  edgeBurn: { type: RANGE, range: [0, 1], step: 0.01, default: 0.18, desc: "Lens-edge vignetting applied to ambient and flash exposure" },
  whiteClip: { type: RANGE, range: [200, 255], step: 1, default: 245, desc: "Sensor saturation capacity expressed as an sRGB code value" },
  warmth: { type: RANGE, range: [-0.3, 0.3], step: 0.01, default: 0.02, desc: "Flash-only white-balance tint: warm (+) to cool (−)" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette applied after flash exposure and sensor clipping" },
};

export const defaults = {
  flashPower: optionTypes.flashPower.default,
  falloff: optionTypes.falloff.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  ambient: optionTypes.ambient.default,
  edgeBurn: optionTypes.edgeBurn.default,
  whiteClip: optionTypes.whiteClip.default,
  warmth: optionTypes.warmth.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const FLASH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform vec2 u_center;
uniform float u_flashGain;
uniform float u_falloff;
uniform float u_ambient;
uniform float u_edgeBurn;
uniform float u_saturation;
uniform float u_warmth;

vec3 srgbToLinear(vec3 c) {
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, cutoff);
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, cutoff);
}

void main() {
  vec4 source = texture(u_source, v_uv);
  vec3 reflectance = srgbToLinear(source.rgb);
  vec2 pixel = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 delta = (pixel - u_center) / max(u_res.x, u_res.y);
  float radiusSquared = dot(delta, delta);
  float beam = exp(-max(0.0, u_falloff) * radiusSquared * 4.0);
  float edgeRadius = clamp(sqrt(radiusSquared) / 0.72, 0.0, 1.0);
  float lensTransmission = 1.0 - clamp(u_edgeBurn, 0.0, 1.0) * edgeRadius * edgeRadius;

  vec3 tint = vec3(1.0 + u_warmth * 0.36, 1.0, 1.0 - u_warmth * 0.46);
  tint /= max(0.001, dot(tint, vec3(0.2126, 0.7152, 0.0722)));
  vec3 exposure = reflectance * u_ambient
    + reflectance * (u_flashGain * beam) * tint;
  exposure *= lensTransmission;
  vec3 captured = min(exposure / max(0.001, u_saturation), vec3(1.0));
  fragColor = vec4(clamp(linearToSrgb(captured), 0.0, 1.0), source.a);
}
`;

let program: Program | null = null;
const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (program) return program;
  program = linkProgram(gl, FLASH_FS, [
    "u_source", "u_res", "u_center", "u_flashGain", "u_falloff",
    "u_ambient", "u_edgeBurn", "u_saturation", "u_warmth",
  ] as const);
  return program;
};

const bounded = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const numeric = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? numeric : fallback));
};

const srgbToLinear = (value: number): number => {
  const normalized = Math.max(0, Math.min(1, value / 255));
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (value: number): number => {
  const linear = Math.max(0, value);
  return 255 * (linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * linear ** (1 / 2.4) - 0.055);
};

const digicamFlash = (input: any, options = defaults) => {
  const width = input.width;
  const height = input.height;
  const flashPower = bounded(options.flashPower, defaults.flashPower, 0, 2);
  const flashGain = 2 ** flashPower - 1;
  const falloff = bounded(options.falloff, defaults.falloff, 0.5, 6);
  const centerX = bounded(options.centerX, defaults.centerX, 0, 1) * width;
  const centerY = bounded(options.centerY, defaults.centerY, 0, 1) * height;
  const ambient = bounded(options.ambient, defaults.ambient, 0, 1);
  const edgeBurn = bounded(options.edgeBurn, defaults.edgeBurn, 0, 1);
  const saturationCode = bounded(options.whiteClip, defaults.whiteClip, 200, 255);
  const saturation = srgbToLinear(saturationCode);
  const warmth = bounded(options.warmth, defaults.warmth, -0.3, 0.3);
  const palette = options.palette ?? defaults.palette;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const context = getGLCtx();
    if (context) {
      const { gl, canvas } = context;
      const shader = getProgram(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, width, height);
      const sourceTexture = ensureTexture(gl, "digicamFlash:source", width, height);
      uploadSourceTexture(gl, sourceTexture, input);
      drawPass(gl, null, width, height, shader, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
        gl.uniform1i(shader.uniforms.u_source, 0);
        gl.uniform2f(shader.uniforms.u_res, width, height);
        gl.uniform2f(shader.uniforms.u_center, centerX, centerY);
        gl.uniform1f(shader.uniforms.u_flashGain, flashGain);
        gl.uniform1f(shader.uniforms.u_falloff, falloff);
        gl.uniform1f(shader.uniforms.u_ambient, ambient);
        gl.uniform1f(shader.uniforms.u_edgeBurn, edgeBurn);
        gl.uniform1f(shader.uniforms.u_saturation, saturation);
        gl.uniform1f(shader.uniforms.u_warmth, warmth);
      }, vao);
      const rendered = readoutToCanvas(canvas, width, height);
      if (rendered) {
        const identityPalette = paletteIsIdentity(palette);
        const output = identityPalette ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
        if (output) {
          logFilterBackend("Digicam Flash", "WebGL2", `flash=${flashPower.toFixed(2)}EV${identityPalette ? "" : "+palettePass"}`);
          return output;
        }
      }
    }
  }

  logFilterWasmStatus("Digicam Flash", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputContext = input.getContext("2d");
  const outputContext = output.getContext("2d");
  if (!inputContext || !outputContext) return input;
  const source = inputContext.getImageData(0, 0, width, height).data;
  const result = new Uint8ClampedArray(source.length);
  const maximumDimension = Math.max(width, height);
  const rawTint = [1 + warmth * 0.36, 1, 1 - warmth * 0.46];
  const tintLuminance = rawTint[0] * 0.2126 + rawTint[1] * 0.7152 + rawTint[2] * 0.0722;
  const tint = rawTint.map((channel) => channel / tintLuminance);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const dx = (x + 0.5 - centerX) / maximumDimension;
      const dy = (y + 0.5 - centerY) / maximumDimension;
      const radiusSquared = dx * dx + dy * dy;
      const beam = Math.exp(-falloff * radiusSquared * 4);
      const edgeRadius = Math.max(0, Math.min(1, Math.sqrt(radiusSquared) / 0.72));
      const lensTransmission = 1 - edgeBurn * edgeRadius * edgeRadius;
      for (let channel = 0; channel < 3; channel += 1) {
        const reflectance = srgbToLinear(source[index + channel]);
        const captured = flashLinearChannel(
          reflectance,
          ambient * lensTransmission,
          flashGain * beam * lensTransmission,
          tint[channel],
          saturation,
        ) / Math.max(0.001, saturation);
        result[index + channel] = linearToSrgb(Math.min(1, captured));
      }
      result[index + 3] = source[index + 3];
    }
  }
  outputContext.putImageData(new ImageData(result, width, height), 0, 0);
  if (paletteIsIdentity(palette)) return output;
  return applyPalettePassToCanvas(output, width, height, palette) ?? output;
};

export default defineFilter({
  name: "Digicam Flash",
  func: digicamFlash,
  optionTypes,
  options: defaults,
  defaults,
  description: "Flat-depth visible-image proxy for on-camera flash: linear ambient-plus-flash exposure, beam falloff, vignetting, white balance, and sensor saturation",
});
