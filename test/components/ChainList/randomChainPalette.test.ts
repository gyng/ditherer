import { afterEach, describe, expect, it, vi } from "vitest";

import { filterList } from "filters";
import { createRandomFilterEntry } from "components/ChainList/randomize";

describe("ChainList random palette selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("can force a preset palette onto palette-capable random filters", () => {
    const ordered = filterList.find((entry) => entry.displayName === "Ordered");

    expect(ordered).toBeTruthy();

    vi.spyOn(Math, "random").mockReturnValue(0);

    const randomized = createRandomFilterEntry(ordered, true);
    const palette = randomized.filter.options.palette;

    expect(palette).toBeTruthy();
    expect(palette.name).toBe("User/Adaptive");
    expect(Array.isArray(palette.options.colors)).toBe(true);
    expect(palette.options.colors.length).toBeGreaterThan(0);
  });
});
