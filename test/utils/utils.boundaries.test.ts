import { describe, expect, it, vi } from "vitest";
import { HSV_NEAREST, LAB_NEAREST, RGB_APPROX, RGB_NEAREST } from "constants/color";
import * as utils from "utils";

describe("utility decision boundaries", () => {
  it("treats missing RGBA channels as zero in float and byte transfer functions", () => {
    const linear = utils.srgbBufToLinearFloat(new Uint8Array([10]));
    expect(Array.from(linear)).toEqual([expect.any(Number)]);

    const out = new Uint8Array(4);
    utils.linearFloatToSrgbBuf(new Float32Array([0.002]), out);
    expect(out[0]).toBeGreaterThan(0);
    expect(out.slice(1)).toEqual(new Uint8Array([0, 0, 0]));

    expect(utils.linearizeColorF([])).toEqual([0, 0, 0, 0]);
    expect(utils.delinearizeColorF([])).toEqual([0, 0, 0, 0]);
    const short = [128] as number[];
    utils.linearizeBuffer(short);
    utils.delinearizeBuffer(short);
    expect(short[0]).toBeTypeOf("number");
  });

  it("handles palette functions that are present, absent, and linear-light", () => {
    const pixel = [10, 20, 30, 255];
    const getColor = vi.fn(() => [255, 255, 255, 255]);
    expect(utils.srgbPaletteGetColor(null, pixel, {})).toBe(pixel);
    expect(utils.srgbPaletteGetColor({ getColor }, pixel, { mode: 1 })).toEqual([255, 255, 255, 255]);
    expect(utils.linearPaletteGetColor({}, [0.1, 0.2, 0.3, 1], {})).toEqual([0.1, 0.2, 0.3, 1]);
    expect(utils.linearPaletteGetColor({ getColor }, [0.1, 0.2, 0.3, 1], {})).toHaveLength(4);
    expect(utils.paletteGetColor({ getColor }, pixel, {}, false)).toEqual([255, 255, 255, 255]);
    expect(utils.paletteGetColor({ getColor }, [0.1, 0.2, 0.3, 1], {}, true)).toHaveLength(4);
  });

  it("covers neutral and every dominant-channel HSV/Lab conversion segment", () => {
    expect(utils.rgba2hsva([40, 40, 40, 128])).toEqual([0, 0, 40 / 255, 128 / 255]);
    expect(utils.rgba2hsva([255, 0, 128, 255])[0]).toBeGreaterThan(300);
    expect(utils.rgba2hsva([0, 255, 10, 255])[0]).toBeGreaterThan(100);
    expect(utils.rgba2hsva([0, 10, 255, 255])[0]).toBeGreaterThan(200);
    expect(utils.rgba2laba([0, 0, 0, 0])).toHaveLength(4);
    expect(utils.rgba2laba([255, 255, 255, 255])).toHaveLength(4);
    expect(utils.laba2rgba([0, 0, 0, 0])).toHaveLength(4);
    expect(utils.laba2rgba([100, 100, -100, 255])).toHaveLength(4);
  });

  it("evaluates every supported color-distance algorithm and the unknown sentinel", () => {
    const a = [250, 20, 30, 255];
    const b = [10, 220, 200, 255];
    for (const algorithm of [RGB_NEAREST, RGB_APPROX, HSV_NEAREST, LAB_NEAREST]) {
      expect(utils.colorDistance(a, b, algorithm)).toBeGreaterThanOrEqual(0);
    }
    expect(utils.colorDistance(a, b, "unknown")).toBe(-1);
    // Repeating the Lab input also exercises the memoized hit path.
    expect(utils.colorDistance(a, b, LAB_NEAREST)).toBeGreaterThanOrEqual(0);
  });

  it("covers median-cut terminal modes, Lab input, alpha ordering, and singleton buckets", () => {
    const colors = new Uint8ClampedArray([
      1, 2, 3, 0,
      20, 10, 5, 64,
      200, 220, 240, 128,
      255, 250, 245, 255,
    ]);
    for (const adaptMode of ["AVERAGE", "FIRST", "MID", "unknown"]) {
      expect(utils.medianCutPalette(colors, 0, false, adaptMode, "RGB")).toHaveLength(1);
    }
    expect(utils.medianCutPalette(colors, 3, true, "MID", "LAB").length).toBeGreaterThan(0);
    expect(utils.medianCutPalette(new Uint8ClampedArray([1, 2, 3, 4]), 4, false, "MID"))
      .toHaveLength(1);
  });

  it("preserves mathematical defaults and respects every buffer boundary", () => {
    expect(utils.add([], [])).toEqual([0, 0, 0, 0]);
    expect(utils.sub([], [])).toEqual([0, 0, 0, 0]);
    expect(utils.scale([], 2, false)).toEqual([0, 0, 0, 0]);
    expect(utils.scale([1, 2, 3, 4], 2, true)).toEqual([2, 4, 6, 8]);
    expect(utils.contrast([], 1)).toHaveLength(4);
    expect(utils.brightness([], 2, 3)).toEqual([2, 2, 2, 0]);
    expect(utils.gamma([], 2)).toEqual([0, 0, 0, 0]);

    for (const start of [0, 1, 2, 3, 4]) {
      const filled = new Uint8Array(4);
      utils.fillBufferPixel(filled, start, 1, 2, 3, 4);
      const added = new Uint8Array(4);
      utils.addBufferPixel(added, start, [1, 2, 3, 4]);
      expect(filled.length).toBe(4);
      expect(added.length).toBe(4);
    }
    const missing = new Uint8Array(4);
    utils.addBufferPixel(missing, 0, []);
    expect(missing).toEqual(new Uint8Array(4));
  });

  it("resolves palette algorithms and all WASM palette-mode mappings", () => {
    expect(utils.resolvePaletteColorAlgorithm(null)).toBeNull();
    expect(utils.resolvePaletteColorAlgorithm({ options: { colorDistanceAlgorithm: RGB_NEAREST } })).toBe(RGB_NEAREST);
    expect(utils.resolvePaletteColorAlgorithm({ defaults: { colorDistanceAlgorithm: LAB_NEAREST } })).toBe(LAB_NEAREST);
    expect(utils.resolvePaletteColorAlgorithm({ options: {}, defaults: {} })).toBeNull();
    expect(utils.colorAlgorithmToWasmMode(RGB_NEAREST)).toBe(utils.WASM_PALETTE_MODE.RGB);
    expect(utils.colorAlgorithmToWasmMode(RGB_APPROX)).toBe(utils.WASM_PALETTE_MODE.RGB_APPROX);
    expect(utils.colorAlgorithmToWasmMode(HSV_NEAREST)).toBe(utils.WASM_PALETTE_MODE.HSV);
    expect(utils.colorAlgorithmToWasmMode(LAB_NEAREST)).toBe(utils.WASM_PALETTE_MODE.LAB);
    expect(utils.colorAlgorithmToWasmMode(undefined)).toBeNull();
  });

  it("records backend status once, notifies subscribers, and isolates returned snapshots", () => {
    const listener = vi.fn();
    const unsubscribe = utils.subscribeFilterBackends(listener);
    utils.logFilterBackend("Boundary GL", "WebGL2", "ok");
    utils.logFilterBackend("Boundary GL", "WebGL2", "ok");
    utils.logFilterDispatched("Boundary JS", { noGL: "sequential", noWASM: "canvas" });
    utils.logFilterDispatched("Boundary JS");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(utils.getFilterWasmStatuses().get("Boundary JS")?.label).toContain("no WASM");
    const snapshot = utils.getFilterBackends();
    snapshot.get("Boundary GL")?.clear();
    expect(utils.getFilterBackends().get("Boundary GL")?.has("WebGL2")).toBe(true);
    utils.resetFilterWasmStatus("Boundary JS");
    expect(utils.getFilterWasmStatuses().has("Boundary JS")).toBe(false);
    unsubscribe();
  });
});
