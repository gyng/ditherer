const getBufferIndex = (x: number, y: number, width: number) => (x + width * y) * 4;
const fillBufferPixel = (
  buf: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number,
) => {
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
};

export const MOTION_SOURCE = {
  RGB: "RGB",
  RED: "RED",
  GREEN: "GREEN",
  BLUE: "BLUE",
  LUMA: "LUMA",
  HUE: "HUE",
  HSV_SATURATION: "HSV_SATURATION",
  VALUE: "VALUE",
  HSL_SATURATION: "HSL_SATURATION",
  LIGHTNESS: "LIGHTNESS",
} as const;

export type MotionSourceMode = typeof MOTION_SOURCE[keyof typeof MOTION_SOURCE];

export type MotionVector = {
  dx: number;
  dy: number;
  magnitude: number;
  motionStrength: number;
  confidence: number;
  error: number;
};

export type MotionAnalysisBuffers = {
  currentScalar: Float32Array | null;
  previousScalar: Float32Array | null;
  circularRange: number;
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const clampCoord = (min: number, max: number, value: number) => Math.max(min, Math.min(max, value));
const readChannel = (buf: Uint8ClampedArray | Float32Array, index: number) => buf[index] ?? 0;
const getMotionVector = (vectors: MotionVector[], index: number): MotionVector =>
  vectors[index] ?? { dx: 0, dy: 0, magnitude: 0, motionStrength: 0, confidence: 0, error: 1 };

export const prepareMotionAnalysisBuffers = (
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  width: number,
  height: number,
  mode: MotionSourceMode,
): MotionAnalysisBuffers => {
  if (mode === MOTION_SOURCE.RGB) {
    return {
      currentScalar: null,
      previousScalar: null,
      circularRange: 0,
    };
  }

  const pixelCount = width * height;
  const currentScalar = new Float32Array(pixelCount);
  const previousScalar = new Float32Array(pixelCount);
  const isHueMode = mode === MOTION_SOURCE.HUE;
  const isHsvSaturationMode = mode === MOTION_SOURCE.HSV_SATURATION;
  const isValueMode = mode === MOTION_SOURCE.VALUE;
  const isHslSaturationMode = mode === MOTION_SOURCE.HSL_SATURATION;
  const isLightnessMode = mode === MOTION_SOURCE.LIGHTNESS;

  for (let i = 0, p = 0; i < current.length; i += 4, p += 1) {
    const curRByte = current[i] ?? 0;
    const curGByte = current[i + 1] ?? 0;
    const curBByte = current[i + 2] ?? 0;
    const prevRByte = previous[i] ?? 0;
    const prevGByte = previous[i + 1] ?? 0;
    const prevBByte = previous[i + 2] ?? 0;
    if (mode === MOTION_SOURCE.RED) {
      currentScalar[p] = curRByte;
      previousScalar[p] = prevRByte;
    } else if (mode === MOTION_SOURCE.GREEN) {
      currentScalar[p] = curGByte;
      previousScalar[p] = prevGByte;
    } else if (mode === MOTION_SOURCE.BLUE) {
      currentScalar[p] = curBByte;
      previousScalar[p] = prevBByte;
    } else if (isHueMode || isHsvSaturationMode || isValueMode || isHslSaturationMode || isLightnessMode) {
      const curR = curRByte / 255;
      const curG = curGByte / 255;
      const curB = curBByte / 255;
      const prevR = prevRByte / 255;
      const prevG = prevGByte / 255;
      const prevB = prevBByte / 255;

      const curMax = Math.max(curR, curG, curB);
      const curMin = Math.min(curR, curG, curB);
      const curDelta = curMax - curMin;
      const prevMax = Math.max(prevR, prevG, prevB);
      const prevMin = Math.min(prevR, prevG, prevB);
      const prevDelta = prevMax - prevMin;

      let curHue = 0;
      let prevHue = 0;
      if (curDelta > 0) {
        curHue = curMax === curR
          ? ((curG - curB) / curDelta + (curG < curB ? 6 : 0)) * 60
          : curMax === curG
            ? ((curB - curR) / curDelta + 2) * 60
            : ((curR - curG) / curDelta + 4) * 60;
      }
      if (prevDelta > 0) {
        prevHue = prevMax === prevR
          ? ((prevG - prevB) / prevDelta + (prevG < prevB ? 6 : 0)) * 60
          : prevMax === prevG
            ? ((prevB - prevR) / prevDelta + 2) * 60
            : ((prevR - prevG) / prevDelta + 4) * 60;
      }

      if (isHueMode) {
        currentScalar[p] = curHue;
        previousScalar[p] = prevHue;
      } else if (isHsvSaturationMode) {
        currentScalar[p] = curMax > 0 ? (curDelta / curMax) * 255 : 0;
        previousScalar[p] = prevMax > 0 ? (prevDelta / prevMax) * 255 : 0;
      } else if (isValueMode) {
        currentScalar[p] = curMax * 255;
        previousScalar[p] = prevMax * 255;
      } else if (isHslSaturationMode) {
        const curLightness = (curMax + curMin) * 0.5;
        const prevLightness = (prevMax + prevMin) * 0.5;
        currentScalar[p] = curDelta > 0 ? (curDelta / (1 - Math.abs(2 * curLightness - 1))) * 255 : 0;
        previousScalar[p] = prevDelta > 0 ? (prevDelta / (1 - Math.abs(2 * prevLightness - 1))) * 255 : 0;
        if (!Number.isFinite(currentScalar[p])) currentScalar[p] = 0;
        if (!Number.isFinite(previousScalar[p])) previousScalar[p] = 0;
      } else {
        currentScalar[p] = ((curMax + curMin) * 0.5) * 255;
        previousScalar[p] = ((prevMax + prevMin) * 0.5) * 255;
      }
    } else {
      currentScalar[p] = curRByte * 0.2126 + curGByte * 0.7152 + curBByte * 0.0722;
      previousScalar[p] = prevRByte * 0.2126 + prevGByte * 0.7152 + prevBByte * 0.0722;
    }
  }

  return {
    currentScalar,
    previousScalar,
    circularRange: isHueMode ? 360 : 0,
  };
};

export const hsvToRgb = (h: number, s: number, v: number): [number, number, number] => {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
  const m = v - c;
  let r: number;
  let g: number;
  let b: number;

  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [
    clamp255((r + m) * 255),
    clamp255((g + m) * 255),
    clamp255((b + m) * 255),
  ];
};

export const directionColor = (
  dx: number,
  dy: number,
  motionStrength: number,
  confidence: number,
  emphasizeMagnitude = true,
): [number, number, number] => {
  const angle = Math.atan2(-dy, dx);
  const hue = (angle / (Math.PI * 2)) * 360;
  const value = emphasizeMagnitude ? Math.max(0.25, motionStrength) : 0.95;
  const saturation = Math.max(0.35, confidence);
  return hsvToRgb(hue, saturation, value);
};

export const drawLine = (
  outBuf: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
  alpha = 255,
) => {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      fillBufferPixel(outBuf, getBufferIndex(x, y, width), color[0], color[1], color[2], alpha);
    }
    if (x === tx && y === ty) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
};

export const drawVectorGlyph = (
  outBuf: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
  glyphMode: string,
  alpha = 255,
) => {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const magnitude = Math.sqrt(vx * vx + vy * vy);
  if (magnitude < 0.05) return;

  if (glyphMode === "LINE") {
    drawLine(outBuf, width, height, x0, y0, x1, y1, color, alpha);
    return;
  }

  const ux = vx / magnitude;
  const uy = vy / magnitude;
  const nx = -uy;
  const ny = ux;
  const head = Math.max(2, Math.min(6, magnitude * 0.35));
  const tailX = x0 - ux * Math.min(1.2, magnitude * 0.08);
  const tailY = y0 - uy * Math.min(1.2, magnitude * 0.08);

  if (glyphMode === "DOT") {
    drawLine(outBuf, width, height, tailX, tailY, x1, y1, color, alpha);
    drawLine(outBuf, width, height, x0 - 1, y0, x0 + 1, y0, color, alpha);
    drawLine(outBuf, width, height, x0, y0 - 1, x0, y0 + 1, color, alpha);
    return;
  }

  if (glyphMode === "NEEDLE") {
    drawLine(outBuf, width, height, tailX, tailY, x1, y1, color, alpha);
    const backX = x1 - ux * head;
    const backY = y1 - uy * head;
    drawLine(outBuf, width, height, x1, y1, backX + nx * head * 0.35, backY + ny * head * 0.35, color, alpha);
    drawLine(outBuf, width, height, x1, y1, backX - nx * head * 0.35, backY - ny * head * 0.35, color, alpha);
    return;
  }

  if (glyphMode === "TRIANGLE") {
    const backX = x1 - ux * head;
    const backY = y1 - uy * head;
    drawLine(outBuf, width, height, tailX, tailY, backX, backY, color, alpha);
    drawLine(outBuf, width, height, x1, y1, backX + nx * head * 0.55, backY + ny * head * 0.55, color, alpha);
    drawLine(outBuf, width, height, x1, y1, backX - nx * head * 0.55, backY - ny * head * 0.55, color, alpha);
    drawLine(
      outBuf,
      width,
      height,
      backX + nx * head * 0.55,
      backY + ny * head * 0.55,
      backX - nx * head * 0.55,
      backY - ny * head * 0.55,
      color,
      alpha,
    );
    return;
  }

  drawLine(outBuf, width, height, tailX, tailY, x1, y1, color, alpha);
  drawLine(outBuf, width, height, x1, y1, x1 - ux * head + nx * head * 0.5, y1 - uy * head + ny * head * 0.5, color, alpha);
  drawLine(outBuf, width, height, x1, y1, x1 - ux * head - nx * head * 0.5, y1 - uy * head - ny * head * 0.5, color, alpha);
};

export const averageBlockError = (
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  blockSize: number,
  dx: number,
  dy: number,
  mode: MotionSourceMode,
  currentScalar: Float32Array | null = null,
  previousScalar: Float32Array | null = null,
  circularRange = 0,
  bestKnownError = Infinity,
) => {
  let error = 0;
  let count = 0;
  const maxAcceptedError = bestKnownError;

  for (let yy = 0; yy < blockSize; yy += 1) {
    const y = y0 + yy;
    if (y >= height) break;
    const sampleY = clampCoord(0, height - 1, y + dy);
    const rowOffset = y * width;
    const sampleRowOffset = sampleY * width;
    for (let xx = 0; xx < blockSize; xx += 1) {
      const x = x0 + xx;
      if (x >= width) break;
      const i = getBufferIndex(x, y, width);
      const sampleX = clampCoord(0, width - 1, x + dx);

      if (mode === MOTION_SOURCE.RGB) {
        const sampleIndex = getBufferIndex(sampleX, sampleY, width);
        error += Math.abs(readChannel(current, i) - readChannel(previous, sampleIndex));
        error += Math.abs(readChannel(current, i + 1) - readChannel(previous, sampleIndex + 1));
        error += Math.abs(readChannel(current, i + 2) - readChannel(previous, sampleIndex + 2));
        count += 3;
      } else {
        const scalarIndex = rowOffset + x;
        const sampleScalarIndex = sampleRowOffset + sampleX;
        const sampleIndex = getBufferIndex(sampleX, sampleY, width);
        const currentValue = currentScalar ? (currentScalar[scalarIndex] ?? 0) : (
          mode === MOTION_SOURCE.RED ? readChannel(current, i)
            : mode === MOTION_SOURCE.GREEN ? readChannel(current, i + 1)
            : mode === MOTION_SOURCE.BLUE ? readChannel(current, i + 2)
            : readChannel(current, i) * 0.2126 + readChannel(current, i + 1) * 0.7152 + readChannel(current, i + 2) * 0.0722
        );

        const prevValue = previousScalar
          ? (previousScalar[sampleScalarIndex] ?? 0)
          : mode === MOTION_SOURCE.RED ? readChannel(previous, sampleIndex)
            : mode === MOTION_SOURCE.GREEN ? readChannel(previous, sampleIndex + 1)
            : mode === MOTION_SOURCE.BLUE ? readChannel(previous, sampleIndex + 2)
            : readChannel(previous, sampleIndex) * 0.2126
              + readChannel(previous, sampleIndex + 1) * 0.7152
              + readChannel(previous, sampleIndex + 2) * 0.0722;
        const diff = Math.abs(currentValue - prevValue);
        error += circularRange > 0 ? Math.min(diff, circularRange - diff) : diff;
        count += 1;
      }

      if (count > 0 && error > maxAcceptedError * count) {
        return error / count;
      }
    }
  }

  return count > 0 ? error / count : Infinity;
};

export const estimateMotionVector = (
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  cellSize: number,
  searchRadius: number,
  threshold: number,
  mode: MotionSourceMode,
  analysisBuffers: MotionAnalysisBuffers | null = null,
): MotionVector => {
  let bestDx = 0;
  let bestDy = 0;
  let bestError = Infinity;
  const currentScalar = analysisBuffers?.currentScalar || null;
  const previousScalar = analysisBuffers?.previousScalar || null;
  const circularRange = analysisBuffers?.circularRange || 0;

  for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
      const error = averageBlockError(
        current,
        previous,
        width,
        height,
        x,
        y,
        cellSize,
        dx,
        dy,
        mode,
        currentScalar,
        previousScalar,
        circularRange,
        bestError,
      );
      if (error < bestError) {
        bestError = error;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  const magnitude = Math.sqrt(bestDx * bestDx + bestDy * bestDy);
  const motionStrength = clamp01(magnitude / Math.max(1, searchRadius));
  const confidence = clamp01((threshold - bestError) / Math.max(1, threshold));

  return {
    dx: bestDx,
    dy: bestDy,
    magnitude,
    motionStrength,
    confidence,
    error: bestError,
  };
};

export const blurVectorGrid = (
  vectors: MotionVector[],
  cols: number,
  rows: number,
  amount: number,
  searchRadius: number,
) => {
  if (amount <= 0) return vectors.map(vector => ({ ...vector }));

  const out = new Array<MotionVector>(vectors.length);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let sumDx = 0;
      let sumDy = 0;
      let sumConfidence = 0;
      let sumError = 0;
      let weightSum = 0;

      for (let oy = -1; oy <= 1; oy += 1) {
        const ny = y + oy;
        if (ny < 0 || ny >= rows) continue;
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox;
          if (nx < 0 || nx >= cols) continue;
          const neighbor = getMotionVector(vectors, ny * cols + nx);
          const weight = ox === 0 && oy === 0 ? 2 : 1;
          sumDx += neighbor.dx * weight;
          sumDy += neighbor.dy * weight;
          sumConfidence += neighbor.confidence * weight;
          sumError += neighbor.error * weight;
          weightSum += weight;
        }
      }

      const current = getMotionVector(vectors, y * cols + x);
      const avgDx = sumDx / weightSum;
      const avgDy = sumDy / weightSum;
      const blendedDx = current.dx * (1 - amount) + avgDx * amount;
      const blendedDy = current.dy * (1 - amount) + avgDy * amount;
      const magnitude = Math.sqrt(blendedDx * blendedDx + blendedDy * blendedDy);

      out[y * cols + x] = {
        dx: blendedDx,
        dy: blendedDy,
        magnitude,
        motionStrength: clamp01(magnitude / Math.max(1, searchRadius)),
        confidence: current.confidence * (1 - amount) + (sumConfidence / weightSum) * amount,
        error: current.error * (1 - amount) + (sumError / weightSum) * amount,
      };
    }
  }

  return out;
};

export const blendVectorFields = (
  current: MotionVector[],
  previous: MotionVector[] | undefined,
  amount: number,
) => {
  if (!previous || amount <= 0 || previous.length !== current.length) {
    return current.map(vector => ({ ...vector }));
  }

  const out = new Array<MotionVector>(current.length);
  for (let i = 0; i < current.length; i += 1) {
    const cur = getMotionVector(current, i);
    const prev = getMotionVector(previous, i);
    const dx = cur.dx * (1 - amount) + prev.dx * amount;
    const dy = cur.dy * (1 - amount) + prev.dy * amount;
    const magnitude = Math.sqrt(dx * dx + dy * dy);
    out[i] = {
      dx,
      dy,
      magnitude,
      motionStrength: cur.motionStrength * (1 - amount) + prev.motionStrength * amount,
      confidence: cur.confidence * (1 - amount) + prev.confidence * amount,
      error: cur.error * (1 - amount) + prev.error * amount,
    };
  }
  return out;
};

export const encodeVectorState = (vectors: MotionVector[]) => {
  const out = new Float32Array(vectors.length * 4);
  for (let i = 0; i < vectors.length; i += 1) {
    const base = i * 4;
    const vector = getMotionVector(vectors, i);
    out[base] = vector.dx;
    out[base + 1] = vector.dy;
    out[base + 2] = vector.confidence;
    out[base + 3] = vector.motionStrength;
  }
  return out;
};

export const encodeVectorStateGroups = (vectorGroups: MotionVector[][]) => {
  let totalLength = 0;
  for (let i = 0; i < vectorGroups.length; i += 1) {
    totalLength += vectorGroups[i]?.length ?? 0;
  }

  const out = new Float32Array(totalLength * 4);
  let cursor = 0;
  for (let groupIndex = 0; groupIndex < vectorGroups.length; groupIndex += 1) {
    const vectors = vectorGroups[groupIndex] ?? [];
    for (let i = 0; i < vectors.length; i += 1) {
      const vector = getMotionVector(vectors, i);
      out[cursor] = vector.dx;
      out[cursor + 1] = vector.dy;
      out[cursor + 2] = vector.confidence;
      out[cursor + 3] = vector.motionStrength;
      cursor += 4;
    }
  }
  return out;
};

export const decodeVectorState = (state: Float32Array | null | undefined, expectedLength: number) => {
  if (!state || state.length !== expectedLength * 4) return undefined;
  const out = new Array<MotionVector>(expectedLength);
  for (let i = 0; i < expectedLength; i += 1) {
    const base = i * 4;
    const dx = state[base] ?? 0;
    const dy = state[base + 1] ?? 0;
    const confidence = state[base + 2] ?? 0;
    const motionStrength = state[base + 3] ?? 0;
    out[i] = {
      dx,
      dy,
      magnitude: Math.sqrt(dx * dx + dy * dy),
      confidence,
      motionStrength,
      error: Math.max(0, 1 - confidence),
    };
  }
  return out;
};

export const fadeBuffer = (outBuf: Uint8ClampedArray, factor: number) => {
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = clamp255((outBuf[i] ?? 0) * factor);
    outBuf[i + 1] = clamp255((outBuf[i + 1] ?? 0) * factor);
    outBuf[i + 2] = clamp255((outBuf[i + 2] ?? 0) * factor);
    outBuf[i + 3] = 255;
  }
};

export const blendSourceIntoBuffer = (outBuf: Uint8ClampedArray, source: Uint8ClampedArray, dim: number) => {
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = clamp255((outBuf[i] ?? 0) + (source[i] ?? 0) * dim);
    outBuf[i + 1] = clamp255((outBuf[i + 1] ?? 0) + (source[i + 1] ?? 0) * dim);
    outBuf[i + 2] = clamp255((outBuf[i + 2] ?? 0) + (source[i + 2] ?? 0) * dim);
    outBuf[i + 3] = 255;
  }
};

export const neutralMotionBackground = (outBuf: Uint8ClampedArray, r = 12, g = 12, b = 14) => {
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = r;
    outBuf[i + 1] = g;
    outBuf[i + 2] = b;
    outBuf[i + 3] = 255;
  }
};

export const clearMotionVectorStateCache = (cache: Map<string, Float32Array>) => {
  cache.clear();
};
