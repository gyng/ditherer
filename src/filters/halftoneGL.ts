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
} from "gl";

// Fragment shader: single-pass halftone.
// Each pixel determines its grid cell, samples the source colour at the cell
// centre, quantises to `u_levels` levels (nearest-palette formula), computes
// per-channel dot radii, then screen-composites the three coloured dots onto
// the background colour.
const HALFTONE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_size;
uniform float u_sizeMultiplier;
uniform float u_offset;
uniform float u_levels;    // 1 = no quantisation, >1 = nearest-palette levels
uniform float u_squareDots; // 0 = circles, 1 = squares
uniform vec3  u_background;

const float PI = 3.14159265;

void main() {
    vec2 px = v_uv * u_res;

    // Grid cell this pixel belongs to.
    vec2 cellIdx    = floor(px / u_size);
    vec2 cellCentre = (cellIdx + 0.5) * u_size;
    vec2 cellUV     = clamp(cellCentre / u_res, vec2(0.0), vec2(1.0));

    // Sample source colour at cell centre.
    vec3 src = texture(u_source, cellUV).rgb;

    // Nearest-palette quantisation: round(c / step) * step, step = 1/(levels-1).
    if (u_levels > 1.5) {
        float q = u_levels - 1.0;
        src = round(src * q) / q;
    }

    // Channel dot centres (angles match JS: 2π/3, 4π/3, 2π).
    float od = u_size * u_offset;
    vec2 rCentre = cellCentre + od * vec2(cos(2.0*PI/3.0), sin(2.0*PI/3.0));
    vec2 gCentre = cellCentre + od * vec2(cos(4.0*PI/3.0), sin(4.0*PI/3.0));
    vec2 bCentre = cellCentre + od * vec2(1.0, 0.0);

    // Dot radii proportional to channel intensity.
    float hs   = u_size * 0.5 * u_sizeMultiplier;
    float rRad = src.r * hs;
    float gRad = src.g * hs;
    float bRad = src.b * hs;

    float rVal, gVal, bVal;
    if (u_squareDots > 0.5) {
        vec2 rd = abs(px - rCentre), gd = abs(px - gCentre), bd = abs(px - bCentre);
        rVal = float(rd.x <= rRad && rd.y <= rRad);
        gVal = float(gd.x <= gRad && gd.y <= gRad);
        bVal = float(bd.x <= bRad && bd.y <= bRad);
    } else {
        // Sub-pixel smooth edge.
        rVal = 1.0 - smoothstep(rRad - 0.7, rRad + 0.7, length(px - rCentre));
        gVal = 1.0 - smoothstep(gRad - 0.7, gRad + 0.7, length(px - gCentre));
        bVal = 1.0 - smoothstep(bRad - 0.7, bRad + 0.7, length(px - bCentre));
    }

    // Screen composite each coloured dot onto the running colour.
    // screen(dst, src) = 1 - (1-dst)*(1-src), applied per channel independently.
    vec3 c = u_background;
    c = 1.0 - (1.0 - c) * (1.0 - vec3(rVal, 0.0, 0.0));
    c = 1.0 - (1.0 - c) * (1.0 - vec3(0.0, gVal, 0.0));
    c = 1.0 - (1.0 - c) * (1.0 - vec3(0.0, 0.0, bVal));

    fragColor = vec4(c, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, HALFTONE_FS, [
      "u_source", "u_res", "u_size", "u_sizeMultiplier", "u_offset",
      "u_levels", "u_squareDots", "u_background",
    ] as const),
  };
  return _cache;
};

/** Parse common CSS colour strings to normalised [r,g,b]. Returns null for unknown formats. */
export const parseCssColorRgb = (color: string): [number, number, number] | null => {
  const s = color.trim().toLowerCase();
  if (s === "black" || s === "transparent") return [0, 0, 0];
  if (s === "white") return [1, 1, 1];
  const h6 = s.match(/^#([0-9a-f]{6})$/);
  if (h6) {
    const h = h6[1];
    return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
  }
  const h3 = s.match(/^#([0-9a-f]{3})$/);
  if (h3) {
    return h3[1].split("").map(c => parseInt(c+c,16)/255) as [number,number,number];
  }
  return null;
};

export const halftoneGLAvailable = (): boolean => glAvailable();

export const renderHalftoneGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  size: number,
  sizeMultiplier: number,
  offset: number,
  levels: number,
  squareDots: boolean,
  background: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);

  const sourceTex = ensureTexture(gl, "halftone:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_size, size);
    gl.uniform1f(cache.prog.uniforms.u_sizeMultiplier, sizeMultiplier);
    gl.uniform1f(cache.prog.uniforms.u_offset, offset);
    gl.uniform1f(cache.prog.uniforms.u_levels, levels);
    gl.uniform1f(cache.prog.uniforms.u_squareDots, squareDots ? 1 : 0);
    gl.uniform3f(cache.prog.uniforms.u_background, ...background);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
