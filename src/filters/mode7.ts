import { ACTION, RANGE, BOOL, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor, sampleBilinear, logFilterBackend } from "utils";
import { applyPaletteToBuffer, paletteIsIdentity as isIdentityPalette } from "palettes/backend";
import { defineFilter } from "filters/types";
import { mode7GLAvailable, renderMode7GL } from "./mode7GL";

export const optionTypes = {
  fly: { type: BOOL, label: "Auto Flight", default: true, desc: "Continuously move forward across the track plane" },
  forwardSpeed: {
    type: RANGE,
    label: "Cruise Speed",
    range: [-4, 4],
    step: 0.1,
    default: 0.4,
    desc: "Forward or reverse travel speed while the animation loop is playing",
    visibleWhen: (options: any) => options.fly
  },
  strafeSpeed: {
    type: RANGE,
    label: "Strafe Speed",
    range: [-2, 2],
    step: 0.05,
    default: 0,
    desc: "Slide sideways while flying",
    visibleWhen: (options: any) => options.fly
  },
  liftSpeed: {
    type: RANGE,
    label: "Lift Speed",
    range: [-1, 1],
    step: 0.05,
    default: 0,
    desc: "Rise or descend while flying",
    visibleWhen: (options: any) => options.fly
  },
  animSpeed: { type: RANGE, label: "Playback FPS", range: [1, 30], step: 1, default: 15, desc: "Playback speed for the optional flying preview" },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) {
      actions.stopAnimLoop();
    } else {
      actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
    }
  } },
  horizon: { type: RANGE, label: "Horizon", range: [0, 1], step: 0.01, default: 0.58, desc: "Vertical position of the horizon line" },
  fov: { type: RANGE, label: "Field of View", range: [30, 120], step: 1, default: 70, desc: "Field of view across the floor plane" },
  pitch: { type: RANGE, label: "Pitch", range: [-10, 89], step: 1, default: 22, desc: "Pitch the camera down toward or up away from the floor" },
  yaw: { type: RANGE, label: "Yaw", range: [-45, 45], step: 1, default: 0, desc: "Rotate the camera left or right across the floor plane" },
  roll: { type: RANGE, label: "Roll", range: [-45, 45], step: 1, default: 0, desc: "Bank the camera clockwise or counterclockwise" },
  cameraX: { type: RANGE, label: "Camera X", range: [-3, 3], step: 0.05, default: 0, desc: "Move the camera left or right across the floor plane" },
  cameraY: { type: RANGE, label: "Camera Height", range: [0.05, 3], step: 0.05, default: 1.15, desc: "Camera height above the floor plane" },
  cameraZ: { type: RANGE, label: "Camera Z", range: [-3, 3], step: 0.05, default: 0, desc: "Move the camera forward or backward through the scene" },
  tile: { type: BOOL, label: "Tile Floor", default: true, desc: "Repeat the source texture instead of clamping it" },
  sky: { type: BOOL, label: "Procedural Sky", default: true, desc: "Generate a stylized procedural sky above the horizon" },
  skyStyle: {
    type: ENUM,
    label: "Sky Style",
    default: "sunsetCircuit",
    options: [
      { name: "Sunset Circuit", value: "sunsetCircuit" },
      { name: "Mute City", value: "muteCity" },
      { name: "Storm Run", value: "stormRun" }
    ],
    desc: "Choose a period-style backdrop motif inspired by SNES racing skies",
    visibleWhen: (options: any) => options.sky
  },
  skyGlow: {
    type: RANGE,
    label: "Sky Glow",
    range: [0, 1],
    step: 0.01,
    default: 0.75,
    desc: "Strength of the horizon glow and sun bloom",
    visibleWhen: (options: any) => options.sky
  },
  skyBands: {
    type: RANGE,
    label: "Sky Bands",
    range: [0, 1],
    step: 0.01,
    default: 0.6,
    desc: "Amount of chunky horizon banding in the retro sky",
    visibleWhen: (options: any) => options.sky
  },
  skyTwist: {
    type: RANGE,
    label: "Sky Twist",
    range: [-2, 2],
    step: 0.01,
    default: 0.5,
    desc: "How much the sky shears with yaw like a sweeping arcade backdrop",
    visibleWhen: (options: any) => options.sky
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  horizon: optionTypes.horizon.default,
  fov: optionTypes.fov.default,
  cameraX: optionTypes.cameraX.default,
  cameraY: optionTypes.cameraY.default,
  cameraZ: optionTypes.cameraZ.default,
  pitch: optionTypes.pitch.default,
  tile: optionTypes.tile.default,
  fly: optionTypes.fly.default,
  forwardSpeed: optionTypes.forwardSpeed.default,
  strafeSpeed: optionTypes.strafeSpeed.default,
  liftSpeed: optionTypes.liftSpeed.default,
  yaw: optionTypes.yaw.default,
  roll: optionTypes.roll.default,
  sky: optionTypes.sky.default,
  skyStyle: optionTypes.skyStyle.default,
  skyGlow: optionTypes.skyGlow.default,
  skyBands: optionTypes.skyBands.default,
  skyTwist: optionTypes.skyTwist.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const wrap = (value: number, max: number) => {
  const m = value % max;
  return m < 0 ? m + max : m;
};

const rotateX = (x: number, y: number, z: number, angle: number) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x, y * cos - z * sin, y * sin + z * cos] as const;
};

const rotateY = (x: number, y: number, z: number, angle: number) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos + z * sin, y, -x * sin + z * cos] as const;
};

const rotateZ = (x: number, y: number, z: number, angle: number) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos, z] as const;
};

const rotateVector = (x: number, y: number, z: number, yaw: number, pitch: number, roll: number) => {
  const rolled = rotateZ(x, y, z, roll);
  const pitched = rotateX(rolled[0], rolled[1], rolled[2], pitch);
  return rotateY(pitched[0], pitched[1], pitched[2], yaw);
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const skyNoise = (x: number, y: number) => {
  const seed = x * 12.9898 + y * 78.233;
  return (Math.sin(seed) * 43758.5453) % 1;
};

const quantizeColor = (value: number, levels = 8) =>
  Math.round(Math.round(clamp01(value / 255) * (levels - 1)) / (levels - 1) * 255);

const getSkyColor = (
  x: number,
  y: number,
  width: number,
  height: number,
  horizon: number,
  yaw: number,
  roll: number,
  skyStyle: string,
  skyGlow: number,
  skyBands: number,
  skyTwist: number
) => {
  const nx = width > 1 ? x / (width - 1) : 0.5;
  const ny = height > 1 ? y / (height - 1) : 0;
  const skyHeight = Math.max(0.001, horizon);
  const altitude = clamp01((skyHeight - ny) / skyHeight);
  const twistedX = nx + yaw / 180 * skyTwist + (0.5 - altitude) * roll / 120;
  const coarseY = Math.floor(altitude * 8) / 8;
  const bandWave = Math.sin((twistedX * 4 + coarseY * 6) * Math.PI);
  const bandMix = (bandWave * 0.5 + 0.5) * skyBands;
  const haze = clamp01(1 - altitude * 1.2);
  const sunX = 0.5 + yaw / 180 * 0.35;
  const sunY = Math.max(0.08, horizon * 0.42);
  const dx = nx - sunX;
  const dy = ny - sunY;
  const sun = Math.exp(-(dx * dx * 52 + dy * dy * 240)) * skyGlow;
  const sunStripe = Math.abs(dy) < 0.008 + sun * 0.02 ? 1 : 0;
  const farMount = 0.18 + skyNoise(Math.floor(twistedX * 18) * 0.37, 3.1) * 0.12;
  const nearMount = 0.1 + skyNoise(Math.floor(twistedX * 11) * 0.53, 8.4) * 0.18;
  const horizonLine = 1 - altitude;
  const mountainMaskFar = horizonLine > 0.72 - farMount && horizonLine < 0.9 ? 1 : 0;
  const mountainMaskNear = horizonLine > 0.8 - nearMount && horizonLine < 0.98 ? 1 : 0;
  const cityCell = Math.floor((twistedX + 2) * 24);
  const cityHeight = 0.08 + skyNoise(cityCell * 0.41, 5.7) * 0.22;
  const cityMask = horizonLine > 0.84 - cityHeight && horizonLine < 0.98 ? 1 : 0;
  const cityWindow = cityMask && Math.floor(ny * height * 4) % 3 === 0 && skyNoise(cityCell * 0.77, Math.floor(ny * height * 3)) > 0.58 ? 1 : 0;
  const stormWave = Math.sin((twistedX * 2.8 + coarseY * 9) * Math.PI);
  const lightning = Math.max(0, 1 - Math.abs(twistedX - 0.62 - yaw / 180 * 0.15) * 18 - Math.abs(altitude - 0.45) * 7);

  if (skyStyle === "muteCity") {
    const baseR = lerp(12, 180, Math.pow(haze, 0.82));
    const baseG = lerp(18, 122, Math.pow(haze, 0.9));
    const baseB = lerp(56, 255, Math.pow(coarseY, 0.68));
    const bandedR = lerp(baseR, 120, bandMix * 0.3);
    const bandedG = lerp(baseG, 220, bandMix * 0.35);
    const bandedB = lerp(baseB, 255, bandMix * 0.4);
    const cityR = cityMask ? 24 : 0;
    const cityG = cityMask ? 20 : 0;
    const cityB = cityMask ? 65 : 0;
    const windowR = cityWindow ? 255 : 0;
    const windowG = cityWindow ? 210 : 0;
    const windowB = cityWindow ? 96 : 0;

    return [
      quantizeColor(bandedR + sun * 90 + cityR + windowR, 7),
      quantizeColor(bandedG + sun * 110 + cityG + windowG, 7),
      quantizeColor(bandedB + sun * 45 + cityB + windowB, 7),
      255
    ] as const;
  }

  if (skyStyle === "stormRun") {
    const baseR = lerp(10, 100, Math.pow(haze, 1.1));
    const baseG = lerp(12, 126, Math.pow(haze, 1.05));
    const baseB = lerp(30, 170, Math.pow(coarseY, 0.72));
    const cloudBand = clamp01((stormWave * 0.5 + 0.5) * skyBands * 1.2);
    const bandedR = lerp(baseR, 170, cloudBand * 0.18);
    const bandedG = lerp(baseG, 192, cloudBand * 0.22);
    const bandedB = lerp(baseB, 210, cloudBand * 0.28);
    const flash = lightning * skyGlow * 220;
    const mountainR = mountainMaskNear ? 18 : mountainMaskFar ? 36 : 0;
    const mountainG = mountainMaskNear ? 20 : mountainMaskFar ? 40 : 0;
    const mountainB = mountainMaskNear ? 32 : mountainMaskFar ? 54 : 0;

    return [
      quantizeColor(bandedR + flash + mountainR, 6),
      quantizeColor(bandedG + flash * 0.95 + mountainG, 6),
      quantizeColor(bandedB + flash * 1.05 + mountainB, 6),
      255
    ] as const;
  }

  const baseR = lerp(20, 248, Math.pow(haze, 0.7));
  const baseG = lerp(26, 120, Math.pow(haze, 0.88));
  const baseB = lerp(66, 214, Math.pow(coarseY, 0.72));
  const bandedR = lerp(baseR, 255, bandMix * 0.5);
  const bandedG = lerp(baseG, 70, bandMix * 0.55);
  const bandedB = lerp(baseB, 190, bandMix * 0.25);
  const mountainR = mountainMaskNear ? 32 : mountainMaskFar ? 70 : 0;
  const mountainG = mountainMaskNear ? 18 : mountainMaskFar ? 34 : 0;
  const mountainB = mountainMaskNear ? 60 : mountainMaskFar ? 92 : 0;

  return [
    quantizeColor(bandedR + sun * 150 + sunStripe * 45 + mountainR, 8),
    quantizeColor(bandedG + sun * 80 + mountainG, 8),
    quantizeColor(bandedB + sun * 30 + mountainB, 8),
    255
  ] as const;
};

const mode7 = (input: any, options = defaults) => {
  const {
    horizon,
    fov,
    cameraX,
    cameraY,
    cameraZ,
    pitch,
    tile,
    fly,
    forwardSpeed,
    strafeSpeed,
    liftSpeed,
    yaw,
    roll,
    sky,
    skyStyle,
    skyGlow,
    skyBands,
    skyTwist,
    palette
  } = options;

  const W = input.width;
  const H = input.height;
  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const forwardOffset = fly ? frameIndex * forwardSpeed * 0.05 : 0;
  const strafeOffset = fly ? frameIndex * strafeSpeed * 0.05 : 0;
  const liftOffset = fly ? frameIndex * liftSpeed * 0.02 : 0;
  const yawRad = yaw * Math.PI / 180;
  const pitchRad = (pitch * Math.PI) / 180;
  const rollRad = roll * Math.PI / 180;
  const planarForwardDir = rotateVector(0, 0, 1, yawRad, 0, 0);
  const rightDir = rotateVector(1, 0, 0, yawRad, pitchRad, rollRad);
  const upDir = rotateVector(0, 1, 0, yawRad, pitchRad, rollRad);
  const animatedCameraX = cameraX + planarForwardDir[0] * forwardOffset + rightDir[0] * strafeOffset + upDir[0] * liftOffset;
  const animatedCameraY = Math.max(0.05, cameraY + upDir[1] * liftOffset);
  const animatedCameraZ = cameraZ + planarForwardDir[2] * forwardOffset + rightDir[2] * strafeOffset + upDir[2] * liftOffset;

  // WebGL2 fast path: single draw call covers projection, sky, and (for
  // nearest palettes) in-shader quantisation. Custom palettes fall through
  // the GL warp and get a standard CPU palette pass on readback.
  if (
    mode7GLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const identity = isIdentityPalette(palette);
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest
      ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256)
      : 256;
    const rendered = renderMode7GL(input, W, H, {
      horizon, fov,
      yawDeg: yaw, pitchDeg: pitch, rollDeg: roll,
      cameraX: animatedCameraX, cameraY: animatedCameraY, cameraZ: animatedCameraZ,
      tile, fly, sky, skyStyle, skyGlow, skyBands, skyTwist,
      levels,
    });
    if (rendered && typeof (rendered as { getContext?: unknown }).getContext === "function") {
      if (identity || isNearest) {
        logFilterBackend("Mode 7", "WebGL2", `levels=${levels} tile=${tile} fly=${fly} sky=${sky}`);
        return rendered;
      }
      // Custom palette: read back and apply palette on CPU.
      const rCtx = (rendered as HTMLCanvasElement | OffscreenCanvas).getContext("2d", { willReadFrequently: true }) as
        | CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (rCtx) {
        const pixels = rCtx.getImageData(0, 0, W, H).data;
        applyPaletteToBuffer(pixels, pixels, W, H, palette, true);
        rCtx.putImageData(new ImageData(pixels, W, H), 0, 0);
        logFilterBackend("Mode 7", "WebGL2", `tile=${tile} fly=${fly} sky=${sky}+palettePass`);
        return rendered;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const tanHalfFov = Math.tan((fov * Math.PI) / 360);
  const horizonShift = (0.5 - horizon) * 2;
  const aspect = H / Math.max(1, W);
  const textureScale = 0.35;
  const sample = [0, 0, 0, 255];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const screenX = (((x + 0.5) / Math.max(1, W)) - 0.5) * 2;
      const screenY = (0.5 - ((y + 0.5) / Math.max(1, H))) * 2 + horizonShift;
      const ray = rotateVector(screenX * tanHalfFov, screenY * tanHalfFov * aspect, 1, yawRad, pitchRad, rollRad);
      const rayY = ray[1];

      if (rayY >= -0.0001) {
        if (sky) {
          const skyColor = getSkyColor(x, y, W, H, horizon, yaw, roll, skyStyle, skyGlow, skyBands, skyTwist);
          fillBufferPixel(outBuf, i, skyColor[0], skyColor[1], skyColor[2], 255);
        } else {
          fillBufferPixel(outBuf, i, 0, 0, 0, 255);
        }
        continue;
      }

      const distance = -animatedCameraY / rayY;
      if (distance <= 0) {
        fillBufferPixel(outBuf, i, 0, 0, 0, 255);
        continue;
      }

      const worldX = animatedCameraX + ray[0] * distance;
      const worldZ = animatedCameraZ + ray[2] * distance;
      let sx = (worldX * textureScale + 0.5) * (W - 1);
      let sy = (H - 1) - worldZ * textureScale * (H - 1);

      if (tile) {
        sx = wrap(sx, W - 1 || 1);
      } else {
        sx = Math.max(0, Math.min(W - 1, sx));
      }

      if (tile || fly) {
        sy = wrap(sy, H - 1 || 1);
      } else {
        sy = Math.max(0, Math.min(H - 1, sy));
      }

      sampleBilinear(buf, W, H, sx, sy, sample);
      const color = srgbPaletteGetColor(palette, rgba(sample[0], sample[1], sample[2], sample[3]), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Mode 7",
  func: mode7,
  optionTypes,
  options: defaults,
  defaults
});
