import { describe, expect, it } from "vitest";
import { filterList } from "filters";
import { CHAIN_PRESETS, findDuplicatePresetGroups, getChainSignature, getPresetSignature } from "components/ChainList/presets";

describe("ChainList presets", () => {
  const resolveDefaults = (name: string) => {
    const filter = filterList.find((candidate) => candidate.displayName === name);
    return (filter?.filter.defaults || filter?.filter.options || {}) as Record<string, unknown>;
  };

  it("matches a resolved preset chain by canonical signature", () => {
    const preset = CHAIN_PRESETS.find((entry) => entry.name === "Motion Compass");
    expect(preset).toBeTruthy();

    const chain = preset!.filters.map((entry) => {
      const filter = filterList.find((candidate) => candidate.displayName === entry.name);
      expect(filter).toBeTruthy();

      return {
        displayName: entry.name,
        filter: {
          ...filter!.filter,
          options: {
            ...(filter!.filter.defaults || filter!.filter.options || {}),
            ...(entry.options || {}),
          },
        },
      };
    });

    expect(getChainSignature(chain, resolveDefaults)).toBe(getPresetSignature(preset!.filters, resolveDefaults));
  });

  it("treats option changes as a different preset signature", () => {
    const base = getPresetSignature([{ name: "Motion Analysis", options: { renderMode: "HEATMAP", source: "EMA" } }], resolveDefaults);
    const changed = getPresetSignature([{ name: "Motion Analysis", options: { renderMode: "DIFFERENCE", source: "PREVIOUS_FRAME" } }], resolveDefaults);

    expect(changed).not.toBe(base);
  });

  it("has no duplicate built-in preset signatures", () => {
    expect(findDuplicatePresetGroups(CHAIN_PRESETS, resolveDefaults)).toEqual([]);
  });
});
