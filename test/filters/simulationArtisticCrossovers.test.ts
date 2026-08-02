import { describe, expect, it } from "vitest";

import {
  knifeEdgeResponse,
  quasicrystalDirections,
  speckleContrastForDiversity,
} from "filters/simulationArtisticContracts";
import { filterIndex, filterList } from "filters/index";

describe("schlieren knife-edge response", () => {
  it("is directional and preserves the sign of ray deflection", () => {
    expect(knifeEdgeResponse(3, 0, 0)).toBeCloseTo(3);
    expect(knifeEdgeResponse(-3, 0, 0)).toBeCloseTo(-3);
    expect(knifeEdgeResponse(0, 3, 0)).toBeCloseTo(0);
    expect(knifeEdgeResponse(0, 3, 90)).toBeCloseTo(3);
  });

  it("normalizes non-finite inputs to a stable response", () => {
    expect(knifeEdgeResponse(Number.NaN, 1, 0)).toBe(0);
    expect(knifeEdgeResponse(1, 0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("coherent speckle diversity", () => {
  it("reduces contrast as independent intensity patterns are averaged", () => {
    expect(speckleContrastForDiversity(1)).toBe(1);
    expect(speckleContrastForDiversity(4)).toBe(0.5);
    expect(speckleContrastForDiversity(9)).toBeCloseTo(1 / 3);
    expect(speckleContrastForDiversity(0)).toBe(1);
  });
});

describe("quasicrystal wave geometry", () => {
  it.each([5, 7, 8, 10])("creates %i unique evenly spaced directions", (order) => {
    const directions = quasicrystalDirections(order);
    expect(directions).toHaveLength(order);
    expect(new Set(directions.map(({ x, y }) => `${x.toFixed(8)}:${y.toFixed(8)}`)).size).toBe(
      order,
    );
    for (const direction of directions) {
      expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1);
    }
    const steps = directions.map((direction, index) => {
      const next = directions[(index + 1) % order]!;
      const a = Math.atan2(direction.y, direction.x);
      let b = Math.atan2(next.y, next.x);
      if (b <= a) b += Math.PI * 2;
      return b - a;
    });
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-10);
  });
});

const crossoverFilters = [
  ["Schlieren Optics", "Simulate", false],
  ["Laser Speckle Projector", "Simulate", true],
  ["Suminagashi Marbling", "Stylize", true],
  ["Quasicrystal Mosaic", "Stylize", false],
] as const;

describe("simulation and artistic crossover registry", () => {
  it.each(crossoverFilters)(
    "registers %s as a worker-resolvable WebGL2 filter",
    (name, category) => {
      const entry = filterList.find((candidate) => candidate.displayName === name);
      expect(entry?.category).toBe(category);
      expect(entry?.filter.name).toBe(name);
      expect(entry?.filter.requiresGL).toBe(true);
      expect(filterIndex[name]).toBe(entry?.filter);
    },
  );

  it.each(crossoverFilters)("describes every %s control", (name) => {
    const filter = filterIndex[name];
    expect(Object.keys(filter.optionTypes ?? {}).length).toBeGreaterThan(0);
    for (const [controlName, control] of Object.entries(filter.optionTypes ?? {})) {
      expect(control.desc, `${name}.${controlName}`).toBeTruthy();
    }
  });

  it.each(crossoverFilters)(
    "only animates %s when the default evolves",
    (name, _category, animated) => {
      expect(filterIndex[name].temporal === true).toBe(animated);
      expect(filterIndex[name].autoAnimate === true).toBe(animated);
    },
  );
});
