import { describe, expect, it } from "vitest";
import {
  getCanvasPoolStats,
  releasePooledCanvas,
  resetCanvasPoolStats,
  takePooledCanvas,
  withPooledCanvasCleanup,
} from "@gyng/ditherer-filters";

describe("canvas pool", () => {
  it("returns released canvases on subsequent takes of the same size", () => {
    const a = takePooledCanvas(32, 24);
    releasePooledCanvas(a);
    const b = takePooledCanvas(32, 24);
    expect(b).toBe(a);
  });

  it("creates a fresh canvas when the pool is empty", () => {
    const a = takePooledCanvas(99, 77);
    const b = takePooledCanvas(99, 77);
    expect(a).not.toBe(b);
  });

  it("segregates by exact WxH — a 32x24 canvas does not satisfy a 32x25 request", () => {
    const a = takePooledCanvas(32, 24);
    releasePooledCanvas(a);
    const b = takePooledCanvas(32, 25);
    expect(b).not.toBe(a);
  });

  it("ignores null/undefined releases without throwing", () => {
    expect(() => releasePooledCanvas(null)).not.toThrow();
    expect(() => releasePooledCanvas(undefined)).not.toThrow();
  });

  it("caps each size bucket — excess releases are dropped, not retained", () => {
    // Drain the bucket for a fresh size so the test is deterministic.
    const size = { w: 123, h: 45 };
    const allocated: (HTMLCanvasElement | OffscreenCanvas)[] = [];
    // Push more than the cap; only the first few should be returned.
    for (let i = 0; i < 20; i += 1) allocated.push(takePooledCanvas(size.w, size.h));
    for (const c of allocated) releasePooledCanvas(c);
    // Now drain — we should only get back some subset, not all 20.
    const retrieved = new Set<unknown>();
    for (let i = 0; i < 20; i += 1) retrieved.add(takePooledCanvas(size.w, size.h));
    // Not a strict equality check on the cap (private constant), just
    // assert that the pool is bounded and fresh canvases are created
    // once the bucket is exhausted.
    let sameFromPool = 0;
    for (const c of allocated) if (retrieved.has(c)) sameFromPool += 1;
    expect(sameFromPool).toBeLessThan(20);
  });

  it("plateaus allocations, records reuse, and rejects duplicate releases", () => {
    const width = 211;
    const height = 73;
    resetCanvasPoolStats();
    const first = takePooledCanvas(width, height);
    releasePooledCanvas(first);
    releasePooledCanvas(first);

    const reused = takePooledCanvas(width, height);
    const simultaneous = takePooledCanvas(width, height);
    const stats = getCanvasPoolStats();
    expect(reused).toBe(first);
    expect(simultaneous).not.toBe(first);
    expect(stats).toMatchObject({ allocations: 2, reuses: 1, releases: 1 });
  });

  it("clears pixels and resets drawing state before handing out a reused canvas", () => {
    const canvas = takePooledCanvas(17, 13);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    expect(context).toBeTruthy();
    if (!context) return;
    context.globalAlpha = 0.25;
    context.globalCompositeOperation = "copy";
    context.fillStyle = "rgb(255, 0, 0)";
    context.fillRect(0, 0, 17, 13);
    releasePooledCanvas(canvas);

    const reused = takePooledCanvas(17, 13);
    const reusedContext = reused.getContext("2d") as CanvasRenderingContext2D | null;
    expect(reused).toBe(canvas);
    expect(reusedContext?.globalAlpha).toBe(1);
    expect(reusedContext?.globalCompositeOperation).toBe("source-over");
    expect(reusedContext?.getImageData(0, 0, 1, 1).data[3]).toBe(0);
  });

  it("releases each unique owned canvas exactly once when an operation throws", () => {
    const first = takePooledCanvas(313, 79);
    const second = takePooledCanvas(313, 79);
    resetCanvasPoolStats();
    expect(() => withPooledCanvasCleanup([first, first, second], () => {
      throw new Error("injected failure");
    })).toThrow("injected failure");
    expect(getCanvasPoolStats()).toMatchObject({ releases: 2 });

    const checkedOut = new Set([
      takePooledCanvas(313, 79),
      takePooledCanvas(313, 79),
    ]);
    expect(checkedOut).toEqual(new Set([first, second]));
  });
});
