import { describe, it, expect } from "vitest";
import { glUnavailableStub } from "gl";

// The stub is what the filter dispatcher draws when a requiresGL filter
// runs on a device without WebGL2. Pixel-content assertions live in the
// gl-smoke Playwright run (jsdom's canvas is a no-op rasteriser and
// always returns zeroed pixels, so colour/text checks would be vacuous
// here). This unit covers the contract that works in jsdom:
//   • the stub produces a canvas at the requested size
//   • it exposes a 2d context
//   • it doesn't throw for very small or zero dimensions the dispatcher
//     may legitimately ask for on pipeline seed frames

describe("glUnavailableStub", () => {
  it("returns a canvas at the requested size", () => {
    const canvas = glUnavailableStub(64, 32) as HTMLCanvasElement;
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(32);
    expect(canvas.getContext("2d")).not.toBeNull();
  });

  it("handles awkwardly small sizes without throwing", () => {
    expect(() => glUnavailableStub(4, 4)).not.toThrow();
    expect(() => glUnavailableStub(1, 1)).not.toThrow();
  });
});
