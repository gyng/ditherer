import { describe, expect, it } from "vitest";

import { filterIndex, filterList, hasTemporalBehavior, isMainThreadFilter } from "filters";

describe("filter registry", () => {
  it("keeps display names unique across the picker list", () => {
    const displayNames = filterList.map((entry) => entry.displayName);
    expect(new Set(displayNames).size).toBe(displayNames.length);
  });

  it("keeps every unique filter name addressable through filterIndex", () => {
    const filterNames = [...new Set(filterList.map((entry) => entry.filter.name))];
    expect(filterNames.every((name) => filterIndex[name] != null)).toBe(true);
  });

  it("exposes every listed filter through filterIndex for worker execution", () => {
    const missing = filterList
      .filter((entry) => entry.displayName !== "None")
      .filter((entry) => !isMainThreadFilter(entry.filter))
      .filter((entry) => !filterIndex[entry.filter.name])
      .map((entry) => `${entry.displayName} (${entry.filter.name})`);

    expect(missing).toEqual([]);
  });

  it("derives temporal behavior from filter-export metadata", () => {
    const temporalEntries = filterList.filter(hasTemporalBehavior);

    expect(temporalEntries.length).toBeGreaterThan(0);
    expect(temporalEntries.every((entry) => entry.filter.mainThread === true)).toBe(true);
  });
});
