import { ACTION, BOOL, ENUM, RANGE } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";
import {
  MOTION_SOURCE,
  MotionVector,
  blendSourceIntoBuffer,
  blendVectorFields,
  blurVectorGrid,
  clearMotionVectorStateCache,
  decodeVectorState,
  directionColor,
  drawVectorGlyph,
  encodeVectorState,
  encodeVectorStateGroups,
  estimateMotionVector,
  fadeBuffer,
  neutralMotionBackground,
  prepareMotionAnalysisBuffers,
} from "utils/motionVectors";

const DISPLAY = {
  ARROWS: "ARROWS",
  OVERLAY: "OVERLAY",
  HEAT: "HEAT",
  HEAT_ARROWS: "HEAT_ARROWS",
  TRAILS: "TRAILS",
  RGB_SPLIT_ARROWS: "RGB_SPLIT_ARROWS",
  RGB_SPLIT_OVERLAY: "RGB_SPLIT_OVERLAY",
  RGB_SPLIT_TRAILS: "RGB_SPLIT_TRAILS",
  HSV_SPLIT_ARROWS: "HSV_SPLIT_ARROWS",
  HSV_SPLIT_OVERLAY: "HSV_SPLIT_OVERLAY",
  HSL_SPLIT_ARROWS: "HSL_SPLIT_ARROWS",
  HSL_SPLIT_OVERLAY: "HSL_SPLIT_OVERLAY",
};

const GLYPH = {
  ARROW: "ARROW",
  NEEDLE: "NEEDLE",
  LINE: "LINE",
  TRIANGLE: "TRIANGLE",
  DOT: "DOT",
};

const COLOR = {
  DIRECTION: "DIRECTION",
  MAGNITUDE: "MAGNITUDE",
  SOURCE: "SOURCE",
  CHANNEL: "CHANNEL",
  CONFIDENCE: "CONFIDENCE",
  WHITE: "WHITE",
};

const MAX_VECTOR_CACHE_KEYS = 24;
const vectorStateCache = new Map<string, Float32Array>();
export const clearMotionVectorsState = () => clearMotionVectorStateCache(vectorStateCache);
const WHITE_COLOR: [number, number, number] = [255, 255, 255];
const RGB_SPLIT_CHANNELS = [MOTION_SOURCE.RED, MOTION_SOURCE.GREEN, MOTION_SOURCE.BLUE] as const;
const RGB_SPLIT_COLORS: [number, number, number][] = [
  [255, 90, 90],
  [90, 255, 120],
  [100, 170, 255],
];
const HSV_SPLIT_CHANNELS = [MOTION_SOURCE.HUE, MOTION_SOURCE.HSV_SATURATION, MOTION_SOURCE.VALUE] as const;
const HSV_SPLIT_COLORS: [number, number, number][] = [
  [255, 180, 60],
  [80, 255, 200],
  [255, 255, 255],
];
const HSL_SPLIT_CHANNELS = [MOTION_SOURCE.HUE, MOTION_SOURCE.HSL_SATURATION, MOTION_SOURCE.LIGHTNESS] as const;
const HSL_SPLIT_COLORS: [number, number, number][] = [
  [255, 180, 60],
  [255, 120, 220],
  [245, 245, 245],
];
const SPLIT_OFFSETS: [number, number][] = [
  [-0.18, -0.12],
  [0, 0],
  [0.18, 0.12],
];

const setCachedVectors = (key: string, vectors: Float32Array) => {
  if (vectorStateCache.has(key)) {
    vectorStateCache.delete(key);
  }
  vectorStateCache.set(key, vectors);
  if (vectorStateCache.size > MAX_VECTOR_CACHE_KEYS) {
    const oldestKey = vectorStateCache.keys().next().value;
    if (oldestKey) vectorStateCache.delete(oldestKey);
  }
};

const channelTint = (sourceMode: string): [number, number, number] => {
  if (sourceMode === MOTION_SOURCE.RED) return [255, 90, 90];
  if (sourceMode === MOTION_SOURCE.GREEN) return [90, 255, 120];
  if (sourceMode === MOTION_SOURCE.BLUE) return [100, 170, 255];
  if (sourceMode === MOTION_SOURCE.LUMA) return [255, 245, 180];
  return [255, 255, 255];
};

const magnitudeHeat = (t: number): [number, number, number] => {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.33) {
    const s = clamped / 0.33;
    return [Math.round(20 + s * 60), Math.round(20 + s * 80), Math.round(40 + s * 180)];
  }
  if (clamped < 0.66) {
    const s = (clamped - 0.33) / 0.33;
    return [Math.round(80 + s * 175), Math.round(100 + s * 120), Math.round(220 - s * 200)];
  }
  const s = (clamped - 0.66) / 0.34;
  return [255, Math.round(220 + s * 35), Math.round(20 + s * 120)];
};

const isSplitDisplay = (display: string) =>
  display === DISPLAY.RGB_SPLIT_ARROWS
  || display === DISPLAY.RGB_SPLIT_OVERLAY
  || display === DISPLAY.RGB_SPLIT_TRAILS
  || display === DISPLAY.HSV_SPLIT_ARROWS
  || display === DISPLAY.HSV_SPLIT_OVERLAY
  || display === DISPLAY.HSL_SPLIT_ARROWS
  || display === DISPLAY.HSL_SPLIT_OVERLAY;

const isHeatDisplay = (display: string) =>
  display === DISPLAY.HEAT || display === DISPLAY.HEAT_ARROWS;

const isOverlayDisplay = (display: string) =>
  display === DISPLAY.OVERLAY
  || display === DISPLAY.RGB_SPLIT_OVERLAY
  || display === DISPLAY.HSV_SPLIT_OVERLAY
  || display === DISPLAY.HSL_SPLIT_OVERLAY;

const isTrailDisplay = (display: string) =>
  display === DISPLAY.TRAILS || display === DISPLAY.RGB_SPLIT_TRAILS;

const confidenceColor = (confidence: number): [number, number, number] => {
  const c = Math.max(0, Math.min(1, confidence));
  return [
    Math.round(40 + c * 215),
    Math.round(40 + c * 215),
    Math.round(50 + c * 80),
  ];
};

const averageBlockColor = (
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  cellSize: number,
): [number, number, number] => {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let yy = 0; yy < cellSize; yy += 1) {
    const y = y0 + yy;
    if (y >= height) break;
    for (let xx = 0; xx < cellSize; xx += 1) {
      const x = x0 + xx;
      if (x >= width) break;
      const i = getBufferIndex(x, y, width);
      r += buf[i];
      g += buf[i + 1];
      b += buf[i + 2];
      count += 1;
    }
  }

  return count > 0
    ? [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
    : [255, 255, 255];
};

const resolveVectorColor = (
  vector: MotionVector,
  sourceMode: string,
  colorMode: string,
  sourceColor: [number, number, number],
): [number, number, number] => {
  if (colorMode === COLOR.WHITE) return [245, 245, 245];
  if (colorMode === COLOR.SOURCE) return sourceColor;
  if (colorMode === COLOR.CHANNEL) return channelTint(sourceMode);
  if (colorMode === COLOR.CONFIDENCE) return confidenceColor(vector.confidence);
  if (colorMode === COLOR.MAGNITUDE) return magnitudeHeat(vector.motionStrength);
  return directionColor(vector.dx, vector.dy, vector.motionStrength, vector.confidence, true);
};

export const optionTypes = {
  display: {
    type: ENUM,
    label: "Render Mode",
    options: [
      { name: "Arrows", value: DISPLAY.ARROWS },
      { name: "Arrows on source", value: DISPLAY.OVERLAY },
      { name: "Magnitude heat", value: DISPLAY.HEAT },
      { name: "Heat + arrows", value: DISPLAY.HEAT_ARROWS },
      { name: "Trails", value: DISPLAY.TRAILS },
      { name: "RGB split arrows", value: DISPLAY.RGB_SPLIT_ARROWS },
      { name: "RGB split overlay", value: DISPLAY.RGB_SPLIT_OVERLAY },
      { name: "RGB split trails", value: DISPLAY.RGB_SPLIT_TRAILS },
      { name: "HSV split arrows", value: DISPLAY.HSV_SPLIT_ARROWS },
      { name: "HSV split overlay", value: DISPLAY.HSV_SPLIT_OVERLAY },
      { name: "HSL split arrows", value: DISPLAY.HSL_SPLIT_ARROWS },
      { name: "HSL split overlay", value: DISPLAY.HSL_SPLIT_OVERLAY },
    ],
    default: DISPLAY.OVERLAY,
    desc: "Choose whether motion reads as a clean vector overlay, a heatmap, or persistent trails",
  },
  sourceMode: {
    type: ENUM,
    label: "Track From",
    options: [
      { name: "RGB", value: MOTION_SOURCE.RGB },
      { name: "Red", value: MOTION_SOURCE.RED },
      { name: "Green", value: MOTION_SOURCE.GREEN },
      { name: "Blue", value: MOTION_SOURCE.BLUE },
      { name: "Luma", value: MOTION_SOURCE.LUMA },
    ],
    default: MOTION_SOURCE.LUMA,
    desc: "Pick which signal drives block matching. Luma is usually the most stable starting point",
    visibleWhen: (options) => !isSplitDisplay(options.display),
  },
  cellSize: {
    type: RANGE,
    label: "Grid Size",
    range: [4, 32],
    step: 1,
    default: 12,
    desc: "Smaller cells capture finer motion; larger cells give a cleaner, more graphic field",
  },
  searchRadius: {
    type: RANGE,
    label: "Search Radius",
    range: [1, 20],
    step: 1,
    default: 6,
    desc: "How far each cell searches into the previous frame for its best match",
  },
  threshold: {
    type: RANGE,
    label: "Match Threshold",
    range: [0, 100],
    step: 1,
    default: 14,
    desc: "Higher values admit weaker matches; lower values keep only cleaner motion estimates",
  },
  minMagnitude: {
    type: RANGE,
    label: "Minimum Motion",
    range: [0, 4],
    step: 0.1,
    default: 0.35,
    desc: "Hide tiny vectors that mostly read as shimmer or sensor noise",
    visibleWhen: (options) => !isHeatDisplay(options.display),
  },
  confidenceCutoff: {
    type: RANGE,
    label: "Confidence Cutoff",
    range: [0, 1],
    step: 0.01,
    default: 0.08,
    desc: "Suppress vectors whose block match is ambiguous",
  },
  gain: {
    type: RANGE,
    label: "Vector Length",
    range: [0.5, 10],
    step: 0.1,
    default: 2.4,
    desc: "Boost how far vectors extend from each cell center",
    visibleWhen: (options) => !isHeatDisplay(options.display),
  },
  colorMode: {
    type: ENUM,
    label: "Color Story",
    options: [
      { name: "Direction wheel", value: COLOR.DIRECTION },
      { name: "Magnitude heat", value: COLOR.MAGNITUDE },
      { name: "Source color", value: COLOR.SOURCE },
      { name: "Channel tint", value: COLOR.CHANNEL },
      { name: "Confidence", value: COLOR.CONFIDENCE },
      { name: "White", value: COLOR.WHITE },
    ],
    default: COLOR.DIRECTION,
    desc: "Choose whether color encodes direction, strength, source color, or confidence",
    visibleWhen: (options) => !isHeatDisplay(options.display) && !isSplitDisplay(options.display),
  },
  glyphMode: {
    type: ENUM,
    label: "Glyph Style",
    options: [
      { name: "Arrow", value: GLYPH.ARROW },
      { name: "Needle", value: GLYPH.NEEDLE },
      { name: "Line", value: GLYPH.LINE },
      { name: "Triangle", value: GLYPH.TRIANGLE },
      { name: "Dot + tail", value: GLYPH.DOT },
    ],
    default: GLYPH.NEEDLE,
    desc: "Swap classic arrows for cleaner needles, lines, triangles, or comet-like tails",
    visibleWhen: (options) => !isHeatDisplay(options.display),
  },
  temporalSmoothing: {
    type: RANGE,
    label: "Temporal Smoothing",
    range: [0, 0.95],
    step: 0.05,
    default: 0.4,
    desc: "Blend with the previous vector field to reduce flicker and jitter",
  },
  spatialSmoothing: {
    type: RANGE,
    label: "Spatial Smoothing",
    range: [0, 1],
    step: 0.05,
    default: 0.25,
    desc: "Average neighboring cells so the field feels more coherent",
  },
  showMagnitude: {
    type: BOOL,
    label: "Fade By Speed",
    default: true,
    desc: "Dim short vectors and emphasize stronger motion",
    visibleWhen: (options) => !isHeatDisplay(options.display) && !isSplitDisplay(options.display),
  },
  backgroundDim: {
    type: RANGE,
    label: "Background Amount",
    range: [0, 1],
    step: 0.05,
    default: 0.55,
    desc: "How much of the source image stays visible behind overlays",
    visibleWhen: (options) => options.display !== DISPLAY.ARROWS && options.display !== DISPLAY.RGB_SPLIT_ARROWS,
  },
  trailDecay: {
    type: RANGE,
    label: "Trail Decay",
    range: [0.5, 0.99],
    step: 0.01,
    default: 0.88,
    desc: "How slowly older vectors fade when using trail mode",
    visibleWhen: (options) => isTrailDisplay(options.display),
  },
  animSpeed: {
    type: RANGE,
    label: "Playback FPS",
    range: [1, 30],
    step: 1,
    default: 15,
    desc: "Playback speed when using the built-in animation toggle",
  },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) actions.stopAnimLoop();
    else actions.startAnimLoop(inputCanvas, options.animSpeed || 15);
  } },
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  searchRadius: optionTypes.searchRadius.default,
  threshold: optionTypes.threshold.default,
  gain: optionTypes.gain.default,
  display: optionTypes.display.default,
  sourceMode: optionTypes.sourceMode.default,
  colorMode: optionTypes.colorMode.default,
  glyphMode: optionTypes.glyphMode.default,
  minMagnitude: optionTypes.minMagnitude.default,
  confidenceCutoff: optionTypes.confidenceCutoff.default,
  temporalSmoothing: optionTypes.temporalSmoothing.default,
  spatialSmoothing: optionTypes.spatialSmoothing.default,
  showMagnitude: optionTypes.showMagnitude.default,
  backgroundDim: optionTypes.backgroundDim.default,
  trailDecay: optionTypes.trailDecay.default,
  animSpeed: optionTypes.animSpeed.default,
};

const motionVectors = (input, options: any = defaults) => {
  const prevInput: Uint8ClampedArray | null = options._prevInput || null;
  const prevOutput: Uint8ClampedArray | null = options._prevOutput || null;
  const {
    cellSize,
    searchRadius,
    threshold,
    gain,
    display,
    sourceMode,
    colorMode,
    glyphMode,
    minMagnitude,
    confidenceCutoff,
    temporalSmoothing,
    spatialSmoothing,
    showMagnitude,
    backgroundDim,
    trailDecay,
  } = options;
  const splitDisplay = isSplitDisplay(display);
  const heatDisplay = isHeatDisplay(display);
  const overlayDisplay = isOverlayDisplay(display);
  const trailDisplay = isTrailDisplay(display);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  if (overlayDisplay) {
    outBuf.set(buf);
  } else if (trailDisplay && prevOutput && prevOutput.length === buf.length) {
    outBuf.set(prevOutput);
    fadeBuffer(outBuf, trailDecay);
    if (backgroundDim > 0) blendSourceIntoBuffer(outBuf, buf, backgroundDim * 0.18);
  } else {
    neutralMotionBackground(outBuf);
    if (heatDisplay && backgroundDim > 0) {
      blendSourceIntoBuffer(outBuf, buf, backgroundDim * 0.15);
    }
  }

  if (!prevInput || prevInput.length !== buf.length) {
    if (!trailDisplay) {
      if (overlayDisplay) {
        outBuf.set(buf);
      } else {
        neutralMotionBackground(outBuf);
        if (backgroundDim > 0) blendSourceIntoBuffer(outBuf, buf, backgroundDim * 0.35);
      }
    }
    outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
    return output;
  }

  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cellCount = cols * rows;
  const splitChannels = display === DISPLAY.HSV_SPLIT_ARROWS || display === DISPLAY.HSV_SPLIT_OVERLAY
    ? HSV_SPLIT_CHANNELS
    : display === DISPLAY.HSL_SPLIT_ARROWS || display === DISPLAY.HSL_SPLIT_OVERLAY
      ? HSL_SPLIT_CHANNELS
      : RGB_SPLIT_CHANNELS;
  const splitColors = display === DISPLAY.HSV_SPLIT_ARROWS || display === DISPLAY.HSV_SPLIT_OVERLAY
    ? HSV_SPLIT_COLORS
    : display === DISPLAY.HSL_SPLIT_ARROWS || display === DISPLAY.HSL_SPLIT_OVERLAY
      ? HSL_SPLIT_COLORS
      : RGB_SPLIT_COLORS;
  const cacheMode = splitDisplay ? display : sourceMode;
  const cacheKey = `${width}x${height}:${cellSize}:${searchRadius}:${cacheMode}`;
  const needsSourceColor = colorMode === COLOR.SOURCE && !splitDisplay;

  let vectorFields: MotionVector[][];

  if (splitDisplay) {
    const previousCombined = decodeVectorState(vectorStateCache.get(cacheKey) || null, cellCount * splitChannels.length);
    const previousFields = previousCombined
      ? splitChannels.map((_, channelIndex) => previousCombined.slice(channelIndex * cellCount, (channelIndex + 1) * cellCount))
      : [];

    vectorFields = splitChannels.map((channelMode, channelIndex) => {
      const analysisBuffers = prepareMotionAnalysisBuffers(buf, prevInput, width, height, channelMode);
      const estimated = new Array<MotionVector>(cellCount);
      let vectorIndex = 0;
      for (let y = 0; y < height; y += cellSize) {
        for (let x = 0; x < width; x += cellSize) {
          estimated[vectorIndex] = estimateMotionVector(
            buf,
            prevInput,
            width,
            height,
            x,
            y,
            cellSize,
            searchRadius,
            threshold,
            channelMode,
            analysisBuffers,
          );
          vectorIndex += 1;
        }
      }

      let vectors = blurVectorGrid(estimated, cols, rows, spatialSmoothing, searchRadius);
      vectors = blendVectorFields(vectors, previousFields[channelIndex], temporalSmoothing);
      return vectors;
    });

    setCachedVectors(cacheKey, encodeVectorStateGroups(vectorFields));
  } else {
    const analysisBuffers = prepareMotionAnalysisBuffers(buf, prevInput, width, height, sourceMode);
    const estimated = new Array<MotionVector>(cellCount);
    let vectorIndex = 0;
    for (let y = 0; y < height; y += cellSize) {
      for (let x = 0; x < width; x += cellSize) {
        estimated[vectorIndex] = estimateMotionVector(
          buf,
          prevInput,
          width,
          height,
          x,
          y,
          cellSize,
          searchRadius,
          threshold,
          sourceMode,
          analysisBuffers,
        );
        vectorIndex += 1;
      }
    }

    const previousVectors = decodeVectorState(vectorStateCache.get(cacheKey) || null, estimated.length);
    let vectors = blurVectorGrid(estimated, cols, rows, spatialSmoothing, searchRadius);
    vectors = blendVectorFields(vectors, previousVectors, temporalSmoothing);
    setCachedVectors(cacheKey, encodeVectorState(vectors));
    vectorFields = [vectors];
  }

  let vectorIndex = 0;
  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      const vector = vectorFields[0][vectorIndex];
      const sourceColor = needsSourceColor
        ? averageBlockColor(buf, width, height, x, y, cellSize)
        : WHITE_COLOR;

      if (heatDisplay) {
        const heatColor = magnitudeHeat(vector.motionStrength);
        const heatAlpha = Math.max(0, vector.motionStrength - confidenceCutoff * 0.5);
        if (heatAlpha > 0) {
          for (let yy = 0; yy < cellSize; yy += 1) {
            const py = y + yy;
            if (py >= height) break;
            for (let xx = 0; xx < cellSize; xx += 1) {
              const px = x + xx;
              if (px >= width) break;
              const i = getBufferIndex(px, py, width);
              outBuf[i] = Math.round(outBuf[i] * (1 - heatAlpha) + heatColor[0] * heatAlpha);
              outBuf[i + 1] = Math.round(outBuf[i + 1] * (1 - heatAlpha) + heatColor[1] * heatAlpha);
              outBuf[i + 2] = Math.round(outBuf[i + 2] * (1 - heatAlpha) + heatColor[2] * heatAlpha);
              outBuf[i + 3] = 255;
            }
          }
        }
      }

      if (!splitDisplay && (vector.error > threshold || vector.magnitude < minMagnitude || vector.confidence < confidenceCutoff)) {
        vectorIndex += 1;
        continue;
      }

      const centerX = x + Math.min(cellSize, width - x) / 2;
      const centerY = y + Math.min(cellSize, height - y) / 2;
      const scale = gain * (cellSize / Math.max(4, searchRadius));
      if (splitDisplay) {
        for (let channelIndex = 0; channelIndex < splitChannels.length; channelIndex += 1) {
          const splitVector = vectorFields[channelIndex][vectorIndex];
          if (splitVector.error > threshold || splitVector.magnitude < minMagnitude || splitVector.confidence < confidenceCutoff) {
            continue;
          }
          const offsetX = centerX + cellSize * SPLIT_OFFSETS[channelIndex][0];
          const offsetY = centerY + cellSize * SPLIT_OFFSETS[channelIndex][1];
          const endX = offsetX + splitVector.dx * scale;
          const endY = offsetY + splitVector.dy * scale;
          const alpha = Math.round(115 + splitVector.motionStrength * 120);
          drawVectorGlyph(outBuf, width, height, offsetX, offsetY, endX, endY, splitColors[channelIndex], glyphMode, alpha);
        }
      } else {
        const endX = centerX + vector.dx * scale;
        const endY = centerY + vector.dy * scale;
        const color = resolveVectorColor(vector, sourceMode, colorMode, sourceColor);
        const alpha = showMagnitude
          ? Math.round(120 + vector.motionStrength * 135)
          : 235;

        if (display !== DISPLAY.HEAT) {
          drawVectorGlyph(outBuf, width, height, centerX, centerY, endX, endY, color, glyphMode, alpha);
        }
      }

      vectorIndex += 1;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default {
  name: "Motion Vectors",
  func: motionVectors,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Estimate local motion between frames and render stable arrows, trails, or heat overlays for debugging and stylized analysis",
};
