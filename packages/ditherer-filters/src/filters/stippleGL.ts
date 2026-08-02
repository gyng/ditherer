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
import { PRINTMAKING_TONE_GLSL, stippleDotRadiusPx } from "./printmakingToneContracts";

// Stippling renders tone by dot *density*, not dot size (Secord 2002). Each
// cell of the placement grid carries at most one dot of constant radius; the
// cell inks only when the local darkness exceeds the cell's noise threshold,
// so the fraction of inked cells — and thus the dot density — equals darkness.
// Dot positions are jittered off the lattice so the result reads as irregular
// stipple rather than a regular halftone screen. (The previous shader grew the
// dot radius with darkness, which is amplitude-modulated halftone.)
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_cell;         // placement grid cell size in pixels
uniform float u_dotRadius;    // constant dot radius in pixels
uniform vec3  u_inkColor;
uniform vec3  u_paperColor;

${PRINTMAKING_TONE_GLSL}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 srcRGBA = texture(u_source, suv);

  float myCellX = floor(x / u_cell);
  float myCellY = floor(y / u_cell);
  int reach = int(ceil(u_dotRadius / u_cell)) + 1;

  float ink = 0.0;
  for (int dy = -6; dy <= 6; dy++) {
    if (dy < -reach || dy > reach) continue;
    for (int dx = -6; dx <= 6; dx++) {
      if (dx < -reach || dx > reach) continue;
      vec2 cell = vec2(myCellX + float(dx), myCellY + float(dy));

      // Local darkness sampled at the cell centre.
      float sampleX = clamp(cell.x * u_cell + u_cell * 0.5, 0.0, u_res.x - 1.0);
      float sampleY = clamp(cell.y * u_cell + u_cell * 0.5, 0.0, u_res.y - 1.0);
      vec2 csuv = vec2((sampleX + 0.5) / u_res.x, 1.0 - (sampleY + 0.5) / u_res.y);
      float darkness = 1.0 - pm_luma(texture(u_source, csuv).rgb);

      // Density modulation: the cell inks iff darkness beats its threshold,
      // so P(inked) = darkness. Constant radius throughout.
      float threshold = hash(cell);
      if (darkness <= threshold) continue;

      float jx = hash(cell + vec2(19.3, 7.1));
      float jy = hash(cell + vec2(3.7, 41.9));
      vec2 dotPos = vec2(cell.x * u_cell + jx * u_cell, cell.y * u_cell + jy * u_cell);
      float dist = length(vec2(x, y) - dotPos);
      ink = max(ink, pm_lineCoverage(dist, u_dotRadius, 0.75));
    }
  }

  vec3 rgb = mix(u_paperColor, u_inkColor, ink);
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
      "u_cell",
      "u_dotRadius",
      "u_inkColor",
      "u_paperColor",
    ] as const),
  };
  return _cache;
};

export const stippleGLAvailable = (): boolean => glAvailable();

export const renderStippleGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  density: number,
  maxDotSize: number,
  inkColor: number[],
  paperColor: number[],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "stipple:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const cell = Math.max(1, density);
  const dotRadius = stippleDotRadiusPx(maxDotSize);

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
      gl.uniform1f(cache.prog.uniforms.u_cell, cell);
      gl.uniform1f(cache.prog.uniforms.u_dotRadius, dotRadius);
      gl.uniform3f(
        cache.prog.uniforms.u_inkColor,
        inkColor[0] / 255,
        inkColor[1] / 255,
        inkColor[2] / 255,
      );
      gl.uniform3f(
        cache.prog.uniforms.u_paperColor,
        paperColor[0] / 255,
        paperColor[1] / 255,
        paperColor[2] / 255,
      );
    },
    vao,
  );

  return readoutToCanvas(canvas, width, height);
};
