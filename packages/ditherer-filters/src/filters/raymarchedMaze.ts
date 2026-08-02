import { COLOR, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderGLSinglePass } from "../utils/glSinglePass";

export type MazeCell = { x: number; y: number };

const mazeHash = (cell: MazeCell, seed: number) => {
  const phase = (cell.x + seed) * 127.1 + (cell.y + seed) * 311.7;
  const value = Math.sin(phase) * 43758.5453;
  return value - Math.floor(value);
};

export const traceMazeSolution = (grid: number, seed: number): MazeCell[] => {
  const size = Math.max(1, Math.floor(grid));
  const route: MazeCell[] = [{ x: 0, y: 0 }];
  let cell = route[0];

  while (cell.x < size - 1 || cell.y < size - 1) {
    const opensEast = cell.y >= size - 1 || (cell.x < size - 1 && mazeHash(cell, seed) < 0.5);
    cell = opensEast ? { x: cell.x + 1, y: cell.y } : { x: cell.x, y: cell.y + 1 };
    route.push(cell);
  }

  return route;
};

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;out vec4 fragColor;uniform sampler2D u_source;uniform vec2 u_res;uniform float u_grid;uniform float u_seed;uniform float u_journey;
uniform float u_speed;uniform float u_wallHeight;uniform float u_fog;uniform float u_steps;uniform float u_time;uniform vec3 u_torchColor;
float hash(vec2 p){return fract(sin(dot(p+u_seed,vec2(127.1,311.7)))*43758.5453);}bool openEast(vec2 c){if(c.y>=u_grid-1.0)return true;if(c.x>=u_grid-1.0)return false;return hash(c)<0.5;}
bool openNorth(vec2 c){return !openEast(c);}vec2 routePosition(float progress,out vec2 heading){vec2 c=vec2(0.0);float total=max(1.0,2.0*u_grid-2.0);float target=clamp(progress,0.0,0.9999)*total;heading=vec2(1,0);
  for(int i=0;i<48;i++){if(float(i)>=total)break;vec2 next=openEast(c)?vec2(1,0):vec2(0,1);if(float(i)<=target&&target<float(i)+1.0){heading=next;return c+vec2(0.5)+next*fract(target);}c+=next;}return c+vec2(0.5);}
float wallDistance(vec3 p){if(p.x<0.0||p.z<0.0||p.x>u_grid||p.z>u_grid)return 0.0;vec2 c=floor(p.xz);vec2 f=fract(p.xz);float d=1e4;
  if(!openEast(c))d=min(d,1.0-f.x);if(c.x<=0.0||!openEast(c-vec2(1,0)))d=min(d,f.x);if(!openNorth(c))d=min(d,1.0-f.y);if(c.y<=0.0||!openNorth(c-vec2(0,1)))d=min(d,f.y);
  d=min(d,p.y);d=min(d,u_wallHeight-p.y);return d;}
void main(){float travelProgress=fract(u_journey+u_time*u_speed*0.003);vec2 heading;vec2 pos=routePosition(travelProgress,heading);float angle=atan(heading.y,heading.x);vec3 ro=vec3(pos.x,0.42,pos.y);
  vec2 screen=v_uv*2.0-1.0;screen.x*=u_res.x/max(u_res.y,1.0);vec3 forward=vec3(cos(angle),0,sin(angle));vec3 right=vec3(-sin(angle),0,cos(angle));vec3 rd=normalize(forward+right*screen.x*0.72+vec3(0,screen.y*0.62,0));
  float travel=0.0;vec3 p=ro;bool hit=false;float count=clamp(u_steps,24.0,96.0);for(int i=0;i<96;i++){if(float(i)>=count)break;p=ro+rd*travel;float d=wallDistance(p);if(d<0.003){hit=true;break;}travel+=max(0.008,d*0.62);if(travel>18.0)break;}
  vec3 exitPos=vec3(u_grid-0.35,0.5,u_grid-0.35);float beacon=0.025/max(0.015,length(cross(exitPos-ro,rd))/max(length(exitPos-ro),0.01));
  if(!hit){fragColor=vec4(clamp((u_torchColor/255.0)*beacon,0.0,1.0),1.0);return;}vec2 wallUv=fract(vec2(p.x+p.z,p.y)*vec2(0.18,1.0));vec3 material=texture(u_source,wallUv).rgb;
  float e=0.004;vec3 n=normalize(vec3(wallDistance(p+vec3(e,0,0))-wallDistance(p-vec3(e,0,0)),wallDistance(p+vec3(0,e,0))-wallDistance(p-vec3(0,e,0)),wallDistance(p+vec3(0,0,e))-wallDistance(p-vec3(0,0,e))));
  vec3 lightDir=normalize(ro-p);float diffuse=0.16+0.9*max(dot(n,lightDir),0.0);float attenuation=1.0/(1.0+travel*travel*0.12);float fogMix=1.0-exp(-travel*u_fog);
  vec3 rgb=material*diffuse*attenuation+(u_torchColor/255.0)*(0.08+beacon);rgb=mix(rgb,vec3(0.015,0.02,0.035),fogMix);fragColor=vec4(clamp(rgb,0.0,1.0),1.0);}`;
export const optionTypes = {
  grid: {
    type: RANGE,
    range: [6, 24],
    step: 1,
    default: 12,
    desc: "Maze width and height in cells",
  },
  seed: {
    type: RANGE,
    range: [0, 999],
    step: 1,
    default: 37,
    desc: "Deterministic binary-tree maze layout seed",
  },
  journey: {
    type: RANGE,
    range: [0, 1],
    step: 0.005,
    default: 0,
    desc: "Manual position along the guaranteed route to the exit",
  },
  speed: {
    type: RANGE,
    range: [0, 3],
    step: 0.05,
    default: 0.45,
    desc: "Automatic movement along the solution route",
  },
  wallHeight: {
    type: RANGE,
    range: [0.5, 2],
    step: 0.05,
    default: 1.05,
    desc: "Height of the source-textured maze walls",
  },
  fog: {
    type: RANGE,
    range: [0, 0.4],
    step: 0.01,
    default: 0.08,
    desc: "Distance fog inside the maze",
  },
  steps: {
    type: RANGE,
    range: [24, 96],
    step: 8,
    default: 72,
    desc: "Maximum wall-intersection steps",
  },
  torchColor: {
    type: COLOR,
    default: [255, 178, 96],
    desc: "Explorer torch and exit-beacon color",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};
export const defaults = {
  grid: optionTypes.grid.default,
  seed: optionTypes.seed.default,
  journey: optionTypes.journey.default,
  speed: optionTypes.speed.default,
  wallHeight: optionTypes.wallHeight.default,
  fog: optionTypes.fog.default,
  steps: optionTypes.steps.default,
  torchColor: optionTypes.torchColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};
const raymarchedMaze = (input: HTMLCanvasElement | OffscreenCanvas, options = defaults) => {
  const runtime = options as typeof defaults & { _frameIndex?: number };
  const W = input.width,
    H = input.height;
  const rendered = renderGLSinglePass({
    source: input,
    width: W,
    height: H,
    key: "raymarchedMaze",
    fragmentShader: FS,
    uniformNames: [
      "u_grid",
      "u_seed",
      "u_journey",
      "u_speed",
      "u_wallHeight",
      "u_fog",
      "u_steps",
      "u_time",
      "u_torchColor",
    ],
    setUniforms: (gl, u) => {
      gl.uniform1f(u.u_grid, options.grid);
      gl.uniform1f(u.u_seed, options.seed);
      gl.uniform1f(u.u_journey, options.journey);
      gl.uniform1f(u.u_speed, options.speed);
      gl.uniform1f(u.u_wallHeight, options.wallHeight);
      gl.uniform1f(u.u_fog, options.fog);
      gl.uniform1f(u.u_steps, options.steps);
      gl.uniform1f(u.u_time, runtime._frameIndex ?? 0);
      gl.uniform3f(
        u.u_torchColor,
        options.torchColor[0],
        options.torchColor[1],
        options.torchColor[2],
      );
    },
  });
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend(
    "Raymarched Maze",
    "WebGL2",
    `${options.grid}x${options.grid}${identity ? "" : "+palettePass"}`,
  );
  return identity
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};
export default defineFilter({
  name: "Raymarched Maze",
  func: raymarchedMaze,
  optionTypes,
  options: defaults,
  defaults,
  description: "Navigate a connected procedural maze with source-textured walls and an exit beacon",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
