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

const DECODE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_colorFringe;
uniform int u_chromaRadius;
uniform float u_tuningRadians;
uniform float u_rollOffset;
uniform float u_banding;
uniform float u_rfNoise;
uniform float u_frame;
uniform float u_fieldRate;

vec4 fetchPixel(float x, float yJs) {
  float wrappedY = mod(mod(yJs, u_res.y) + u_res.y, u_res.y);
  float sampleX = clamp(x, 0.0, u_res.x - 1.0);
  return texture(u_source, vec2((sampleX + 0.5) / u_res.x, 1.0 - (wrappedY + 0.5) / u_res.y));
}

vec3 rgbToYiq(vec3 rgb) {
  return vec3(
    dot(rgb, vec3(0.299, 0.587, 0.114)),
    dot(rgb, vec3(0.596, -0.275, -0.321)),
    dot(rgb, vec3(0.212, -0.523, 0.311))
  );
}

vec3 yiqToRgb(vec3 yiq) {
  return vec3(
    yiq.x + 0.956 * yiq.y + 0.621 * yiq.z,
    yiq.x - 0.272 * yiq.y - 0.647 * yiq.z,
    yiq.x - 1.106 * yiq.y + 1.703 * yiq.z
  );
}

float hash(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

void main() {
  float x = floor(v_uv.x * u_res.x);
  float yJs = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  float sourceY = yJs + u_rollOffset;
  vec4 centre = fetchPixel(x, sourceY);
  float ySignal = rgbToYiq(centre.rgb).x;
  vec2 chroma = vec2(0.0);
  float weightSum = 0.0;
  for (int offset = -10; offset <= 10; offset++) {
    if (offset < -u_chromaRadius || offset > u_chromaRadius) continue;
    float weight = float(u_chromaRadius + 1 - abs(offset));
    vec3 yiq = rgbToYiq(fetchPixel(x + u_colorFringe + float(offset), sourceY).rgb);
    chroma += yiq.yz * weight;
    weightSum += weight;
  }
  chroma /= max(1.0, weightSum);
  float cosine = cos(u_tuningRadians);
  float sine = sin(u_tuningRadians);
  chroma = mat2(cosine, -sine, sine, cosine) * chroma;
  float humPhase = (yJs / max(1.0, u_res.y)) * 12.5663706
    + u_frame * (50.0 / max(1.0, u_fieldRate)) * 0.055;
  ySignal += sin(humPhase) * u_banding * 0.08;
  ySignal += (hash(vec2(x, yJs), u_frame * 19.37 + 3.1) - 0.5) * u_rfNoise;
  fragColor = vec4(clamp(yiqToRgb(vec3(ySignal, chroma)), 0.0, 1.0), centre.a);
}
`;

const BLUR_H_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_decoded;
uniform vec2 u_res;

vec3 srgbToLinear(vec3 c) {
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, cutoff);
}

void main() {
  vec2 texel = 1.0 / u_res;
  vec3 sum = srgbToLinear(texture(u_decoded, v_uv).rgb) * 0.4;
  sum += srgbToLinear(texture(u_decoded, v_uv + vec2(texel.x * 2.0, 0.0)).rgb) * 0.15;
  sum += srgbToLinear(texture(u_decoded, v_uv - vec2(texel.x * 2.0, 0.0)).rgb) * 0.15;
  sum += srgbToLinear(texture(u_decoded, v_uv + vec2(texel.x * 4.0, 0.0)).rgb) * 0.15;
  sum += srgbToLinear(texture(u_decoded, v_uv - vec2(texel.x * 4.0, 0.0)).rgb) * 0.15;
  fragColor = vec4(sum, 1.0);
}
`;

const DISPLAY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_decoded;
uniform sampler2D u_blurH;
uniform vec2 u_res;
uniform float u_glow;
uniform float u_fieldLines;
uniform float u_scanlineStrength;

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
  vec4 decoded = texture(u_decoded, v_uv);
  vec2 texel = 1.0 / u_res;
  vec3 vertical = texture(u_blurH, v_uv).rgb * 0.4;
  vertical += texture(u_blurH, v_uv + vec2(0.0, texel.y * 2.0)).rgb * 0.15;
  vertical += texture(u_blurH, v_uv - vec2(0.0, texel.y * 2.0)).rgb * 0.15;
  vertical += texture(u_blurH, v_uv + vec2(0.0, texel.y * 4.0)).rgb * 0.15;
  vertical += texture(u_blurH, v_uv - vec2(0.0, texel.y * 4.0)).rgb * 0.15;
  vec3 linear = srgbToLinear(decoded.rgb) + vertical * u_glow * 0.42;

  float pixelsPerLine = u_res.y / max(1.0, u_fieldLines);
  float resolvable = smoothstep(0.8, 2.4, pixelsPerLine);
  float phase = fract((v_uv.y * u_res.y + 0.5) / max(1.0, u_res.y) * u_fieldLines);
  float distance = abs(phase - 0.5);
  float beam = exp(-0.5 * pow(distance / 0.22, 2.0));
  float rasterGain = 1.0 - u_scanlineStrength * resolvable * (1.0 - beam);
  linear *= rasterGain;
  fragColor = vec4(clamp(linearToSrgb(linear), 0.0, 1.0), decoded.a);
}
`;

type Cache = { decode: Program; blurH: Program; display: Program };
let cache: Cache | null = null;
const getCache = (gl: WebGL2RenderingContext): Cache => {
  if (cache) return cache;
  cache = {
    decode: linkProgram(gl, DECODE_FS, [
      "u_source",
      "u_res",
      "u_colorFringe",
      "u_chromaRadius",
      "u_tuningRadians",
      "u_rollOffset",
      "u_banding",
      "u_rfNoise",
      "u_frame",
      "u_fieldRate",
    ] as const),
    blurH: linkProgram(gl, BLUR_H_FS, ["u_decoded", "u_res"] as const),
    display: linkProgram(gl, DISPLAY_FS, [
      "u_decoded",
      "u_blurH",
      "u_res",
      "u_glow",
      "u_fieldLines",
      "u_scanlineStrength",
    ] as const),
  };
  return cache;
};

export const renderVintageTVGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  params: {
    banding: number;
    colorFringe: number;
    chromaBandwidth: number;
    tuningError: number;
    rollOffset: number;
    frameIndex: number;
    fieldRate: number;
    fieldLines: number;
    scanlineStrength: number;
    glow: number;
    rfNoise: number;
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const programs = getCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "vintageTV:source", width, height);
  const decodedTexture = ensureTexture(gl, "vintageTV:decoded", width, height);
  const blurTexture = ensureTexture(gl, "vintageTV:blurH", width, height);
  uploadSourceTexture(gl, sourceTexture, source);
  drawPass(
    gl,
    decodedTexture,
    width,
    height,
    programs.decode,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
      gl.uniform1i(programs.decode.uniforms.u_source, 0);
      gl.uniform2f(programs.decode.uniforms.u_res, width, height);
      gl.uniform1f(programs.decode.uniforms.u_colorFringe, params.colorFringe);
      gl.uniform1i(programs.decode.uniforms.u_chromaRadius, params.chromaBandwidth);
      gl.uniform1f(programs.decode.uniforms.u_tuningRadians, (params.tuningError * Math.PI) / 180);
      gl.uniform1f(programs.decode.uniforms.u_rollOffset, params.rollOffset);
      gl.uniform1f(programs.decode.uniforms.u_banding, params.banding);
      gl.uniform1f(programs.decode.uniforms.u_rfNoise, params.rfNoise);
      gl.uniform1f(programs.decode.uniforms.u_frame, params.frameIndex);
      gl.uniform1f(programs.decode.uniforms.u_fieldRate, params.fieldRate);
    },
    vao,
  );
  drawPass(
    gl,
    blurTexture,
    width,
    height,
    programs.blurH,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, decodedTexture.tex);
      gl.uniform1i(programs.blurH.uniforms.u_decoded, 0);
      gl.uniform2f(programs.blurH.uniforms.u_res, width, height);
    },
    vao,
  );
  drawPass(
    gl,
    null,
    width,
    height,
    programs.display,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, decodedTexture.tex);
      gl.uniform1i(programs.display.uniforms.u_decoded, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurTexture.tex);
      gl.uniform1i(programs.display.uniforms.u_blurH, 1);
      gl.uniform2f(programs.display.uniforms.u_res, width, height);
      gl.uniform1f(programs.display.uniforms.u_glow, params.glow);
      gl.uniform1f(programs.display.uniforms.u_fieldLines, params.fieldLines);
      gl.uniform1f(programs.display.uniforms.u_scanlineStrength, params.scanlineStrength);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
