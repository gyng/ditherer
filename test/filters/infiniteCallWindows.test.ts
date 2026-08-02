import { describe, expect, it } from "vitest";

import {
  LAYOUT,
  centeredRect,
  clamp01,
  clamp255,
  clampRect,
  hslToRgb,
  layoutRect,
} from "filters/infiniteCallWindows";

// 454 lines, noGL + noWASM, covered only by the smoke sweep's "doesn't throw".
//
// The filter's hot path is Canvas2D chrome drawing (drawImage / fillRect /
// strokeRect / fillText), which jsdom can't exercise — but the geometry
// underneath it is pure and is where the real invariants live: every pane must
// land inside the frame, panes must shrink with depth, and a pane too small or
// fully off-screen must be dropped rather than drawn at a negative size.
//
// This is also where the session's pattern points: bugs have clustered in state
// machines and geometry (Pixel Sort's iterators, Octree's tree reduction), not
// in the maths.

const W = 320;
const H = 200;
const MIN_PANE = 8;

const LAYOUTS = [LAYOUT.CENTER_STACK, LAYOUT.GRID_2X2, LAYOUT.GRID_3X3, LAYOUT.PIP];

describe("panes stay inside the frame", () => {
  it.each(LAYOUTS)("%s never returns a rect outside the canvas", (layout) => {
    // A rect poking outside would drawImage off-canvas — silently clipped, so
    // nothing would ever complain, but the pane would be wrong.
    for (let level = 0; level < 8; level++) {
      for (let frame = 0; frame < 40; frame++) {
        const r = layoutRect(layout, level, frame, W, H, 0.84, 0.018);
        if (!r) continue; // dropped is a valid outcome
        expect(r.x, `${layout} L${level} F${frame}: x`).toBeGreaterThanOrEqual(0);
        expect(r.y, `${layout} L${level} F${frame}: y`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, `${layout} L${level} F${frame}: right edge`).toBeLessThanOrEqual(W);
        expect(r.y + r.h, `${layout} L${level} F${frame}: bottom edge`).toBeLessThanOrEqual(H);
      }
    }
  });

  it.each(LAYOUTS)("%s never returns a pane below the minimum size", (layout) => {
    // Below minPaneSize the pane is meant to be dropped, not drawn tiny.
    for (let level = 0; level < 12; level++) {
      for (let frame = 0; frame < 10; frame++) {
        const r = layoutRect(layout, level, frame, W, H, 0.84, 0.018);
        if (!r) continue;
        expect(r.w).toBeGreaterThanOrEqual(MIN_PANE);
        expect(r.h).toBeGreaterThanOrEqual(MIN_PANE);
      }
    }
  });

  it.each(LAYOUTS)("%s survives a frame smaller than a pane", (layout) => {
    // Degenerate sizes are where geometry tends to go negative.
    for (const [w, h] of [
      [1, 1],
      [4, 4],
      [8, 8],
      [10, 3],
    ]) {
      for (let level = 0; level < 4; level++) {
        const r = layoutRect(layout, level, 0, w, h, 0.84, 0.018);
        if (!r) continue;
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y + r.h).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe("recursion shrinks", () => {
  it("CENTER_STACK panes shrink with depth and bottom out at the minimum", () => {
    // The filter's premise: each generation nests inside the last. If deeper
    // panes didn't shrink there'd be no recursion, just redraws.
    //
    // They never drop out, though: centeredRect floors at minPaneSize, so a
    // CENTER_STACK pane is always at least 8x8 however deep you go. Recursion is
    // bounded by the `depth` option, not by the geometry running out — worth
    // knowing before assuming this is where the floor lives.
    let prev = Infinity;
    let first = 0;
    for (let level = 0; level < 40; level++) {
      // drift 0 so this measures scale alone, not the wobble.
      const r = layoutRect(LAYOUT.CENTER_STACK, level, 0, W, H, 0.84, 0);
      expect(r, `level ${level} dropped out unexpectedly`).not.toBeNull();
      expect(r!.w, `level ${level} did not shrink`).toBeLessThanOrEqual(prev);
      expect(r!.w).toBeGreaterThanOrEqual(MIN_PANE);
      if (level === 0) first = r!.w;
      prev = r!.w;
    }
    // Deep enough and it sits on the floor rather than vanishing or inverting.
    expect(prev).toBe(MIN_PANE);
    expect(first).toBeGreaterThan(MIN_PANE * 4);
  });

  it("a smaller scalePerDepth shrinks faster", () => {
    const gentle = layoutRect(LAYOUT.CENTER_STACK, 2, 0, W, H, 0.9, 0);
    const steep = layoutRect(LAYOUT.CENTER_STACK, 2, 0, W, H, 0.5, 0);
    expect(gentle && steep).toBeTruthy();
    expect(steep!.w).toBeLessThan(gentle!.w);
  });

  it("drift moves the pane without pushing it out of frame", () => {
    const still = layoutRect(LAYOUT.CENTER_STACK, 1, 7, W, H, 0.84, 0);
    const drifting = layoutRect(LAYOUT.CENTER_STACK, 1, 7, W, H, 0.84, 0.05);
    expect(still && drifting).toBeTruthy();
    expect([drifting!.x, drifting!.y]).not.toEqual([still!.x, still!.y]);
    expect(drifting!.x).toBeGreaterThanOrEqual(0);
    expect(drifting!.x + drifting!.w).toBeLessThanOrEqual(W);
  });
});

describe("clampRect", () => {
  it("drops a rect that is entirely off-screen", () => {
    expect(clampRect({ x: -100, y: 0, w: 50, h: 50 }, W, H)).toBeNull();
    expect(clampRect({ x: W, y: 0, w: 50, h: 50 }, W, H)).toBeNull();
    expect(clampRect({ x: 0, y: -60, w: 50, h: 50 }, W, H)).toBeNull();
    expect(clampRect({ x: 0, y: H, w: 50, h: 50 }, W, H)).toBeNull();
  });

  it("drops a rect smaller than the minimum", () => {
    expect(clampRect({ x: 0, y: 0, w: MIN_PANE - 1, h: 50 }, W, H)).toBeNull();
    expect(clampRect({ x: 0, y: 0, w: 50, h: MIN_PANE - 1 }, W, H)).toBeNull();
  });

  it("clips a rect that straddles the top-left, keeping it in bounds", () => {
    const r = clampRect({ x: -10, y: -10, w: 50, h: 50 }, W, H);
    expect(r).toEqual({ x: 0, y: 0, w: 40, h: 40 });
  });

  it("clips a rect that straddles the bottom-right, keeping it in bounds", () => {
    // The other two edges clip by shrinking w/h rather than moving x/y, so they
    // need their own case — mutation-testing caught that dropping the right-edge
    // clip entirely left every other assertion here green, because nothing else
    // ever produced a rect that overhangs the far side.
    const r = clampRect({ x: W - 10, y: H - 10, w: 50, h: 50 }, W, H);
    expect(r).toEqual({ x: W - 10, y: H - 10, w: 10, h: 10 });
    expect(r!.x + r!.w).toBe(W);
    expect(r!.y + r!.h).toBe(H);
  });

  it("clips a rect larger than the whole frame down to the frame", () => {
    const r = clampRect({ x: -50, y: -50, w: W + 500, h: H + 500 }, W, H);
    expect(r).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it("drops a rect that clipping shrinks below the minimum", () => {
    // Straddling by so much that only a sliver remains — that sliver is not a
    // pane, and drawing it would be worse than skipping it.
    expect(clampRect({ x: -45, y: 0, w: 50, h: 50 }, W, H)).toBeNull();
  });

  it("leaves a fully-contained rect alone", () => {
    const rect = { x: 10, y: 10, w: 50, h: 50 };
    expect(clampRect(rect, W, H)).toEqual(rect);
  });
});

describe("centeredRect", () => {
  it("centres the pane", () => {
    const r = centeredRect(100, 100, 0.5);
    expect(r).toEqual({ x: 25, y: 25, w: 50, h: 50 });
  });

  it("honours the offset", () => {
    const r = centeredRect(100, 100, 0.5, 10, -10);
    expect(r).toEqual({ x: 35, y: 15, w: 50, h: 50 });
  });

  it("never goes below the minimum pane size", () => {
    const r = centeredRect(100, 100, 0.0001);
    expect(r.w).toBe(MIN_PANE);
    expect(r.h).toBe(MIN_PANE);
  });
});

describe("hslToRgb matches the published conversion", () => {
  // Hue is in DEGREES here (the function wraps via ((h % 360) + 360) % 360),
  // not the 0..1 some HSL helpers take. Reference values are from the standard
  // HSL->RGB definition, not from this implementation.
  it.each([
    ["black", 0, 0, 0, [0, 0, 0]],
    ["white", 0, 0, 1, [255, 255, 255]],
    ["mid grey", 0, 0, 0.5, [128, 128, 128]],
    ["red", 0, 1, 0.5, [255, 0, 0]],
    ["green", 120, 1, 0.5, [0, 255, 0]],
    ["blue", 240, 1, 0.5, [0, 0, 255]],
    ["yellow", 60, 1, 0.5, [255, 255, 0]],
    ["cyan", 180, 1, 0.5, [0, 255, 255]],
  ])("%s", (_name, h, s, l, expected) => {
    const got = hslToRgb(h as number, s as number, l as number);
    for (let i = 0; i < 3; i++) {
      expect(
        Math.abs(got[i] - (expected as number[])[i]),
        `channel ${i}: ${got}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("wraps hue past 360 and below 0", () => {
    // The accent hue is driven by frameIndex, so it runs off both ends.
    expect(hslToRgb(480, 1, 0.5)).toEqual(hslToRgb(120, 1, 0.5));
    expect(hslToRgb(-120, 1, 0.5)).toEqual(hslToRgb(240, 1, 0.5));
  });

  it("saturation 0 is always grey whatever the hue", () => {
    for (const h of [0, 90, 180, 270]) {
      const [r, g, b] = hslToRgb(h, 0, 0.5);
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });
});

describe("clamps", () => {
  it("clamp255 rounds and bounds", () => {
    expect(clamp255(-5)).toBe(0);
    expect(clamp255(300)).toBe(255);
    expect(clamp255(127.6)).toBe(128);
  });

  it("clamp01 bounds without rounding", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });
});
