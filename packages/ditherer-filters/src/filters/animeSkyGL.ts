import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_mode;
uniform float u_skyStart;
uniform vec3 u_gradientTop;
uniform vec3 u_gradientBottom;
uniform float u_cloudAmount;
uniform float u_cloudSoftness;
uniform float u_cloudScale;
uniform float u_horizonGlow;
uniform float u_maskTolerance;
uniform float u_blend;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1,0)), f.x),
    mix(hash(cell + vec2(0,1)), hash(cell + vec2(1)), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0, amplitude = 0.56;
  mat2 rotateScale = mat2(1.58, 1.17, -1.17, 1.58);
  for (int octave = 0; octave < 4; octave++) {
    value += noise(p) * amplitude;
    p = rotateScale * p + vec2(7.3, 3.9);
    amplitude *= 0.48;
  }
  return value;
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 sampleColor = texture(u_source, v_uv);
  vec3 source = sampleColor.rgb;
  float imageY = 1.0 - v_uv.y;
  float region = 1.0 - smoothstep(max(0.02, u_skyStart - 0.1), u_skyStart + 0.035, imageY);
  float skyPosition = clamp(imageY / max(u_skyStart, 0.001), 0.0, 1.0);

  vec2 texel = 7.0 / max(u_res, vec2(1.0));
  vec3 local = (texture(u_source, v_uv + vec2(texel.x, 0)).rgb
    + texture(u_source, v_uv - vec2(texel.x, 0)).rgb
    + texture(u_source, v_uv + vec2(0, texel.y)).rgb
    + texture(u_source, v_uv - vec2(0, texel.y)).rgb) * 0.25;
  float localDifference = length(source - local);
  float smoothRegion = 1.0 - smoothstep(0.035, 0.2, localDifference);
  vec3 maskColor = mix(source, local, 0.76);
  float brightness = max(maskColor.r, max(maskColor.g, maskColor.b));
  float maximum = brightness, minimum = min(maskColor.r, min(maskColor.g, maskColor.b));
  float saturation = maximum > 0.001 ? (maximum - minimum) / maximum : 0.0;
  float blueEvidence = smoothstep(0.005, 0.16, maskColor.b - max(maskColor.r, maskColor.g) * 0.88)
    * smoothstep(0.28, 0.62, brightness);
  float neutralEvidence = smoothstep(0.48, 0.82, brightness)
    * (1.0 - smoothstep(0.16, 0.52, saturation)) * smoothRegion;
  float tolerance = mix(0.16, 0.72, u_maskTolerance);
  float confidence = max(blueEvidence, neutralEvidence * tolerance);
  confidence *= smoothstep(0.3, 0.92, smoothRegion);
  float skyMask = region * smoothstep(0.12, 0.72, confidence) * u_blend;

  vec3 target = mix(u_gradientTop, u_gradientBottom, pow(skyPosition, 0.82));
  float horizon = exp(-pow((skyPosition - 0.88) / 0.2, 2.0));
  target = mix(target, vec3(1.0, 0.79, 0.58), horizon * u_horizonGlow * 0.24);

  if (u_mode == 1 && u_cloudAmount > 0.0) {
    vec2 cloudUv = vec2(v_uv.x * u_res.x / max(u_res.y, 1.0), imageY);
    cloudUv *= u_cloudScale;
    float body = fbm(cloudUv + vec2(0.0, skyPosition * 0.75));
    float erosion = fbm(cloudUv * 2.15 + vec2(11.7, 4.2));
    float cloudField = body - erosion * 0.24 + horizon * 0.08;
    float low = mix(0.42, 0.62, u_cloudSoftness);
    float high = mix(0.7, 0.86, u_cloudSoftness);
    float cloud = smoothstep(low, high, cloudField) * u_cloudAmount * region;
    vec3 cloudColor = mix(vec3(0.73, 0.79, 0.9), vec3(1.0, 0.985, 0.95), skyPosition);
    target = mix(target, cloudColor, cloud);
    target *= 1.0 - smoothstep(low, high, body) * (1.0 - cloud) * u_cloudAmount * 0.08;
  }

  fragColor = vec4(clamp(mix(source, target, skyMask), 0.0, 1.0), sampleColor.a);
}`;

let program: Program | null = null;
const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (program) return program;
  program = linkProgram(gl, FS, [
    "u_source", "u_res", "u_mode", "u_skyStart", "u_gradientTop",
    "u_gradientBottom", "u_cloudAmount", "u_cloudSoftness", "u_cloudScale",
    "u_horizonGlow", "u_maskTolerance", "u_blend",
  ] as const);
  return program;
};

export const animeSkyGLAvailable = (): boolean => glAvailable();

export const renderAnimeSkyGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  clouds: boolean,
  skyStart: number,
  gradientTop: number[],
  gradientBottom: number[],
  cloudAmount: number,
  cloudSoftness: number,
  cloudScale: number,
  horizonGlow: number,
  maskTolerance: number,
  blend: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const current = getProgram(gl), vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "animeSky:source", width, height);
  uploadSourceTexture(gl, sourceTexture, source);
  drawPass(gl, null, width, height, current, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(current.uniforms.u_source, 0);
    gl.uniform2f(current.uniforms.u_res, width, height);
    gl.uniform1i(current.uniforms.u_mode, clouds ? 1 : 0);
    gl.uniform1f(current.uniforms.u_skyStart, skyStart);
    gl.uniform3f(current.uniforms.u_gradientTop, gradientTop[0]! / 255, gradientTop[1]! / 255, gradientTop[2]! / 255);
    gl.uniform3f(current.uniforms.u_gradientBottom, gradientBottom[0]! / 255, gradientBottom[1]! / 255, gradientBottom[2]! / 255);
    gl.uniform1f(current.uniforms.u_cloudAmount, cloudAmount);
    gl.uniform1f(current.uniforms.u_cloudSoftness, cloudSoftness);
    gl.uniform1f(current.uniforms.u_cloudScale, cloudScale);
    gl.uniform1f(current.uniforms.u_horizonGlow, horizonGlow);
    gl.uniform1f(current.uniforms.u_maskTolerance, maskTolerance);
    gl.uniform1f(current.uniforms.u_blend, blend);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
