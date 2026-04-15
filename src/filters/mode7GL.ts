import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

// Full Mode 7 per-pixel ray transform + procedural sky in a single fragment
// shader. Mirrors the JS reference in mode7.ts; see that file for comments on
// the projection, sky style motifs, and quantisation. Palette quantisation
// (when palette.name === "nearest") is applied in-shader via
// round(c * (L-1)) / (L-1); custom palettes fall through to the JS path.
const MODE7_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_horizon;
uniform float u_fov;          // degrees
uniform float u_yaw;          // radians
uniform float u_pitch;        // radians
uniform float u_roll;         // radians
uniform float u_cameraX;
uniform float u_cameraY;
uniform float u_cameraZ;
uniform float u_tile;         // 0 or 1
uniform float u_fly;          // 0 or 1 — toggles sy wrap when tile is off
uniform float u_sky;          // 0 or 1
uniform int   u_skyStyle;     // 0 sunsetCircuit, 1 muteCity, 2 stormRun
uniform float u_skyGlow;
uniform float u_skyBands;
uniform float u_skyTwist;
uniform float u_levels;       // >1 = nearest-palette quantise, else pass-through
uniform float u_yawDeg;       // for sky (same as u_yaw * 180/PI but kept separate to avoid accumulated error)
uniform float u_rollDeg;

const float PI = 3.14159265;

vec3 rotateX(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}
vec3 rotateY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
vec3 rotateZ(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}
vec3 rotateVector(vec3 v, float yaw, float pitch, float roll) {
  return rotateY(rotateX(rotateZ(v, roll), pitch), yaw);
}

float skyNoise(float x, float y) {
  return fract(sin(x * 12.9898 + y * 78.233) * 43758.5453);
}

float clamp01(float v) { return clamp(v, 0.0, 1.0); }

float quantizeColor(float value, float levels) {
  return floor(clamp01(value / 255.0) * (levels - 1.0) + 0.5) / (levels - 1.0) * 255.0;
}

vec3 getSkyColor(float xPx, float yPx) {
  float nx = u_res.x > 1.0 ? xPx / (u_res.x - 1.0) : 0.5;
  float ny = u_res.y > 1.0 ? yPx / (u_res.y - 1.0) : 0.0;
  float skyHeight = max(0.001, u_horizon);
  float altitude = clamp01((skyHeight - ny) / skyHeight);
  float twistedX = nx + u_yawDeg / 180.0 * u_skyTwist + (0.5 - altitude) * u_rollDeg / 120.0;
  float coarseY = floor(altitude * 8.0) / 8.0;
  float bandWave = sin((twistedX * 4.0 + coarseY * 6.0) * PI);
  float bandMix = (bandWave * 0.5 + 0.5) * u_skyBands;
  float haze = clamp01(1.0 - altitude * 1.2);
  float sunX = 0.5 + u_yawDeg / 180.0 * 0.35;
  float sunY = max(0.08, u_horizon * 0.42);
  float dxs = nx - sunX;
  float dys = ny - sunY;
  float sun = exp(-(dxs * dxs * 52.0 + dys * dys * 240.0)) * u_skyGlow;
  float sunStripe = abs(dys) < 0.008 + sun * 0.02 ? 1.0 : 0.0;
  float farMount = 0.18 + skyNoise(floor(twistedX * 18.0) * 0.37, 3.1) * 0.12;
  float nearMount = 0.1 + skyNoise(floor(twistedX * 11.0) * 0.53, 8.4) * 0.18;
  float horizonLine = 1.0 - altitude;
  float mountainMaskFar = horizonLine > 0.72 - farMount && horizonLine < 0.9 ? 1.0 : 0.0;
  float mountainMaskNear = horizonLine > 0.8 - nearMount && horizonLine < 0.98 ? 1.0 : 0.0;
  float cityCell = floor((twistedX + 2.0) * 24.0);
  float cityHeight = 0.08 + skyNoise(cityCell * 0.41, 5.7) * 0.22;
  float cityMask = horizonLine > 0.84 - cityHeight && horizonLine < 0.98 ? 1.0 : 0.0;
  float cityWindowCond = (cityMask > 0.5 && mod(floor(ny * u_res.y * 4.0), 3.0) == 0.0
                         && skyNoise(cityCell * 0.77, floor(ny * u_res.y * 3.0)) > 0.58) ? 1.0 : 0.0;
  float stormWave = sin((twistedX * 2.8 + coarseY * 9.0) * PI);
  float lightning = max(0.0, 1.0 - abs(twistedX - 0.62 - u_yawDeg / 180.0 * 0.15) * 18.0 - abs(altitude - 0.45) * 7.0);

  if (u_skyStyle == 1) { // muteCity
    float baseR = mix(12.0, 180.0, pow(haze, 0.82));
    float baseG = mix(18.0, 122.0, pow(haze, 0.9));
    float baseB = mix(56.0, 255.0, pow(coarseY, 0.68));
    float bandedR = mix(baseR, 120.0, bandMix * 0.3);
    float bandedG = mix(baseG, 220.0, bandMix * 0.35);
    float bandedB = mix(baseB, 255.0, bandMix * 0.4);
    float cityR = cityMask * 24.0;
    float cityG = cityMask * 20.0;
    float cityB = cityMask * 65.0;
    float windowR = cityWindowCond * 255.0;
    float windowG = cityWindowCond * 210.0;
    float windowB = cityWindowCond * 96.0;
    return vec3(
      quantizeColor(bandedR + sun * 90.0 + cityR + windowR, 7.0),
      quantizeColor(bandedG + sun * 110.0 + cityG + windowG, 7.0),
      quantizeColor(bandedB + sun * 45.0 + cityB + windowB, 7.0)
    );
  }
  if (u_skyStyle == 2) { // stormRun
    float baseR = mix(10.0, 100.0, pow(haze, 1.1));
    float baseG = mix(12.0, 126.0, pow(haze, 1.05));
    float baseB = mix(30.0, 170.0, pow(coarseY, 0.72));
    float cloudBand = clamp01((stormWave * 0.5 + 0.5) * u_skyBands * 1.2);
    float bandedR = mix(baseR, 170.0, cloudBand * 0.18);
    float bandedG = mix(baseG, 192.0, cloudBand * 0.22);
    float bandedB = mix(baseB, 210.0, cloudBand * 0.28);
    float flash = lightning * u_skyGlow * 220.0;
    float mountainR = mountainMaskNear > 0.5 ? 18.0 : (mountainMaskFar > 0.5 ? 36.0 : 0.0);
    float mountainG = mountainMaskNear > 0.5 ? 20.0 : (mountainMaskFar > 0.5 ? 40.0 : 0.0);
    float mountainB = mountainMaskNear > 0.5 ? 32.0 : (mountainMaskFar > 0.5 ? 54.0 : 0.0);
    return vec3(
      quantizeColor(bandedR + flash + mountainR, 6.0),
      quantizeColor(bandedG + flash * 0.95 + mountainG, 6.0),
      quantizeColor(bandedB + flash * 1.05 + mountainB, 6.0)
    );
  }
  // sunsetCircuit (default)
  float baseR = mix(20.0, 248.0, pow(haze, 0.7));
  float baseG = mix(26.0, 120.0, pow(haze, 0.88));
  float baseB = mix(66.0, 214.0, pow(coarseY, 0.72));
  float bandedR = mix(baseR, 255.0, bandMix * 0.5);
  float bandedG = mix(baseG, 70.0, bandMix * 0.55);
  float bandedB = mix(baseB, 190.0, bandMix * 0.25);
  float mountainR = mountainMaskNear > 0.5 ? 32.0 : (mountainMaskFar > 0.5 ? 70.0 : 0.0);
  float mountainG = mountainMaskNear > 0.5 ? 18.0 : (mountainMaskFar > 0.5 ? 34.0 : 0.0);
  float mountainB = mountainMaskNear > 0.5 ? 60.0 : (mountainMaskFar > 0.5 ? 92.0 : 0.0);
  return vec3(
    quantizeColor(bandedR + sun * 150.0 + sunStripe * 45.0 + mountainR, 8.0),
    quantizeColor(bandedG + sun * 80.0 + mountainG, 8.0),
    quantizeColor(bandedB + sun * 30.0 + mountainB, 8.0)
  );
}

void main() {
  float W = u_res.x;
  float H = u_res.y;
  // Output pixel in GL-y-up → JS-y-down conversion. drawImage() in readoutToCanvas
  // flips the rendered framebuffer, so we emit in GL-native orientation here but
  // compute screen coords using JS-y pixel position.
  float xPx = floor(v_uv.x * W);
  float yPx_js = H - 1.0 - floor(v_uv.y * H);

  float screenX = (((xPx + 0.5) / max(1.0, W)) - 0.5) * 2.0;
  float horizonShift = (0.5 - u_horizon) * 2.0;
  float screenY = (0.5 - ((yPx_js + 0.5) / max(1.0, H))) * 2.0 + horizonShift;

  float tanHalfFov = tan(u_fov * PI / 360.0);
  float aspect = H / max(1.0, W);

  vec3 ray = rotateVector(
    vec3(screenX * tanHalfFov, screenY * tanHalfFov * aspect, 1.0),
    u_yaw, u_pitch, u_roll
  );
  float rayY = ray.y;

  vec3 outColor;
  if (rayY >= -0.0001) {
    if (u_sky > 0.5) {
      outColor = getSkyColor(xPx, yPx_js) / 255.0;
    } else {
      outColor = vec3(0.0);
    }
    fragColor = vec4(outColor, 1.0);
    return;
  }

  float distance = -u_cameraY / rayY;
  if (distance <= 0.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float textureScale = 0.35;
  float worldX = u_cameraX + ray.x * distance;
  float worldZ = u_cameraZ + ray.z * distance;
  float sx = (worldX * textureScale + 0.5) * (W - 1.0);
  float sy = (H - 1.0) - worldZ * textureScale * (H - 1.0);

  float maxX = max(1.0, W - 1.0);
  float maxY = max(1.0, H - 1.0);
  if (u_tile > 0.5) {
    sx = mod(sx, maxX);
    sy = mod(sy, maxY);
  } else {
    sx = clamp(sx, 0.0, W - 1.0);
    // JS wraps sy when (tile || fly); clamp otherwise. Mirror both cases here.
    sy = u_fly > 0.5 ? mod(sy, maxY) : clamp(sy, 0.0, H - 1.0);
  }

  // UNPACK_FLIP_Y=true means uv.y=1 samples JS row 0, uv.y=0 samples JS row H-1.
  vec2 sampleUV = vec2((sx + 0.5) / W, 1.0 - (sy + 0.5) / H);
  vec3 sampled = texture(u_source, sampleUV).rgb;

  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    sampled = floor(sampled * q + 0.5) / q;
  }
  fragColor = vec4(sampled, 1.0);
}
`;

type Cache = { prog: Program };
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    prog: linkProgram(gl, MODE7_FS, [
      "u_source", "u_res", "u_horizon", "u_fov",
      "u_yaw", "u_pitch", "u_roll",
      "u_cameraX", "u_cameraY", "u_cameraZ",
      "u_tile", "u_fly", "u_sky", "u_skyStyle", "u_skyGlow", "u_skyBands", "u_skyTwist",
      "u_levels", "u_yawDeg", "u_rollDeg",
    ] as const),
  };
  return _cache;
};

export const mode7GLAvailable = (): boolean => glAvailable();

export const SKY_STYLE_ID: Record<string, number> = {
  sunsetCircuit: 0,
  muteCity: 1,
  stormRun: 2,
};

export const renderMode7GL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  params: {
    horizon: number;
    fov: number;
    yawDeg: number;
    pitchDeg: number;
    rollDeg: number;
    cameraX: number;
    cameraY: number;
    cameraZ: number;
    tile: boolean;
    fly: boolean;
    sky: boolean;
    skyStyle: string;
    skyGlow: number;
    skyBands: number;
    skyTwist: number;
    levels: number;
  },
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "mode7:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  drawPass(gl, null, width, height, cache.prog, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.prog.uniforms.u_source, 0);
    gl.uniform2f(cache.prog.uniforms.u_res, width, height);
    gl.uniform1f(cache.prog.uniforms.u_horizon, params.horizon);
    gl.uniform1f(cache.prog.uniforms.u_fov, params.fov);
    gl.uniform1f(cache.prog.uniforms.u_yaw, params.yawDeg * Math.PI / 180);
    gl.uniform1f(cache.prog.uniforms.u_pitch, params.pitchDeg * Math.PI / 180);
    gl.uniform1f(cache.prog.uniforms.u_roll, params.rollDeg * Math.PI / 180);
    gl.uniform1f(cache.prog.uniforms.u_cameraX, params.cameraX);
    gl.uniform1f(cache.prog.uniforms.u_cameraY, params.cameraY);
    gl.uniform1f(cache.prog.uniforms.u_cameraZ, params.cameraZ);
    gl.uniform1f(cache.prog.uniforms.u_tile, params.tile ? 1 : 0);
    gl.uniform1f(cache.prog.uniforms.u_fly, params.fly ? 1 : 0);
    gl.uniform1f(cache.prog.uniforms.u_sky, params.sky ? 1 : 0);
    gl.uniform1i(cache.prog.uniforms.u_skyStyle, SKY_STYLE_ID[params.skyStyle] ?? 0);
    gl.uniform1f(cache.prog.uniforms.u_skyGlow, params.skyGlow);
    gl.uniform1f(cache.prog.uniforms.u_skyBands, params.skyBands);
    gl.uniform1f(cache.prog.uniforms.u_skyTwist, params.skyTwist);
    gl.uniform1f(cache.prog.uniforms.u_levels, params.levels);
    gl.uniform1f(cache.prog.uniforms.u_yawDeg, params.yawDeg);
    gl.uniform1f(cache.prog.uniforms.u_rollDeg, params.rollDeg);
  }, vao);

  return readoutToCanvas(canvas, width, height);
};
