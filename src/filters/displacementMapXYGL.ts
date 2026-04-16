import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Box blur (separable) of the map-supplying texture, then a displacement
// pass that reads the blurred map for dx/dy and the original source for
// RGB via bilinear sampling on JS-orientation coords.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
uniform vec2  u_dir;     // (1/W, 0) or (0, 1/H)
uniform int   u_radius;

void main() {
  vec4 acc = vec4(0.0);
  float cnt = 0.0;
  for (int k = -20; k <= 20; k++) {
    if (k < -u_radius || k > u_radius) continue;
    vec2 uv = clamp(v_uv + u_dir * float(k),
                    vec2(0.5) / u_res, vec2(1.0) - vec2(0.5) / u_res);
    acc += texture(u_input, uv);
    cnt += 1.0;
  }
  fragColor = acc / max(1.0, cnt);
}
`;

const DISP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_map;   // blurred (or original) source
uniform vec2  u_res;
uniform float u_strength;
uniform int   u_channelX;
uniform int   u_channelY;
uniform int   u_mapOrientation;  // 0 = source-flip (upload FLIP_Y), 1 = FBO (no flip)

float pickChannel(vec4 c, int ch) {
  return ch == 0 ? c.r : ch == 1 ? c.g : c.b;
}

vec4 sampleSourceBilinear(vec2 p) {
  vec2 p0 = floor(p);
  vec2 f = p - p0;
  vec2 p1 = p0 + 1.0;
  vec2 c0 = clamp(p0, vec2(0.0), u_res - 1.0);
  vec2 c1 = clamp(p1, vec2(0.0), u_res - 1.0);
  vec2 uv00 = vec2((c0.x + 0.5) / u_res.x, 1.0 - (c0.y + 0.5) / u_res.y);
  vec2 uv10 = vec2((c1.x + 0.5) / u_res.x, 1.0 - (c0.y + 0.5) / u_res.y);
  vec2 uv01 = vec2((c0.x + 0.5) / u_res.x, 1.0 - (c1.y + 0.5) / u_res.y);
  vec2 uv11 = vec2((c1.x + 0.5) / u_res.x, 1.0 - (c1.y + 0.5) / u_res.y);
  vec4 a00 = texture(u_source, uv00);
  vec4 a10 = texture(u_source, uv10);
  vec4 a01 = texture(u_source, uv01);
  vec4 a11 = texture(u_source, uv11);
  return (a00 * (1.0 - f.x) + a10 * f.x) * (1.0 - f.y)
       + (a01 * (1.0 - f.x) + a11 * f.x) * f.y;
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec2 mapUV = u_mapOrientation == 1
    ? vec2((jsX + 0.5) / u_res.x, (jsY + 0.5) / u_res.y)          // FBO — no flip
    : vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y);   // source — FLIP_Y
  vec4 m = texture(u_map, mapUV);
  float dx = (pickChannel(m, u_channelX) - 0.5) * u_strength * 2.0;
  float dy = (pickChannel(m, u_channelY) - 0.5) * u_strength * 2.0;

  fragColor = sampleSourceBilinear(vec2(jsX + dx, jsY + dy));
}
`;

type Cache = { blur: Program; disp: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    blur: linkProgram(gl, BLUR_FS, ["u_input", "u_res", "u_dir", "u_radius"] as const),
    disp: linkProgram(gl, DISP_FS, [
      "u_source", "u_map", "u_res", "u_strength", "u_channelX", "u_channelY", "u_mapOrientation",
    ] as const),
  };
  return _cache;
};

export const displacementMapXYGLAvailable = (): boolean => glAvailable();

export const renderDisplacementMapXYGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  strength: number, blurRadius: number,
  channelX: 0 | 1 | 2, channelY: 0 | 1 | 2,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);

  const sourceTex = ensureTexture(gl, "displacementMapXY:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const clampedR = Math.min(20, Math.max(0, Math.floor(blurRadius)));

  let mapTexId: WebGLTexture;
  let mapOrientation: 0 | 1;
  if (clampedR > 0) {
    const tempH = ensureTexture(gl, "displacementMapXY:tempH", width, height);
    const tempV = ensureTexture(gl, "displacementMapXY:tempV", width, height);

    drawPass(gl, tempH, width, height, cache.blur, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
      gl.uniform1i(cache.blur.uniforms.u_input, 0);
      gl.uniform2f(cache.blur.uniforms.u_res, width, height);
      gl.uniform2f(cache.blur.uniforms.u_dir, 1 / width, 0);
      gl.uniform1i(cache.blur.uniforms.u_radius, clampedR);
    }, vao);

    drawPass(gl, tempV, width, height, cache.blur, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tempH.tex);
      gl.uniform1i(cache.blur.uniforms.u_input, 0);
      gl.uniform2f(cache.blur.uniforms.u_res, width, height);
      gl.uniform2f(cache.blur.uniforms.u_dir, 0, 1 / height);
      gl.uniform1i(cache.blur.uniforms.u_radius, clampedR);
    }, vao);

    mapTexId = tempV.tex;
    mapOrientation = 1;
  } else {
    mapTexId = sourceTex.tex;
    mapOrientation = 0;
  }

  drawPass(gl, null, width, height, cache.disp, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.disp.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mapTexId);
    gl.uniform1i(cache.disp.uniforms.u_map, 1);
    gl.uniform2f(cache.disp.uniforms.u_res, width, height);
    gl.uniform1f(cache.disp.uniforms.u_strength, strength);
    gl.uniform1i(cache.disp.uniforms.u_channelX, channelX);
    gl.uniform1i(cache.disp.uniforms.u_channelY, channelY);
    gl.uniform1i(cache.disp.uniforms.u_mapOrientation, mapOrientation);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
