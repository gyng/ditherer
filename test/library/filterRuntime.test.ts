import { describe, expect, it, vi } from "vitest";

import {
  createFilterSession,
  filterIndex,
  runFilterChain,
  type FilterCanvas,
  type FilterDefinition,
  type FilterOptionValues,
} from "@gyng/ditherer-filters";

const canvas = (width = 3, height = 2): HTMLCanvasElement => {
  const value = document.createElement("canvas");
  value.width = width;
  value.height = height;
  return value;
};

describe("browser filter library runtime", () => {
  it("runs catalog filters by canonical name", async () => {
    const result = await runFilterChain(canvas(), [
      { id: "gray", filter: "Grayscale" },
    ], { webglAcceleration: false, wasmAcceleration: false });

    expect(result.canvas.width).toBe(3);
    expect(result.canvas.height).toBe(2);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].filterName).toBe("Grayscale");
  });

  it("merges defaults and entry options without mutating the definition", async () => {
    const seen: FilterOptionValues[] = [];
    const definition: FilterDefinition = {
      name: "Capture",
      defaults: { amount: 2, palette: { name: "test", options: { levels: 4 } } },
      options: { amount: 2, palette: { name: "test", options: { levels: 4 } } },
      func: (input, options) => {
        seen.push(options ?? {});
        return input;
      },
    };

    await runFilterChain(canvas(), [
      { id: "capture", filter: definition, options: { amount: 7 } },
    ], { wasmAcceleration: false });

    expect(seen[0].amount).toBe(7);
    expect((seen[0].palette as { options: { _wasmAcceleration: boolean } }).options._wasmAcceleration).toBe(false);
    expect(definition.options).toEqual({
      amount: 2,
      palette: { name: "test", options: { levels: 4 } },
    });
  });

  it("owns previous-frame input, output, EMA, and frame indexes in a session", async () => {
    const observed: Array<{
      frame: unknown;
      previousInput: unknown;
      previousOutput: unknown;
      ema: unknown;
    }> = [];
    const temporal: FilterDefinition = {
      name: "Temporal capture",
      temporal: true,
      func: (input, options = {}) => {
        observed.push({
          frame: options._frameIndex,
          previousInput: options._prevInput,
          previousOutput: options._prevOutput,
          ema: options._ema,
        });
        return input;
      },
    };
    const session = createFilterSession([{ id: "temporal", filter: temporal }]);

    await session.process(canvas());
    await session.process(canvas());

    expect(observed[0]).toMatchObject({
      frame: 0,
      previousInput: null,
      previousOutput: null,
      ema: null,
    });
    expect(observed[1].frame).toBe(1);
    expect(observed[1].previousInput).toBeInstanceOf(Uint8ClampedArray);
    expect(observed[1].previousOutput).toBeInstanceOf(Uint8ClampedArray);
    expect(observed[1].ema).toBeInstanceOf(Float32Array);
    expect(session.state.frameIndex).toBe(2);
  });

  it("reports unknown filters without corrupting the rest of a chain", async () => {
    const onError = vi.fn();
    const result = await runFilterChain(canvas(), [
      { id: "missing", filter: "Not in this catalog" },
      { id: "gray", filter: filterIndex.Grayscale },
    ], { onError, webglAcceleration: false });

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].error).toMatch(/Unknown filter/);
    expect(result.steps[1].filterName).toBe("Grayscale");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("prunes removed entries, resets temporal state, and rejects use after disposal", async () => {
    const passthrough: FilterDefinition = { name: "Pass", func: (input) => input };
    const session = createFilterSession([
      { id: "one", filter: passthrough },
      { id: "two", filter: passthrough },
    ]);
    await session.process(canvas());
    expect(session.state.prevInputs.size).toBe(2);

    session.setChain([{ id: "two", filter: passthrough }]);
    expect(session.state.prevInputs.has("one")).toBe(false);
    session.reset();
    expect(session.state.prevInputs.size).toBe(0);
    expect(session.state.frameIndex).toBe(0);

    session.dispose();
    await expect(session.process(canvas() as FilterCanvas)).rejects.toThrow(/disposed/);
  });
});
