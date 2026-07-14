import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT_WINDOW_HEIGHT,
  DEFAULT_INPUT_WINDOW_WIDTH,
  getAutoScale,
  getScaleForMaxWidth,
  roundScale,
} from "context/autoScale";

describe("getAutoScale", () => {
  it("scales small assets up to fill the default input window", () => {
    const scale = getAutoScale(100, 100, { width: 1280 });

    expect(scale).toBe(DEFAULT_INPUT_WINDOW_WIDTH / 100);
  });

  it("scales based on height when that is the limiting side of the default input window", () => {
    const scale = getAutoScale(100, 50, { width: 1280 });

    expect(scale).toBe(DEFAULT_INPUT_WINDOW_HEIGHT / 50);
  });

  it("still scales large assets down to fit the available width", () => {
    const scale = getAutoScale(2000, 1000, { width: 1280 });

    expect(scale).toBe((1280 - 240) / 2000);
  });

  it("rounds scales to the slider step used by the UI", () => {
    expect(roundScale(1.74)).toBe(1.7);
    expect(roundScale(0.04)).toBe(0.1);
  });

  it("rounds a maximum-width scale down so the rendered width cannot exceed the cap", () => {
    expect(getScaleForMaxWidth(268, 160)).toBe(0.59);
    expect(Math.round(268 * getScaleForMaxWidth(268, 160))).toBeLessThanOrEqual(160);
  });

  it("clamps maximum-width scales to the supported input-scale range", () => {
    expect(getScaleForMaxWidth(10, 1000)).toBe(16);
    expect(getScaleForMaxWidth(10_000, 1)).toBe(0.05);
  });
});
