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

// Corner light-piping exposure with a quadratic falloff. Exposure is added in
// linear light so the selected spectral color remains meaningful.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_corner;     // pixel coords of leak source (JS-y)
uniform vec3  u_color;      // 0..255
uniform float u_intensity;
uniform float u_maxDist;

vec3 srgbToLinear(vec3 c) {
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  vec3 low = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
  vec3 low = c * 12.92;
  vec3 high = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, cutoff);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec4 c = texture(u_source, v_uv);
  vec3 srcLinear = srgbToLinear(c.rgb);

  vec2 d = vec2(jsX - u_corner.x, jsY - u_corner.y);
  float dist = length(d);
  float t = max(0.0, 1.0 - dist / u_maxDist);
  float leak = t * t * u_intensity;

  vec3 leakLinear = srgbToLinear(u_color / 255.0);
  vec3 exposed = linearToSrgb(srcLinear + leakLinear * leak);
  fragColor = vec4(floor(clamp(exposed, 0.0, 1.0) * 255.0 + 0.5) / 255.0, c.a);
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
      "u_corner",
      "u_color",
      "u_intensity",
      "u_maxDist",
    ] as const),
  };
  return _cache;
};

export const lightLeakGLAvailable = (): boolean => glAvailable();

export const renderLightLeakGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  cornerX: number,
  cornerY: number,
  color: [number, number, number],
  intensity: number,
  maxDist: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lightLeak:source", width, height);
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
      gl.uniform2f(cache.prog.uniforms.u_corner, cornerX, cornerY);
      gl.uniform3f(cache.prog.uniforms.u_color, color[0], color[1], color[2]);
      gl.uniform1f(cache.prog.uniforms.u_intensity, intensity);
      gl.uniform1f(cache.prog.uniforms.u_maxDist, maxDist);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
