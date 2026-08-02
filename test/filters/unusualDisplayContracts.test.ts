import { describe, expect, it } from "vitest";
import {
  bairdFrameIndex,
  bairdScanColumn,
  cgaCarrierPhase,
  dlpSubfieldOffsets,
  platoGridCoordinate,
} from "filters/unusualDisplayContracts";
import { filterIndex, filterList } from "filters/index";

describe("Baird mechanical raster", () => {
  it("uses exactly 30 vertical scan columns", () => {
    expect(Array.from({ length: 30 }, (_, column) => bairdScanColumn((column + 0.5) / 30))).toEqual(
      Array.from({ length: 30 }, (_, column) => column),
    );
    expect(bairdScanColumn(-1)).toBe(0);
    expect(bairdScanColumn(2)).toBe(29);
  });

  it("retains the 12.5 Hz picture cadence at arbitrary preview rates", () => {
    expect(Array.from({ length: 8 }, (_, frame) => bairdFrameIndex(frame, 25))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
    expect(bairdFrameIndex(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("CGA composite carrier", () => {
  it("repeats its four-pixel NTSC phase without negative residues", () => {
    expect(Array.from({ length: 12 }, (_, index) => cgaCarrierPhase(index - 4))).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3,
    ]);
  });
});

describe("PLATO plasma geometry", () => {
  it("centers a square 512-grid panel inside wide and tall outputs", () => {
    expect(platoGridCoordinate(0, 50, 200, 100).inside).toBe(false);
    expect(platoGridCoordinate(50, 0, 200, 100)).toEqual({ inside: true, x: 0, y: 0 });
    expect(platoGridCoordinate(149, 99, 200, 100)).toEqual({ inside: true, x: 506, y: 506 });
    expect(platoGridCoordinate(50, 50, 100, 200)).toEqual({ inside: true, x: 256, y: 0 });
  });
});

describe("DLP sequential color", () => {
  it("reduces color breakup monotonically as wheel cycles rise", () => {
    const spans = [1, 2, 3, 4, 6].map((cycles) => {
      const offsets = dlpSubfieldOffsets(12, -6, cycles);
      return Math.hypot(offsets.blue.x - offsets.red.x, offsets.blue.y - offsets.red.y);
    });
    expect(spans).toEqual([...spans].sort((left, right) => right - left));
    expect(spans.at(-1)).toBeLessThan(spans[0]!);
    expect(dlpSubfieldOffsets(-12, 6, 1).red).toEqual(dlpSubfieldOffsets(12, -6, 1).blue);
  });
});

describe("unusual display registry", () => {
  it.each(["Baird Televisor", "CGA Composite", "PLATO Plasma", "DLP Color Wheel"])(
    "registers %s as a WebGL2 simulation",
    (name) => {
      const entry = filterList.find((candidate) => candidate.displayName === name);
      expect(entry?.category).toBe("Simulate");
      expect(entry?.filter.name).toBe(name);
      expect(entry?.filter.requiresGL).toBe(true);
      expect(filterIndex[name]).toBe(entry?.filter);
    },
  );
});
