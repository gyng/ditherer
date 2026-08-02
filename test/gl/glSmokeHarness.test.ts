import { describe, expect, it } from "vitest";

import {
  acquireGradientCanvas,
  canvasPixels,
  makeGradientCanvas,
  runtimeFixtureIntegrity,
  runtimeOptions,
} from "../../src/gl-smoke/fixtures";
import { runContractSuites } from "../../src/gl-smoke/contractRunner";

describe("GL smoke harness fixtures", () => {
  it("reuses read-only temporal histories without rebuilding canvases", () => {
    const first = runtimeOptions();
    const second = runtimeOptions();
    expect(first).toBe(second);
    expect(first._prevInput).toBe(second._prevInput);
    expect(first._prevOutput).toBe(second._prevOutput);
    expect(first._ema).toBe(second._ema);
    expect(runtimeFixtureIntegrity()).toEqual({ ok: true });
  });

  it("reuses an immutable registry canvas without changing its fixture", () => {
    const pooled = acquireGradientCanvas(16, 16);
    const fresh = makeGradientCanvas(16, 16);
    expect(acquireGradientCanvas(16, 16)).toBe(pooled);
    expect(canvasPixels(pooled)).toEqual(canvasPixels(fresh));
  });

  it("records declarative suites sequentially and converts throws into failures", async () => {
    const order: string[] = [];
    const records: { name: string; mode: string; ok: boolean }[] = [];
    const timings = await runContractSuites(
      [
        {
          name: "first",
          contracts: [
            {
              name: "A",
              mode: "pass",
              run: async () => {
                order.push("A");
                return { ok: true };
              },
            },
          ],
        },
        {
          name: "second",
          contracts: [
            {
              name: "B",
              mode: "throw",
              run: () => {
                order.push("B");
                throw new Error("boom");
              },
            },
          ],
        },
      ],
      (name, mode, result) => records.push({ name, mode, ok: result.ok }),
    );

    expect(order).toEqual(["A", "B"]);
    expect(records).toEqual([
      { name: "A", mode: "pass", ok: true },
      { name: "B", mode: "throw", ok: false },
    ]);
    expect(Object.keys(timings)).toEqual(["first", "second"]);
  });
});
