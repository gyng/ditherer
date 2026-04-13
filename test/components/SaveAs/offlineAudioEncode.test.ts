import { describe, expect, it } from "vitest";
import { reconcileAudioFrameCount } from "components/SaveAs/export/offlineAudioEncode";

describe("reconcileAudioFrameCount", () => {
  it("returns the requested target frame count", () => {
    expect(reconcileAudioFrameCount(48_000, 24_000)).toBe(24_000);
    expect(reconcileAudioFrameCount(12_000, 24_000)).toBe(24_000);
  });

  it("clamps invalid targets to zero or above", () => {
    expect(reconcileAudioFrameCount(Number.NaN, -5)).toBe(0);
  });
});
