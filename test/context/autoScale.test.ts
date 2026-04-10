import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT_WINDOW_HEIGHT,
  DEFAULT_INPUT_WINDOW_WIDTH,
  getAutoScale,
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
});
