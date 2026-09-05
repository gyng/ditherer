import { describe, expect, it, vi } from "vitest";

import {
  createFilterSession,
  filterIndex,
  getCanvasPoolStats,
  resetCanvasPoolStats,
  runFilterChain,
  takePooledCanvas,
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
    const result = await runFilterChain(canvas(), [{ id: "gray", filter: "Grayscale" }], {
      webglAcceleration: false,
      wasmAcceleration: false,
    });

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

    await runFilterChain(
      canvas(),
      [{ id: "capture", filter: definition, options: { amount: 7 } }],
      { wasmAcceleration: false },
    );

    expect(seen[0].amount).toBe(7);
    expect(
      (seen[0].palette as { options: { _wasmAcceleration: boolean } }).options._wasmAcceleration,
    ).toBe(false);
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

  it("does not retain temporal buffers for a stateless catalog filter", async () => {
    const session = createFilterSession([{ id: "gray", filter: "Grayscale" }]);
    await session.process(canvas());
    await session.process(canvas());
    expect(session.state.prevInputs.size).toBe(0);
    expect(session.state.prevOutputs.size).toBe(0);
    expect(session.state.ema.size).toBe(0);
    expect(session.state.frameIndex).toBe(2);
  });

  it("skips pixel readbacks when a custom filter explicitly needs no history", async () => {
    const input = canvas();
    const readPixels = vi.spyOn(input.getContext("2d")!, "getImageData");
    const session = createFilterSession([
      {
        id: "pass",
        filter: {
          name: "Pass without history",
          history: {},
          func: (source) => source,
        },
      },
    ]);
    await session.process(input);
    expect(readPixels).not.toHaveBeenCalled();
  });

  it.each(["prevInput", "prevOutput", "ema"] as const)(
    "retains and injects only declared %s history",
    async (kind) => {
      const observed: FilterOptionValues[] = [];
      const session = createFilterSession([
        {
          id: "selective",
          filter: {
            name: "Selective history",
            history: { [kind]: true },
            func: (source, options = {}) => {
              observed.push(options);
              return source;
            },
          },
        },
      ]);
      await session.process(canvas());
      await session.process(canvas());
      expect(session.state.prevInputs.size).toBe(kind === "prevInput" ? 1 : 0);
      expect(session.state.prevOutputs.size).toBe(kind === "prevOutput" ? 1 : 0);
      expect(session.state.ema.size).toBe(kind === "ema" ? 1 : 0);
      for (const key of ["prevInput", "prevOutput", "ema"]) {
        expect(observed[0][`_${key}`]).toBeNull();
        if (key === kind)
          expect(observed[1][`_${key}`]).toBeInstanceOf(
            kind === "ema" ? Float32Array : Uint8ClampedArray,
          );
        else expect(observed[1][`_${key}`]).toBeNull();
      }
    },
  );

  it("reports unknown filters without corrupting the rest of a chain", async () => {
    const onError = vi.fn();
    const result = await runFilterChain(
      canvas(),
      [
        { id: "missing", filter: "Not in this catalog" },
        { id: "gray", filter: filterIndex.Grayscale },
      ],
      { onError, webglAcceleration: false },
    );

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

  it("aborts after an awaited step, releases its output, and skips state and later stages", async () => {
    let resolveFirst: ((value: HTMLCanvasElement | OffscreenCanvas) => void) | undefined;
    let aborted = false;
    const later = vi.fn((input: FilterCanvas) => input);
    const firstOutput = takePooledCanvas(37, 23);
    const session = createFilterSession([
      {
        id: "first",
        filter: {
          name: "Deferred first",
          func: () =>
            new Promise<HTMLCanvasElement | OffscreenCanvas>((resolve) => {
              resolveFirst = resolve;
            }),
        },
      },
      { id: "later", filter: { name: "Later", func: later } },
    ]);
    const input = canvas(37, 23);
    resetCanvasPoolStats();

    const pending = session.process(input, { shouldAbort: () => aborted });
    expect(resolveFirst).toBeTypeOf("function");
    aborted = true;
    resolveFirst?.(firstOutput);
    const result = await pending;

    expect(result.canvas).toBe(input);
    expect(result.steps).toHaveLength(0);
    expect(later).not.toHaveBeenCalled();
    expect(session.state.prevOutputs.size).toBe(0);
    expect(session.state.prevInputs.size).toBe(0);
    expect(session.state.ema.size).toBe(0);
    expect(session.state.frameIndex).toBe(0);
    expect(getCanvasPoolStats()).toMatchObject({ releases: 1 });
    expect(takePooledCanvas(37, 23)).toBe(firstOutput);
  });

  it("releases superseded intermediates unless a preview transaction retains them", async () => {
    const width = 239;
    const height = 41;
    const first = takePooledCanvas(width, height);
    const second = takePooledCanvas(width, height);
    const chain = [
      { id: "first", filter: { name: "First pooled", func: () => first } },
      { id: "second", filter: { name: "Second pooled", func: () => second } },
    ];
    resetCanvasPoolStats();

    const released = await runFilterChain(
      canvas(width, height),
      chain,
      {},
      {
        retainStepCanvases: false,
      },
    );
    expect(released.canvas).toBe(second);
    expect(getCanvasPoolStats().releases).toBe(1);
    expect(takePooledCanvas(width, height)).toBe(first);

    const retainedFirst = takePooledCanvas(241, 43);
    const retainedSecond = takePooledCanvas(241, 43);
    resetCanvasPoolStats();
    const retained = await runFilterChain(canvas(241, 43), [
      { id: "first", filter: { name: "First retained", func: () => retainedFirst } },
      { id: "second", filter: { name: "Second retained", func: () => retainedSecond } },
    ]);
    expect(retained.canvas).toBe(retainedSecond);
    expect(getCanvasPoolStats().releases).toBe(0);
    expect(retained.steps.map((step) => step.canvas)).toEqual([retainedFirst, retainedSecond]);
  });

  it("releases the current ephemeral intermediate when later option resolution rejects", async () => {
    const width = 251;
    const height = 47;
    const first = takePooledCanvas(width, height);
    resetCanvasPoolStats();

    await expect(
      runFilterChain(
        canvas(width, height),
        [
          { id: "first", filter: { name: "First before resolve failure", func: () => first } },
          { id: "second", filter: { name: "Resolve failure", func: (input) => input } },
        ],
        {},
        {
          retainStepCanvases: false,
          resolveOptions: (_entry, index, defaults) => {
            if (index === 1) throw new Error("injected resolveOptions failure");
            return defaults;
          },
        },
      ),
    ).rejects.toThrow("injected resolveOptions failure");

    expect(getCanvasPoolStats().releases).toBe(1);
    expect(takePooledCanvas(width, height)).toBe(first);
  });

  it("releases the current ephemeral intermediate exactly once when onStep rejects", async () => {
    const width = 257;
    const height = 53;
    const first = takePooledCanvas(width, height);
    resetCanvasPoolStats();

    await expect(
      runFilterChain(
        canvas(width, height),
        [{ id: "first", filter: { name: "Rejected step callback", func: () => first } }],
        {},
        {
          retainStepCanvases: false,
          onStep: () => {
            throw new Error("injected onStep failure");
          },
        },
      ),
    ).rejects.toThrow("injected onStep failure");

    expect(getCanvasPoolStats().releases).toBe(1);
    expect(takePooledCanvas(width, height)).toBe(first);
  });
});
