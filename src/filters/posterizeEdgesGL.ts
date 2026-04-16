import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Sobel edges on luma (3×3 neighbourhood) plus in-shader edge dilation
// up to a 7×7 box, then a posterised source or the configured edge
// colour depending on whether the dilated magnitude clears the
// threshold. edgeWidth caps at 4 in the JS reference so a static 7×7
// loop covers every case.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_levels;
uniform float u_edgeThreshold;
uniform int   u_dilationRadius;
uniform vec3  u_edgeColor;

float lumaAt(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  vec3 c = texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb;
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
}

float sobelMagAt(float jsX, float jsY) {
  float l00 = lumaAt(jsX - 1.0, jsY - 1.0);
  float l10 = lumaAt(jsX,       jsY - 1.0);
  float l20 = lumaAt(jsX + 1.0, jsY - 1.0);
  float l01 = lumaAt(jsX - 1.0, jsY);
  float l21 = lumaAt(jsX + 1.0, jsY);
  float l02 = lumaAt(jsX - 1.0, jsY + 1.0);
  float l12 = lumaAt(jsX,       jsY + 1.0);
  float l22 = lumaAt(jsX + 1.0, jsY + 1.0);
  float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
  float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
  return sqrt(gx * gx + gy * gy) * 255.0;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  float maxMag = sobelMagAt(jsX, jsY);
  // Dilate over a (2r+1)² box. Max supported r is 3 (edgeWidth max = 4 → r = 3).
  for (int ky = -3; ky <= 3; ky++) {
    if (ky < -u_dilationRadius || ky > u_dilationRadius) continue;
    for (int kx = -3; kx <= 3; kx++) {
      if (kx < -u_dilationRadius || kx > u_dilationRadius) continue;
      if (kx == 0 && ky == 0) continue;
      maxMag = max(maxMag, sobelMagAt(jsX + float(kx), jsY + float(ky)));
    }
  }

  vec4 srcC = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y));
  vec3 src = srcC.rgb * 255.0;

  vec3 outRgb;
  if (maxMag > u_edgeThreshold) {
    outRgb = u_edgeColor;
  } else {
    float step = 255.0 / (u_levels - 1.0);
    outRgb = floor(floor(src / step + 0.5) * step + 0.5);
  }
  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, srcC.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_levels", "u_edgeThreshold",
    "u_dilationRadius", "u_edgeColor",
  ] as const) };
  return _cache;
};

export const posterizeEdgesGLAvailable = (): boolean => glAvailable();

export const renderPosterizeEdgesGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  levels: number, edgeThreshold: number, edgeWidth: number,
  edgeColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "posterizeEdges:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  const dilationRadius = Math.max(0, Math.min(3, Math.floor(edgeWidth) - 1));
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
    gl.uniform1f(cache.prog.uniforms.u_edgeThreshold, edgeThreshold);
    gl.uniform1i(cache.prog.uniforms.u_dilationRadius, dilationRadius);
    gl.uniform3f(cache.prog.uniforms.u_edgeColor, edgeColor[0], edgeColor[1], edgeColor[2]);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
