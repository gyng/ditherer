import { COLOR, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

const FS=`#version 300 es
precision highp float;
in vec2 v_uv;out vec4 fragColor;uniform sampler2D u_source;uniform vec2 u_res;
uniform float u_recursion;uniform float u_twist;uniform float u_scale;uniform float u_glow;uniform float u_steps;uniform float u_time;uniform vec3 u_portalColor;
vec3 foldHall(vec3 p){float cell=floor((p.z+2.0)/4.0);float a=cell*u_twist;float c=cos(a),s=sin(a);p.xy=mat2(c,-s,s,c)*p.xy*pow(u_scale,mod(abs(cell),max(1.0,u_recursion)));p.z=mod(p.z+2.0,4.0)-2.0;return p;}
float scene(vec3 p,out float portal){vec3 q=foldHall(p);float wall=min(1.25-abs(q.x),0.78-abs(q.y));
  float ring=abs(length(q.xy)-0.55);float plane=abs(q.z-1.82);float frame=max(ring-0.075,plane-0.045);portal=exp(-ring*22.0)*exp(-plane*35.0);
  return min(wall,frame);}
vec2 materialUv(vec3 p){vec3 q=foldHall(p);float side=abs(q.x)>abs(q.y)?q.y:q.x;return fract(vec2(side*0.45+0.5,p.z*0.14));}
void main(){vec2 screen=v_uv*2.0-1.0;screen.x*=u_res.x/max(u_res.y,1.0);vec3 ro=vec3(0.0,0.0,u_time);
  vec3 rd=normalize(vec3(screen*0.72,1.0));float travel=0.0;float portal=0.0;float portalAccum=0.0;vec3 p=ro;bool hit=false;float count=clamp(u_steps,24.0,96.0);
  for(int i=0;i<96;i++){if(float(i)>=count)break;p=ro+rd*travel;float marker;float d=scene(p,marker);portalAccum+=marker*0.025;if(d<0.002){portal=marker;hit=true;break;}travel+=max(0.006,d*0.62);if(travel>18.0)break;}
  if(!hit){fragColor=vec4((u_portalColor/255.0)*portalAccum,1.0);return;}vec3 material=texture(u_source,materialUv(p)).rgb;
  float e=0.003,m;vec3 n=normalize(vec3(scene(p+vec3(e,0,0),m)-scene(p-vec3(e,0,0),m),scene(p+vec3(0,e,0),m)-scene(p-vec3(0,e,0),m),scene(p+vec3(0,0,e),m)-scene(p-vec3(0,0,e),m)));
  vec3 light=normalize(vec3(-0.4,0.6,-0.8));float diffuse=0.18+0.85*max(dot(n,light),0.0);float fog=exp(-travel*0.055);
  vec3 rgb=material*diffuse*fog+(u_portalColor/255.0)*(portal*u_glow+portalAccum);fragColor=vec4(clamp(rgb,0.0,1.0),1.0);}`;
export const optionTypes={
  recursion:{type:RANGE,range:[1,8],step:1,default:4,desc:"Number of repeating portal-scale states"},twist:{type:RANGE,range:[-2,2],step:0.05,default:0.35,desc:"Rotation applied each time the hall repeats"},
  scale:{type:RANGE,range:[0.75,1.25],step:0.01,default:0.94,desc:"Non-Euclidean scale change between portal cells"},glow:{type:RANGE,range:[0,4],step:0.1,default:1.6,desc:"Portal-frame emission strength"},
  steps:{type:RANGE,range:[24,96],step:8,default:72,desc:"Maximum corridor ray-march steps"},speed:{type:RANGE,range:[0,3],step:0.05,default:0.55,desc:"Forward travel speed through the hall"},
  portalColor:{type:COLOR,default:[112,82,255],desc:"Portal frame and recursive fog color"},palette:{type:PALETTE,default:nearest,desc:"Optional output palette quantization"},};
export const defaults={recursion:optionTypes.recursion.default,twist:optionTypes.twist.default,scale:optionTypes.scale.default,glow:optionTypes.glow.default,steps:optionTypes.steps.default,
  speed:optionTypes.speed.default,portalColor:optionTypes.portalColor.default,palette:{...optionTypes.palette.default,options:{levels:256}}};
const portalHall=(input:HTMLCanvasElement|OffscreenCanvas,options=defaults)=>{const runtime=options as typeof defaults&{_frameIndex?:number};const W=input.width,H=input.height;
  const rendered=renderGLSinglePass({source:input,width:W,height:H,key:"portalHall",fragmentShader:FS,uniformNames:["u_recursion","u_twist","u_scale","u_glow","u_steps","u_time","u_portalColor"],
    setUniforms:(gl,u)=>{gl.uniform1f(u.u_recursion,options.recursion);gl.uniform1f(u.u_twist,options.twist);gl.uniform1f(u.u_scale,options.scale);gl.uniform1f(u.u_glow,options.glow);
      gl.uniform1f(u.u_steps,options.steps);gl.uniform1f(u.u_time,(runtime._frameIndex??0)*options.speed*0.035);gl.uniform3f(u.u_portalColor,options.portalColor[0],options.portalColor[1],options.portalColor[2]);}});
  if(!rendered)return input;const identity=paletteIsIdentity(options.palette);logFilterBackend("Portal Hall","WebGL2",`recursion=${options.recursion}${identity?"":"+palettePass"}`);
  return identity?rendered:(applyPalettePassToCanvas(rendered,W,H,options.palette)??rendered);};
export default defineFilter({name:"Portal Hall",func:portalHall,optionTypes,options:defaults,defaults,
  description:"Travel through a source-textured corridor of twisting, scale-changing portals",temporal:true,autoAnimate:true,autoAnimateFps:30,requiresGL:true});
