import { COLOR, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { nearest } from "palettes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { logFilterBackend } from "utils";
import { renderGLSinglePass } from "utils/glSinglePass";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_source; uniform vec2 u_res; uniform float u_thickness;
uniform float u_radius; uniform float u_translucency; uniform float u_lightAngle;
uniform float u_backlight; uniform vec3 u_waxColor;
float lum(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}
void main(){
  vec2 px=1.0/max(u_res,vec2(1.0));float a=radians(u_lightAngle);vec2 dir=vec2(cos(a),sin(a));
  vec4 src=texture(u_source,v_uv);float localThickness=(1.0-lum(src.rgb))*u_thickness+0.15;
  vec3 transmitted=vec3(0.0);float weight=0.0;
  for(int i=1;i<=32;i++){float t=float(i)/32.0;float w=exp(-t*t*4.0/localThickness);
    vec2 offset=dir*px*u_radius*t+vec2(-dir.y,dir.x)*px*sin(float(i)*2.399)*u_radius*t*0.22;
    transmitted+=texture(u_source,clamp(v_uv+offset,0.0,1.0)).rgb*w;weight+=w;}
  transmitted/=max(weight,0.001);
  float edge=length(vec2(lum(texture(u_source,v_uv+vec2(px.x,0)).rgb)-lum(texture(u_source,v_uv-vec2(px.x,0)).rgb),
                         lum(texture(u_source,v_uv+vec2(0,px.y)).rgb)-lum(texture(u_source,v_uv-vec2(0,px.y)).rgb)));
  float glow=(1.0-localThickness/(u_thickness+0.15))*u_backlight+edge*u_backlight*2.0;
  vec3 scatter=transmitted*(u_waxColor/255.0)*(0.8+glow);
  vec3 rgb=mix(src.rgb,scatter,u_translucency)+vec3(1.0,0.38,0.18)*glow*0.18;
  fragColor=vec4(clamp(rgb,0.0,1.0),src.a);
}`;
export const optionTypes={
  thickness:{type:RANGE,range:[0.1,4],step:0.1,default:1.5,desc:"Optical thickness inferred from dark source regions"},
  radius:{type:RANGE,range:[1,80],step:1,default:24,desc:"Subsurface scattering distance in pixels"},
  translucency:{type:RANGE,range:[0,1],step:0.05,default:0.72,desc:"Blend between source color and transmitted wax light"},
  lightAngle:{type:RANGE,range:[0,360],step:1,default:35,desc:"Direction from which light enters the material"},
  backlight:{type:RANGE,range:[0,3],step:0.05,default:1.1,desc:"Warm transmitted glow through thin edges"},
  waxColor:{type:COLOR,default:[255,176,142],desc:"Scattering tint for wax, skin, jade, or resin"},
  palette:{type:PALETTE,default:nearest,desc:"Optional output palette quantization"},
};
export const defaults={thickness:optionTypes.thickness.default,radius:optionTypes.radius.default,translucency:optionTypes.translucency.default,
  lightAngle:optionTypes.lightAngle.default,backlight:optionTypes.backlight.default,waxColor:optionTypes.waxColor.default,
  palette:{...optionTypes.palette.default,options:{levels:256}}};
const subsurfaceWax=(input:HTMLCanvasElement|OffscreenCanvas,options=defaults)=>{const W=input.width,H=input.height;
  const rendered=renderGLSinglePass({source:input,width:W,height:H,key:"subsurfaceWax",fragmentShader:FS,
    uniformNames:["u_thickness","u_radius","u_translucency","u_lightAngle","u_backlight","u_waxColor"],setUniforms:(gl,u)=>{
      gl.uniform1f(u.u_thickness,options.thickness);gl.uniform1f(u.u_radius,options.radius);gl.uniform1f(u.u_translucency,options.translucency);
      gl.uniform1f(u.u_lightAngle,options.lightAngle);gl.uniform1f(u.u_backlight,options.backlight);gl.uniform3f(u.u_waxColor,options.waxColor[0],options.waxColor[1],options.waxColor[2]);}});
  if(!rendered)return input;const identity=paletteIsIdentity(options.palette);logFilterBackend("Subsurface Wax","WebGL2",`radius=${options.radius}${identity?"":"+palettePass"}`);
  return identity?rendered:(applyPalettePassToCanvas(rendered,W,H,options.palette)??rendered);};
export default defineFilter({name:"Subsurface Wax",func:subsurfaceWax,optionTypes,options:defaults,defaults,
  description:"Diffuse light beneath the source surface like wax, skin, jade, or stained resin",requiresGL:true});
