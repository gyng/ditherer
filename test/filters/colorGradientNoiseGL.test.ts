import { describe, expect, it } from "vitest";
import { __testing } from "filters/colorGradientNoiseGL";

describe("colorGradientNoiseGL", () => {
  it("carries source alpha through instead of forcing opaque output", () => {
    // GL can't execute in this test environment (no WebGL2 in jsdom), so
    // this is a CPU-observable regression check on the shader source: the
    // final fragColor write must use the sampled source alpha, not a
    // hardcoded 1.0.
    expect(__testing.FS).toMatch(/fragColor = vec4\(outRgb \/ 255\.0, srcSample\.a\)/);
    expect(__testing.FS).not.toMatch(/fragColor = vec4\(outRgb \/ 255\.0, 1\.0\)/);
    expect(__testing.FS).toMatch(/vec4 srcSample = texture\(u_source,/);
  });
});
