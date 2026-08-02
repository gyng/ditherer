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

// Rubber / relief stamp: a raised binary die pressed through ink onto paper.
// The die is a thresholded BINARY mask, morphologically cleaned so it reads as
// connected solid masses (not per-pixel speckle). Ink break-up is a function of
// DISTANCE-TO-EDGE — it concentrates at shape boundaries where a real stamp
// starves of ink — modulated by LOW-FREQUENCY pressure noise so the print looks
// blotchy rather than dithered. Everything is seeded from pixel coordinates only,
// so a fixed frame is deterministic. Single pass; neighbourhood scans use
// compile-time-constant loop bounds with a circular-window `continue`.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_threshold;   // 0..255 luma cutoff: inked where luma < threshold
uniform float u_roughness;   // 0..1 edge break-up / uneven-inking amount
uniform vec3  u_inkColor;    // 0..255
uniform vec3  u_paperColor;  // 0..255

const int MORPH_R = 2;        // opening/closing radius (speckle cleanup)
const int EDGE_R  = 5;        // edge-distance scan radius (px)

float lumaAt(vec2 ij) {
  vec2 c = clamp(ij, vec2(0.0), u_res - 1.0);
  vec2 uv = vec2((c.x + 0.5) / u_res.x, 1.0 - (c.y + 0.5) / u_res.y);
  vec3 rgb = texture(u_source, uv).rgb * 255.0;
  return rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722;
}

// Raw binary die: 1 = inked (dark), 0 = paper.
float inkedAt(vec2 ij) {
  return lumaAt(ij) < u_threshold ? 1.0 : 0.0;
}

// Opened membership over a 5-tap plus, so an isolated interior pinhole (a lone
// bright/specular pixel inside a solid mass) does NOT register as a paper edge
// and cannot spawn break-up halos in the interior; connected thin features still do.
float coverageAt(vec2 ij) {
  return (inkedAt(ij)
        + inkedAt(ij + vec2(1.0, 0.0)) + inkedAt(ij + vec2(-1.0, 0.0))
        + inkedAt(ij + vec2(0.0, 1.0)) + inkedAt(ij + vec2(0.0, -1.0))) / 5.0;
}

// Deterministic value noise, seeded from pixel coords only.
float hash21(vec2 p) {
  p = floor(p);
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 px = v_uv * u_res;
  float jsX = floor(px.x);
  float jsY = u_res.y - 1.0 - floor(px.y);
  vec2 ij = vec2(jsX, jsY);
  vec2 suv = vec2((jsX + 0.5) / u_res.x, 1.0 - (jsY + 0.5) / u_res.y);
  float srcA = texture(u_source, suv).a;

  // (1)+(2) Binary die + morphological opening/closing. The fraction of inked
  // pixels over a small neighbourhood removes isolated speckle and fills
  // pinholes; binarising that coverage at 0.5 is a median-style open+close.
  float cov = 0.0;
  float wsum = 0.0;
  for (int dy = -MORPH_R; dy <= MORPH_R; dy++) {
    for (int dx = -MORPH_R; dx <= MORPH_R; dx++) {
      cov += inkedAt(ij + vec2(float(dx), float(dy)));
      wsum += 1.0;
    }
  }
  cov /= wsum;
  // Anti-aliased solid mask around the 0.5 iso-level of the cleaned die.
  float solid = smoothstep(0.5 - 0.12, 0.5 + 0.12, cov);

  // (3) Distance to the nearest NON-inked (paper) pixel within a bounded
  // radius, measured on the OPENED field so pinholes are not false edges.
  // Interior pixels find no paper and saturate at EDGE_R.
  float best = float(EDGE_R);
  for (int dy = -EDGE_R; dy <= EDGE_R; dy++) {
    for (int dx = -EDGE_R; dx <= EDGE_R; dx++) {
      float r = length(vec2(float(dx), float(dy)));
      if (r > float(EDGE_R)) continue;                 // circular window
      if (coverageAt(ij + vec2(float(dx), float(dy))) < 0.5) {
        best = min(best, r);
      }
    }
  }
  // edgeProx = 1 at the boundary, 0 deep in the interior.
  float edgeProx = 1.0 - clamp(best / float(EDGE_R), 0.0, 1.0);

  // (4) Uneven ink pressure from LOW-FREQUENCY noise (coarse cells, two
  // octaves) — not per-pixel white noise — so the print reads as organic
  // blotches of pressure rather than dither.
  float blotch =
      valueNoise(ij / 6.0)  * 0.65 +
      valueNoise(ij / 13.0) * 0.35;

  // Break-up concentrates where edgeProx is high; its strength is roughness.
  // A coarse blotch below the local demand flakes the ink away to paper, so
  // chunks break off at the boundary while the interior stays solid.
  float breakDemand = edgeProx * u_roughness;
  // roughness 0 => a perfectly clean die (no flaking from noise minima).
  float keep = u_roughness <= 0.0 ? 1.0 : smoothstep(breakDemand - 0.06, breakDemand + 0.06, blotch);
  float ink = solid * keep;

  // (5) Blotchy ink density from the same low-frequency field: uneven inking
  // in the interior, output ink where the die is inked and not broken away,
  // paper elsewhere. Source alpha is preserved exactly.
  float density = mix(1.0 - 0.28 * u_roughness, 1.0, blotch);
  vec3 inkShade = mix(u_paperColor, u_inkColor, density);
  vec3 rgb = mix(u_paperColor, inkShade, ink) / 255.0;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), srcA);
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
      "u_roughness",
      "u_inkColor",
      "u_paperColor",
    ] as const),
  };
  return _cache;
};

export const stampGLAvailable = (): boolean => glAvailable();

export const renderStampGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  threshold: number,
  roughness: number,
  inkColor: [number, number, number],
  paperColor: [number, number, number],
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "stamp:source", width, height);
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
      gl.uniform1f(cache.prog.uniforms.u_roughness, roughness);
      gl.uniform3f(cache.prog.uniforms.u_inkColor, inkColor[0], inkColor[1], inkColor[2]);
      gl.uniform3f(cache.prog.uniforms.u_paperColor, paperColor[0], paperColor[1], paperColor[2]);
    },
    vao,
  );
  return readoutToCanvas(canvas, width, height);
};
