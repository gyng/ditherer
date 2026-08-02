import { describe, expect, it, vi } from "vitest";

const resourceMocks = vi.hoisted(() => ({
  releaseJpegArtifactFloatTextures: vi.fn(() => 6),
}));

vi.mock("filters/jpegArtifactGL", async () => {
  const actual =
    await vi.importActual<typeof import("filters/jpegArtifactGL")>("filters/jpegArtifactGL");
  return {
    ...actual,
    releaseJpegArtifactFloatTextures: resourceMocks.releaseJpegArtifactFloatTextures,
  };
});

import { disposeSharedFilterResources } from "../../packages/ditherer-filters/src/runtime";

describe("shared filter resource disposal", () => {
  it("includes JPEG codec float targets", () => {
    disposeSharedFilterResources();
    expect(resourceMocks.releaseJpegArtifactFloatTextures).toHaveBeenCalledOnce();
  });
});
