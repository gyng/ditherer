import { describe, expect, it } from "vitest";

import { COLOR_DISTANCE_ALGORITHM } from "constants/controlTypes";
import { ORDERED_PAL_MODE } from "filters/orderedGL";
import { WASM_PALETTE_MODE, colorAlgorithmToWasmMode } from "utils";

// Two independent tables map colorDistanceAlgorithm -> a backend palette mode,
// and both degrade *silently* when they don't recognise one:
//
//   ORDERED_PAL_MODE (orderedGL.ts) — unknown falls back to LEVELS, which
//     passes `paletteRgb: null`, so the colour table is discarded and the
//     filter renders plausible level-quantized output instead of failing.
//
//   colorAlgorithmToWasmMode (utils) — unknown returns null. Error diffusion
//     drops to the per-pixel JS loop (correct, just slow), but Riemersma is
//     noGL with no JS fallback and returns the image *unfiltered*.
//
// OKLab hit both, one commit apart: 38292fe fixed the Ordered table and pinned
// it, and missed the WASM sibling — which is the failure this file exists to
// stop repeating. A comment asking the next person to update the mapping is not
// enforcement, and pinning only one table is how the second one drifted.
//
// If you add an option to COLOR_DISTANCE_ALGORITHM, every table here must name
// a real mode for it, or its filter must fall back to a path that is correct
// rather than one that quietly discards the palette.

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

describe("every colour-distance algorithm has a WASM palette mode", () => {
  // Goes through the resolver rather than indexing WASM_PALETTE_MODE, because
  // the swallow lives in the resolver's `default: null`, not in the table. A
  // mode could exist and still be unreachable if the switch never returns it.
  it.each(ALGO_VALUES)("%s resolves to a real WASM mode", (algo: string) => {
    const mode = colorAlgorithmToWasmMode(algo);
    expect(
      mode,
      `${algo} is offered in the UI but colorAlgorithmToWasmMode returns null ` +
        `— Riemersma would return the image unfiltered and error diffusion ` +
        `would silently drop to the JS loop`,
    ).not.toBeNull();
    expect(mode).not.toBe(WASM_PALETTE_MODE.LEVELS);
  });

  it("returns null for an algorithm that is genuinely unknown", () => {
    // The guard above is only meaningful if the resolver can still say "no" —
    // a resolver hardwired to return RGB would pass every case above.
    expect(colorAlgorithmToWasmMode("NOT_AN_ALGORITHM")).toBeNull();
    expect(colorAlgorithmToWasmMode(undefined)).toBeNull();
  });

  it("assigns every mode a unique value", () => {
    const values = Object.values(WASM_PALETTE_MODE);
    expect(new Set(values).size).toBe(values.length);
  });

  // The Rust side indexes on these numbers (PAL_MODE_* in lib.rs). If the two
  // drift, a palette silently matches with the wrong algorithm — no error, just
  // wrong colours. Pinned literally: this is a wire format, not an enum.
  it("keeps the mode numbers the Rust kernel expects", () => {
    expect(WASM_PALETTE_MODE).toEqual({
      LEVELS: 0,
      RGB: 1,
      RGB_APPROX: 2,
      HSV: 3,
      LAB: 4,
      OKLAB: 5,
    });
  });
});
