// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatFrameRate } from "../../src/utils/frameTiming";

describe("frame-rate telemetry", () => {
  it("shows a measured rate for a positive frame duration", () => {
    expect(formatFrameRate(20)).toBe("50.0 fps");
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MIN_VALUE])(
    "does not invent an infinite rate for untimed or invalid durations (%s)",
    (duration) => {
      expect(formatFrameRate(duration)).toBe("— fps");
    },
  );
});
