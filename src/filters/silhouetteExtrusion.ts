import { COLOR, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { nearest } from "palettes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { logFilterBackend } from "utils";
import { renderGLSinglePass } from "utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_res;
uniform float u_threshold;
uniform float u_depth;
uniform float u_angle;
uniform float u_bevel;
uniform float u_metallic;
uniform vec3 u_sideColor;
uniform vec3 u_background;

float maskAt(vec2 uv) {
  vec4 c = texture(u_source, clamp(uv, 0.0, 1.0));
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  return step(u_threshold, max(lum, 1.0 - c.a));
}

void main() {
  float a = radians(u_angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 px = 1.0 / max(u_res, vec2(1.0));
  float hit = -1.0;
  vec2 hitUv = v_uv;
  for (int i = 0; i < 64; i++) {
    float t = float(i) / 63.0;
    if (t * 64.0 > u_depth) break;
    vec2 uv = v_uv - dir * px * t * u_depth;
    if (maskAt(uv) > 0.5) { hit = t; hitUv = uv; break; }
  }
  if (hit < 0.0) {
    fragColor = vec4(u_background / 255.0, 1.0);
    return;
  }

  float center = maskAt(hitUv);
  vec2 grad = vec2(
    maskAt(hitUv + vec2(px.x, 0.0)) - maskAt(hitUv - vec2(px.x, 0.0)),
    maskAt(hitUv + vec2(0.0, px.y)) - maskAt(hitUv - vec2(0.0, px.y))
  );
  float edge = clamp(length(grad) * (0.5 + u_bevel), 0.0, 1.0);
  vec3 normal = normalize(vec3(-grad * u_bevel, 1.0));
  vec3 light = normalize(vec3(-0.45, 0.55, 0.8));
  float diffuse = 0.3 + 0.8 * max(dot(normal, light), 0.0);
  float spec = pow(max(dot(reflect(-light, normal), vec3(0.0, 0.0, 1.0)), 0.0), mix(8.0, 64.0, u_metallic));
  vec4 source = texture(u_source, hitUv);
  vec3 face = source.rgb * diffuse + spec * u_metallic;
  vec3 side = (u_sideColor / 255.0) * mix(0.35, 0.95, 1.0 - hit);
  float front = step(hit, 0.001) * center;
  vec3 rgb = mix(side, face, max(front, edge * u_bevel));
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 1], step: 0.01, default: 0.45, desc: "Luminance/alpha cutoff defining the extruded silhouette" },
  depth: { type: RANGE, range: [1, 64], step: 1, default: 24, desc: "Extrusion depth in pixels" },
  angle: { type: RANGE, range: [0, 360], step: 1, default: 135, desc: "Direction of the traced side wall" },
  bevel: { type: RANGE, range: [0, 2], step: 0.05, default: 0.8, desc: "Rounded lighting around silhouette edges" },
  metallic: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "Sharpness and strength of metallic highlights" },
  sideColor: { type: COLOR, default: [54, 42, 78], desc: "Extrusion side-wall material color" },
  background: { type: COLOR, default: [10, 11, 18], desc: "Background behind the traced slab" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  depth: optionTypes.depth.default,
  angle: optionTypes.angle.default,
  bevel: optionTypes.bevel.default,
  metallic: optionTypes.metallic.default,
  sideColor: optionTypes.sideColor.default,
  background: optionTypes.background.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const silhouetteExtrusion = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const W = input.width, H = input.height;
  const rendered = renderGLSinglePass({
    source: input, width: W, height: H, key: "silhouetteExtrusion", fragmentShader: FS,
    uniformNames: ["u_threshold", "u_depth", "u_angle", "u_bevel", "u_metallic", "u_sideColor", "u_background"],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_threshold, options.threshold);
      gl.uniform1f(u.u_depth, options.depth);
      gl.uniform1f(u.u_angle, options.angle);
      gl.uniform1f(u.u_bevel, options.bevel);
      gl.uniform1f(u.u_metallic, options.metallic);
      gl.uniform3f(u.u_sideColor, options.sideColor[0], options.sideColor[1], options.sideColor[2]);
      gl.uniform3f(u.u_background, options.background[0], options.background[1], options.background[2]);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend("Silhouette Extrusion", "WebGL2", `depth=${options.depth}${identity ? "" : "+palettePass"}`);
  return identity ? rendered : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "Silhouette Extrusion",
  func: silhouetteExtrusion,
  optionTypes,
  options: defaults,
  defaults,
  description: "Ray-trace a luminance or alpha silhouette into a bevelled 3D slab",
  requiresGL: true,
});
