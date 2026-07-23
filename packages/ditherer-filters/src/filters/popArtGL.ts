import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "../gl/index";

// Lichtenstein-style pop-art pass: saturation boost + colour posterise +
// luminance-driven Ben-Day dots on a white background. JS-orientation
// pixel coordinates match the reference loop so dot placement is stable.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_dotSize;
uniform float u_levels;
uniform float u_satBoost;
uniform float u_screenAngle;
uniform vec3  u_paperColor;

void main() {
  vec4 source = texture(u_source, v_uv);
  vec3 src = source.rgb * 255.0;

  // Saturation boost around luma.
  float gray = 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b;
  vec3 sat = clamp(gray + (src - gray) * u_satBoost, 0.0, 255.0);
  sat = floor(sat + 0.5);

  // Posterise.
  float step = 255.0 / (u_levels - 1.0);
  vec3 post = floor(floor(sat / step + 0.5) * step + 0.5);

  // Ben-Day dots. Tone controls printed area, not radius: circular dots
  // grow until theoretical contact at pi/4 coverage, then switch to
  // complementary circular paper holes so solid black is reachable.
  float lum = (0.2126 * post.r + 0.7152 * post.g + 0.0722 * post.b) / 255.0;
  float darkness = clamp(1.0 - lum, 0.0, 1.0);
  float pitch = max(1.0, u_dotSize);
  float radians = u_screenAngle * 0.017453292519943295;
  float cs = cos(radians);
  float sn = sin(radians);
  vec2 pixel = vec2(gl_FragCoord.x - 0.5, u_res.y - gl_FragCoord.y);
  vec2 centered = pixel - u_res * 0.5;
  vec2 screened = mat2(cs, -sn, sn, cs) * centered;
  vec2 local = mod(screened + pitch * 0.5, pitch);

  float inkCoverage;
  if (darkness <= 0.7853981633974483) {
    float radius = pitch * sqrt(darkness / 3.141592653589793);
    float distanceToDot = length(local - vec2(pitch * 0.5));
    float aa = max(fwidth(distanceToDot), 0.5);
    inkCoverage = radius <= 0.0
      ? 0.0
      : 1.0 - smoothstep(radius - aa, radius + aa, distanceToDot);
  } else {
    float radius = pitch * sqrt((1.0 - darkness) / 3.141592653589793);
    vec2 cornerDelta = min(local, vec2(pitch) - local);
    float distanceToHole = length(cornerDelta);
    float aa = max(fwidth(distanceToHole), 0.5);
    inkCoverage = radius <= 0.0
      ? 1.0
      : smoothstep(radius - aa, radius + aa, distanceToHole);
  }

  vec3 paper = clamp(u_paperColor / 255.0, 0.0, 1.0);
  vec3 outCol = mix(paper, post / 255.0, clamp(inkCoverage, 0.0, 1.0));
  fragColor = vec4(outCol, source.a);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = { prog: linkProgram(gl, FS, [
    "u_source", "u_res", "u_dotSize", "u_levels", "u_satBoost",
    "u_screenAngle", "u_paperColor",
  ] as const) };
  return _cache;
};

export const popArtGLAvailable = (): boolean => glAvailable();

export const renderPopArtGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  dotSize: number, levels: number, saturationBoost: number,
  screenAngle: number, paperColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "popArt:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);
  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_dotSize, dotSize);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
    gl.uniform1f(cache.prog.uniforms.u_satBoost, saturationBoost);
    gl.uniform1f(cache.prog.uniforms.u_screenAngle, screenAngle);
    gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
