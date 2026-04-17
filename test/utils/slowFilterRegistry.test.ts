import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SLOW_FILTER_BUDGETS,
  clearSlowFilters,
  getSlowFilters,
  isSlowFilter,
  recordFilterStepMs,
} from "utils/slowFilterRegistry";

// Guards the runtime safety net that keeps screensaver/random-chain cycling
// from landing on a filter that just hung the UI. Failures here mean either
// slow filters silently keep getting picked, or fast filters get flagged
// spuriously — both break slideshow reliability.

beforeEach(() => clearSlowFilters());
afterEach(() => {
  clearSlowFilters();
  vi.restoreAllMocks();
});

describe("slowFilterRegistry", () => {
  it("ignores fast filters regardless of how many times they run", () => {
    recordFilterStepMs("Grayscale", 12);
    recordFilterStepMs("Grayscale", 30);
    recordFilterStepMs("Grayscale", 200);
    expect(isSlowFilter("Grayscale")).toBe(false);
    expect(getSlowFilters()).toEqual([]);
  });

  it("flags a filter after two soft-budget breaches", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    recordFilterStepMs("Delaunay", SLOW_FILTER_BUDGETS.soft + 200);
    expect(isSlowFilter("Delaunay")).toBe(false);
    recordFilterStepMs("Delaunay", SLOW_FILTER_BUDGETS.soft + 50);
    expect(isSlowFilter("Delaunay")).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Delaunay"));
  });

  it("flags a filter on a single hard-budget breach", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    recordFilterStepMs("StableFluids", SLOW_FILTER_BUDGETS.hard + 100);
    expect(isSlowFilter("StableFluids")).toBe(true);
  });

  it("keeps flagged filters stable across further recordings", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    recordFilterStepMs("Slow", SLOW_FILTER_BUDGETS.hard + 10);
    expect(isSlowFilter("Slow")).toBe(true);
    // Even a fast run after flagging doesn't un-flag.
    recordFilterStepMs("Slow", 5);
    expect(isSlowFilter("Slow")).toBe(true);
  });

  it("isSlowFilter tolerates null/undefined names", () => {
    expect(isSlowFilter(null)).toBe(false);
    expect(isSlowFilter(undefined)).toBe(false);
    expect(isSlowFilter("")).toBe(false);
  });

  it("clearSlowFilters resets both the strike and flagged maps", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    recordFilterStepMs("X", SLOW_FILTER_BUDGETS.soft + 10);
    recordFilterStepMs("X", SLOW_FILTER_BUDGETS.soft + 10);
    expect(isSlowFilter("X")).toBe(true);
    clearSlowFilters();
    expect(isSlowFilter("X")).toBe(false);
    // And a single new soft-breach should not immediately re-flag.
    recordFilterStepMs("X", SLOW_FILTER_BUDGETS.soft + 10);
    expect(isSlowFilter("X")).toBe(false);
  });
});
