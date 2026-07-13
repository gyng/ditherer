import { describe, expect, it } from "vitest";

import { filterIndex, filterList } from "filters";

const suite = [
  "Heightfield Raymarch",
  "Silhouette Extrusion",
  "Voxel Landscape",
  "Glass Surface",
  "Relief Reflections",
  "Volumetric Light",
  "SDF Melt",
  "Fractal Portal",
  "Path-Traced Diorama",
] as const;

const temporal = new Set([
  "Glass Surface",
  "Volumetric Light",
  "SDF Melt",
  "Fractal Portal",
  "Path-Traced Diorama",
]);

describe("raymarching filter suite", () => {
  it("registers every filter as a worker-resolvable WebGL2 effect", () => {
    for (const name of suite) {
      const entry = filterList.find((candidate) => candidate.displayName === name);
      expect(entry, name).toBeDefined();
      expect(entry?.category, name).toBe("Advanced");
      expect(entry?.filter.requiresGL, name).toBe(true);
      expect(filterIndex[entry?.filter.name ?? ""], name).toBe(entry?.filter);
    }
  });

  it("gives every control a user-facing description", () => {
    for (const name of suite) {
      const filter = filterList.find((entry) => entry.displayName === name)?.filter;
      const controls = Object.entries(filter?.optionTypes ?? {});
      expect(controls.length, name).toBeGreaterThan(0);
      for (const [controlName, control] of controls) {
        expect(control.desc, `${name}.${controlName}`).toBeTruthy();
      }
    }
  });

  it("advertises animation only for filters whose default result evolves", () => {
    for (const name of suite) {
      const filter = filterList.find((entry) => entry.displayName === name)?.filter;
      expect(filter?.temporal === true, name).toBe(temporal.has(name));
      expect(filter?.autoAnimate === true, name).toBe(temporal.has(name));
    }
  });
});
