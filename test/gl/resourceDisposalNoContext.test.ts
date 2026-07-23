import { describe, expect, it, vi } from "vitest";
import { releaseFloatTextures } from "gl/fft2d";
import { releasePooledTextures } from "gl/index";
import { disposeSharedFilterResources } from "../../packages/ditherer-filters/src/runtime";

describe("empty GL resource disposal", () => {
  it("does not create a WebGL context just to discover empty pools", () => {
    const createElement = vi.spyOn(document, "createElement");

    expect(releasePooledTextures()).toBe(0);
    expect(releaseFloatTextures()).toBe(0);
    expect(() => disposeSharedFilterResources()).not.toThrow();
    expect(createElement).not.toHaveBeenCalledWith("canvas");
  });
});
