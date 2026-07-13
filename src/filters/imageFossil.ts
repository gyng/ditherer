import { COLOR, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { nearest } from "palettes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { logFilterBackend } from "utils";
import { renderGLSinglePass } from "utils/glSinglePass";

const FS=`#version 300 es
precision highp float;
in vec2 v_uv;out vec4 fragColor;uniform sampler2D u_source;uniform vec2 u_res;uniform float u_depth;uniform float u_strata;
uniform float u_cracks;uniform float u_mineral;uniform float u_lightAngle;uniform vec3 u_stoneColor;uniform vec3 u_fossilColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float h(vec2 uv){vec3 c=texture(u_source,clamp(uv,0.0,1.0)).rgb;return dot(c,vec3(0.2126,0.7152,0.0722));}
void main(){vec2 px=1.0/max(u_res,vec2(1.0));float center=h(v_uv);vec2 grad=vec2(h(v_uv+vec2(px.x,0))-h(v_uv-vec2(px.x,0)),h(v_uv+vec2(0,px.y))-h(v_uv-vec2(0,px.y)));
  vec3 n=normalize(vec3(-grad*u_depth,1.0));float a=radians(u_lightAngle);vec3 light=normalize(vec3(cos(a),sin(a),0.75));float diffuse=0.3+0.85*max(dot(n,light),0.0);
  float bands=0.5+0.5*sin((v_uv.y+center*0.09+noise(v_uv*7.0)*0.025)*u_strata*6.28318);bands=smoothstep(0.2,0.8,bands);
  vec2 cell=floor(v_uv*u_cracks*12.0);vec2 f=fract(v_uv*u_cracks*12.0);float nearestEdge=1.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 o=vec2(x,y);vec2 point=o+vec2(hash(cell+o),hash(cell+o+19.7));nearestEdge=min(nearestEdge,abs(length(f-point)-0.32));}
  float crack=1.0-smoothstep(0.008,0.035,nearestEdge);float fossilEdge=smoothstep(0.02,0.0,length(grad));float imprint=smoothstep(0.18,0.78,center)*(0.55+fossilEdge*0.45);
  vec3 stone=(u_stoneColor/255.0)*mix(0.72,1.1,bands);vec3 fossil=(u_fossilColor/255.0)*(0.45+center*0.85);vec3 rgb=mix(stone,fossil,imprint);
  rgb*=diffuse;rgb=mix(rgb,vec3(0.05,0.035,0.025),crack);rgb+=vec3(0.18,0.42,0.52)*crack*u_mineral;fragColor=vec4(clamp(rgb,0.0,1.0),1.0);}`;
export const optionTypes={depth:{type:RANGE,range:[0.1,12],step:0.1,default:4.5,desc:"Depth of the embedded luminance relief"},strata:{type:RANGE,range:[2,40],step:1,default:14,desc:"Number and tightness of sediment layers"},
  cracks:{type:RANGE,range:[0.1,3],step:0.1,default:1.2,desc:"Density of cellular stone fractures"},mineral:{type:RANGE,range:[0,3],step:0.05,default:0.55,desc:"Blue mineral emission inside cracks"},
  lightAngle:{type:RANGE,range:[0,360],step:1,default:135,desc:"Directional light across the fossil relief"},stoneColor:{type:COLOR,default:[172,151,117],desc:"Sedimentary stone color"},
  fossilColor:{type:COLOR,default:[92,70,48],desc:"Color of the embedded source impression"},palette:{type:PALETTE,default:nearest,desc:"Optional output palette quantization"},};
export const defaults={depth:optionTypes.depth.default,strata:optionTypes.strata.default,cracks:optionTypes.cracks.default,mineral:optionTypes.mineral.default,lightAngle:optionTypes.lightAngle.default,
  stoneColor:optionTypes.stoneColor.default,fossilColor:optionTypes.fossilColor.default,palette:{...optionTypes.palette.default,options:{levels:256}}};
const imageFossil=(input:HTMLCanvasElement|OffscreenCanvas,options=defaults)=>{const W=input.width,H=input.height;const rendered=renderGLSinglePass({source:input,width:W,height:H,key:"imageFossil",fragmentShader:FS,
  uniformNames:["u_depth","u_strata","u_cracks","u_mineral","u_lightAngle","u_stoneColor","u_fossilColor"],setUniforms:(gl,u)=>{gl.uniform1f(u.u_depth,options.depth);gl.uniform1f(u.u_strata,options.strata);
    gl.uniform1f(u.u_cracks,options.cracks);gl.uniform1f(u.u_mineral,options.mineral);gl.uniform1f(u.u_lightAngle,options.lightAngle);gl.uniform3f(u.u_stoneColor,options.stoneColor[0],options.stoneColor[1],options.stoneColor[2]);
    gl.uniform3f(u.u_fossilColor,options.fossilColor[0],options.fossilColor[1],options.fossilColor[2]);}});if(!rendered)return input;const identity=paletteIsIdentity(options.palette);
  logFilterBackend("Image Fossil","WebGL2",`strata=${options.strata}${identity?"":"+palettePass"}`);return identity?rendered:(applyPalettePassToCanvas(rendered,W,H,options.palette)??rendered);};
export default defineFilter({name:"Image Fossil",func:imageFossil,optionTypes,options:defaults,defaults,
  description:"Compress source structure into cracked sediment, mineral veins, and fossil relief",requiresGL:true});
