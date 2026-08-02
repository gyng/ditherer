import { describe, expect, it } from "vitest";

import { filterIndex, filterList, hasTemporalBehavior } from "@gyng/ditherer-filters";

describe("filter registry", () => {
  it("keeps display names unique across the picker list", () => {
    const displayNames = filterList.map((entry) => entry.displayName);
    expect(new Set(displayNames).size).toBe(displayNames.length);
  });

  it("keeps every unique filter name addressable through filterIndex", () => {
    const filterNames = [...new Set(filterList.map((entry) => entry.filter.name))];
    expect(filterNames.every((name) => filterIndex[name] != null)).toBe(true);
  });

  it("maps duplicate preset names to the first canonical catalog definition", () => {
    const canonical = filterList.find((entry) => entry.displayName === "Floyd-Steinberg");

    expect(canonical).toBeDefined();
    expect(filterIndex["Floyd-Steinberg"]).toBe(canonical?.filter);
  });

  it("exposes every listed filter through filterIndex for worker execution", () => {
    const missing = filterList
      .filter((entry) => entry.displayName !== "None")
      .filter((entry) => !filterIndex[entry.filter.name])
      .map((entry) => `${entry.displayName} (${entry.filter.name})`);

    expect(missing).toEqual([]);
  });

  it("derives temporal behavior from filter-export metadata", () => {
    const temporalEntries = filterList.filter(hasTemporalBehavior);

    expect(temporalEntries.length).toBeGreaterThan(0);
    expect(temporalEntries.every((entry) => entry.filter.temporal === true)).toBe(true);
  });

  it("marks every filter with an animate control as temporal", () => {
    const missing = filterList
      .filter((entry) =>
        Object.keys(entry.filter.optionTypes ?? {}).some((key) =>
          key.toLowerCase().startsWith("animate"),
        ),
      )
      .filter((entry) => entry.filter.temporal !== true)
      .map((entry) => entry.displayName);

    expect(missing).toEqual([]);
  });
});
