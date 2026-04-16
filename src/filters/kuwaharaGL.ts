import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Direct-sampling Kuwahara (no summed-area table): four overlapping
// quadrants of size (radius+1)². Static max radius = 16 in the JS
// reference; the shader loops that wide and gates each iteration by
// the actual uniform radius.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform int   u_radius;

vec3 fetch(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float bestVar = 1e30;
  vec3 bestMean = vec3(0.0);

  int r = u_radius;

  for (int q = 0; q < 4; q++) {
    int qx0 = (q == 0 || q == 2) ? -r : 0;
    int qy0 = (q == 0 || q == 1) ? -r : 0;

    vec3 sum = vec3(0.0);
    vec3 sum2 = vec3(0.0);
    float n = 0.0;
    for (int dy = 0; dy <= 16; dy++) {
      if (dy > r) break;
      for (int dx = 0; dx <= 16; dx++) {
        if (dx > r) break;
        float sx = jsX + float(qx0 + dx);
        float sy = jsY + float(qy0 + dy);
        if (sx < 0.0 || sx >= u_res.x || sy < 0.0 || sy >= u_res.y) continue;
        vec3 c = fetch(sx, sy);
        sum += c;
        sum2 += c * c;
        n += 1.0;
      }
    }

    if (n == 0.0) continue;
    vec3 mean = sum / n;
    vec3 varPerCh = sum2 / n - mean * mean;
    float variance = varPerCh.r + varPerCh.g + varPerCh.b;
    if (variance < bestVar) {
      bestVar = variance;
      bestMean = mean;
    }
  }

  vec3 outRgb = clamp(floor(bestMean + 0.5), 0.0, 255.0);
  fragColor = vec4(outRgb / 255.0, texture(u_source, v_uv).a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, ["u_source", "u_res", "u_radius"] as const) };
  return _cache;
};

export const kuwaharaGLAvailable = (): boolean => glAvailable();

export const renderKuwaharaGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  radius: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "kuwahara:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1i(cache.prog.uniforms.u_radius, Math.max(1, Math.min(16, Math.round(radius))));
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
