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
    expect([...lazyFilterNames].sort()).toEqual(Object.keys(filterIndex).sort());
    await expect(loadFilter("Grayscale")).resolves.toBe(filterIndex.Grayscale);
  });

  it("rejects unknown filter names clearly", async () => {
    await expect(loadFilter("Definitely not a filter")).rejects.toThrow(
      "Unknown filter: Definitely not a filter",
    );
  });
});
