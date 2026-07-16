import { describe, expect, it } from "vitest";

import { filterIndex, filterList } from "@gyng/ditherer-filters";
import { traceMazeSolution } from "filters/raymarchedMaze";

const suite = [
  "Luminance Caverns",
  "Black Hole Lens",
  "Thin-Film Iridescence",
  "Subsurface Wax",
  "Cone-Traced AO",
  "Chromatic Prism Tracer",
  "Portal Hall",
  "Image Fossil",
  "Volumetric Cloud Sculpture",
  "Raymarched Maze",
] as const;

const temporal = new Set([
  "Luminance Caverns",
  "Black Hole Lens",
  "Thin-Film Iridescence",
  "Portal Hall",
  "Volumetric Cloud Sculpture",
  "Raymarched Maze",
]);

describe("raymarching worlds and materials suite", () => {
  it("registers all ten filters as worker-resolvable WebGL2 effects", () => {
    expect(suite).toHaveLength(10);
    expect(suite).toContain("Raymarched Maze");
    for (const name of suite) {
      const entry = filterList.find((candidate) => candidate.displayName === name);
      expect(entry, name).toBeDefined();
      expect(entry?.category, name).toBe("Advanced");
      expect(entry?.filter.requiresGL, name).toBe(true);
      expect(filterIndex[entry?.filter.name ?? ""], name).toBe(entry?.filter);
    }
  });

  it("documents every generated control", () => {
    for (const name of suite) {
      const controls = Object.entries(
        filterList.find((entry) => entry.displayName === name)?.filter.optionTypes ?? {},
      );
      expect(controls.length, name).toBeGreaterThan(0);
      for (const [controlName, control] of controls) {
        expect(control.desc, `${name}.${controlName}`).toBeTruthy();
      }
    }
  });

  it("auto-animates only effects whose default world or material evolves", () => {
    for (const name of suite) {
      const filter = filterList.find((entry) => entry.displayName === name)?.filter;
      expect(filter?.temporal === true, name).toBe(temporal.has(name));
      expect(filter?.autoAnimate === true, name).toBe(temporal.has(name));
    }
  });

  it.each([6, 12, 24])("keeps the %i-cell maze route connected for every tested seed", (grid) => {
    for (const seed of [0, 37, 419, 999]) {
      const route = traceMazeSolution(grid, seed);
      expect(route).toHaveLength(grid * 2 - 1);
      expect(route.at(-1)).toEqual({ x: grid - 1, y: grid - 1 });

      for (let index = 1; index < route.length; index += 1) {
        const previous = route[index - 1];
        const current = route[index];
        expect(current.x - previous.x + current.y - previous.y).toBe(1);
        expect(current.x).toBeGreaterThanOrEqual(0);
        expect(current.x).toBeLessThan(grid);
        expect(current.y).toBeGreaterThanOrEqual(0);
        expect(current.y).toBeLessThan(grid);
      }
    }
  });
});
