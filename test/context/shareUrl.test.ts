import { describe, expect, it } from "vitest";
import { decodeShareState } from "utils/shareState";
import { getShareHash, getShareUrl } from "context/shareUrl";

describe("shareUrl", () => {
  it("omits the share hash for the default view state", () => {
    const defaultJson = JSON.stringify({ selected: { name: "Floyd-Steinberg" }, convertGrayscale: false, linearize: true, wasmAcceleration: true });

    expect(getShareHash(defaultJson, defaultJson)).toBe("");
  });

  it("encodes a share hash for non-default state", () => {
    const defaultJson = JSON.stringify({ selected: { name: "Floyd-Steinberg" }, convertGrayscale: false, linearize: true, wasmAcceleration: true });
    const changedJson = JSON.stringify({ selected: { name: "Ordered" }, convertGrayscale: false, linearize: true, wasmAcceleration: true });

    const hash = getShareHash(changedJson, defaultJson);

    expect(hash.startsWith("#!z:")).toBe(true);
    expect(decodeShareState(hash.slice(2))).toBe(changedJson);
  });

  it("builds a clean URL without a trailing hash when none is needed", () => {
    expect(getShareUrl("/app", "?demo=1", "")).toBe("/app?demo=1");
  });
});
