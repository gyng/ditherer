import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Pull-model lens flare: each fragment sums contributions from the
// central bloom, up to six lens ghosts (placed along the image-centre
// axis), and a horizontal anamorphic streak. All falloffs match the JS
// reference so the look is consistent between backends.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform vec2  u_centre;     // JS-y
uniform vec2  u_imageCentre;
uniform vec3  u_flareColor; // 0..255
uniform float u_intensity;
uniform int   u_ghosts;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec3 src = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb * 255.0;
  vec3 total = src;

  // Central bloom.
  float bloomR = max(u_res.x, u_res.y) * 0.15;
  vec2 dBloom = vec2(jsX - u_centre.x, jsY - u_centre.y);
  float distBloom = length(dBloom);
  if (distBloom <= bloomR) {
    float falloff = pow(1.0 - distBloom / bloomR, 2.0) * u_intensity * 0.4;
    total += u_flareColor * falloff;
  }

  // Ghosts along the image-centre axis.
  for (int g = 0; g < 6; g++) {
    if (g >= u_ghosts) break;
    float t = (float(g) + 1.0) * 0.4;
    vec2 ghostC = u_centre + (u_imageCentre - u_centre) * t;
    float ghostR = 15.0 + float(g) * 12.0;
    float ghostI = u_intensity * 0.25 / (float(g) + 1.0);
    vec2 dG = vec2(jsX - ghostC.x, jsY - ghostC.y);
    float distG = length(dG);
    if (distG <= ghostR) {
      float ring = abs(distG / ghostR - 0.7);
      if (ring < 0.3) {
        float falloff = (1.0 - ring / 0.3) * ghostI;
        total += u_flareColor * falloff;
      }
    }
  }

  // Horizontal anamorphic streak (through centre, height 3px).
  float streakLength = u_res.x * 0.4;
  float streakHeight = 3.0;
  float dyStreak = abs(jsY - u_centre.y);
  if (dyStreak <= streakHeight) {
    float yFalloff = 1.0 - dyStreak / streakHeight;
    float dxStreak = abs(jsX - u_centre.x);
    if (dxStreak <= streakLength) {
      float xFalloff = pow(1.0 - dxStreak / streakLength, 3.0);
      float brightness = xFalloff * yFalloff * u_intensity * 0.15;
      total += u_flareColor * brightness;
    }
  }

  vec3 outRgb = clamp(floor(total + 0.5), 0.0, 255.0);
  fragColor = vec4(outRgb / 255.0, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_centre", "u_imageCentre",
    "u_flareColor", "u_intensity", "u_ghosts",
  ] as const) };
  return _cache;
};

export const lensFlareGLAvailable = (): boolean => glAvailable();

export const renderLensFlareGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  centreX: number, centreY: number,
  intensity: number, flareColor: [number, number, number],
  ghosts: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "lensFlare:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform2f(cache.prog.uniforms.u_centre, centreX, centreY);
    gl.uniform2f(cache.prog.uniforms.u_imageCentre, width / 2, height / 2);
    gl.uniform3f(cache.prog.uniforms.u_flareColor, flareColor[0], flareColor[1], flareColor[2]);
    gl.uniform1f(cache.prog.uniforms.u_intensity, intensity);
    gl.uniform1i(cache.prog.uniforms.u_ghosts, ghosts | 0);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
