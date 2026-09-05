import { describe, expect, it } from "vitest";
import { filterIndex, getFilterHistory, type FilterDefinition } from "@gyng/ditherer-filters";

const definitions = import.meta.glob("../../packages/ditherer-filters/src/filters/*.ts", {
  eager: true,
});
const sources = import.meta.glob<string>("../../packages/ditherer-filters/src/filters/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});
const prefix = "../../packages/ditherer-filters/src/filters/";
const historyKeys = ["prevInput", "prevOutput", "ema"] as const;

// Include helpers and factories: a filter can delegate history consumption to
// another module even when its own entry point does not read the injected keys.
const requiredHistory = (
  path: string,
  seen = new Set<string>(),
  followHelpers = true,
): Set<string> => {
  if (seen.has(path)) return new Set();
  seen.add(path);
  const source = sources[path] ?? "";
  const required = new Set<string>(
    historyKeys.filter((key) => new RegExp(`\\b_${key}\\b`).test(source)),
  );
  if (!followHelpers) return required;
  for (const match of source.matchAll(/\bfrom\s+["']\.\/([^"']+)["']/g)) {
    for (const key of requiredHistory(`${prefix}${match[1]}.ts`, seen)) required.add(key);
  }
  return required;
};

describe("filter history declarations", () => {
  it("retains every injected buffer consumed by a built-in filter or its helpers", () => {
    const missing: string[] = [];
    for (const [path, module] of Object.entries(definitions)) {
      const filter = (module as { default?: FilterDefinition }).default;
      if (!filter || typeof filter.func !== "function") continue;
      const history = getFilterHistory(filter);
      // An explicit empty declaration can isolate helper calls from injected
      // options. Still check that the filter itself does not consume history.
      const followHelpers =
        filter.history === undefined || Object.values(filter.history).some(Boolean);
      for (const key of requiredHistory(path, new Set(), followHelpers)) {
        if (!history[key as keyof typeof history]) missing.push(`${filter.name}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps a built-in implementation's requirements when used in a new definition", () => {
    const definition = filterIndex["Floyd-Steinberg"];
    expect(getFilterHistory({ name: "My dither", func: definition.func })).toEqual(
      getFilterHistory(definition),
    );
  });

  it("preserves history for undeclared custom filters even if their name matches a built-in", () => {
    expect(getFilterHistory({ name: "Grayscale", func: (input) => input })).toEqual({
      prevInput: true,
      prevOutput: true,
      ema: true,
    });
  });
});
