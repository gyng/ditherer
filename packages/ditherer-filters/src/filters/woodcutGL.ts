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
import { PRINTMAKING_TONE_GLSL } from "./printmakingToneContracts";

// Relief printing: ink sits on the raised surface and carved gouges print as
// white lines. Tone in the mid-values is carried by the *width* of those
// gouges, and the gouges follow the block's form — their direction is the
// local structure-tensor tangent, not a fixed 45° screen in device pixels.
// The carved (paper) fraction equals the local lightness, so ink coverage
// tracks darkness and a mid-grey differs from a near-black. Strong edges keep
// a solid ink contour. The whole filter is a single pass; the structure tensor
// is smoothed over a 3×3 grid of gradient samples for coherent orientation.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;    // 0..255, luma mapped to 50% ink
uniform float u_lineWeight;   // gouge spacing scale
uniform float u_edgeStrength; // solid-contour emphasis
uniform vec3  u_inkColor;     // 0..255
uniform vec3  u_paperColor;   // 0..255

${PRINTMAKING_TONE_GLSL}

float lumaAt(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  return pm_luma(texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb);
}

// Central-difference luma gradient at an integer pixel.
vec2 gradAt(float jsX, float jsY) {
  float gx = lumaAt(jsX + 1.0, jsY) - lumaAt(jsX - 1.0, jsY);
  float gy = lumaAt(jsX, jsY + 1.0) - lumaAt(jsX, jsY - 1.0);
  return vec2(gx, gy);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y);
  vec4 srcRGBA = texture(u_source, suv);
  float l = pm_luma(srcRGBA.rgb);

  // Smoothed structure tensor over a 3x3 grid of gradient samples.
  float gxx = 0.0, gyy = 0.0, gxy = 0.0, mag = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 g = gradAt(jsX + float(dx), jsY + float(dy));
      gxx += g.x * g.x; gyy += g.y * g.y; gxy += g.x * g.y;
      mag += length(g);
    }
  }
  mag /= 9.0;
  float theta = pm_tensorTangentAngle(gxx, gyy, gxy);
  // Gouges run along the tangent; measure distance across them.
  vec2 across = vec2(-sin(theta), cos(theta));
  float spacing = max(2.0, u_lineWeight + 2.0);
  float proj = dot(vec2(jsX, jsY), across);
  float m = mod(proj, spacing);
  float dist = min(m, spacing - m);

  // Carved (paper) half-width grows with lightness so ink fraction = darkness.
  // u_threshold is the luma that maps to a 50% carve.
  float t = clamp(u_threshold / 255.0, 0.02, 0.98);
  float lightness = pm_clamp01(l / (2.0 * t));
  float carveHalf = 0.5 * spacing * lightness;
  float paperCov = pm_lineCoverage(dist, carveHalf, 0.75);
  float ink = 1.0 - paperCov;

  // Solid ink contour along strong edges.
  float edge = pm_clamp01((mag * 255.0 * u_edgeStrength - 18.0) / 40.0);
  ink = max(ink, edge);

  vec3 rgb = mix(u_paperColor / 255.0, u_inkColor / 255.0, ink);
  fragColor = vec4(rgb, srcRGBA.a);
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
      "u_threshold",
      "u_lineWeight",
      "u_edgeStrength",
      "u_inkColor",
      "u_paperColor",
    ] as const),
  };
  return _cache;
};

export const woodcutGLAvailable = (): boolean => glAvailable();

export const renderWoodcutGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  threshold: number,
  lineWeight: number,
  edgeStrength: number,
  inkColor: [number, number, number],
  paperColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "woodcut:source", width, height);
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
      gl.uniform1f(cache.prog.uniforms.u_threshold, threshold);
      gl.uniform1f(cache.prog.uniforms.u_lineWeight, lineWeight);
      gl.uniform1f(cache.prog.uniforms.u_edgeStrength, edgeStrength);
      gl.uniform3f(cache.prog.uniforms.u_inkColor, inkColor[0], inkColor[1], inkColor[2]);
      gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
