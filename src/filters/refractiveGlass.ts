import { ENUM, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glUnavailableStub,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

const SURFACE = { LUMINANCE: "LUMINANCE", EDGES: "EDGES", FROSTED: "FROSTED" };

export const optionTypes = {
  surface: {
    type: ENUM,
    options: [
      { name: "Luminance relief", value: SURFACE.LUMINANCE },
      { name: "Edge-cut glass", value: SURFACE.EDGES },
      { name: "Frosted noise", value: SURFACE.FROSTED },
    ],
    default: SURFACE.LUMINANCE,
    desc: "Source used to derive the refracting surface normal",
  },
  refraction: { type: RANGE, range: [0, 48], step: 0.5, default: 12, desc: "Pixel displacement caused by the glass surface" },
  relief: { type: RANGE, range: [0.1, 8], step: 0.1, default: 2.5, desc: "Strength of image-derived surface slopes" },
  roughness: { type: RANGE, range: [0, 1], step: 0.01, default: 0.18, desc: "Fine irregularity in the glass" },
  dispersion: { type: RANGE, range: [0, 1], step: 0.01, default: 0.28, desc: "Prismatic separation between red and blue rays" },
  highlight: { type: RANGE, range: [0, 1], step: 0.01, default: 0.22, desc: "Specular highlight on steep glass facets" },
};

export const defaults = {
  surface: optionTypes.surface.default,
  refraction: optionTypes.refraction.default,
  relief: optionTypes.relief.default,
  roughness: optionTypes.roughness.default,
  dispersion: optionTypes.dispersion.default,
  highlight: optionTypes.highlight.default,
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_refraction;
uniform float u_relief;
uniform float u_roughness;
uniform float u_dispersion;
uniform float u_highlight;
uniform int u_surface;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float heightAt(vec2 uv) { return luma(texture(u_source, clamp(uv, vec2(0.0), vec2(1.0))).rgb); }
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 texel = 1.0 / u_res;
  float left = heightAt(v_uv - vec2(texel.x, 0.0));
  float right = heightAt(v_uv + vec2(texel.x, 0.0));
  float down = heightAt(v_uv - vec2(0.0, texel.y));
  float up = heightAt(v_uv + vec2(0.0, texel.y));
  vec2 gradient = vec2(right - left, up - down);
  if (u_surface == 1) {
    float edge = length(gradient);
    gradient *= 1.0 + edge * 8.0;
  }
  vec2 pixel = floor(v_uv * u_res);
  vec2 noise = vec2(hash12(pixel * 0.73), hash12(pixel.yx * 1.17 + 9.2)) - 0.5;
  if (u_surface == 2) gradient = noise * 0.35 + gradient * 0.2;
  else gradient += noise * u_roughness * 0.12;

  vec2 normal = gradient * u_relief + noise * u_roughness * 0.2;
  vec2 offset = normal * u_refraction / u_res;
  vec2 uvR = clamp(v_uv + offset * (1.0 + u_dispersion), vec2(0.0), vec2(1.0));
  vec2 uvG = clamp(v_uv + offset, vec2(0.0), vec2(1.0));
  vec2 uvB = clamp(v_uv + offset * (1.0 - u_dispersion), vec2(0.0), vec2(1.0));
  vec3 refracted = vec3(texture(u_source, uvR).r, texture(u_source, uvG).g, texture(u_source, uvB).b);
  vec3 n = normalize(vec3(-normal * 3.0, 1.0));
  float specular = pow(max(0.0, dot(n, normalize(vec3(-0.35, 0.45, 1.0)))), 24.0) * u_highlight;
  fragColor = vec4(clamp(refracted + specular, 0.0, 1.0), texture(u_source, v_uv).a);
}
`;

let _prog: Program | null = null;
const getProg = (gl: WebGL2RenderingContext): Program => {
  if (_prog) return _prog;
  _prog = linkProgram(gl, FS, [
    "u_source", "u_res", "u_refraction", "u_relief", "u_roughness",
    "u_dispersion", "u_highlight", "u_surface",
  ] as const);
  return _prog;
};
const surfaceId: Record<string, number> = { LUMINANCE: 0, EDGES: 1, FROSTED: 2 };

const refractiveGlass = (input: any, options = defaults) => {
  const W = input.width, H = input.height;
  const ctx = getGLCtx();
  if (!ctx) return glUnavailableStub(W, H);
  const { gl, canvas } = ctx;
  const prog = getProg(gl);
  const vao = getQuadVAO(gl);
  resizeGLCanvas(canvas, W, H);
  const sourceTex = ensureTexture(gl, "refractiveGlass:source", W, H);
  uploadSourceTexture(gl, sourceTex, input);
  drawPass(gl, null, W, H, prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(prog.uniforms.u_source, 0);
    gl.uniform2f(prog.uniforms.u_res, W, H);
    gl.uniform1f(prog.uniforms.u_refraction, options.refraction);
    gl.uniform1f(prog.uniforms.u_relief, options.relief);
    gl.uniform1f(prog.uniforms.u_roughness, options.roughness);
    gl.uniform1f(prog.uniforms.u_dispersion, options.dispersion);
    gl.uniform1f(prog.uniforms.u_highlight, options.highlight);
    gl.uniform1i(prog.uniforms.u_surface, surfaceId[options.surface] ?? 0);
  }, vao);
  const output = readoutToCanvas(canvas, W, H);
  if (!output) return glUnavailableStub(W, H);
  logFilterBackend("Refractive Glass", "WebGL2", `${options.surface} offset=${options.refraction}`);
  return output;
};

export default defineFilter({
  name: "Refractive Glass",
  func: refractiveGlass,
  optionTypes,
  options: defaults,
  defaults,
  description: "Turn image luminance, edges, or procedural frost into a prismatic refracting glass surface",
  requiresGL: true,
});
