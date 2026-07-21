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
uniform int u_look;
uniform float u_shadowCool;
uniform float u_highlightWarm;
uniform float u_blackPoint;
uniform float u_whitePoint;
uniform float u_contrast;
uniform float u_midtoneLift;
uniform float u_highlightRollOff;
uniform float u_vibrance;
uniform float u_chromaDensity;
uniform float u_skinProtect;
uniform float u_mix;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void lookProfile(out vec3 shadow, out vec3 middle, out vec3 highlight) {
  if (u_look == 1) {
    shadow = vec3(0.78, 1.03, 1.18);
    middle = vec3(0.98, 1.02, 1.06);
    highlight = vec3(1.11, 1.055, 0.92);
  } else if (u_look == 2) {
    shadow = vec3(0.83, 0.91, 1.13);
    middle = vec3(1.06, 1.0, 0.91);
    highlight = vec3(1.18, 1.075, 0.78);
  } else if (u_look == 3) {
    shadow = vec3(0.68, 0.83, 1.2);
    middle = vec3(0.87, 0.94, 1.08);
    highlight = vec3(1.08, 0.96, 1.08);
  } else if (u_look == 4) {
    shadow = vec3(0.64, 0.78, 1.22);
    middle = vec3(1.01, 0.84, 1.12);
    highlight = vec3(1.18, 0.9, 1.08);
  } else {
    shadow = vec3(0.86, 0.98, 1.1);
    middle = vec3(1.0);
    highlight = vec3(1.08, 1.035, 0.92);
  }
}

float toneCurve(float value) {
  float black = u_blackPoint / 255.0;
  float white = max(black + 1.0 / 255.0, u_whitePoint / 255.0);
  float n = clamp((value - black) / (white - black), 0.0, 1.0);
  n = clamp(0.5 + (n - 0.5) * (1.0 + u_contrast), 0.0, 1.0);
  n = pow(n, exp(-u_midtoneLift * 1.8));
  float shoulder = 1.0 - pow(max(1.0 - n, 0.0), 1.0 / (1.0 + u_highlightRollOff * 0.75));
  return mix(n, shoulder, u_highlightRollOff * 0.7);
}

float skinConfidence(vec3 source, float y) {
  float cb = source.b - y;
  float cr = source.r - y;
  float warm = smoothstep(0.025, 0.09, cr) * (1.0 - smoothstep(0.3, 0.42, cr));
  float blue = smoothstep(-0.3, -0.035, cb) * (1.0 - smoothstep(-0.035, 0.025, cb));
  float ordering = smoothstep(0.0, 0.055, source.r - source.g)
    * smoothstep(-0.035, 0.05, source.g - source.b);
  return clamp(warm * blue * ordering, 0.0, 1.0);
}

void main() {
  vec4 sampleColor = texture(u_source, v_uv);
  vec3 source = sampleColor.rgb;
  float sourceLuma = lum(source);
  float targetLuma = toneCurve(sourceLuma);
  vec3 base = sourceLuma > 0.0001 ? source * (targetLuma / sourceLuma) : vec3(targetLuma);
  base = clamp(base, 0.0, 1.0);

  vec3 shadowTint, middleTint, highlightTint;
  lookProfile(shadowTint, middleTint, highlightTint);
  float shadowWeight = 1.0 - smoothstep(0.16, 0.58, targetLuma);
  float highlightWeight = smoothstep(0.54, 0.91, targetLuma);
  float middleWeight = max(0.0, 1.0 - shadowWeight - highlightWeight);

  vec3 graded = base;
  graded *= mix(vec3(1.0), shadowTint, shadowWeight * u_shadowCool);
  graded *= mix(vec3(1.0), middleTint, middleWeight * 0.42);
  graded *= mix(vec3(1.0), highlightTint, highlightWeight * u_highlightWarm);

  float gradedLuma = max(lum(graded), 0.0001);
  vec3 lumaRestored = graded * (targetLuma / gradedLuma);
  graded = mix(graded, lumaRestored, 0.68);

  float maximum = max(graded.r, max(graded.g, graded.b));
  float minimum = min(graded.r, min(graded.g, graded.b));
  float saturation = maximum - minimum;
  float chromaScale = 1.0 + u_vibrance * (1.0 - saturation) * 0.72
    + u_chromaDensity * saturation * (1.0 - targetLuma) * 0.38;
  graded = vec3(targetLuma) + (graded - vec3(targetLuma)) * chromaScale;

  float protectedSkin = skinConfidence(source, sourceLuma) * u_skinProtect;
  graded = mix(graded, base, protectedSkin * 0.78);
  vec3 result = mix(source, clamp(graded, 0.0, 1.0), u_mix);
  fragColor = vec4(result, sampleColor.a);
}`;

let program: Program | null = null;
const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (program) return program;
  program = linkProgram(gl, FS, [
    "u_source", "u_look", "u_shadowCool", "u_highlightWarm", "u_blackPoint",
    "u_whitePoint", "u_contrast", "u_midtoneLift", "u_highlightRollOff",
    "u_vibrance", "u_chromaDensity", "u_skinProtect", "u_mix",
  ] as const);
  return program;
};

export const animeColorGradeGLAvailable = (): boolean => glAvailable();

export const renderAnimeColorGradeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  look: number,
  shadowCool: number,
  highlightWarm: number,
  blackPoint: number,
  whitePoint: number,
  contrast: number,
  midtoneLift: number,
  highlightRollOff: number,
  vibrance: number,
  chromaDensity: number,
  skinProtect: number,
  mixAmount: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const current = getProgram(gl);
  const sourceTexture = ensureTexture(gl, "animeColorGrade:source", width, height);
  uploadSourceTexture(gl, sourceTexture, source);
  resizeGLCanvas(canvas, width, height);
  drawPass(gl, null, width, height, current, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(current.uniforms.u_source, 0);
    gl.uniform1i(current.uniforms.u_look, look);
    gl.uniform1f(current.uniforms.u_shadowCool, shadowCool);
    gl.uniform1f(current.uniforms.u_highlightWarm, highlightWarm);
    gl.uniform1f(current.uniforms.u_blackPoint, blackPoint);
    gl.uniform1f(current.uniforms.u_whitePoint, whitePoint);
    gl.uniform1f(current.uniforms.u_contrast, contrast);
    gl.uniform1f(current.uniforms.u_midtoneLift, midtoneLift);
    gl.uniform1f(current.uniforms.u_highlightRollOff, highlightRollOff);
    gl.uniform1f(current.uniforms.u_vibrance, vibrance);
    gl.uniform1f(current.uniforms.u_chromaDensity, chromaDensity);
    gl.uniform1f(current.uniforms.u_skinProtect, skinProtect);
    gl.uniform1f(current.uniforms.u_mix, mixAmount);
  }, getQuadVAO(gl));
  return readoutToCanvas(canvas, width, height);
};
