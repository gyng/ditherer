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

// Three additive RGB plates. Circular dots grow with exact area coverage until
// contact (π/4); highlights above contact use complementary corner holes so
// full input reaches full output without clipping or multiplying tone twice.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_dotSize;
uniform float u_offsetR;
uniform float u_offsetG;
uniform float u_offsetB;

vec3 sourceAt(vec2 p) {
  p = clamp(p, vec2(0.0), u_res - vec2(1.0));
  return texture(u_source, vec2((p.x + 0.5) / u_res.x, 1.0 - (p.y + 0.5) / u_res.y)).rgb;
}

float channelContribution(vec2 outputPosition, vec2 displacement, int channel) {
  vec2 platePosition = outputPosition - displacement;
  vec2 cell = floor(platePosition / u_dotSize);
  vec2 centre = (cell + 0.5) * u_dotSize;
  vec3 rgb = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    rgb += sourceAt(centre + vec2(x, y) * u_dotSize / 3.0);
  }
  rgb /= 9.0;
  float value = channel == 0 ? rgb.r : channel == 1 ? rgb.g : rgb.b;
  if (value <= 0.0) return 0.0;
  if (value >= 1.0) return 1.0;
  vec2 local = platePosition - cell * u_dotSize;
  const float CONTACT = 0.78539816339;
  if (value <= CONTACT) {
    float radius = u_dotSize * sqrt(value / 3.14159265359);
    float distanceToCentre = length(local - vec2(u_dotSize * 0.5));
    float aa = max(fwidth(distanceToCentre), 0.35);
    return 1.0 - smoothstep(radius - aa, radius + aa, distanceToCentre);
  }
  float holeRadius = u_dotSize * sqrt((1.0 - value) / 3.14159265359);
  float distanceToCorner = length(min(local, vec2(u_dotSize) - local));
  float aa = max(fwidth(distanceToCorner), 0.35);
  return smoothstep(holeRadius - aa, holeRadius + aa, distanceToCorner);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec2 position = vec2(jsX, jsY);
  float r = channelContribution(position, vec2(u_offsetR, 0.0), 0);
  float g = channelContribution(position, vec2(u_offsetG, 0.0), 1);
  float b = channelContribution(position, vec2(0.0, u_offsetB), 2);

  float alpha = texture(u_source, v_uv).a;
  fragColor = vec4(clamp(vec3(r, g, b), 0.0, 1.0), alpha);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source",
      "u_res",
      "u_dotSize",
      "u_offsetR",
      "u_offsetG",
      "u_offsetB",
    ] as const),
  };
  return _cache;
};

export const colorHalftoneSeparateGLAvailable = (): boolean => glAvailable();

export const renderColorHalftoneSeparateGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  dotSize: number,
  offsetR: number,
  offsetG: number,
  offsetB: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "colorHalftoneSeparate:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(
    gl,
    null,
    width,
    height,
    cache.prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.prog.uniforms.u_source, 0);
      gl.uniform2f(cache.prog.uniforms.u_res, width, height);
      gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
      gl.uniform1f(cache.prog.uniforms.u_offsetR, offsetR);
      gl.uniform1f(cache.prog.uniforms.u_offsetG, offsetG);
      gl.uniform1f(cache.prog.uniforms.u_offsetB, offsetB);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
