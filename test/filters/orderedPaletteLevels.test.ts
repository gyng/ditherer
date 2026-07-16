import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderOrderedGL } = vi.hoisted(() => ({
  renderOrderedGL: vi.fn((input: HTMLCanvasElement) => input),
}));

vi.mock("filters/orderedGL", async () => {
  const actual = await vi.importActual<typeof import("filters/orderedGL")>("filters/orderedGL");
  return { ...actual, renderOrderedGL };
});

import ordered, { BAYER_4X4 } from "filters/ordered";
import nearest from "palettes/nearest";

describe("Ordered nearest-palette levels", () => {
  beforeEach(() => renderOrderedGL.mockClear());

  it("passes palette levels separately from threshold-map levels", () => {
    const input = document.createElement("canvas");
    input.width = 2;
    input.height = 2;

    ordered.func(input, {
      ...ordered.defaults,
      thresholdMap: BAYER_4X4,
      palette: { ...nearest, options: { levels: 32 } },
    });

    expect(renderOrderedGL).toHaveBeenCalledOnce();
    expect(renderOrderedGL.mock.calls[0][3]).toMatchObject({
      levels: 16,
      paletteLevels: 32,
    });
  });
});
