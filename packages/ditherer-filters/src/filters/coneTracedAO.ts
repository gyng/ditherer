import { COLOR, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const MODE={ORIGINAL:"ORIGINAL",STONE:"STONE",AO_ONLY:"AO_ONLY"};
const FS=`#version 300 es
precision highp float;
in vec2 v_uv;out vec4 fragColor;uniform sampler2D u_source;uniform vec2 u_res;
uniform float u_height;uniform float u_radius;uniform float u_strength;uniform float u_bias;uniform int u_mode;uniform vec3 u_stoneColor;
float h(vec2 uv){return dot(texture(u_source,clamp(uv,0.0,1.0)).rgb,vec3(0.2126,0.7152,0.0722))*u_height;}
void main(){vec2 px=1.0/max(u_res,vec2(1.0));float center=h(v_uv);float occlusion=0.0;
  for(int d=0;d<8;d++){float a=float(d)*0.785398;vec2 dir=vec2(cos(a),sin(a));float horizon=-1e4;
    for(int i=1;i<=12;i++){float t=float(i)/12.0;float distancePx=t*u_radius;float slope=(h(v_uv+dir*px*distancePx)-center-u_bias)/max(distancePx,0.1);horizon=max(horizon,slope);}
    occlusion+=max(horizon,0.0);}
  float ao=exp(-occlusion*u_strength/8.0);vec4 src=texture(u_source,v_uv);vec3 base=src.rgb;
  if(u_mode==1)base=(u_stoneColor/255.0)*(0.45+center/max(u_height,0.001)*0.75);if(u_mode==2)base=vec3(1.0);
  fragColor=vec4(clamp(base*ao,0.0,1.0),src.a);}`;
export const optionTypes={
  height:{type:RANGE,range:[0.1,12],step:0.1,default:4,desc:"Luminance height scale used by the horizon cones"},
  radius:{type:RANGE,range:[2,120],step:2,default:42,desc:"Ambient-occlusion search radius in pixels"},
  strength:{type:RANGE,range:[0,12],step:0.25,default:5,desc:"Crease and contact-shadow strength"},
  bias:{type:RANGE,range:[0,1],step:0.01,default:0.08,desc:"Height bias that prevents flat surfaces self-occluding"},
  mode:{type:ENUM,options:[{name:"Original color",value:MODE.ORIGINAL},{name:"Stone material",value:MODE.STONE},{name:"AO only",value:MODE.AO_ONLY}],default:MODE.ORIGINAL,desc:"Base material beneath the occlusion"},
  stoneColor:{type:COLOR,default:[188,180,165],desc:"Relief material tint in Stone mode"},
  palette:{type:PALETTE,default:nearest,desc:"Optional output palette quantization"},
};
export const defaults={height:optionTypes.height.default,radius:optionTypes.radius.default,strength:optionTypes.strength.default,bias:optionTypes.bias.default,
  mode:optionTypes.mode.default,stoneColor:optionTypes.stoneColor.default,palette:{...optionTypes.palette.default,options:{levels:256}}};
const coneTracedAO=(input:HTMLCanvasElement|OffscreenCanvas,options=defaults)=>{const W=input.width,H=input.height;
  const rendered=renderGLSinglePass({source:input,width:W,height:H,key:"coneTracedAO",fragmentShader:FS,
    uniformNames:["u_height","u_radius","u_strength","u_bias","u_mode","u_stoneColor"],setUniforms:(gl,u)=>{
      gl.uniform1f(u.u_height,options.height);gl.uniform1f(u.u_radius,options.radius);gl.uniform1f(u.u_strength,options.strength);gl.uniform1f(u.u_bias,options.bias);
      gl.uniform1i(u.u_mode,options.mode===MODE.STONE?1:options.mode===MODE.AO_ONLY?2:0);gl.uniform3f(u.u_stoneColor,options.stoneColor[0],options.stoneColor[1],options.stoneColor[2]);}});
  if(!rendered)return input;const identity=paletteIsIdentity(options.palette);logFilterBackend("Cone-Traced AO","WebGL2",`radius=${options.radius}${identity?"":"+palettePass"}`);
  return identity?rendered:(applyPalettePassToCanvas(rendered,W,H,options.palette)??rendered);};
export default defineFilter({name:"Cone-Traced AO",func:coneTracedAO,optionTypes,options:defaults,defaults,
  description:"Horizon-trace a luminance heightfield to deepen creases and contact shadows",requiresGL:true});
