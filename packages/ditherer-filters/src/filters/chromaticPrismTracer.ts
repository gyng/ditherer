import { PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;out vec4 fragColor;uniform sampler2D u_source;uniform vec2 u_res;uniform vec2 u_center;
uniform float u_size;uniform float u_angle;uniform float u_ior;uniform float u_dispersion;uniform float u_reflections;uniform float u_blend;
vec2 rotate2(vec2 p,float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c)*p;}
float triangleSdf(vec2 p){const float k=1.7320508;p.x=abs(p.x)-1.0;p.y=p.y+0.5773503;if(p.x+k*p.y>0.0)p=vec2(p.x-k*p.y,-k*p.x-p.y)/2.0;p.x-=clamp(p.x,-2.0,0.0);return -length(p)*sign(p.y);}
vec2 traceChannel(vec2 local,float eta){vec2 direction=normalize(vec2(0.32+eta*0.08,-0.95));vec2 p=local;
  for(int i=0;i<28;i++){float d=triangleSdf(p);if(d>0.0&&i>0)break;p+=direction*max(0.012,abs(d)*0.32);if(float(i)<u_reflections*5.0&&abs(d)<0.025)direction=reflect(direction,normalize(p+vec2(0.0001)));}
  return p;}
void main(){float a=radians(u_angle);vec2 aspect=vec2(u_res.x/max(u_res.y,1.0),1.0);vec2 local=rotate2((v_uv-u_center)*aspect/u_size,-a);
  float sdf=triangleSdf(local);vec4 src=texture(u_source,v_uv);if(sdf>0.0){fragColor=src;return;}
  vec2 pr=traceChannel(local,u_ior-u_dispersion*0.08);vec2 pg=traceChannel(local,u_ior);vec2 pb=traceChannel(local,u_ior+u_dispersion*0.08);
  vec2 ur=u_center+rotate2(pr,a)*u_size/aspect;vec2 ug=u_center+rotate2(pg,a)*u_size/aspect;vec2 ub=u_center+rotate2(pb,a)*u_size/aspect;
  vec3 spectrum=vec3(texture(u_source,clamp(ur,0.0,1.0)).r,texture(u_source,clamp(ug,0.0,1.0)).g,texture(u_source,clamp(ub,0.0,1.0)).b);
  float edge=exp(-abs(sdf)*18.0);vec3 rgb=mix(src.rgb,spectrum,u_blend)+edge*vec3(0.35,0.5,0.8);fragColor=vec4(clamp(rgb,0.0,1.0),src.a);}`;
export const optionTypes = {
  centerX: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Horizontal prism position",
  },
  centerY: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Vertical prism position",
  },
  size: {
    type: RANGE,
    range: [0.1, 0.9],
    step: 0.01,
    default: 0.48,
    desc: "Triangular prism size",
  },
  angle: { type: RANGE, range: [-180, 180], step: 1, default: 0, desc: "Prism rotation" },
  ior: {
    type: RANGE,
    range: [1.01, 2.5],
    step: 0.01,
    default: 1.52,
    desc: "Base glass index of refraction",
  },
  dispersion: {
    type: RANGE,
    range: [0, 3],
    step: 0.05,
    default: 1.1,
    desc: "Wavelength-dependent ray separation",
  },
  reflections: {
    type: RANGE,
    range: [0, 4],
    step: 1,
    default: 1,
    desc: "Approximate internal reflection count",
  },
  blend: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.9,
    desc: "Strength of the traced spectral image",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};
export const defaults = {
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  size: optionTypes.size.default,
  angle: optionTypes.angle.default,
  ior: optionTypes.ior.default,
  dispersion: optionTypes.dispersion.default,
  reflections: optionTypes.reflections.default,
  blend: optionTypes.blend.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};
const chromaticPrismTracer = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "chromaticPrismTracer",
    fragmentShader: FS,
    uniformNames: [
      "u_center",
      "u_size",
      "u_angle",
      "u_ior",
      "u_dispersion",
      "u_reflections",
      "u_blend",
    ],
    setUniforms: (gl, u) => {
      gl.uniform2f(u.u_center, options.centerX, 1 - options.centerY);
      gl.uniform1f(u.u_size, options.size);
      gl.uniform1f(u.u_angle, options.angle);
      gl.uniform1f(u.u_ior, options.ior);
      gl.uniform1f(u.u_dispersion, options.dispersion);
      gl.uniform1f(u.u_reflections, options.reflections);
      gl.uniform1f(u.u_blend, options.blend);
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend(
    "Chromatic Prism Tracer",
    "WebGL2",
    `ior=${options.ior}${identity ? "" : "+palettePass"}`,
  );
  return identity
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};
export default defineFilter({
  name: "Chromatic Prism Tracer",
  func: chromaticPrismTracer,
  optionTypes,
  options: defaults,
  defaults,
  description: "Trace separate red, green, and blue rays through a virtual triangular prism",
  requiresGL: true,
});
