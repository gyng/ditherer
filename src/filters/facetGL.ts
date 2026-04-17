import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Jittered-grid Voronoi facets. Each fragment scans the 3×3 grid
// neighbourhood to find its nearest + second-nearest seed and either
// paints the seam (|d1−d2| < seamWidth) or samples the seed's colour
// from source.
//
// CENTER fill: samples raw source at the seed's exact position. Exact
// match of the JS reference's CENTER mode.
//
// AVERAGE fill: the JS averages the Voronoi cell. Without atomics we
// approximate this by pre-blurring source with a separable box filter
// of radius facetSize/2 before the facet pass — each blurred pixel
// is the mean of a facetSize×facetSize window, close to the true
// cell mean for low jitter. For extreme jitter the approximation
// drifts; document and accept.
//
// JS uses a stateful mulberry32 seeded once and iterated across all
// cells; we use a per-cell uint32 hash instead, so exact seed
// positions differ but the facet character is preserved.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_dir;     // (1/W, 0) or (0, 1/H)
uniform int   u_radius;  // capped at 32

void main() {
  vec4 acc = vec4(0.0);
  float cnt = 0.0;
  for (int k = -32; k <= 32; k++) {
    if (k < -u_radius || k > u_radius) continue;
    vec2 uv = clamp(v_uv + u_dir * float(k),
                    vec2(0.5) / u_res, vec2(1.0) - vec2(0.5) / u_res);
    acc += texture(u_input, uv);
    cnt += 1.0;
  }
  fragColor = acc / max(1.0, cnt);
}
`;

const FACET_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_facetSize;
uniform float u_jitter;
uniform float u_seamWidth;
uniform vec3  u_lineColor;   // 0..255
uniform uint  u_seed;
// 1 when u_source is FLIP_Y-uploaded (raw source texture); 0 when it's an
// FBO-rendered texture (blurred source in AVERAGE mode) which lacks the
// flip. Affects how jsY maps to texture v-coord.
uniform int   u_sourceFlipped;

uint hashU(int x, int y, int axis) {
  uint h = u_seed
    + uint(x + 1024) * 374761393u
    + uint(y + 1024) * 668265263u
    + uint(axis) * 0xC2B2AE35u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

float hashF01(int x, int y, int axis) {
  return float(hashU(x, y, axis)) / 4294967296.0;
}

vec2 seedPos(int gx, int gy) {
  float ox = (hashF01(gx, gy, 0) - 0.5) * u_facetSize * u_jitter;
  float oy = (hashF01(gx, gy, 1) - 0.5) * u_facetSize * u_jitter;
  return vec2((float(gx) + 0.5) * u_facetSize + ox,
              (float(gy) + 0.5) * u_facetSize + oy);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  int ownGx = int(floor(jsX / u_facetSize));
  int ownGy = int(floor(jsY / u_facetSize));

  float bestDist = 1e30;
  float secondDist = 1e30;
  vec2  bestSeed = vec2(0.0);

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 s = seedPos(ownGx + dx, ownGy + dy);
      float dd = (jsX - s.x) * (jsX - s.x) + (jsY - s.y) * (jsY - s.y);
      if (dd < bestDist) {
        secondDist = bestDist;
        bestDist = dd;
        bestSeed = s;
      } else if (dd < secondDist) {
        secondDist = dd;
      }
    }
  }

  float borderDist = (sqrt(secondDist) - sqrt(bestDist)) * 0.5;

  vec3 outRgb;
  if (borderDist < u_seamWidth) {
    outRgb = u_lineColor;
  } else {
    float sx = clamp(bestSeed.x, 0.0, u_res.x - 1.0);
    float sy = clamp(bestSeed.y, 0.0, u_res.y - 1.0);
    float v = u_sourceFlipped == 1 ? 1.0 - (sy + 0.5) / u_res.y : (sy + 0.5) / u_res.y;
    outRgb = texture(u_source, vec2((sx + 0.5) / u_res.x, v)).rgb * 255.0;
  }
  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, 1.0);
}
`;

type Cache = { facet: Program; blur: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    facet: linkProgram(gl, FACET_FS, [
      "u_source", "u_res", "u_facetSize", "u_jitter",
      "u_seamWidth", "u_lineColor", "u_seed", "u_sourceFlipped",
    ] as const),
    blur: linkProgram(gl, BLUR_FS, ["u_input", "u_res", "u_dir", "u_radius"] as const),
  };
  return _cache;
};

export const facetGLAvailable = (): boolean => glAvailable();

export const renderFacetGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  facetSize: number, jitter: number, seamWidth: number,
  lineColor: [number, number, number],
  averageMode: boolean,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);

  const sourceTex = ensureTexture(gl, "facet:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  // AVERAGE mode: pre-blur source with a separable box filter, radius =
  // facetSize/2. The facet pass then samples the blurred texture at the
  // seed position, giving a cell-mean approximation.
  let sampleTex = sourceTex.tex;
  if (averageMode) {
    const blurR = Math.max(1, Math.min(32, Math.round(facetSize / 2)));
    const tempH = ensureTexture(gl, "facet:blurH", width, height);
    const tempV = ensureTexture(gl, "facet:blurV", width, height);
    drawPass(gl, tempH, width, height, cache.blur, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.blur.uniforms.u_input, 0);
      gl.uniform2f(cache.blur.uniforms.u_res, width, height);
      gl.uniform2f(cache.blur.uniforms.u_dir, 1 / width, 0);
      gl.uniform1i(cache.blur.uniforms.u_radius, blurR);
    }, vao);
    drawPass(gl, tempV, width, height, cache.blur, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tempH.tex);
      gl.uniform1i(cache.blur.uniforms.u_input, 0);
      gl.uniform2f(cache.blur.uniforms.u_res, width, height);
      gl.uniform2f(cache.blur.uniforms.u_dir, 0, 1 / height);
      gl.uniform1i(cache.blur.uniforms.u_radius, blurR);
    }, vao);
    sampleTex = tempV.tex;
  }

  const seed = ((width * 73856093) ^ (height * 19349663) ^ Math.round(jitter * 1000)) >>> 0;
  drawPass(gl, null, width, height, cache.facet, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sampleTex);
    gl.uniform1i(cache.facet.uniforms.u_source, 0);
    gl.uniform2f(cache.facet.uniforms.u_res, width, height);
    gl.uniform1f(cache.facet.uniforms.u_facetSize, facetSize);
    gl.uniform1f(cache.facet.uniforms.u_jitter, jitter);
    gl.uniform1f(cache.facet.uniforms.u_seamWidth, seamWidth);
    gl.uniform3f(cache.facet.uniforms.u_lineColor, lineColor[0], lineColor[1], lineColor[2]);
    gl.uniform1ui(cache.facet.uniforms.u_seed, seed || 1);
    gl.uniform1i(cache.facet.uniforms.u_sourceFlipped, averageMode ? 0 : 1);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
