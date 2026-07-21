import { describe, expect, it } from "vitest";
import { filterCatalog } from "../../packages/ditherer-filters/src/catalog";
import { filterIndex, filterList } from "../../packages/ditherer-filters/src/filters/index";
import { lazyFilterNames, loadFilter } from "../../packages/ditherer-filters/src/lazy";

describe("selective filter exports", () => {
  it("keeps metadata rows aligned with the complete registry", () => {
    expect(filterCatalog).toEqual(filterList.map((entry) => ({
      displayName: entry.displayName,
      filterName: entry.filter.name,
      category: entry.category,
      description: entry.description,
    })));
  });

  it("provides a lazy loader for every canonical filter", async () => {
    const registeredNames = Object.keys(filterIndex).sort();

    expect([...lazyFilterNames].sort()).toEqual(registeredNames);

    const loadedFilters = await Promise.all(
      lazyFilterNames.map(async (name) => [name, await loadFilter(name)] as const),
    );

    for (const [name, loadedFilter] of loadedFilters) {
      const registeredFilter = filterIndex[name];

      expect(loadedFilter.name).toBe(name);
      expect(loadedFilter.func).toBe(registeredFilter.func);
      expect(loadedFilter.optionTypes).toBe(registeredFilter.optionTypes);
    }
  });

  it("rejects unknown filter names clearly", async () => {
    await expect(loadFilter("Definitely not a filter")).rejects.toThrow(
      "Unknown filter: Definitely not a filter",
    );
  });
});
