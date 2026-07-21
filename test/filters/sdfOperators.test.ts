import { describe, expect, it } from "vitest";

import { filterIndex, filterList } from "filters/index";

const sdfOperators = [
  ["SDF Boolean Sculpt", "Advanced", false],
  ["SDF Medial Axis", "Stylize", false],
  ["SDF Flow Warp", "Distort", true],
] as const;

describe("signed-distance field operator family", () => {
  it.each(sdfOperators)("registers %s as a worker-resolvable WebGL2 filter", (name, category) => {
    const entry = filterList.find((candidate) => candidate.displayName === name);
    expect(entry?.category).toBe(category);
    expect(entry?.filter.requiresGL).toBe(true);
    expect(filterIndex[name]).toBe(entry?.filter);
  });

  it.each(sdfOperators)("describes every %s control", (name) => {
    const filter = filterIndex[name];
    expect(Object.keys(filter.optionTypes ?? {}).length).toBeGreaterThan(0);
    for (const [controlName, control] of Object.entries(filter.optionTypes ?? {})) {
      expect(control.desc, `${name}.${controlName}`).toBeTruthy();
    }
  });

  it.each(sdfOperators)("only advertises animation when %s evolves by default", (name, _category, temporal) => {
    expect(filterIndex[name].temporal === true).toBe(temporal);
    expect(filterIndex[name].autoAnimate === true).toBe(temporal);
  });

  it("exposes every constructive operation and analytic primitive", () => {
    const filter = filterIndex["SDF Boolean Sculpt"];
    const operations = filter.optionTypes?.operation?.options?.flatMap((option) => "options" in option ? option.options : [option]) ?? [];
    const shapes = filter.optionTypes?.shape?.options?.flatMap((option) => "options" in option ? option.options : [option]) ?? [];
    expect(operations).toHaveLength(5);
    expect(shapes).toHaveLength(4);
  });
});
