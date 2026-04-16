import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Three separate RGB halftone screens with channel-registration offsets
// on a black background. Each channel's dot radius = (dotSize/2) * value,
// so dots always fit inside their own cell — the fragment only needs
// to consider its containing cell per channel.
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

float channelContribution(float jsX, float jsY, float offX, float offY, int channel) {
  float cellX = floor(jsX / u_dotSize) * u_dotSize;
  float cellY = floor(jsY / u_dotSize) * u_dotSize;
  float sx = clamp(cellX + floor(u_dotSize * 0.5) + offX, 0.0, u_res.x - 1.0);
  float sy = clamp(cellY + floor(u_dotSize * 0.5) + offY, 0.0, u_res.y - 1.0);

  vec3 rgb = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb;
  float value = channel == 0 ? rgb.r : channel == 1 ? rgb.g : rgb.b;
  float dotR = (u_dotSize * 0.5) * value;
  if (dotR < 0.3) return 0.0;

  float centreX = cellX + u_dotSize * 0.5;
  float centreY = cellY + u_dotSize * 0.5;
  float dx = jsX - centreX;
  float dy = jsY - centreY;
  float dist2 = dx * dx + dy * dy;
  if (dist2 > dotR * dotR) return 0.0;

  float dist = sqrt(dist2);
  float intensity = min(1.0, (dotR - dist) / 1.5 + 0.5);
  float add = intensity * value * 200.0;
  return floor(add * 0.2 + 0.5);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float r = channelContribution(jsX, jsY, u_offsetR, 0.0, 0);
  float g = channelContribution(jsX, jsY, u_offsetG, 0.0, 1);
  float b = channelContribution(jsX, jsY, 0.0, u_offsetB, 2);

  fragColor = vec4(clamp(vec3(r, g, b), 0.0, 255.0) / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_dotSize", "u_offsetR", "u_offsetG", "u_offsetB",
  ] as const) };
  return _cache;
};

export const colorHalftoneSeparateGLAvailable = (): boolean => glAvailable();

export const renderColorHalftoneSeparateGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  dotSize: number, offsetR: number, offsetG: number, offsetB: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "colorHalftoneSeparate:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
    gl.uniform1f(cache.prog.uniforms.u_offsetR, offsetR);
    gl.uniform1f(cache.prog.uniforms.u_offsetG, offsetG);
    gl.uniform1f(cache.prog.uniforms.u_offsetB, offsetB);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
