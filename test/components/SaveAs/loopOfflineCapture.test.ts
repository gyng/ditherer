import { describe, expect, it } from "vitest";
import {
  getRenderableDecodedGifFrames,
  collapseDecodedFramesToCadence,
  filterDecodedFramesForRange,
  getDecodedGifFrameDurationUs,
  inferDecodedGifCadenceUs,
} from "components/SaveAs/export/loopOfflineCapture";

describe("loopOfflineCapture WebCodecs GIF helpers", () => {
  it("prefers decoded duration metadata when available", () => {
    const durationUs = getDecodedGifFrameDurationUs([
      { timestampUs: 0, durationUs: 120000 },
      { timestampUs: 120000, durationUs: 40000 },
    ], 0, 40000, 0.2);

    expect(durationUs).toBe(120000);
  });

  it("falls back to the next decoded timestamp when duration metadata is missing", () => {
    const durationUs = getDecodedGifFrameDurationUs([
      { timestampUs: 0, durationUs: 0 },
      { timestampUs: 80000, durationUs: 0 },
      { timestampUs: 160000, durationUs: 0 },
    ], 1, 40000, 0.2);

    expect(durationUs).toBe(80000);
  });

  it("filters decoded frames to the requested export range", () => {
    const makeFrame = (timestampUs: number) => ({
      timestampUs,
      durationUs: 40000,
      frame: {} as VideoFrame,
    });

    const filtered = filterDecodedFramesForRange([
      makeFrame(0),
      makeFrame(50000),
      makeFrame(100000),
      makeFrame(150000),
    ], 0.05, 0.15);

    expect(filtered.map((frame) => frame.timestampUs)).toEqual([50000, 100000]);
  });

  it("clamps the final decoded frame to the requested range end", () => {
    const durationUs = getDecodedGifFrameDurationUs([
      { timestampUs: 900000, durationUs: 420000 },
    ], 0, 40000, 1.03);

    expect(durationUs).toBe(130000);
  });

  it("infers cadence from decoded frame duration metadata", () => {
    expect(inferDecodedGifCadenceUs([
      { timestampUs: 0, durationUs: 33367 },
      { timestampUs: 16683, durationUs: 33367 },
      { timestampUs: 33367, durationUs: 33367 },
    ], 40000)).toBe(33367);
  });

  it("collapses over-dense decoded frames back toward the inferred cadence", () => {
    const makeFrame = (timestampUs: number) => ({
      timestampUs,
      durationUs: 33367,
      frame: {} as VideoFrame,
    });

    const collapsed = collapseDecodedFramesToCadence([
      makeFrame(0),
      makeFrame(16683),
      makeFrame(33367),
      makeFrame(50050),
      makeFrame(66734),
    ], 40000);

    expect(collapsed.map((frame) => frame.timestampUs)).toEqual([0, 33367, 66734]);
  });

  it("uses the final decoded frame as a guard frame instead of exporting it", () => {
    expect(getRenderableDecodedGifFrames([1, 2, 3, 4])).toEqual([1, 2, 3]);
    expect(getRenderableDecodedGifFrames([1])).toEqual([1]);
  });

  it("reuses source-cadence collapse for sequence exports too", () => {
    const makeFrame = (timestampUs: number) => ({
      timestampUs,
      durationUs: 33367,
      frame: {} as VideoFrame,
    });

    const collapsed = collapseDecodedFramesToCadence(
      filterDecodedFramesForRange([
        makeFrame(0),
        makeFrame(16683),
        makeFrame(33367),
        makeFrame(50050),
        makeFrame(66734),
      ], 0, 0.08),
      40000,
    );

    expect(collapsed.map((frame) => frame.timestampUs)).toEqual([0, 33367, 66734]);
  });
});
