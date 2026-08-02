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

const BLUR_H_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2 u_res;
uniform int u_radius;

void main() {
  vec2 pixel = v_uv * u_res;
  float row = floor(pixel.y);
  vec3 sum = vec3(0.0);
  float count = 0.0;
  for (int offset = -4; offset <= 4; offset++) {
    if (offset < -u_radius || offset > u_radius) continue;
    float column = clamp(floor(pixel.x) + float(offset), 0.0, u_res.x - 1.0);
    sum += texture(u_input, (vec2(column, row) + 0.5) / u_res).rgb;
    count += 1.0;
  }
  float sourceAlpha = texture(u_input, (vec2(floor(pixel.x), row) + 0.5) / u_res).a;
  fragColor = vec4(sum / count, sourceAlpha);
}
`;

const DAGUERREOTYPE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_blurH;
uniform vec2 u_res;
uniform int u_radius;
uniform float u_silverTone;
uniform float u_vignette;
uniform float u_metallic;
uniform float u_gilding;
uniform float u_viewAngle;
uniform float u_plateAge;

float hash21(vec2 point) {
  vec3 p = fract(vec3(point.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 srgbToLinear(vec3 value) {
  bvec3 cutoff = lessThanEqual(value, vec3(0.04045));
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

vec3 linearToSrgb(vec3 value) {
  value = max(value, vec3(0.0));
  bvec3 cutoff = lessThanEqual(value, vec3(0.0031308));
  vec3 low = value * 12.92;
  vec3 high = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, cutoff);
}

float sourceLuma(vec2 uv) {
  vec3 linear = srgbToLinear(texture(u_blurH, clamp(uv, vec2(0.0), vec2(1.0))).rgb);
  return dot(linear, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 pixel = v_uv * u_res;
  float column = floor(pixel.x);
  float row = floor(pixel.y);
  vec3 sum = vec3(0.0);
  float count = 0.0;
  for (int offset = -4; offset <= 4; offset++) {
    if (offset < -u_radius || offset > u_radius) continue;
    float sampleRow = clamp(row + float(offset), 0.0, u_res.y - 1.0);
    sum += texture(u_blurH, (vec2(column, sampleRow) + 0.5) / u_res).rgb;
    count += 1.0;
  }
  float sourceAlpha = texture(u_blurH, (vec2(column, row) + 0.5) / u_res).a;
  vec4 source = vec4(sum / count, sourceAlpha);
  vec3 linearSource = srgbToLinear(source.rgb);
  float luminance = dot(linearSource, vec3(0.2126, 0.7152, 0.0722));

  vec2 texel = 1.0 / u_res;
  float neighbourhood = (
    sourceLuma(v_uv + vec2(texel.x, 0.0))
    + sourceLuma(v_uv - vec2(texel.x, 0.0))
    + sourceLuma(v_uv + vec2(0.0, texel.y))
    + sourceLuma(v_uv - vec2(0.0, texel.y))
  ) * 0.25;
  float fineDetail = luminance - neighbourhood;

  float imageScatter = pow(clamp(luminance, 0.0, 1.0), 0.9);
  imageScatter = clamp((imageScatter - 0.5) * (1.0 + u_gilding * 0.5) + 0.5 + fineDetail * 1.1, 0.0, 1.0);

  vec2 platePosition = v_uv * 2.0 - 1.0;
  float angle = radians(u_viewAngle);
  vec2 lightDirection = vec2(cos(angle), sin(angle));
  float directionalField = clamp(0.5 + 0.5 * dot(platePosition, lightDirection), 0.0, 1.0);
  float reflection = (0.12 + 0.88 * directionalField) * u_metallic;

  vec3 plateShadow = vec3(0.018, 0.021, 0.026);
  vec3 plateReflection = mix(vec3(0.13, 0.145, 0.17), vec3(0.68, 0.72, 0.79), reflection);
  vec3 silverParticles = mix(vec3(0.7, 0.72, 0.76), vec3(0.92, 0.84, 0.68), u_silverTone);
  vec3 plate = mix(plateShadow, plateReflection, 0.32 + reflection * 0.48);
  vec3 result = mix(plate, silverParticles, imageScatter);

  float distanceFromCentre = length(platePosition * vec2(0.84, 1.0));
  float edgeFalloff = smoothstep(0.58, 1.35, distanceFromCentre);
  result *= 1.0 - edgeFalloff * u_vignette * 0.52;

  float speckle = smoothstep(0.988, 1.0, hash21(floor(pixel * 0.5)));
  float diagonalScratch = smoothstep(0.493, 0.5, abs(fract((pixel.x * 0.19 + pixel.y) / 83.0) - 0.5));
  float ageMask = u_plateAge * clamp(edgeFalloff * 0.42 + speckle * 0.7 + diagonalScratch * 0.18, 0.0, 1.0);
  result = mix(result, vec3(0.22, 0.13, 0.075), ageMask * 0.58);

  fragColor = vec4(clamp(linearToSrgb(result), 0.0, 1.0), source.a);
}
`;

type Cache = { blurH: Program; final: Program };
let cache: Cache | null = null;

const getPrograms = (gl: WebGL2RenderingContext): Cache => {
  if (cache) return cache;
  cache = {
    blurH: linkProgram(gl, BLUR_H_FS, ["u_input", "u_res", "u_radius"] as const),
    final: linkProgram(gl, DAGUERREOTYPE_FS, [
      "u_blurH",
      "u_res",
      "u_radius",
      "u_silverTone",
      "u_vignette",
      "u_metallic",
      "u_gilding",
      "u_viewAngle",
      "u_plateAge",
    ] as const),
  };
  return cache;
};

export const renderDaguerreotypeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  silverTone: number,
  softFocus: number,
  vignette: number,
  metallic: number,
  gilding: number,
  viewAngle: number,
  plateAge: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const programs = getPrograms(gl);
  const vao = getQuadVAO(gl);
  const radius = Math.max(0, Math.min(4, Math.round(softFocus)));

  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "daguerreotype:source", width, height);
  uploadSourceTexture(gl, sourceTexture, source);
  const horizontalTexture = ensureTexture(gl, "daguerreotype:blurH", width, height);

  drawPass(
    gl,
    horizontalTexture,
    width,
    height,
    programs.blurH,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
      gl.uniform1i(programs.blurH.uniforms.u_input, 0);
      gl.uniform2f(programs.blurH.uniforms.u_res, width, height);
      gl.uniform1i(programs.blurH.uniforms.u_radius, radius);
    },
    vao,
  );

  drawPass(
    gl,
    null,
    width,
    height,
    programs.final,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, horizontalTexture.tex);
      gl.uniform1i(programs.final.uniforms.u_blurH, 0);
      gl.uniform2f(programs.final.uniforms.u_res, width, height);
      gl.uniform1i(programs.final.uniforms.u_radius, radius);
      gl.uniform1f(programs.final.uniforms.u_silverTone, silverTone);
      gl.uniform1f(programs.final.uniforms.u_vignette, vignette);
      gl.uniform1f(programs.final.uniforms.u_metallic, metallic);
      gl.uniform1f(programs.final.uniforms.u_gilding, gilding);
      gl.uniform1f(programs.final.uniforms.u_viewAngle, viewAngle);
      gl.uniform1f(programs.final.uniforms.u_plateAge, plateAge);
    },
    vao,
  );

  return readoutToCanvas(canvas, width, height);
};
