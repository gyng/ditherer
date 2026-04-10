import { describe, expect, it } from "vitest";
import { getWorkerPrevOutputFrame } from "utils";

describe("getWorkerPrevOutputFrame", () => {
  it("uses the intermediate frame dimensions from the worker payload", () => {
    const payload = {
      imageData: new Uint8ClampedArray(4 * 4 * 4).buffer,
      width: 4,
      height: 4,
    };

    const frame = getWorkerPrevOutputFrame(payload, 8, 8);

    expect(frame.width).toBe(4);
    expect(frame.height).toBe(4);
    expect(frame.pixels).toHaveLength(4 * 4 * 4);
  });

  it("falls back to the final output dimensions for legacy worker payloads", () => {
    const payload = new Uint8ClampedArray(8 * 8 * 4).buffer;

    const frame = getWorkerPrevOutputFrame(payload, 8, 8);

    expect(frame.width).toBe(8);
    expect(frame.height).toBe(8);
    expect(frame.pixels).toHaveLength(8 * 8 * 4);
  });
});
