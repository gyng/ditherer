import { describe, expect, it } from "vitest";

import { filterIndex, filterList } from "filters";

describe("filter registry", () => {
  it("exposes every listed filter through filterIndex for worker execution", () => {
    const missing = filterList
      .filter((entry) => entry.displayName !== "None")
      .filter((entry) => entry.filter.mainThread !== true)
      .filter((entry) => !filterIndex[entry.filter.name])
      .map((entry) => `${entry.displayName} (${entry.filter.name})`);

    expect(missing).toEqual([]);
  });
});
