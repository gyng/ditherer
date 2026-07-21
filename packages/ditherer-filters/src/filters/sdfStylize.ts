import { COLOR, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
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
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { nearest } from "../palettes/index";
import { cloneCanvas, logFilterBackend, logFilterWasmStatus } from "../utils/index";
import { buildSdfField, SDF_GLSL } from "../utils/sdfJumpFlood";
import { defineFilter } from "./types";

const MODE = { ISOLINES: "ISOLINES", OFFSET: "OFFSET", BEVEL: "BEVEL" };

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_sdf;
uniform vec2 u_res;
uniform int u_mode;
uniform float u_spacing;
uniform float u_thickness;
uniform vec3 u_lineColor;
uniform vec3 u_fillColor;
uniform float u_threshold;
uniform float u_levels;

${SDF_GLSL}

void main() {
  ivec2 p = ivec2(floor(v_uv * u_res));
  float sd = signedDistanceAt(u_sdf, u_source, p, u_res, u_threshold);
  vec3 rgb;
  if (u_mode == 0) {
    float loop = mod(abs(sd), u_spacing);
    float lineDistance = min(loop, u_spacing - loop);
    float line = 1.0 - smoothstep(
      max(0.0, u_thickness * 0.5 - 0.75),
      u_thickness * 0.5 + 0.75,
      lineDistance
    );
    rgb = mix(u_fillColor, u_lineColor, line);
  } else if (u_mode == 1) {
    float band = floor(sd / u_spacing);
    float tone = clamp(band / 8.0 + 0.5, 0.0, 1.0);
    rgb = mix(u_fillColor, u_lineColor, tone);
  } else {
    float shade = clamp(-sd / u_spacing * 0.5 + 0.5, 0.0, 1.0);
    rgb = mix(u_lineColor, u_fillColor, shade);
  }

  rgb = clamp(rgb, 0.0, 255.0) / 255.0;
  if (u_levels > 1.5) {
    float quantizer = u_levels - 1.0;
    rgb = floor(rgb * quantizer + 0.5) / quantizer;
  }
  fragColor = vec4(rgb, 1.0);
}
`;

let renderProgram: Program | null = null;
const getRenderProgram = (gl: WebGL2RenderingContext): Program => {
  if (renderProgram) return renderProgram;
  renderProgram = linkProgram(gl, RENDER_FS, [
    "u_source", "u_sdf", "u_res", "u_mode", "u_spacing", "u_thickness",
    "u_lineColor", "u_fillColor", "u_threshold", "u_levels",
  ]);
  return renderProgram;
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Isolines", value: MODE.ISOLINES },
      { name: "Offset bands", value: MODE.OFFSET },
      { name: "Bevel", value: MODE.BEVEL },
    ],
    default: MODE.ISOLINES,
    desc: "SDF rendering style",
  },
  threshold: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Luminance threshold for the binary mask" },
  spacing: { type: RANGE, range: [2, 80], step: 1, default: 16, desc: "Isoline or band spacing in pixels" },
  thickness: { type: RANGE, range: [0.5, 10], step: 0.5, default: 1.5, desc: "Isoline thickness in pixels" },
  lineColor: { type: COLOR, default: [20, 20, 20], desc: "Line or shadow color" },
  fillColor: { type: COLOR, default: [240, 235, 220], desc: "Fill or highlight color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  mode: optionTypes.mode.default,
  threshold: optionTypes.threshold.default,
  spacing: optionTypes.spacing.default,
  thickness: optionTypes.thickness.default,
  lineColor: optionTypes.lineColor.default,
  fillColor: optionTypes.fillColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const MODE_ID: Record<string, number> = { ISOLINES: 0, OFFSET: 1, BEVEL: 2 };

const sdfStylize = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const width = input.width;
  const height = input.height;
  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const context = getGLCtx();
    if (context) {
      const { gl, canvas } = context;
      resizeGLCanvas(canvas, width, height);
      const sourceTexture = ensureTexture(gl, "sdfStylize:source", width, height);
      uploadSourceTexture(gl, sourceTexture, input);
      const field = buildSdfField({
        gl,
        sourceTexture,
        width,
        height,
        threshold: options.threshold,
        key: "sdfStylize",
      });
      if (field) {
        const program = getRenderProgram(gl);
        const vao = getQuadVAO(gl);
        drawPass(gl, null, width, height, program, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
          gl.uniform1i(program.uniforms.u_source, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, field.tex);
          gl.uniform1i(program.uniforms.u_sdf, 1);
          gl.uniform2f(program.uniforms.u_res, width, height);
          gl.uniform1i(program.uniforms.u_mode, MODE_ID[options.mode] ?? 0);
          gl.uniform1f(program.uniforms.u_spacing, options.spacing);
          gl.uniform1f(program.uniforms.u_thickness, options.thickness);
          gl.uniform3f(program.uniforms.u_lineColor, options.lineColor[0], options.lineColor[1], options.lineColor[2]);
          gl.uniform3f(program.uniforms.u_fillColor, options.fillColor[0], options.fillColor[1], options.fillColor[2]);
          gl.uniform1f(program.uniforms.u_threshold, options.threshold);
          const paletteOptions = options.palette as { options?: { levels?: number } };
          gl.uniform1f(
            program.uniforms.u_levels,
            paletteIsIdentity(options.palette) ? (paletteOptions.options?.levels ?? 256) : 256,
          );
        }, vao);

        const rendered = readoutToCanvas(canvas, width, height);
        if (rendered) {
          const identity = paletteIsIdentity(options.palette);
          const output = identity
            ? rendered
            : applyPalettePassToCanvas(rendered, width, height, options.palette);
          if (output) {
            logFilterBackend("SDF Stylize", "WebGL2", `${options.mode} spacing=${options.spacing}${identity ? "" : "+palettePass"}`);
            return output;
          }
        }
      }
    }
  }
  logFilterWasmStatus("SDF Stylize", false, "needs WebGL2 with float render targets");
  return cloneCanvas(input, true);
};

export default defineFilter({
  name: "SDF Stylize",
  func: sdfStylize,
  optionTypes,
  options: defaults,
  defaults,
  description: "True signed-distance styling via boundary jump-flood: isolines, offset bands, or bevelled fills",
  noWASM: "Jump-flood distance fields use parallel GPU propagation.",
});
