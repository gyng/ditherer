import { COLOR, ENUM, RANGE } from "../constants/controlTypes";
import { logFilterBackend } from "../utils/index";
import { renderSdfEffect, SDF_GLSL } from "../utils/sdfJumpFlood";
import { defineFilter } from "./types";

const OPERATION = {
  UNION: "UNION",
  INTERSECTION: "INTERSECTION",
  SUBTRACT_PRIMITIVE: "SUBTRACT_PRIMITIVE",
  SUBTRACT_SOURCE: "SUBTRACT_SOURCE",
  SMOOTH_UNION: "SMOOTH_UNION",
};
const SHAPE = { CIRCLE: "CIRCLE", BOX: "BOX", DIAMOND: "DIAMOND", CAPSULE: "CAPSULE" };

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_sdf;
uniform vec2 u_res;
uniform float u_threshold;
uniform int u_operation;
uniform int u_shape;
uniform vec2 u_center;
uniform float u_size;
uniform float u_aspect;
uniform float u_angle;
uniform float u_rounding;
uniform float u_smoothness;
uniform float u_edgeWidth;
uniform float u_sourceMix;
uniform vec3 u_insideColor;
uniform vec3 u_edgeColor;
uniform vec3 u_outsideColor;

${SDF_GLSL}

float roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - max(vec2(0.5), halfSize - radius);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float capsule(vec2 p, float halfLength, float radius) {
  p.y -= clamp(p.y, -halfLength, halfLength);
  return length(p) - radius;
}

float primitiveDistance(vec2 pixel) {
  float scale = min(u_res.x, u_res.y);
  vec2 p = pixel - u_center * u_res;
  float c = cos(u_angle), s = sin(u_angle);
  p = mat2(c, -s, s, c) * p;
  float sizePx = max(1.0, u_size * scale);
  float aspect = max(0.2, u_aspect);
  if (u_shape == 0) return length(p / vec2(aspect, 1.0)) - sizePx;
  if (u_shape == 1) {
    vec2 halfSize = vec2(sizePx * aspect, sizePx);
    return roundedBox(p, halfSize, min(halfSize.x, halfSize.y) * u_rounding);
  }
  if (u_shape == 2) return (abs(p.x) / aspect + abs(p.y)) * 0.70710678 - sizePx;
  return capsule(p, sizePx * aspect, max(1.0, sizePx * (0.18 + 0.32 * u_rounding)));
}

float smoothMinimum(float a, float b, float radius) {
  if (radius <= 0.001) return min(a, b);
  float h = clamp(0.5 + 0.5 * (b - a) / radius, 0.0, 1.0);
  return mix(b, a, h) - radius * h * (1.0 - h);
}

void main() {
  ivec2 p = ivec2(floor(v_uv * u_res));
  float sourceDistance = signedDistanceAt(u_sdf, u_source, p, u_res, u_threshold);
  float primitive = primitiveDistance(vec2(p) + 0.5);
  float field;
  if (u_operation == 0) field = min(sourceDistance, primitive);
  else if (u_operation == 1) field = max(sourceDistance, primitive);
  else if (u_operation == 2) field = max(sourceDistance, -primitive);
  else if (u_operation == 3) field = max(primitive, -sourceDistance);
  else field = smoothMinimum(sourceDistance, primitive, u_smoothness);

  vec3 sourceColor = texelFetch(u_source, p, 0).rgb;
  vec3 interior = mix(u_insideColor / 255.0, sourceColor, u_sourceMix);
  float coverage = 1.0 - smoothstep(-0.75, 0.75, field);
  float edge = 1.0 - smoothstep(max(0.0, u_edgeWidth - 0.75), u_edgeWidth + 0.75, abs(field));
  vec3 color = mix(u_outsideColor / 255.0, interior, coverage);
  color = mix(color, u_edgeColor / 255.0, edge);
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export const optionTypes = {
  operation: {
    type: ENUM,
    options: [
      { name: "Union", value: OPERATION.UNION },
      { name: "Intersection", value: OPERATION.INTERSECTION },
      { name: "Cut primitive from source", value: OPERATION.SUBTRACT_PRIMITIVE },
      { name: "Cut source from primitive", value: OPERATION.SUBTRACT_SOURCE },
      { name: "Smooth union", value: OPERATION.SMOOTH_UNION },
    ],
    default: OPERATION.SMOOTH_UNION,
    desc: "Constructive field operation between the source silhouette and primitive",
  },
  shape: {
    type: ENUM,
    options: [
      { name: "Circle", value: SHAPE.CIRCLE },
      { name: "Rounded box", value: SHAPE.BOX },
      { name: "Diamond", value: SHAPE.DIAMOND },
      { name: "Capsule", value: SHAPE.CAPSULE },
    ],
    default: SHAPE.CIRCLE,
    desc: "Analytic signed-distance primitive to combine with the source",
  },
  threshold: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Luminance threshold defining the source silhouette",
  },
  centerX: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.58,
    desc: "Primitive horizontal center",
  },
  centerY: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Primitive vertical center",
  },
  size: {
    type: RANGE,
    range: [0.02, 0.75],
    step: 0.01,
    default: 0.28,
    desc: "Primitive radius relative to the shorter image side",
  },
  aspect: {
    type: RANGE,
    range: [0.2, 3],
    step: 0.05,
    default: 1,
    desc: "Primitive horizontal stretch or capsule length",
  },
  angle: {
    type: RANGE,
    range: [-180, 180],
    step: 1,
    default: 0,
    desc: "Primitive rotation in degrees",
  },
  rounding: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.35,
    desc: "Corner radius or capsule thickness",
  },
  smoothness: {
    type: RANGE,
    range: [0, 96],
    step: 1,
    default: 24,
    desc: "Blend radius for smooth union",
  },
  edgeWidth: {
    type: RANGE,
    range: [0, 24],
    step: 0.5,
    default: 2,
    desc: "Outline width around the composed zero contour",
  },
  sourceMix: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.75,
    desc: "Amount of original image color inside the result",
  },
  insideColor: {
    type: COLOR,
    default: [224, 92, 118],
    desc: "Solid color mixed into the composed interior",
  },
  edgeColor: { type: COLOR, default: [255, 236, 190], desc: "Color of the composed zero contour" },
  outsideColor: { type: COLOR, default: [12, 14, 24], desc: "Color outside the composed field" },
};

export const defaults = Object.fromEntries(
  Object.entries(optionTypes).map(([key, option]) => [key, option.default]),
) as { [K in keyof typeof optionTypes]: (typeof optionTypes)[K]["default"] };

const OPERATION_ID: Record<string, number> = {
  UNION: 0,
  INTERSECTION: 1,
  SUBTRACT_PRIMITIVE: 2,
  SUBTRACT_SOURCE: 3,
  SMOOTH_UNION: 4,
};
const SHAPE_ID: Record<string, number> = { CIRCLE: 0, BOX: 1, DIAMOND: 2, CAPSULE: 3 };

const sdfBooleanSculpt = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const rendered = renderSdfEffect({
    source: input,
    width: input.width,
    height: input.height,
    key: "sdfBooleanSculpt",
    threshold: options.threshold,
    fragmentShader: FS,
    uniformNames: [
      "u_operation",
      "u_shape",
      "u_center",
      "u_size",
      "u_aspect",
      "u_angle",
      "u_rounding",
      "u_smoothness",
      "u_edgeWidth",
      "u_sourceMix",
      "u_insideColor",
      "u_edgeColor",
      "u_outsideColor",
    ],
    setUniforms: (gl, uniforms) => {
      gl.uniform1i(uniforms.u_operation, OPERATION_ID[options.operation] ?? 0);
      gl.uniform1i(uniforms.u_shape, SHAPE_ID[options.shape] ?? 0);
      gl.uniform2f(uniforms.u_center, options.centerX, options.centerY);
      gl.uniform1f(uniforms.u_size, options.size);
      gl.uniform1f(uniforms.u_aspect, options.aspect);
      gl.uniform1f(uniforms.u_angle, (options.angle * Math.PI) / 180);
      gl.uniform1f(uniforms.u_rounding, options.rounding);
      gl.uniform1f(uniforms.u_smoothness, options.smoothness);
      gl.uniform1f(uniforms.u_edgeWidth, options.edgeWidth);
      gl.uniform1f(uniforms.u_sourceMix, options.sourceMix);
      gl.uniform3f(
        uniforms.u_insideColor,
        options.insideColor[0],
        options.insideColor[1],
        options.insideColor[2],
      );
      gl.uniform3f(
        uniforms.u_edgeColor,
        options.edgeColor[0],
        options.edgeColor[1],
        options.edgeColor[2],
      );
      gl.uniform3f(
        uniforms.u_outsideColor,
        options.outsideColor[0],
        options.outsideColor[1],
        options.outsideColor[2],
      );
    },
  });
  if (!rendered) return input;
  logFilterBackend("SDF Boolean Sculpt", "WebGL2", `${options.operation}/${options.shape}`);
  return rendered;
};

export default defineFilter({
  name: "SDF Boolean Sculpt",
  func: sdfBooleanSculpt,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Sculpt a source silhouette with analytic SDF union, intersection, subtraction, and smooth blending",
  requiresGL: true,
});
