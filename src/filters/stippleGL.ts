import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Inverts the CPU stipple placement loop: for each output pixel, walk the
// cells whose dots could reach us and test against their radii. The CPU
// path uses mulberry32 so dot positions are bit-identical across runs,
// which GL can't replicate portably; we substitute a per-cell hash that
// gives a visually equivalent random layout.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_density;       // cellSize in pixels
uniform float u_maxDotSize;    // max dot radius
uniform vec3  u_inkColor;
uniform vec3  u_paperColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float luma(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float myCellX = floor(x / u_density);
  float myCellY = floor(y / u_density);
  int reach = int(ceil(u_maxDotSize / u_density)) + 1;

  // Dark floor: CPU path skips cells below darkness 0.05. Match that.
  const float DARK_FLOOR = 0.05;

  bool isInk = false;
  for (int dy = -8; dy <= 8; dy++) {
    if (dy < -reach || dy > reach) continue;
    for (int dx = -8; dx <= 8; dx++) {
      if (dx < -reach || dx > reach) continue;
      float cx = myCellX + float(dx);
      float cy = myCellY + float(dy);

      // Cell-centre pixel coords used for luma sampling (proxy for the
      // CPU average over the cell — visually indistinguishable at these
      // cell sizes).
      float sampleX = clamp(cx * u_density + u_density * 0.5, 0.0, u_res.x - 1.0);
      float sampleY = clamp(cy * u_density + u_density * 0.5, 0.0, u_res.y - 1.0);
      vec2 suv = vec2((sampleX + 0.5) / u_res.x, 1.0 - (sampleY + 0.5) / u_res.y);
      float darkness = 1.0 - luma(texture(u_source, suv).rgb);
      if (darkness < DARK_FLOOR) continue;

      float dotR = u_maxDotSize * darkness;
      // Per-cell random offset in [0, density). Two independent hashes
      // so x and y aren't correlated.
      float rx = hash(vec2(cx, cy));
      float ry = hash(vec2(cx + 17.0, cy + 31.0));
      float dotX = cx * u_density + rx * u_density;
      float dotY = cy * u_density + ry * u_density;

      float ddx = x - dotX;
      float ddy = y - dotY;
      if (ddx * ddx + ddy * ddy <= dotR * dotR) {
        isInk = true;
        break;
      }
    }
    if (isInk) break;
  }

  vec3 outRgb = isInk ? u_inkColor : u_paperColor;
  fragColor = vec4(outRgb, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, FS, [
      "u_source", "u_res", "u_density", "u_maxDotSize", "u_inkColor", "u_paperColor",
    ] as const),
  };
  return _cache;
};

export const stippleGLAvailable = (): boolean => glAvailable();

export const renderStippleGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  density: number, maxDotSize: number,
  inkColor: number[], paperColor: number[],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "stipple:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_density, Math.max(1, density));
    gl.uniform1f(cache.prog.uniforms.u_maxDotSize, maxDotSize);
    gl.uniform3f(cache.prog.uniforms.u_inkColor, inkColor[0] / 255, inkColor[1] / 255, inkColor[2] / 255);
    gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
