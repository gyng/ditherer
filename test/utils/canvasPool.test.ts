import { describe, expect, it } from "vitest";
import { releasePooledCanvas, takePooledCanvas } from "utils";

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
});
