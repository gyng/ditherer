import { describe, expect, it } from "vitest";

import { COLOR_DISTANCE_ALGORITHM } from "constants/controlTypes";
import { ORDERED_PAL_MODE } from "filters/orderedGL";

// `ordered` maps colorDistanceAlgorithm -> a shader palette mode, and falls back
// to ORDERED_PAL_MODE.LEVELS when it doesn't recognise one. LEVELS passes
// `paletteRgb: null`, so that fallback DISCARDS the colour table: an algorithm
// the shader doesn't know renders level-quantized output with the palette
// silently ignored, which looks like a plausible image rather than an error.
//
// OKLab hit exactly that when it was added. The comment in ordered.ts asking the
// next person to update the mapping is not enforcement — this is. If you add an
// option to COLOR_DISTANCE_ALGORITHM, either give it a shader mode and map it,
// or make ordered fall back to its CPU path for it.

const ALGO_VALUES = COLOR_DISTANCE_ALGORITHM.options.map((o) => o.value);

describe("every colour-distance algorithm has an Ordered shader mode", () => {
  it("names a distinct ORDERED_PAL_MODE for each offered algorithm", () => {
    // LEVELS is the palette-less mode, so no algorithm may map to it.
    const colourModes = Object.entries(ORDERED_PAL_MODE)
      .filter(([name]) => name !== "LEVELS")
      .map(([, v]) => v);
    expect(colourModes.length).toBeGreaterThanOrEqual(ALGO_VALUES.length);
  });

  it.each(ALGO_VALUES)("%s maps to a non-LEVELS mode", (algo: string) => {
    // The algorithm constants and the shader's mode keys are deliberately the
    // same strings ("RGB", "LAB", "OKLAB", ...), so index the real enum rather
    // than restating the mapping — a local copy would just drift and pass.
    const mode = (ORDERED_PAL_MODE as Record<string, number | undefined>)[algo];
    expect(
      mode,
      `${algo} is offered in the UI but has no Ordered shader mode — it would ` +
        `fall back to LEVELS and drop the palette`,
    ).toBeDefined();
    expect(mode).not.toBe(ORDERED_PAL_MODE.LEVELS);
  });

  it("assigns every mode a unique value", () => {
    const values = Object.values(ORDERED_PAL_MODE);
    expect(new Set(values).size).toBe(values.length);
  });
});
