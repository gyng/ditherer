import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Mandelbrot / Julia iterator with smooth escape colouring. Colour
// source can be the image (sampled by escape-time wrap) or an HSL
// rainbow. Matches the JS reference's per-pixel maths.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_type;        // 0 = Mandelbrot, 1 = Julia
uniform int   u_colorSource; // 0 = image, 1 = palette hue
uniform float u_zoom;
uniform vec2  u_centre;
uniform int   u_iterations;
uniform vec2  u_julia;

vec3 hslToRgb(float hue, float sat, float lit) {
  float c = (1.0 - abs(2.0 * lit - 1.0)) * sat;
  float hh = mod(mod(hue, 360.0) + 360.0, 360.0);
  float xc = c * (1.0 - abs(mod(hh / 60.0, 2.0) - 1.0));
  float m = lit - c * 0.5;
  vec3 rgb;
  if (hh < 60.0)       rgb = vec3(c, xc, 0.0);
  else if (hh < 120.0) rgb = vec3(xc, c, 0.0);
  else if (hh < 180.0) rgb = vec3(0.0, c, xc);
  else if (hh < 240.0) rgb = vec3(0.0, xc, c);
  else if (hh < 300.0) rgb = vec3(xc, 0.0, c);
  else                 rgb = vec3(c, 0.0, xc);
  return floor((rgb + vec3(m)) * 255.0 + 0.5);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float aspect = u_res.x / u_res.y;
  float rangeX = 3.0 / u_zoom;
  float rangeY = rangeX / aspect;

  float x0 = u_centre.x + (jsX / u_res.x - 0.5) * rangeX;
  float y0 = u_centre.y + (jsY / u_res.y - 0.5) * rangeY;

  float zr, zi, cr, ci;
  if (u_type == 1) {
    zr = x0; zi = y0;
    cr = u_julia.x; ci = u_julia.y;
  } else {
    zr = 0.0; zi = 0.0;
    cr = x0; ci = y0;
  }

  int iter = 0;
  for (int i = 0; i < 500; i++) {
    if (i >= u_iterations) break;
    if (zr * zr + zi * zi >= 4.0) break;
    float tmp = zr * zr - zi * zi + cr;
    zi = 2.0 * zr * zi + ci;
    zr = tmp;
    iter = i + 1;
  }

  vec3 outRgb;
  if (iter == u_iterations) {
    outRgb = vec3(0.0);
  } else {
    float mag = sqrt(zr * zr + zi * zi);
    float t = (float(iter) + 1.0 - log2(log2(mag))) / float(u_iterations);
    if (u_colorSource == 0) {
      float srcX = mod(floor(t * u_res.x), u_res.x);
      float srcY = mod(floor(t * u_res.y), u_res.y);
      outRgb = texture(u_source, vec2((srcX + 0.5) / u_res.x, 1.0 - (srcY + 0.5) / u_res.y)).rgb * 255.0;
    } else {
      outRgb = hslToRgb(t * 360.0 * 3.0, 0.9, 0.5);
    }
  }

  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_type", "u_colorSource",
    "u_zoom", "u_centre", "u_iterations", "u_julia",
  ] as const) };
  return _cache;
};

export const fractalGLAvailable = (): boolean => glAvailable();

export const renderFractalGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  typeIsJulia: boolean, colorFromImage: boolean,
  zoom: number, centreX: number, centreY: number,
  iterations: number, juliaR: number, juliaI: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "fractal:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_type, typeIsJulia ? 1 : 0);
    gl.uniform1i(cache.prog.uniforms.u_colorSource, colorFromImage ? 0 : 1);
    gl.uniform1f(cache.prog.uniforms.u_zoom, zoom);
    gl.uniform2f(cache.prog.uniforms.u_centre, centreX, centreY);
    gl.uniform1i(cache.prog.uniforms.u_iterations, Math.max(1, Math.min(500, Math.round(iterations))));
    gl.uniform2f(cache.prog.uniforms.u_julia, juliaR, juliaI);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
