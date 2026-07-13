import { COLOR, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter } from "filters/types";
import { nearest } from "palettes";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { logFilterBackend } from "utils";
import { renderGLSinglePass } from "utils/glSinglePass";

const FS=`#version 300 es
precision highp float;
in vec2 v_uv;out vec4 fragColor;uniform sampler2D u_source;uniform vec2 u_res;uniform float u_density;uniform float u_depth;
uniform float u_detail;uniform float u_scatter;uniform float u_lightAngle;uniform float u_steps;uniform float u_time;uniform vec3 u_background;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float sampleDensity(vec3 p,out vec3 color){vec2 uv=clamp(p.xy*0.5+0.5,0.0,1.0);vec3 src=texture(u_source,vec2(uv.x,1.0-uv.y)).rgb;float image=dot(src,vec3(0.2126,0.7152,0.0722));
  float volume=max(0.0,1.0-dot(p,p)/max(u_depth*u_depth,0.01));float n=noise(p*u_detail+vec3(0.0,u_time*0.3,u_time));color=src;return max(0.0,image+n*0.55-0.48)*volume*u_density;}
void main(){vec2 screen=v_uv*2.0-1.0;screen.x*=u_res.x/max(u_res.y,1.0);float orbit=u_time*0.18;vec3 ro=vec3(sin(orbit)*2.4,0.15,cos(orbit)*2.4);vec3 forward=normalize(-ro);vec3 right=normalize(cross(forward,vec3(0,1,0)));vec3 up=cross(right,forward);
  vec3 rd=normalize(forward+right*screen.x*0.65+up*screen.y*0.65);vec3 accum=vec3(0.0);float alpha=0.0;float count=clamp(u_steps,24.0,96.0);float a=radians(u_lightAngle);vec3 light=normalize(vec3(cos(a),0.65,sin(a)));
  for(int i=0;i<96;i++){if(float(i)>=count||alpha>0.985)break;float t=float(i)/count*4.8;vec3 p=ro+rd*t;vec3 material;float d=sampleDensity(p,material);if(d<=0.001)continue;
    vec3 lc;float shadow=sampleDensity(p+light*0.16,lc)+sampleDensity(p+light*0.32,lc);float lighting=0.22+u_scatter*exp(-shadow*0.8);float stepAlpha=1.0-exp(-d*0.085);accum+=(1.0-alpha)*material*lighting*stepAlpha;alpha+=(1.0-alpha)*stepAlpha;}
  vec3 bg=u_background/255.0;fragColor=vec4(clamp(accum+bg*(1.0-alpha),0.0,1.0),1.0);}`;
export const optionTypes={density:{type:RANGE,range:[0.1,8],step:0.1,default:2.8,desc:"Optical density of the source-shaped cloud"},depth:{type:RANGE,range:[0.5,2],step:0.05,default:1.1,desc:"Depth of the sculpted volume"},
  detail:{type:RANGE,range:[0.5,12],step:0.25,default:4,desc:"Scale of internal turbulent cloud detail"},scatter:{type:RANGE,range:[0,3],step:0.05,default:1.15,desc:"Light scattering through low-density regions"},
  lightAngle:{type:RANGE,range:[0,360],step:1,default:45,desc:"Direction of the volumetric light"},steps:{type:RANGE,range:[24,96],step:8,default:64,desc:"Volume-integration sample count"},
  speed:{type:RANGE,range:[0,2],step:0.05,default:0.35,desc:"Camera orbit and cloud-evolution speed"},background:{type:COLOR,default:[9,12,28],desc:"Color behind the cloud sculpture"},
  palette:{type:PALETTE,default:nearest,desc:"Optional output palette quantization"},};
export const defaults={density:optionTypes.density.default,depth:optionTypes.depth.default,detail:optionTypes.detail.default,scatter:optionTypes.scatter.default,lightAngle:optionTypes.lightAngle.default,
  steps:optionTypes.steps.default,speed:optionTypes.speed.default,background:optionTypes.background.default,palette:{...optionTypes.palette.default,options:{levels:256}}};
const volumetricCloudSculpture=(input:HTMLCanvasElement|OffscreenCanvas,options=defaults)=>{const runtime=options as typeof defaults&{_frameIndex?:number};const W=input.width,H=input.height;
  const rendered=renderGLSinglePass({source:input,width:W,height:H,key:"volumetricCloudSculpture",fragmentShader:FS,uniformNames:["u_density","u_depth","u_detail","u_scatter","u_lightAngle","u_steps","u_time","u_background"],
    setUniforms:(gl,u)=>{gl.uniform1f(u.u_density,options.density);gl.uniform1f(u.u_depth,options.depth);gl.uniform1f(u.u_detail,options.detail);gl.uniform1f(u.u_scatter,options.scatter);gl.uniform1f(u.u_lightAngle,options.lightAngle);
      gl.uniform1f(u.u_steps,options.steps);gl.uniform1f(u.u_time,(runtime._frameIndex??0)*options.speed*0.025);gl.uniform3f(u.u_background,options.background[0],options.background[1],options.background[2]);}});
  if(!rendered)return input;const identity=paletteIsIdentity(options.palette);logFilterBackend("Volumetric Cloud Sculpture","WebGL2",`${options.steps} steps${identity?"":"+palettePass"}`);
  return identity?rendered:(applyPalettePassToCanvas(rendered,W,H,options.palette)??rendered);};
export default defineFilter({name:"Volumetric Cloud Sculpture",func:volumetricCloudSculpture,optionTypes,options:defaults,defaults,
  description:"Integrate source luminance and color into an animated three-dimensional cloud statue",temporal:true,autoAnimate:true,autoAnimateFps:30,requiresGL:true});
