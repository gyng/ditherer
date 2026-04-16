import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  getBufferIndex,
  wasmIsLoaded,
  logFilterWasmStatus,
  logFilterBackend,
  wasmBokehBuffer,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPaletteToBuffer, applyPalettePassToCanvas, paletteIsIdentity as isIdentityPalette } from "palettes/backend";
import { bokehGLAvailable, renderBokehGL } from "./bokehGL";

const SHAPE = { CIRCLE: "CIRCLE", HEXAGON: "HEXAGON", TRIANGLE: "TRIANGLE", PENTAGON: "PENTAGON", OCTAGON: "OCTAGON", STAR: "STAR" };
const SHAPE_TO_ID = { [SHAPE.CIRCLE]: 0, [SHAPE.HEXAGON]: 1, [SHAPE.TRIANGLE]: 2, [SHAPE.PENTAGON]: 3, [SHAPE.OCTAGON]: 4, [SHAPE.STAR]: 5 };

export const optionTypes = {
  radius: { type: RANGE, range: [2, 30], step: 1, default: 10, desc: "Size of blur kernel and bokeh highlight shapes" },
  threshold: { type: RANGE, range: [100, 255], step: 1, default: 185, desc: "Luminance cutoff — brighter pixels become bokeh highlights" },
  intensity: { type: RANGE, range: [0, 2], step: 0.1, default: 1, desc: "Brightness multiplier for the bokeh highlight shapes" },
  shape: { type: ENUM, options: [
    { name: "Circle", value: SHAPE.CIRCLE },
    { name: "Triangle (3-blade)", value: SHAPE.TRIANGLE },
    { name: "Pentagon (5-blade)", value: SHAPE.PENTAGON },
    { name: "Hexagon (6-blade)", value: SHAPE.HEXAGON },
    { name: "Octagon (8-blade)", value: SHAPE.OCTAGON },
    { name: "Star (diffraction)", value: SHAPE.STAR },
  ], default: SHAPE.CIRCLE, desc: "Shape of the bokeh highlight" },
  localDetect: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "0 = global threshold; 1 = only pixels brighter than their blurred neighbourhood (real light sources)" },
  softness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.15, desc: "Feathering of the bokeh disc edges (smoothstep falloff)" },
  bubble: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Hollow out the disc interior — 0 = solid, 1 = ring only (soap bubble)" },
  edgeRing: { type: RANGE, range: [0, 2], step: 0.1, default: 0.4, desc: "Boost brightness at the outer rim (combine with Bubble for a soap-bubble look)" },
  edgeFringe: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Chromatic aberration: R/B discs shift in size and source position" },
  rotation: { type: RANGE, range: [0, 180], step: 1, default: 15, desc: "Rotation of the bokeh shape" },
  catsEye: { type: RANGE, range: [0, 1], step: 0.05, default: 0.85, desc: "Mechanical vignetting: shapes near frame edges become crescent-shaped" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  threshold: optionTypes.threshold.default,
  intensity: optionTypes.intensity.default,
  shape: optionTypes.shape.default as string,
  localDetect: optionTypes.localDetect.default,
  softness: optionTypes.softness.default,
  bubble: optionTypes.bubble.default,
  edgeRing: optionTypes.edgeRing.default,
  edgeFringe: optionTypes.edgeFringe.default,
  rotation: optionTypes.rotation.default,
  catsEye: optionTypes.catsEye.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type BokehOptions = typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean };

const bokeh = (input: any, options: BokehOptions = defaults) => {
  const { radius, threshold, intensity, shape, localDetect, softness, bubble, edgeRing, edgeFringe, rotation, catsEye, palette } = options;
  const wasmOk: boolean = (options as { _wasmAcceleration?: boolean })._wasmAcceleration !== false;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const paletteIdentity = isIdentityPalette(palette);
  const shapeId = SHAPE_TO_ID[shape] ?? 0;

  // GL fast path — bokeh render on GPU, palette pass on CPU after readout.
  if (
    options._webglAcceleration !== false
    && bokehGLAvailable()
  ) {
    const rendered = renderBokehGL(input, W, H, radius, threshold, intensity, shapeId, localDetect, softness, edgeFringe, rotation, catsEye, edgeRing, bubble);
    if (rendered) {
      const out = paletteIdentity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette, wasmOk);
      if (out) {
        logFilterBackend("Bokeh", "WebGL2", `gpu radius=${radius} shape=${shape}${paletteIdentity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  if (wasmIsLoaded() && wasmOk) {
    const outBuf = new Uint8ClampedArray(buf.length);
    wasmBokehBuffer(buf, outBuf, W, H, radius, threshold, intensity, shapeId, localDetect, softness, edgeFringe, rotation, catsEye, edgeRing, bubble);
    applyPaletteToBuffer(outBuf, outBuf, W, H, palette, wasmOk);
    logFilterWasmStatus("Bokeh", true, paletteIdentity ? `radius=${radius}` : `radius=${radius}+palettePass`);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("Bokeh", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  // Basic JS fallback
  const blurR = new Float32Array(W * H);
  const blurG = new Float32Array(W * H);
  const blurB = new Float32Array(W * H);
  const sigma = radius / 2;
  const kr = Math.ceil(sigma * 2);

  // Horizontal pass
  const tempR = new Float32Array(W * H), tempG = new Float32Array(W * H), tempB = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let k = -kr; k <= kr; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        const ni = getBufferIndex(nx, y, W);
        const w = Math.exp(-(k * k) / (2 * sigma * sigma));
        sr += buf[ni] * w; sg += buf[ni + 1] * w; sb += buf[ni + 2] * w; sw += w;
      }
      const pi = y * W + x;
      tempR[pi] = sr / sw; tempG[pi] = sg / sw; tempB[pi] = sb / sw;
    }
  // Vertical pass
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let k = -kr; k <= kr; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        const pi = ny * W + x;
        const w = Math.exp(-(k * k) / (2 * sigma * sigma));
        sr += tempR[pi] * w; sg += tempG[pi] * w; sb += tempB[pi] * w; sw += w;
      }
      const pi = y * W + x;
      blurR[pi] = sr / sw; blurG[pi] = sg / sw; blurB[pi] = sb / sw;
    }

  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      const di = getBufferIndex(x, y, W);
      outBuf[di] = Math.round(blurR[pi]); outBuf[di + 1] = Math.round(blurG[pi]); outBuf[di + 2] = Math.round(blurB[pi]); outBuf[di + 3] = buf[di + 3];
    }

  // Highlights
  for (let y = 0; y < H; y += Math.max(1, Math.floor(radius / 2))) {
    for (let x = 0; x < W; x += Math.max(1, Math.floor(radius / 2))) {
      const ci = getBufferIndex(x, y, W);
      const lum = 0.2126 * buf[ci] + 0.7152 * buf[ci + 1] + 0.0722 * buf[ci + 2];
      const pi = y * W + x;
      const blurLum = 0.2126 * blurR[pi] + 0.7152 * blurG[pi] + 0.0722 * blurB[pi];
      const baseline = blurLum * localDetect;
      const adjThreshold = threshold * (1 - localDetect * 0.85);
      const bokehStrength = Math.max(0, (lum - baseline - adjThreshold) / Math.max(1, 255 - baseline - adjThreshold));
      if (bokehStrength <= 0) continue;
      const bokehIntensity = bokehStrength * intensity;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const px = x + dx, py = y + dy;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const dist2 = Math.sqrt(dx * dx + dy * dy);
          let inShapeCoarse: boolean;
          if (shape === SHAPE.CIRCLE) {
            inShapeCoarse = dist2 <= radius;
          } else if (shape === SHAPE.STAR) {
            const b = Math.PI / 6;
            const fa = Math.abs(((Math.atan2(dy, dx) + b) % (2 * b) + 2 * b) % (2 * b) - b);
            const ri = radius * 0.42 + (radius - radius * 0.42) * (1 - (fa / b) ** 2);
            inShapeCoarse = dist2 <= ri;
          } else {
            const n = shape === SHAPE.HEXAGON ? 6 : shape === SHAPE.TRIANGLE ? 3 : shape === SHAPE.PENTAGON ? 5 : 8;
            const sector = 2 * Math.PI / n;
            const fa = ((Math.atan2(dy, dx) + Math.PI / n) % sector + sector) % sector - Math.PI / n;
            const cs = Math.cos(Math.PI / n);
            inShapeCoarse = dist2 * Math.cos(fa) <= radius * cs;
          }
          if (!inShapeCoarse) continue;
          const t = Math.max(0, Math.min(1, (dist2 - radius) / (softness * radius + 0.1)));
          let inShapeVal = 1 - t * t * (3 - 2 * t); // smoothstep
          // Bubble: hollow interior
          if (bubble > 0) {
            const bt = Math.min(1, dist2 / (radius * 0.75));
            inShapeVal *= 1 - bubble * (1 - bt * bt * (3 - 2 * bt));
          }
          if (inShapeVal <= 0) continue;
          const ringFade = dist2 > radius * 0.7 ? 1.0 + edgeRing : inShapeVal;
          const di = getBufferIndex(px, py, W);
          const add = bokehIntensity * ringFade * 80;
          outBuf[di] = Math.min(255, outBuf[di] + Math.round(add * inShapeVal * buf[ci] / 255));
          outBuf[di + 1] = Math.min(255, outBuf[di + 1] + Math.round(add * inShapeVal * buf[ci + 1] / 255));
          outBuf[di + 2] = Math.min(255, outBuf[di + 2] + Math.round(add * inShapeVal * buf[ci + 2] / 255));
        }
      }
    }
  }

  applyPaletteToBuffer(outBuf, outBuf, W, H, palette, wasmOk);
  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Bokeh", func: bokeh, optionTypes, options: defaults, defaults });
