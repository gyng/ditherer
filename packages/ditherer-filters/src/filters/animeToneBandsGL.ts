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

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2 u_res;
uniform vec2 u_axis;
uniform int u_radius;
void main() {
  vec2 pixel = v_uv * u_res;
  vec4 total = vec4(0.0);
  float weightSum = 0.0;
  for (int offset = -12; offset <= 12; offset++) {
    if (offset < -u_radius || offset > u_radius) continue;
    float distance = float(offset) / max(float(u_radius), 1.0);
    float weight = exp(-distance * distance * 2.2);
    vec2 samplePixel = clamp(pixel + u_axis * float(offset), vec2(0.5), u_res - vec2(0.5));
    total += texture(u_input, samplePixel / u_res) * weight;
    weightSum += weight;
  }
  fragColor = total / max(weightSum, 0.0001);
}`;

const FINAL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_structure;
uniform float u_shadowThreshold;
uniform float u_highlightThreshold;
uniform float u_shadowSteps;
uniform float u_highlightSteps;
uniform float u_edgeSoftness;
uniform float u_bandBias;
uniform vec3 u_shadowTint;
uniform vec3 u_highlightTint;
uniform float u_colorSeparation;
uniform int u_preserveSkin;
uniform float u_mix;

float lum(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }

float quantizeRange(float value, float low, float high, float steps) {
  float count = max(2.0, floor(steps + 0.5));
  float normalized = clamp((value - low) / max(high - low, 0.0001), 0.0, 1.0);
  float stepped = floor(normalized * (count - 1.0) + 0.5) / (count - 1.0);
  return mix(low, high, stepped);
}

float skinConfidence(vec3 source, float y) {
  float cb = source.b - y;
  float cr = source.r - y;
  return smoothstep(0.025, 0.09, cr) * (1.0 - smoothstep(0.3, 0.42, cr))
    * smoothstep(-0.3, -0.035, cb) * (1.0 - smoothstep(-0.035, 0.025, cb));
}

vec3 tintAtLuma(vec3 tint, float targetLuma) {
  float tintLuma = lum(tint);
  return clamp(vec3(targetLuma) + (tint - vec3(tintLuma)) * 0.78, 0.0, 1.0);
}

void main() {
  vec4 sampleColor = texture(u_source, v_uv);
  vec3 source = sampleColor.rgb;
  float sourceLuma = lum(source);
  float structureLuma = lum(texture(u_structure, v_uv).rgb);
  float biased = clamp(mix(sourceLuma, structureLuma, 0.84)
    + u_bandBias * (0.5 - structureLuma), 0.0, 1.0);
  float shadowEdge = min(u_shadowThreshold, u_highlightThreshold - 0.01);
  float highlightEdge = max(u_highlightThreshold, shadowEdge + 0.01);
  float targetLuma;
  if (biased < shadowEdge) {
    targetLuma = quantizeRange(biased, min(0.055, shadowEdge * 0.3), shadowEdge, u_shadowSteps);
  } else if (biased < highlightEdge) {
    targetLuma = quantizeRange(biased, shadowEdge, highlightEdge, max(u_shadowSteps, u_highlightSteps));
  } else {
    targetLuma = quantizeRange(biased, highlightEdge, 0.97, u_highlightSteps);
  }
  float transition = u_edgeSoftness > 0.0
    ? max(1.0 - smoothstep(0.0, u_edgeSoftness, abs(biased - shadowEdge)),
      1.0 - smoothstep(0.0, u_edgeSoftness, abs(biased - highlightEdge)))
    : 0.0;
  targetLuma = mix(targetLuma, biased, transition * 0.72);
  vec3 sourceChroma = source - vec3(sourceLuma);
  vec3 banded = clamp(vec3(targetLuma) + sourceChroma * 0.82, 0.0, 1.0);

  float shadowRegion = 1.0 - smoothstep(shadowEdge - u_edgeSoftness, shadowEdge + u_edgeSoftness, structureLuma);
  float highlightRegion = smoothstep(highlightEdge - u_edgeSoftness, highlightEdge + u_edgeSoftness, structureLuma);
  vec3 authored = banded;
  authored = mix(authored, tintAtLuma(u_shadowTint, targetLuma), shadowRegion * u_colorSeparation);
  authored = mix(authored, tintAtLuma(u_highlightTint, targetLuma), highlightRegion * u_colorSeparation);

  if (u_preserveSkin == 1) {
    float skin = skinConfidence(source, sourceLuma);
    authored = mix(authored, mix(source, banded, 0.32), skin * 0.78);
  }
  fragColor = vec4(clamp(mix(source, authored, u_mix), 0.0, 1.0), sampleColor.a);
}`;

type Cache = { blur: Program; final: Program };
let cache: Cache | null = null;
const getCache = (gl: WebGL2RenderingContext): Cache => {
  if (cache) return cache;
  cache = {
    blur: linkProgram(gl, BLUR_FS, ["u_input", "u_res", "u_axis", "u_radius"] as const),
    final: linkProgram(gl, FINAL_FS, [
      "u_source",
      "u_structure",
      "u_shadowThreshold",
      "u_highlightThreshold",
      "u_shadowSteps",
      "u_highlightSteps",
      "u_edgeSoftness",
      "u_bandBias",
      "u_shadowTint",
      "u_highlightTint",
      "u_colorSeparation",
      "u_preserveSkin",
      "u_mix",
    ] as const),
  };
  return cache;
};

export const animeToneBandsGLAvailable = (): boolean => glAvailable();

export const renderAnimeToneBandsGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  structureScale: number,
  shadowThreshold: number,
  highlightThreshold: number,
  shadowSteps: number,
  highlightSteps: number,
  edgeSoftness: number,
  bandBias: number,
  shadowTint: number[],
  highlightTint: number[],
  colorSeparation: number,
  preserveSkin: boolean,
  mixAmount: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const programs = getCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "animeToneBands:source", width, height);
  const horizontal = ensureTexture(gl, "animeToneBands:horizontal", width, height);
  const structure = ensureTexture(gl, "animeToneBands:structure", width, height);
  uploadSourceTexture(gl, sourceTexture, source);
  const radius = Math.max(1, Math.min(12, Math.round(structureScale)));

  const drawBlur = (
    input: WebGLTexture,
    target: ReturnType<typeof ensureTexture>,
    x: number,
    y: number,
  ) => {
    drawPass(
      gl,
      target,
      width,
      height,
      programs.blur,
      () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, input);
        gl.uniform1i(programs.blur.uniforms.u_input, 0);
        gl.uniform2f(programs.blur.uniforms.u_res, width, height);
        gl.uniform2f(programs.blur.uniforms.u_axis, x, y);
        gl.uniform1i(programs.blur.uniforms.u_radius, radius);
      },
      vao,
    );
  };
  drawBlur(sourceTexture.tex, horizontal, 1, 0);
  drawBlur(horizontal.tex, structure, 0, 1);

  drawPass(
    gl,
    null,
    width,
    height,
    programs.final,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
      gl.uniform1i(programs.final.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, structure.tex);
      gl.uniform1i(programs.final.uniforms.u_structure, 1);
      gl.uniform1f(programs.final.uniforms.u_shadowThreshold, shadowThreshold);
      gl.uniform1f(programs.final.uniforms.u_highlightThreshold, highlightThreshold);
      gl.uniform1f(programs.final.uniforms.u_shadowSteps, shadowSteps);
      gl.uniform1f(programs.final.uniforms.u_highlightSteps, highlightSteps);
      gl.uniform1f(programs.final.uniforms.u_edgeSoftness, edgeSoftness);
      gl.uniform1f(programs.final.uniforms.u_bandBias, bandBias);
      gl.uniform3f(
        programs.final.uniforms.u_shadowTint,
        shadowTint[0]! / 255,
        shadowTint[1]! / 255,
        shadowTint[2]! / 255,
      );
      gl.uniform3f(
        programs.final.uniforms.u_highlightTint,
        highlightTint[0]! / 255,
        highlightTint[1]! / 255,
        highlightTint[2]! / 255,
      );
      gl.uniform1f(programs.final.uniforms.u_colorSeparation, colorSeparation);
      gl.uniform1i(programs.final.uniforms.u_preserveSkin, preserveSkin ? 1 : 0);
      gl.uniform1f(programs.final.uniforms.u_mix, mixAmount);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
