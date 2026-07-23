import { describe, it, expect, vi } from "vitest";
import reducer, { initialState } from "reducers/filters";
import { filterIndex } from "@gyng/ditherer-filters";

// Complementary coverage for the reducer's larger code paths that the
// original suite doesn't touch: LOAD_STATE deserialization (v1 + v2),
// audio-mod legacy-format branches, palette mutation guards, and the
// derived state pieces that only fire in less-common actions.

const nameOf = (name: string) => {
  const filter = filterIndex[name];
  if (!filter) throw new Error(`missing filter ${name}`);
  return filter;
};

const loadCycleSeconds = (version: 1 | 2, value: unknown, includeValue = true) => {
  const cycleField = includeValue ? { r: value } : {};
  const data = version === 2
    ? {
        v: 2,
        g: false,
        l: true,
        w: true,
        chain: [{ n: "Invert" }],
        ...cycleField,
      }
    : {
        selected: { filter: { name: "Invert" } },
        convertGrayscale: false,
        ...cycleField,
      };
  return reducer(initialState, { type: "LOAD_STATE", data } as never).randomCycleSeconds;
};

describe.each([1, 2] as const)("filters reducer — LOAD_STATE v%s cycle interval", (version) => {
  it.each([
    ["numeric string", "3"],
    ["object", { seconds: 3 }],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["negative", -1],
    ["zero", 0],
  ])("rejects a %s", (_label, value) => {
    expect(loadCycleSeconds(version, value)).toBeNull();
  });

  it.each([
    ["smallest positive finite value", Number.MIN_VALUE],
    ["typical value", 2],
    ["largest finite value", Number.MAX_VALUE],
  ])("accepts the %s", (_label, value) => {
    expect(loadCycleSeconds(version, value)).toBe(value);
  });

  it("keeps the existing missing-field policy of resetting to null", () => {
    expect(loadCycleSeconds(version, undefined, false)).toBeNull();
  });
});

describe("filters reducer — LOAD_STATE v2 (chain format)", () => {
  it("falls back to canonical names for malformed display labels", () => {
    const loaded = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        g: false,
        l: true,
        w: true,
        chain: [
          { n: "Invert", d: { label: "object" } },
          { n: "Binarize", d: "" },
          { n: "Grayscale", d: "   " },
          { n: "Ordered", d: "x".repeat(257) },
          { n: "Halftone", d: "Valid alias" },
          { n: "Invert", d: "y".repeat(256) },
        ],
      },
    } as never);

    expect(loaded.chain.map((entry) => entry.displayName)).toEqual([
      "Invert",
      "Binarize",
      "Grayscale",
      "Ordered",
      "Valid alias",
      "y".repeat(256),
    ]);
    expect(loaded.chain.every((entry) => typeof entry.displayName === "string")).toBe(true);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "rejects inherited registry name %s",
    (name) => {
      const prior = reducer(initialState, { type: "__INIT__" } as never);
      const result = reducer(prior, {
        type: "LOAD_STATE",
        data: { v: 2, chain: [{ n: name }], g: false, l: true, w: true },
      } as never);
      expect(result).toBe(prior);
    },
  );

  it("preserves safe unique entry ids and regenerates missing, malformed, or duplicate ids", () => {
    const stableId = "stable-entry-id";
    const loaded = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        g: false,
        l: true,
        w: true,
        chain: [
          { n: "Invert", i: stableId },
          { n: "Binarize", i: stableId },
          { n: "Invert" },
          { n: "Binarize", i: "" },
          { n: "Invert", i: "x".repeat(257) },
        ],
      },
    } as never);

    expect(loaded.chain[0].id).toBe(stableId);
    expect(new Set(loaded.chain.map((entry) => entry.id)).size).toBe(loaded.chain.length);
    for (const entry of loaded.chain.slice(1)) {
      expect(entry.id).not.toBe(stableId);
      expect(entry.id.length).toBeGreaterThan(0);
    }

    const serializedTarget = `${stableId}:invertR`;
    expect(serializedTarget.startsWith(`${loaded.chain[0].id}:`)).toBe(true);
    expect(serializedTarget.slice(loaded.chain[0].id.length + 1)).toBe("invertR");
  });

  it("rebuilds a chain with palette + flags + audio mod per entry", () => {
    const state = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        g: true,
        l: true,
        w: false,
        r: 12,
        chain: [
          { n: "Invert", d: "Invert (disabled)", e: false, o: { amount: 0.5 } },
          {
            n: "Ordered",
            o: { palette: { name: "Nearest", options: { levels: 4 } } },
            // connections-style modulation (modern format)
            m: { c: [{ k: "amp", o: "levels", w: 0.3 }], z: ["amp"] },
          },
        ],
      },
    });

    expect(state.chain).toHaveLength(2);
    expect(state.chain[0].enabled).toBe(false);
    expect(state.chain[0].filter.options?.amount).toBe(0.5);
    expect(state.chain[0].displayName).toBe("Invert (disabled)");
    expect(state.chain[1].audioMod?.connections[0]).toMatchObject({
      metric: "amp",
      target: "levels",
      weight: 0.3,
    });
    // v2 → top-level flags also applied
    expect(state.convertGrayscale).toBe(true);
    expect(state.linearize).toBe(true);
    expect(state.wasmAcceleration).toBe(false);
    expect(state.randomCycleSeconds).toBe(12);
  });

  it("drops entries for unknown filter names and preserves state if chain empties", () => {
    const original = reducer(undefined, { type: "__INIT__" } as never);
    const result = reducer(original, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        g: false,
        l: false,
        w: false,
        chain: [
          { n: "ThisFilterDoesNotExist" },
        ],
      },
    });
    // v2 path returns the prior state when nothing usable came through
    expect(result).toBe(original);
  });

  it("accepts legacy audio-mod formats — metrics array and single-key targets", () => {
    const state = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        g: false,
        l: false,
        w: false,
        chain: [
          {
            n: "Invert",
            m: {
              // `m` is the legacy metrics-array variant
              m: [{ k: "rms", o: "amount", w: 0.5 }],
              z: ["rms"],
            },
          },
          {
            n: "Ordered",
            m: {
              // `k` + `t` is the oldest single-key, multi-target shape
              k: "amp",
              t: [{ o: "levels", w: 0.25 }, { o: "thresholdMap", w: 0.1 }],
            },
          },
        ],
      },
    });

    expect(state.chain[0].audioMod?.connections).toEqual([
      { metric: "rms", target: "amount", weight: 0.5 },
    ]);
    // Legacy `k + t` shape rehydrates with a fixed default weight (0.25) —
    // the old persisted format didn't carry per-target weights.
    expect(state.chain[1].audioMod?.connections).toEqual([
      { metric: "amp", target: "levels", weight: 0.25 },
      { metric: "amp", target: "thresholdMap", weight: 0.25 },
    ]);
  });

  it("migrates Bilateral Blur resolution keys without overriding new state", () => {
    const state = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        g: false,
        l: false,
        w: false,
        chain: [
          { n: "Bilateral Blur", o: { useDownsample: false } },
          { n: "Bilateral Blur", o: { downsampleFactor: 4 } },
          { n: "Bilateral Blur", o: { useSeparableApproximation: false } },
          {
            n: "Bilateral Blur",
            o: { workingResolution: "QUARTER", useDownsample: false, downsampleFactor: 1 },
          },
        ],
      },
    });

    expect(state.chain.map(entry => entry.filter.options?.workingResolution)).toEqual([
      "FULL", "QUARTER", "HALF", "QUARTER",
    ]);
    for (const entry of state.chain) {
      expect(entry.filter.options).not.toHaveProperty("useSeparableApproximation");
      expect(entry.filter.options).not.toHaveProperty("useDownsample");
      expect(entry.filter.options).not.toHaveProperty("downsampleFactor");
    }
  });
});

describe("filters reducer — LOAD_STATE v1 (selected format)", () => {
  it("uses only bounded nonblank string display labels", () => {
    const malformedLabels: unknown[] = [{ label: "object" }, "", "   ", "x".repeat(257)];
    for (const label of malformedLabels) {
      const state = reducer(initialState, {
        type: "LOAD_STATE",
        data: {
          selected: {
            displayName: label,
            name: label,
            filter: { name: "Invert" },
          },
          convertGrayscale: false,
        },
      } as never);
      expect(state.chain[0].displayName).toBe("Invert");
      expect(typeof state.chain[0].displayName).toBe("string");
    }

    const named = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        selected: {
          displayName: { invalid: true },
          name: "Valid legacy alias",
          filter: { name: "Invert" },
        },
        convertGrayscale: false,
      },
    } as never);
    expect(named.chain[0].displayName).toBe("Valid legacy alias");
  });

  it.each(["__proto__", "constructor", "toString"])(
    "rejects inherited registry name %s",
    (name) => {
      const prior = reducer(initialState, { type: "__INIT__" } as never);
      const result = reducer(prior, {
        type: "LOAD_STATE",
        data: {
          selected: { filter: { name } },
          convertGrayscale: false,
        },
      } as never);
      expect(result).toBe(prior);
    },
  );

  it("rebuilds a single-entry chain from a legacy selected payload", () => {
    const state = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        selected: {
          displayName: "Invert V1",
          filter: { name: "Invert", options: { invertR: false } },
        },
        convertGrayscale: false,
        linearize: true,
        wasmAcceleration: true,
        r: 3,
      },
    });
    expect(state.chain).toHaveLength(1);
    expect(state.chain[0].displayName).toBe("Invert V1");
    expect(state.chain[0].filter.name).toBe("Invert");
    expect(state.linearize).toBe(true);
    expect(state.wasmAcceleration).toBe(true);
    expect(state.randomCycleSeconds).toBe(3);
  });

  it("migrates v1 Bilateral Blur optimization keys", () => {
    const state = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        selected: {
          filter: {
            name: "Bilateral Blur",
            options: {
              sigmaSpatial: 7,
              useSeparableApproximation: false,
              useDownsample: true,
              downsampleFactor: 4,
            },
          },
        },
        convertGrayscale: false,
      },
    });
    expect(state.chain[0].filter.options).toMatchObject({
      sigmaSpatial: 7,
      workingResolution: "QUARTER",
    });
    expect(state.chain[0].filter.options).not.toHaveProperty("useSeparableApproximation");
    expect(state.chain[0].filter.options).not.toHaveProperty("useDownsample");
    expect(state.chain[0].filter.options).not.toHaveProperty("downsampleFactor");
  });

  it("returns prior state when the v1 selected filter name is unknown", () => {
    const prior = reducer(initialState, { type: "__INIT__" } as never);
    const result = reducer(prior, {
      type: "LOAD_STATE",
      data: {
        selected: { filter: { name: "NotARealFilter" } },
        convertGrayscale: false,
      },
    });
    expect(result).toBe(prior);
  });

  it("ignores payloads that have neither v2 chain nor v1 selected", () => {
    const prior = reducer(initialState, { type: "__INIT__" } as never);
    const result = reducer(prior, { type: "LOAD_STATE", data: {} as never });
    expect(result).toBe(prior);
  });
});

describe("filters reducer — palette guards", () => {
  it("SET_FILTER_PALETTE_OPTION warns and no-ops on a filter without a palette", () => {
    const invert = nameOf("Invert");
    const prior = reducer(initialState, {
      type: "SELECT_FILTER",
      name: "Invert",
      filter: invert,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = reducer(prior, {
      type: "SET_FILTER_PALETTE_OPTION",
      optionName: "levels",
      value: 4,
    });
    expect(result).toBe(prior);
    expect(warn).toHaveBeenCalledWith(
      "Tried to set option on null palette",
      prior,
    );
    warn.mockRestore();
  });

  it("ADD_PALETTE_COLOR warns and no-ops on a filter without a palette", () => {
    const invert = nameOf("Invert");
    const prior = reducer(initialState, {
      type: "SELECT_FILTER",
      name: "Invert",
      filter: invert,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = reducer(prior, {
      type: "ADD_PALETTE_COLOR",
      color: [0, 0, 0],
    });
    expect(result).toBe(prior);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
