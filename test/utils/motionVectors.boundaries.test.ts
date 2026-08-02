import { describe, expect, it } from "vitest";
import {
  MOTION_SOURCE,
  averageBlockError,
  blendSourceIntoBuffer,
  blendVectorFields,
  blurVectorGrid,
  decodeVectorState,
  directionColor,
  drawLine,
  drawVectorGlyph,
  encodeVectorState,
  encodeVectorStateGroups,
  fadeBuffer,
  hsvToRgb,
  neutralMotionBackground,
  prepareMotionAnalysisBuffers,
  type MotionVector,
} from "@gyng/ditherer-filters";

const vector = (dx: number, dy: number, confidence = 0.5): MotionVector => ({
  dx,
  dy,
  magnitude: Math.hypot(dx, dy),
  motionStrength: Math.min(1, Math.hypot(dx, dy)),
  confidence,
  error: 1 - confidence,
});

describe("motion-vector helper boundaries", () => {
  it("projects every scalar source mode and hue dominant-channel segment", () => {
    const current = new Uint8ClampedArray([
      255, 0, 128, 255, 0, 255, 64, 255, 64, 0, 255, 255, 0, 0, 0, 255,
    ]);
    const previous = new Uint8ClampedArray([
      255, 128, 0, 255, 64, 255, 0, 255, 0, 64, 255, 255, 255, 255, 255, 255,
    ]);
    expect(
      prepareMotionAnalysisBuffers(current, previous, 4, 1, MOTION_SOURCE.RGB).currentScalar,
    ).toBeNull();
    for (const mode of Object.values(MOTION_SOURCE).filter((mode) => mode !== MOTION_SOURCE.RGB)) {
      const result = prepareMotionAnalysisBuffers(current, previous, 4, 1, mode);
      expect(result.currentScalar).toHaveLength(4);
      expect(result.previousScalar).toHaveLength(4);
      expect(result.circularRange).toBe(mode === MOTION_SOURCE.HUE ? 360 : 0);
    }
  });

  it("maps every hue sextant, magnitude mode, line direction, and glyph", () => {
    for (const hue of [-30, 0, 60, 120, 180, 240, 300, 360]) {
      expect(hsvToRgb(hue, 0.8, 0.9)).toHaveLength(3);
    }
    expect(directionColor(1, -1, 0.1, 0.1, true)).toHaveLength(3);
    expect(directionColor(-1, 1, 0.1, 0.1, false)).toHaveLength(3);

    const buffer = new Uint8ClampedArray(12 * 12 * 4);
    drawLine(buffer, 12, 12, -2, -2, 5, 2, [1, 2, 3]);
    drawLine(buffer, 12, 12, 8, 10, 2, 1, [3, 2, 1], 64);
    drawVectorGlyph(buffer, 12, 12, 1, 1, 1.01, 1.01, [255, 0, 0], "ARROW");
    for (const glyph of ["LINE", "DOT", "NEEDLE", "TRIANGLE", "ARROW"]) {
      drawVectorGlyph(buffer, 12, 12, 2, 2, 9, 7, [255, 255, 255], glyph, 128);
    }
    expect(buffer.some((value) => value > 0)).toBe(true);
  });

  it("handles scalar/RGB error boundaries and early rejection", () => {
    const current = new Uint8ClampedArray([255, 10, 20, 255, 0, 200, 30, 255]);
    const previous = new Uint8ClampedArray([0, 10, 200, 255, 255, 20, 30, 255]);
    expect(averageBlockError(current, previous, 0, 0, 0, 0, 1, 0, 0, MOTION_SOURCE.RGB)).toBe(
      Infinity,
    );
    expect(
      averageBlockError(
        current,
        previous,
        2,
        1,
        0,
        0,
        2,
        0,
        0,
        MOTION_SOURCE.RGB,
        null,
        null,
        0,
        0,
      ),
    ).toBeGreaterThan(0);
    for (const mode of [
      MOTION_SOURCE.RED,
      MOTION_SOURCE.GREEN,
      MOTION_SOURCE.BLUE,
      MOTION_SOURCE.LUMA,
    ]) {
      expect(
        averageBlockError(current, previous, 2, 1, 0, 0, 2, 0, 0, mode),
      ).toBeGreaterThanOrEqual(0);
    }
    expect(
      averageBlockError(
        current,
        previous,
        2,
        1,
        0,
        0,
        2,
        0,
        0,
        MOTION_SOURCE.HUE,
        new Float32Array([359, 1]),
        new Float32Array([1, 359]),
        360,
      ),
    ).toBe(2);
  });

  it("smooths, blends, serializes, and restores vector fields defensively", () => {
    const current = [vector(1, 0), vector(0, 1), vector(-1, 0), vector(0, -1)];
    expect(blurVectorGrid(current, 2, 2, 0, 2)).not.toBe(current);
    expect(blurVectorGrid(current.slice(0, 2), 2, 2, 1, 2)).toHaveLength(4);
    expect(blendVectorFields(current, undefined, 0.5)).toEqual(current);
    expect(blendVectorFields(current, current.slice(0, 1), 0.5)).toEqual(current);
    expect(
      blendVectorFields(
        current,
        current.map((entry) => vector(-entry.dx, -entry.dy)),
        0.5,
      ),
    ).toHaveLength(4);

    expect(encodeVectorState(current)).toHaveLength(16);
    expect(encodeVectorStateGroups([current.slice(0, 2), current.slice(2)])).toHaveLength(16);
    expect(decodeVectorState(null, 4)).toBeUndefined();
    expect(decodeVectorState(new Float32Array(3), 1)).toBeUndefined();
    const decoded = decodeVectorState(encodeVectorState(current), 4);
    expect(decoded).toHaveLength(4);
    expect(decoded?.[0].magnitude).toBe(1);
  });

  it("composes and fades raster backgrounds with short source buffers", () => {
    const output = new Uint8ClampedArray([10, 20, 30, 0, 250, 240, 230, 0]);
    fadeBuffer(output, 0.5);
    expect(Array.from(output)).toEqual([5, 10, 15, 255, 125, 120, 115, 255]);
    blendSourceIntoBuffer(output, new Uint8ClampedArray([100]), 0.5);
    expect(output[0]).toBe(55);
    neutralMotionBackground(output, 1, 2, 3);
    expect(Array.from(output)).toEqual([1, 2, 3, 255, 1, 2, 3, 255]);
  });
});
