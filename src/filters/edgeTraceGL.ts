import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Two-pass Canny-lite:
// 1) NMS: compute Sobel magnitude + quantised direction, suppress
//    anything that's not a local max along the gradient, write a 0/255
//    edge map to an FBO texture.
// 2) Dilate + render: for each fragment scan a small kernel over the
//    edge map (line width caps at 3 → radius ≤ 1) and composite either
//    the line colour or the background / source depending on mode.
const NMS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;

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

  // Interior only — JS skips the 1-pixel border.
  if (jsX < 1.0 || jsY < 1.0 || jsX >= u_res.x - 1.0 || jsY >= u_res.y - 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

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
  float mag = sqrt(gx * gx + gy * gy) * 255.0;

  if (mag < u_threshold) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float dir = atan(gy, gx);
  if (dir < 0.0) dir += 3.14159265;
  float deg = dir * 57.2957795;

  float n1X, n1Y, n2X, n2Y;
  if (deg < 22.5 || deg >= 157.5) {
    n1X = jsX; n1Y = jsY - 1.0;
    n2X = jsX; n2Y = jsY + 1.0;
  } else if (deg < 67.5) {
    n1X = jsX + 1.0; n1Y = jsY - 1.0;
    n2X = jsX - 1.0; n2Y = jsY + 1.0;
  } else if (deg < 112.5) {
    n1X = jsX - 1.0; n1Y = jsY;
    n2X = jsX + 1.0; n2Y = jsY;
  } else {
    n1X = jsX - 1.0; n1Y = jsY - 1.0;
    n2X = jsX + 1.0; n2Y = jsY + 1.0;
  }

  float m1 = sobelMagAt(n1X, n1Y);
  float m2 = sobelMagAt(n2X, n2Y);
  bool isMax = mag >= m1 && mag >= m2;
  fragColor = vec4(isMax ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}
`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_edgeMap;
uniform vec2  u_res;
uniform float u_lineWidth;
uniform float u_reach;
uniform int   u_ceilRadius;
uniform vec3  u_lineColor;   // 0..255
uniform vec3  u_bgColor;     // 0..255
uniform int   u_mode;        // 0 = solid, 1 = overlay
uniform float u_overlayMix;

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);

  vec4 edgeC = texture(u_edgeMap, v_uv);
  bool isEdge = edgeC.r > 0.5;
  if (!isEdge) {
    // Check dilation kernel for any edge pixel within reach.
    for (int ky = -1; ky <= 1; ky++) {
      if (ky < -u_ceilRadius || ky > u_ceilRadius) continue;
      for (int kx = -1; kx <= 1; kx++) {
        if (kx < -u_ceilRadius || kx > u_ceilRadius) continue;
        if (kx == 0 && ky == 0) continue;
        if (sqrt(float(kx * kx + ky * ky)) > u_reach) continue;
        vec2 off = vec2(float(kx) / u_res.x, float(ky) / u_res.y);
        vec2 uv = v_uv + vec2(off.x, -off.y);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
        if (texture(u_edgeMap, uv).r > 0.5) { isEdge = true; break; }
      }
      if (isEdge) break;
    }
  }

  vec3 srcRgb = texture(u_source, vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y)).rgb * 255.0;
  vec3 base = u_mode == 1 ? srcRgb : u_bgColor;

  vec3 outRgb;
  float edgeAlpha = clamp(u_lineWidth, 0.1, 1.0);
  if (isEdge) {
    if (u_mode == 1) {
      float m = clamp(u_overlayMix * edgeAlpha, 0.0, 1.0);
      outRgb = floor(base + (u_lineColor - base) * m + 0.5);
    } else if (u_lineWidth < 1.0) {
      outRgb = floor(base + (u_lineColor - base) * edgeAlpha + 0.5);
    } else {
      outRgb = u_lineColor;
    }
  } else {
    outRgb = base;
  }
  fragColor = vec4(clamp(outRgb, 0.0, 255.0) / 255.0, 1.0);
}
`;

type Cache = { nms: Program; render: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    nms: linkProgram(gl, NMS_FS, ["u_source", "u_res", "u_threshold"] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_source", "u_edgeMap", "u_res", "u_lineWidth", "u_reach", "u_ceilRadius",
      "u_lineColor", "u_bgColor", "u_mode", "u_overlayMix",
    ] as const),
  };
  return _cache;
};

export const edgeTraceGLAvailable = (): boolean => glAvailable();

export const renderEdgeTraceGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  threshold: number, lineWidth: number,
  lineColor: [number, number, number], bgColor: [number, number, number],
  modeIsOverlay: boolean, overlayMix: number,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);

  const sourceTex = ensureTexture(gl, "edgeTrace:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const edgeMap = ensureTexture(gl, "edgeTrace:edges", width, height);
  drawPass(gl, edgeMap, width, height, cache.nms, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.nms.uniforms.u_source, 0);
    gl.uniform2f(cache.nms.uniforms.u_res, width, height);
    gl.uniform1f(cache.nms.uniforms.u_threshold, threshold);
  }, vao);

  const radius = lineWidth > 1 ? (lineWidth - 1) / 2 : 0;
  const ceilRadius = Math.min(1, Math.ceil(radius));
  const reach = radius + 0.35;

  drawPass(gl, null, width, height, cache.render, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.render.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, edgeMap.tex);
    gl.uniform1i(cache.render.uniforms.u_edgeMap, 1);
    gl.uniform2f(cache.render.uniforms.u_res, width, height);
    gl.uniform1f(cache.render.uniforms.u_lineWidth, lineWidth);
    gl.uniform1f(cache.render.uniforms.u_reach, reach);
    gl.uniform1i(cache.render.uniforms.u_ceilRadius, ceilRadius);
    gl.uniform3f(cache.render.uniforms.u_lineColor, lineColor[0], lineColor[1], lineColor[2]);
    gl.uniform3f(cache.render.uniforms.u_bgColor, bgColor[0], bgColor[1], bgColor[2]);
    gl.uniform1i(cache.render.uniforms.u_mode, modeIsOverlay ? 1 : 0);
    gl.uniform1f(cache.render.uniforms.u_overlayMix, overlayMix);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
