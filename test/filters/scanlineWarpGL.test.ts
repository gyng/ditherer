import { describe, expect, it } from "vitest";

import { filterIndex, filterList } from "@gyng/ditherer-filters";
import scanlineWarp, { defaults as scanlineWarpDefaults } from "filters/scanlineWarp";
import { scanlineWarpGLAvailable } from "filters/scanlineWarpGL";

describe("Scanline Warp filter", () => {
  it("is a registered GL-only single-pass displacement filter", () => {
    expect(scanlineWarp.requiresGL).toBe(true);
    expect(scanlineWarp.temporal).toBe(true);
    expect(filterIndex["Scanline Warp"]).toBe(scanlineWarp);
    expect(filterList.some((entry) => entry.displayName === "Scanline Warp")).toBe(true);
  });

  it("ships sane default amplitude, frequency, and phase", () => {
    expect(scanlineWarpDefaults.amplitude).toBe(10);
    expect(scanlineWarpDefaults.frequency).toBe(2);
    expect(scanlineWarpDefaults.phase).toBe(0);
    expect(scanlineWarpDefaults.animSpeed).toBe(12);
  });

  // The alpha-carrying fix (sampling the full vec4 at the warped tap and
  // interpolating alpha with the same lerp as rgb) lives entirely inside the
  // GLSL fragment shader and can only be observed through a live WebGL2
  // context. jsdom provides no WebGL2, so glAvailable()/renderScanlineWarpGL
  // report unavailable here; the pixel-level assertion (a translucent region
  // stays translucent, not forced opaque, after the warp) is covered by the
  // gl-smoke draft `runScanlineWarpAlphaWarped` instead (headed Chrome).
  it("reports GL unavailable in the jsdom test environment and falls back to passthrough", () => {
    expect(scanlineWarpGLAvailable()).toBe(false);

    const input = { width: 4, height: 4 } as any;
    const result = scanlineWarp.func(input, { ...scanlineWarpDefaults, _frameIndex: 0 });

    expect(result).toBe(input);
  });
});
