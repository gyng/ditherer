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

const DENSITY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform int u_display;
uniform float u_beamWidth;
uniform float u_intensity;
uniform float u_noiseFloor;
uniform float u_frameSeed;

float hash(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

vec3 sourcePixel(float x, float yJs) {
  vec2 uv = vec2((x + 0.5) / u_res.x, 1.0 - (yJs + 0.5) / u_res.y);
  return texture(u_source, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

float signalLevel(vec3 colour, int channel) {
  if (channel == 0) return colour.r;
  if (channel == 1) return colour.g;
  if (channel == 2) return colour.b;
  return dot(colour, vec3(0.2126, 0.7152, 0.0722));
}

float beam(float distancePx) {
  float sigma = max(0.25, u_beamWidth * 0.5);
  float normalized = distancePx / sigma;
  return exp(-0.5 * normalized * normalized);
}

void main() {
  float x = floor(v_uv.x * u_res.x);
  float yJs = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  int sampleCount = min(512, max(1, int(u_res.y)));
  float density = 0.0;

  if (u_display == 1) {
    float mean = 0.0;
    for (int sampleIndex = 0; sampleIndex < 512; sampleIndex++) {
      if (sampleIndex >= sampleCount) break;
      float sourceY = (float(sampleIndex) + 0.5) * u_res.y / float(sampleCount) - 0.5;
      mean += signalLevel(sourcePixel(x, sourceY), -1);
    }
    mean /= float(sampleCount);
    float target = (1.0 - mean) * (u_res.y - 1.0);
    density = beam(yJs - target) * 4.0;
  } else {
    float sourceX = x;
    int channel = -1;
    if (u_display == 2) {
      float segmentPosition = x * 3.0 / max(1.0, u_res.x);
      channel = min(2, int(floor(segmentPosition)));
      sourceX = fract(segmentPosition) * u_res.x;
    }
    float sampleWeight = 96.0 / float(sampleCount);
    for (int sampleIndex = 0; sampleIndex < 512; sampleIndex++) {
      if (sampleIndex >= sampleCount) break;
      float sourceY = (float(sampleIndex) + 0.5) * u_res.y / float(sampleCount) - 0.5;
      float level = signalLevel(sourcePixel(sourceX, sourceY), channel);
      float target = (1.0 - level) * (u_res.y - 1.0);
      density += beam(yJs - target) * sampleWeight;
    }
  }

  float exposure = 1.0 - exp(-density * max(0.0, u_intensity));
  exposure += hash(vec2(x, yJs), u_frameSeed) * max(0.0, u_noiseFloor);
  fragColor = vec4(clamp(exposure, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

const BLUR_H_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_density;
uniform vec2 u_res;
uniform int u_radius;

void main() {
  float x = floor(v_uv.x * u_res.x);
  float yJs = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  float sum = 0.0;
  float count = 0.0;
  for (int offset = -10; offset <= 10; offset++) {
    if (offset < -u_radius || offset > u_radius) continue;
    float sx = clamp(x + float(offset), 0.0, u_res.x - 1.0);
    vec2 uv = vec2((sx + 0.5) / u_res.x, 1.0 - (yJs + 0.5) / u_res.y);
    sum += texture(u_density, uv).r;
    count += 1.0;
  }
  fragColor = vec4(sum / max(1.0, count), 0.0, 0.0, 1.0);
}
`;

const FINAL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_density;
uniform sampler2D u_blurH;
uniform sampler2D u_prevOutput;
uniform int u_hasPrev;
uniform vec2 u_res;
uniform int u_radius;
uniform float u_bloomStrength;
uniform vec3 u_phosphor;
uniform int u_graticule;
uniform int u_graticuleDivs;
uniform float u_persistence;

vec2 jsUV(float x, float yJs) {
  return vec2((x + 0.5) / u_res.x, 1.0 - (yJs + 0.5) / u_res.y);
}

void main() {
  float x = floor(v_uv.x * u_res.x);
  float yJs = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec2 uv = jsUV(x, yJs);
  float raw = texture(u_density, uv).r;
  float sum = 0.0;
  float count = 0.0;
  for (int offset = -10; offset <= 10; offset++) {
    if (offset < -u_radius || offset > u_radius) continue;
    float sy = clamp(yJs + float(offset), 0.0, u_res.y - 1.0);
    sum += texture(u_blurH, jsUV(x, sy)).r;
    count += 1.0;
  }
  float halo = sum / max(1.0, count);
  float value = clamp(raw + (u_radius > 0 ? halo * u_bloomStrength : 0.0), 0.0, 1.0);
  vec3 background = vec3(2.0, 3.0, 2.0) / 255.0;
  vec3 rgb = mix(background, u_phosphor / 255.0, value);

  if (u_graticule == 1) {
    float cellW = u_res.x / float(u_graticuleDivs);
    float cellH = u_res.y / float(u_graticuleDivs);
    bool major = mod(x, cellW) < 1.0 || mod(yJs, cellH) < 1.0
      || x >= u_res.x - 1.0 || yJs >= u_res.y - 1.0;
    bool centre = abs(x - u_res.x * 0.5) < 1.0 || abs(yJs - u_res.y * 0.5) < 1.0;
    if (major || centre) rgb = min(vec3(1.0), rgb + u_phosphor / 255.0 * (centre ? 0.10 : 0.065));
  }

  if (u_hasPrev == 1 && u_persistence > 0.0) {
    vec3 decayed = texture(u_prevOutput, uv).rgb * clamp(u_persistence, 0.0, 1.0);
    rgb = max(rgb, decayed);
  }
  fragColor = vec4(rgb, 1.0);
}
`;

type Cache = { density: Program; blurH: Program; final: Program };
let cache: Cache | null = null;

const getCache = (gl: WebGL2RenderingContext): Cache => {
  if (cache) return cache;
  cache = {
    density: linkProgram(gl, DENSITY_FS, [
      "u_source", "u_res", "u_display", "u_beamWidth", "u_intensity", "u_noiseFloor", "u_frameSeed",
    ] as const),
    blurH: linkProgram(gl, BLUR_H_FS, ["u_density", "u_res", "u_radius"] as const),
    final: linkProgram(gl, FINAL_FS, [
      "u_density", "u_blurH", "u_prevOutput", "u_hasPrev", "u_res", "u_radius",
      "u_bloomStrength", "u_phosphor", "u_graticule", "u_graticuleDivs", "u_persistence",
    ] as const),
  };
  return cache;
};

const uploadPrevOutput = (
  gl: WebGL2RenderingContext,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): WebGLTexture | null => {
  if (data.byteLength !== width * height * 4) return null;
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return texture;
};

export const oscilloscopeGLAvailable = (): boolean => glAvailable();

const displayIds: Record<string, number> = { WAVEFORM: 0, TRACE: 1, PARADE: 2 };

export const renderOscilloscopeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  params: {
    display: string;
    phosphorColor: [number, number, number];
    beamWidth: number;
    intensity: number;
    bloom: number;
    bloomStrength: number;
    persistence: number;
    graticule: boolean;
    graticuleDivs: number;
    noiseFloor: number;
    frameIndex: number;
    prevOutput: Uint8ClampedArray | null;
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const programs = getCache(gl);
  const vao = getQuadVAO(gl);
  const radius = Math.min(10, Math.max(0, Math.round(params.bloom)));
  resizeGLCanvas(canvas, width, height);
  const sourceTexture = ensureTexture(gl, "oscilloscope:source", width, height);
  const densityTexture = ensureTexture(gl, "oscilloscope:density", width, height);
  const horizontalTexture = ensureTexture(gl, "oscilloscope:hblur", width, height);
  uploadSourceTexture(gl, sourceTexture, source);

  drawPass(gl, densityTexture, width, height, programs.density, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(programs.density.uniforms.u_source, 0);
    gl.uniform2f(programs.density.uniforms.u_res, width, height);
    gl.uniform1i(programs.density.uniforms.u_display, displayIds[params.display] ?? 0);
    gl.uniform1f(programs.density.uniforms.u_beamWidth, Math.max(0.5, params.beamWidth));
    gl.uniform1f(programs.density.uniforms.u_intensity, Math.max(0, params.intensity));
    gl.uniform1f(programs.density.uniforms.u_noiseFloor, Math.max(0, params.noiseFloor));
    gl.uniform1f(programs.density.uniforms.u_frameSeed, params.frameIndex * 3571 + 41);
  }, vao);

  drawPass(gl, horizontalTexture, width, height, programs.blurH, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, densityTexture.tex);
    gl.uniform1i(programs.blurH.uniforms.u_density, 0);
    gl.uniform2f(programs.blurH.uniforms.u_res, width, height);
    gl.uniform1i(programs.blurH.uniforms.u_radius, radius);
  }, vao);

  const previousTexture = params.prevOutput && params.persistence > 0
    ? uploadPrevOutput(gl, params.prevOutput, width, height)
    : null;
  drawPass(gl, null, width, height, programs.final, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, densityTexture.tex);
    gl.uniform1i(programs.final.uniforms.u_density, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, horizontalTexture.tex);
    gl.uniform1i(programs.final.uniforms.u_blurH, 1);
    if (previousTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
      gl.uniform1i(programs.final.uniforms.u_prevOutput, 2);
      gl.uniform1i(programs.final.uniforms.u_hasPrev, 1);
    } else {
      gl.uniform1i(programs.final.uniforms.u_hasPrev, 0);
    }
    gl.uniform2f(programs.final.uniforms.u_res, width, height);
    gl.uniform1i(programs.final.uniforms.u_radius, radius);
    gl.uniform1f(programs.final.uniforms.u_bloomStrength, Math.max(0, params.bloomStrength));
    gl.uniform3f(programs.final.uniforms.u_phosphor, ...params.phosphorColor);
    gl.uniform1i(programs.final.uniforms.u_graticule, params.graticule ? 1 : 0);
    gl.uniform1i(programs.final.uniforms.u_graticuleDivs, Math.max(2, Math.round(params.graticuleDivs)));
    gl.uniform1f(programs.final.uniforms.u_persistence, Math.max(0, Math.min(1, params.persistence)));
  }, vao);

  const output = readoutToCanvas(canvas, width, height);
  if (previousTexture) gl.deleteTexture(previousTexture);
  return output;
};
