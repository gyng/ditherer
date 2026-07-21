import { ACTION, BOOL, RANGE } from "../constants/controlTypes";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "../gl/index";
import { logFilterBackend } from "../utils/index";
import { spectrumFlashPhase } from "./retroHardwareCodecs";
import { defineFilter, type FilterCanvas, type FilterOptionValues } from "./types";

export const optionTypes = {
  flashProbability: { type: RANGE, range: [0, 1], step: 0.01, default: 0.08, desc: "Fraction of 8×8 attribute cells assigned the hardware FLASH bit" },
  flashEnabled: { type: BOOL, default: true, desc: "Swap INK and PAPER at the Spectrum's 0.64-second full FLASH cycle" },
  pixelGrid: { type: BOOL, default: false, desc: "Darken dot and attribute-cell boundaries to expose the 256×192 display geometry" },
  animSpeed: { type: RANGE, range: [1, 50], step: 1, default: 25, desc: "Preview frame rate used to reproduce the hardware FLASH timing" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Advance the Spectrum FLASH counter",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) actions.stopAnimLoop();
      else actions.startAnimLoop(inputCanvas, Number(options.animSpeed) || 25);
    },
  },
};

export const defaults = {
  flashProbability: optionTypes.flashProbability.default,
  flashEnabled: optionTypes.flashEnabled.default,
  pixelGrid: optionTypes.pixelGrid.default,
  animSpeed: optionTypes.animSpeed.default,
};

type ZxOptions = FilterOptionValues & Partial<typeof defaults> & { _frameIndex?: number };

const ATTRIBUTE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;

vec3 spectrumColor(int index, bool bright) {
  float level = bright ? 1.0 : 205.0 / 255.0;
  return vec3(
    (index & 2) != 0 ? level : 0.0,
    (index & 4) != 0 ? level : 0.0,
    (index & 1) != 0 ? level : 0.0
  );
}

vec3 sourceDot(float x, float y) {
  return texture(u_source, vec2((x + 0.5) / 256.0, 1.0 - (y + 0.5) / 192.0)).rgb;
}

void main() {
  int cellX = int(floor(v_uv.x * 32.0));
  int cellY = 23 - int(floor(v_uv.y * 24.0));
  float bestError = 1e20;
  int bestInk = 0;
  int bestPaper = 0;
  int bestBright = 0;

  for (int bright = 0; bright < 2; bright++) {
    for (int paper = 0; paper < 8; paper++) {
      vec3 paperColor = spectrumColor(paper, bright == 1);
      for (int ink = 0; ink < 8; ink++) {
        vec3 inkColor = spectrumColor(ink, bright == 1);
        float error = 0.0;
        for (int py = 0; py < 8; py++) {
          for (int px = 0; px < 8; px++) {
            vec3 source = sourceDot(float(cellX * 8 + px), float(cellY * 8 + py));
            vec3 dp = source - paperColor;
            vec3 di = source - inkColor;
            error += min(dot(dp, dp), dot(di, di));
          }
        }
        if (error < bestError) {
          bestError = error;
          bestInk = ink;
          bestPaper = paper;
          bestBright = bright;
        }
      }
    }
  }
  fragColor = vec4((float(bestInk) + 0.5) / 8.0, (float(bestPaper) + 0.5) / 8.0, float(bestBright), 1.0);
}
`;

const OUTPUT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_attributes;
uniform vec2 u_res;
uniform float u_flashProbability;
uniform int u_flashPhase;
uniform int u_flashEnabled;
uniform int u_pixelGrid;

vec3 spectrumColor(int index, bool bright) {
  float level = bright ? 1.0 : 205.0 / 255.0;
  return vec3(
    (index & 2) != 0 ? level : 0.0,
    (index & 4) != 0 ? level : 0.0,
    (index & 1) != 0 ? level : 0.0
  );
}

float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

void main() {
  float jsX = floor(v_uv.x * u_res.x);
  float jsY = u_res.y - 1.0 - floor(v_uv.y * u_res.y);
  vec2 dotPx = floor(vec2(jsX * 256.0 / u_res.x, jsY * 192.0 / u_res.y));
  vec2 cell = floor(dotPx / 8.0);
  vec4 attrData = texture(u_attributes, vec2((cell.x + 0.5) / 32.0, 1.0 - (cell.y + 0.5) / 24.0));
  int ink = int(floor(attrData.r * 8.0));
  int paper = int(floor(attrData.g * 8.0));
  bool bright = attrData.b > 0.5;
  vec3 inkColor = spectrumColor(ink, bright);
  vec3 paperColor = spectrumColor(paper, bright);
  vec3 source = texture(u_source, vec2((dotPx.x + 0.5) / 256.0, 1.0 - (dotPx.y + 0.5) / 192.0)).rgb;
  vec3 di = source - inkColor;
  vec3 dp = source - paperColor;
  bool useInk = dot(di, di) < dot(dp, dp);
  bool flashCell = u_flashEnabled == 1 && hash(cell + vec2(17.0, 91.0)) < u_flashProbability;
  if (flashCell && u_flashPhase == 1) useInk = !useInk;
  vec3 color = useInk ? inkColor : paperColor;
  if (u_pixelGrid == 1) {
    vec2 within = mod(vec2(jsX * 256.0 / u_res.x, jsY * 192.0 / u_res.y), 8.0);
    float dotEdge = min(fract(jsX * 256.0 / u_res.x), fract(jsY * 192.0 / u_res.y));
    float cellEdge = min(min(within.x, within.y), min(8.0 - within.x, 8.0 - within.y));
    color *= mix(0.76, 1.0, smoothstep(0.0, 0.16, dotEdge)) * mix(0.78, 1.0, smoothstep(0.0, 0.28, cellEdge));
  }
  fragColor = vec4(color, 1.0);
}
`;

let attributeProgram: Program | null = null;
let outputProgram: Program | null = null;

const zxSpectrum = (input: FilterCanvas, options: ZxOptions = defaults): FilterCanvas => {
  const context = getGLCtx();
  if (!context || input.width < 1 || input.height < 1) return input;
  const { gl, canvas } = context;
  attributeProgram ??= linkProgram(gl, ATTRIBUTE_FS, ["u_source"]);
  outputProgram ??= linkProgram(gl, OUTPUT_FS, [
    "u_source", "u_attributes", "u_res", "u_flashProbability", "u_flashPhase", "u_flashEnabled", "u_pixelGrid",
  ]);
  const source = ensureTexture(gl, "zx-spectrum:source", input.width, input.height);
  const attributes = ensureTexture(gl, "zx-spectrum:attributes", 32, 24);
  uploadSourceTexture(gl, source, input);
  const vao = getQuadVAO(gl);
  drawPass(gl, attributes, 32, 24, attributeProgram, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.tex);
    gl.uniform1i(attributeProgram?.uniforms.u_source ?? null, 0);
  }, vao);

  resizeGLCanvas(canvas, input.width, input.height);
  const speed = Math.max(1, Math.min(50, Number(options.animSpeed) || defaults.animSpeed));
  const frame = Math.max(0, Math.floor(Number(options._frameIndex) || 0));
  drawPass(gl, null, input.width, input.height, outputProgram, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.tex);
    gl.uniform1i(outputProgram?.uniforms.u_source ?? null, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, attributes.tex);
    gl.uniform1i(outputProgram?.uniforms.u_attributes ?? null, 1);
    gl.uniform2f(outputProgram?.uniforms.u_res ?? null, input.width, input.height);
    gl.uniform1f(outputProgram?.uniforms.u_flashProbability ?? null, Math.max(0, Math.min(1, Number(options.flashProbability) || 0)));
    gl.uniform1i(outputProgram?.uniforms.u_flashPhase ?? null, spectrumFlashPhase(frame, speed));
    gl.uniform1i(outputProgram?.uniforms.u_flashEnabled ?? null, options.flashEnabled === false ? 0 : 1);
    gl.uniform1i(outputProgram?.uniforms.u_pixelGrid ?? null, options.pixelGrid === true ? 1 : 0);
  }, vao);
  const output = readoutToCanvas(canvas, input.width, input.height);
  if (!output) return input;
  logFilterBackend("ZX Spectrum", "WebGL2", "256x192 bitmap + 32x24 legal attribute map");
  return output;
};

export default defineFilter({
  name: "ZX Spectrum",
  func: zxSpectrum,
  optionTypes,
  defaults,
  options: defaults,
  description: "ZX Spectrum display with one INK/PAPER pair and one brightness bit per 8×8 cell",
  requiresGL: true,
  temporal: true,
});
