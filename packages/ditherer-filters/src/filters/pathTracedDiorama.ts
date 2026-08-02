import { COLOR, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter } from "./types";
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
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_history;
uniform vec2 u_res;
uniform float u_frame;
uniform int u_hasHistory;
uniform float u_aperture;
uniform float u_focus;
uniform float u_lightSize;
uniform float u_bounces;
uniform float u_roughness;
uniform float u_exposure;
uniform float u_maxFrames;
uniform vec3 u_roomColor;

struct Hit { float t; vec3 p; vec3 n; vec2 uv; int material; };

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
vec2 rand2(vec2 seed) { return vec2(hash(seed), hash(seed + 37.19)); }

Hit noHit() { return Hit(1e9, vec3(0.0), vec3(0.0), vec2(0.0), -1); }

Hit traceScene(vec3 ro, vec3 rd) {
  Hit best = noHit();
  float t;
  vec3 p;

  if (abs(rd.z) > 0.0001) {
    t = -ro.z / rd.z;
    p = ro + rd * t;
    if (t > 0.001 && abs(p.x) < 0.92 && p.y > -0.58 && p.y < 0.58 && t < best.t) {
      best = Hit(t, p, vec3(0,0,1), vec2(p.x / 1.84 + 0.5, p.y / 1.16 + 0.5), 1);
    }
    t = (-0.18 - ro.z) / rd.z;
    p = ro + rd * t;
    if (t > 0.001 && abs(p.x) < 1.35 && p.y > -0.75 && p.y < 1.05 && t < best.t) {
      best = Hit(t, p, vec3(0,0,1), p.xy, 0);
    }
  }
  if (abs(rd.y) > 0.0001) {
    t = (-0.75 - ro.y) / rd.y;
    p = ro + rd * t;
    if (t > 0.001 && abs(p.x) < 1.35 && p.z > -0.2 && p.z < 2.2 && t < best.t) {
      best = Hit(t, p, vec3(0,1,0), p.xz, 0);
    }
    t = (1.05 - ro.y) / rd.y;
    p = ro + rd * t;
    if (t > 0.001 && abs(p.x) < 1.35 && p.z > -0.2 && p.z < 2.2 && t < best.t) {
      best = Hit(t, p, vec3(0,-1,0), p.xz, 0);
    }
  }
  if (abs(rd.x) > 0.0001) {
    t = (-1.35 - ro.x) / rd.x;
    p = ro + rd * t;
    if (t > 0.001 && p.y > -0.75 && p.y < 1.05 && p.z > -0.2 && p.z < 2.2 && t < best.t) {
      best = Hit(t, p, vec3(1,0,0), p.yz, 0);
    }
    t = (1.35 - ro.x) / rd.x;
    p = ro + rd * t;
    if (t > 0.001 && p.y > -0.75 && p.y < 1.05 && p.z > -0.2 && p.z < 2.2 && t < best.t) {
      best = Hit(t, p, vec3(-1,0,0), p.yz, 0);
    }
  }
  return best;
}

vec3 materialAt(Hit hit) {
  if (hit.material == 1) return texture(u_source, vec2(hit.uv.x, 1.0 - hit.uv.y)).rgb;
  float checker = mod(floor(hit.p.x * 4.0) + floor(hit.p.z * 4.0), 2.0);
  return (u_roomColor / 255.0) * mix(0.78, 1.05, checker * step(abs(hit.n.y), 0.9));
}

void main() {
  vec2 seed = floor(v_uv * u_res) + vec2(u_frame * 17.0, u_frame * 43.0);
  vec2 jitter = rand2(seed) - 0.5;
  vec2 screen = ((v_uv * u_res + jitter) / u_res) * 2.0 - 1.0;
  screen.x *= u_res.x / max(u_res.y, 1.0);

  vec3 camera = vec3(0.0, 0.02, 2.15);
  vec3 target = vec3(0.0, 0.0, 0.0);
  vec3 forward = normalize(target - camera);
  vec3 right = normalize(cross(forward, vec3(0,1,0)));
  vec3 up = cross(right, forward);
  vec3 pinholeRay = normalize(forward + right * screen.x * 0.64 + up * screen.y * 0.64);
  float focusT = u_focus / max(0.01, dot(pinholeRay, forward));
  vec3 focusPoint = camera + pinholeRay * focusT;
  vec2 lens = (rand2(seed + 91.7) - 0.5) * u_aperture;
  vec3 ro = camera + right * lens.x + up * lens.y;
  vec3 rd = normalize(focusPoint - ro);

  Hit hit = traceScene(ro, rd);
  vec3 sampleColor = vec3(0.015, 0.02, 0.035);
  if (hit.material >= 0) {
    vec3 base = materialAt(hit);
    vec2 lightJitter = (rand2(seed + 203.1) - 0.5) * u_lightSize;
    vec3 lightPos = vec3(lightJitter.x, 0.92, 0.55 + lightJitter.y);
    vec3 toLight = lightPos - hit.p;
    float lightDistance = length(toLight);
    vec3 lightDir = toLight / max(lightDistance, 0.001);
    Hit blocker = traceScene(hit.p + hit.n * 0.003, lightDir);
    float visible = blocker.t < lightDistance ? 0.08 : 1.0;
    float direct = max(dot(hit.n, lightDir), 0.0) * visible;
    sampleColor = base * (0.12 + direct * 1.45);

    if (u_bounces > 1.5) {
      vec2 bounceJitter = rand2(seed + 401.3) - 0.5;
      vec3 reflected = normalize(reflect(rd, hit.n) + vec3(bounceJitter * u_roughness, 0.0));
      Hit bounce = traceScene(hit.p + hit.n * 0.004, reflected);
      if (bounce.material >= 0) sampleColor += materialAt(bounce) * max(dot(bounce.n, -reflected), 0.0) * 0.32;
    }
  }
  sampleColor = vec3(1.0) - exp(-sampleColor * u_exposure);

  vec3 history = texture(u_history, v_uv).rgb;
  float count = min(u_frame + 1.0, max(1.0, u_maxFrames));
  float weight = u_hasHistory == 1 ? 1.0 / count : 1.0;
  fragColor = vec4(mix(history, sampleColor, weight), 1.0);
}`;

export const optionTypes = {
  aperture: {
    type: RANGE,
    range: [0, 0.12],
    step: 0.005,
    default: 0.018,
    desc: "Lens aperture for stochastic depth of field",
  },
  focus: {
    type: RANGE,
    range: [1.2, 3],
    step: 0.05,
    default: 2.15,
    desc: "Focus distance from the camera",
  },
  lightSize: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.45,
    desc: "Area-light size controlling soft-shadow spread",
  },
  bounces: {
    type: RANGE,
    range: [1, 2],
    step: 1,
    default: 2,
    desc: "Path depth: direct light only or one reflected bounce",
  },
  roughness: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.28,
    desc: "Spread of reflected secondary rays",
  },
  exposure: {
    type: RANGE,
    range: [0.25, 3],
    step: 0.05,
    default: 1.35,
    desc: "Tone-mapped scene exposure",
  },
  maxFrames: {
    type: RANGE,
    range: [4, 256],
    step: 4,
    default: 96,
    desc: "Progressive samples accumulated before switching to a rolling average",
  },
  roomColor: {
    type: COLOR,
    default: [126, 111, 105],
    desc: "Material color of the diorama walls and floor",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  aperture: optionTypes.aperture.default,
  focus: optionTypes.focus.default,
  lightSize: optionTypes.lightSize.default,
  bounces: optionTypes.bounces.default,
  roughness: optionTypes.roughness.default,
  exposure: optionTypes.exposure.default,
  maxFrames: optionTypes.maxFrames.default,
  roomColor: optionTypes.roomColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type DioramaOptions = typeof defaults & {
  _frameIndex?: number;
  _prevOutput?: Uint8ClampedArray | null;
};

let program: Program | null = null;
const getProgram = (gl: WebGL2RenderingContext): Program => {
  if (program) return program;
  program = linkProgram(gl, FS, [
    "u_source",
    "u_history",
    "u_res",
    "u_frame",
    "u_hasHistory",
    "u_aperture",
    "u_focus",
    "u_lightSize",
    "u_bounces",
    "u_roughness",
    "u_exposure",
    "u_maxFrames",
    "u_roomColor",
  ] as const);
  return program;
};

const pathTracedDiorama = (
  input: HTMLCanvasElement | OffscreenCanvas,
  options: DioramaOptions = defaults,
) => {
  const W = input.width,
    H = input.height;
  const context = getGLCtx();
  if (!context) return input;
  const { gl, canvas } = context;
  const prog = getProgram(gl);
  const source = ensureTexture(gl, "pathTracedDiorama:source", W, H);
  const history = ensureTexture(gl, "pathTracedDiorama:history", W, H);
  uploadSourceTexture(gl, source, input);
  const haveHistory =
    !!options._prevOutput &&
    options._prevOutput.length === W * H * 4 &&
    (options._frameIndex ?? 0) > 0;
  if (haveHistory) {
    gl.bindTexture(gl.TEXTURE_2D, history.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, options._prevOutput!);
  }
  resizeGLCanvas(canvas, W, H);
  drawPass(
    gl,
    null,
    W,
    H,
    prog,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.tex);
      gl.uniform1i(prog.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, haveHistory ? history.tex : source.tex);
      gl.uniform1i(prog.uniforms.u_history, 1);
      gl.uniform2f(prog.uniforms.u_res, W, H);
      gl.uniform1f(prog.uniforms.u_frame, options._frameIndex ?? 0);
      gl.uniform1i(prog.uniforms.u_hasHistory, haveHistory ? 1 : 0);
      gl.uniform1f(prog.uniforms.u_aperture, options.aperture);
      gl.uniform1f(prog.uniforms.u_focus, options.focus);
      gl.uniform1f(prog.uniforms.u_lightSize, options.lightSize);
      gl.uniform1f(prog.uniforms.u_bounces, options.bounces);
      gl.uniform1f(prog.uniforms.u_roughness, options.roughness);
      gl.uniform1f(prog.uniforms.u_exposure, options.exposure);
      gl.uniform1f(prog.uniforms.u_maxFrames, options.maxFrames);
      gl.uniform3f(
        prog.uniforms.u_roomColor,
        options.roomColor[0],
        options.roomColor[1],
        options.roomColor[2],
      );
    },
    getQuadVAO(gl),
  );
  const rendered = readoutToCanvas(canvas, W, H);
  if (!rendered) return input;
  const identity = paletteIsIdentity(options.palette);
  logFilterBackend(
    "Path-Traced Diorama",
    "WebGL2",
    `sample=${(options._frameIndex ?? 0) + 1}${identity ? "" : "+palettePass"}`,
  );
  return identity
    ? rendered
    : (applyPalettePassToCanvas(rendered, W, H, options.palette) ?? rendered);
};

export default defineFilter({
  name: "Path-Traced Diorama",
  func: pathTracedDiorama,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Progressively path-trace the source as a framed image inside a softly lit miniature room",
  temporal: true,
  autoAnimate: true,
  autoAnimateFps: 30,
  requiresGL: true,
});
