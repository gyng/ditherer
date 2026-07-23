import React, { act, useContext } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@gyng/ditherer-filters/client", async () => {
  const actual = await vi.importActual<typeof import("@gyng/ditherer-filters/client")>("@gyng/ditherer-filters/client");
  return { ...actual, USE_WORKER: false, disposeFilterWorker: vi.fn() };
});

import { FilterProvider } from "context/FilterContext";
import { FilterContext, type FilterContextValue } from "context/filterContextValue";
import type { FilterDefinition } from "filters/types";

let latest: FilterContextValue;
const Probe = () => {
  const value = useContext(FilterContext);
  if (!value) throw new Error("FilterContext is missing");
  latest = value;
  return null;
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("FilterProvider main-thread generation", () => {
  const mountProvider = async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<FilterProvider><Probe /></FilterProvider>));
    return root;
  };

  it("drops an async filter result that resolves after processing reset", async () => {
    const root = await mountProvider();

    let resolveFilter: ((canvas: HTMLCanvasElement) => void) | undefined;
    const staleOutput = document.createElement("canvas");
    staleOutput.width = 9;
    staleOutput.height = 6;
    const temporalSnapshots: Record<string, unknown>[] = [];
    const asyncFilter: FilterDefinition = {
      name: "Deferred main filter",
      func: (filterInput, options = {}) => {
        temporalSnapshots.push({
          prevOutput: options._prevOutput,
          prevInput: options._prevInput,
          ema: options._ema,
        });
        if (temporalSnapshots.length === 1) {
          return new Promise<HTMLCanvasElement>((resolve) => { resolveFilter = resolve; });
        }
        const output = document.createElement("canvas");
        output.width = filterInput.width;
        output.height = filterInput.height;
        return output;
      },
      options: {},
      defaults: {},
      optionTypes: {},
    };
    await act(async () => {
      latest.actions.chainReplace(latest.state.chain[0].id, asyncFilter.name, asyncFilter);
    });
    const entryId = latest.state.chain[0].id;
    const input = document.createElement("canvas");
    input.width = 1;
    input.height = 1;
    latest.actions.filterImageAsync(input);
    expect(resolveFilter).toBeTypeOf("function");

    await act(async () => {
      latest.actions.loadImage(document.createElement("canvas"));
      resolveFilter?.(staleOutput);
      await Promise.resolve();
    });
    expect(latest.state.outputImage).not.toBe(staleOutput);
    expect(latest.actions.getIntermediatePreview(entryId)).toBeNull();

    await act(async () => {
      latest.actions.filterImageAsync(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(temporalSnapshots[1]).toEqual({ prevOutput: null, prevInput: null, ema: null });

    await act(async () => {
      latest.actions.filterImageAsync(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(temporalSnapshots[2]?.prevOutput).toBeInstanceOf(Uint8ClampedArray);
    expect(temporalSnapshots[2]?.prevInput).toBeInstanceOf(Uint8ClampedArray);
    expect(temporalSnapshots[2]?.ema).toBeInstanceOf(Float32Array);

    await act(async () => root.unmount());
  });

  it.each(["remove", "replace", "reorder", "import", "options"] as const)(
    "aborts remaining stages when an async early filter is invalidated by %s",
    async (mutation) => {
      const root = await mountProvider();
      let resolveFirst: ((canvas: HTMLCanvasElement) => void) | undefined;
      const later = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => input);
      const early: FilterDefinition = {
        name: "Deferred mutation target",
        func: () => new Promise<HTMLCanvasElement>((resolve) => { resolveFirst = resolve; }),
        options: { amount: 1 },
        defaults: { amount: 1 },
        optionTypes: { amount: { type: "RANGE", range: [0, 2], default: 1 } },
      };
      const laterFilter: FilterDefinition = {
        name: "Later side effect",
        func: later,
        options: {},
        defaults: {},
        optionTypes: {},
      };
      await act(async () => {
        latest.actions.chainReplace(latest.state.chain[0].id, early.name, early);
        latest.actions.chainAdd(laterFilter.name, laterFilter);
      });
      const earlyId = latest.state.chain[0].id;
      const input = document.createElement("canvas");
      input.width = 2;
      input.height = 2;
      latest.actions.filterImageAsync(input);
      expect(resolveFirst).toBeTypeOf("function");

      await act(async () => {
        if (mutation === "remove") latest.actions.chainRemove(earlyId);
        if (mutation === "replace") latest.actions.chainReplace(earlyId, "Grayscale", latest.grayscale);
        if (mutation === "reorder") latest.actions.chainReorder(0, 1);
        if (mutation === "import") {
          latest.actions.importState(JSON.stringify({
            v: 2,
            chain: [{ n: "Grayscale" }],
            g: false,
            l: true,
            w: true,
          }));
        }
        if (mutation === "options") latest.actions.setFilterOption("amount", 2, 0);
        resolveFirst?.(document.createElement("canvas"));
        await Promise.resolve();
      });

      expect(later).not.toHaveBeenCalled();
      expect(latest.actions.getIntermediatePreview(earlyId)).toBeNull();
      await act(async () => root.unmount());
    },
  );
});
