import { describe, expect, it } from "vitest";
import { decodeShareState, encodeShareState } from "utils/shareState";

describe("shareState", () => {
  it("round-trips compressed share state", () => {
    const json = JSON.stringify({
      v: 2,
      chain: [
        {
          n: "Ordered",
          d: "Ordered (Gameboy)",
          o: {
            threshold: 128,
            palette: {
              name: "User/Adaptive",
              options: { colors: ["#000000", "#ffffff", "#7f7f7f", "#00ff00"] },
            },
          },
        },
      ],
      g: false,
      l: true,
      w: true,
    });

    const encoded = encodeShareState(json);

    expect(encoded.startsWith("z:")).toBe(true);
    expect(encoded.includes("%")).toBe(false);
    expect(decodeShareState(encoded)).toBe(json);
  });

  it("produces a compact base64url payload", () => {
    const json = JSON.stringify({
      v: 2,
      chain: Array.from({ length: 5 }, (_, index) => ({
        n: "Ordered",
        d: `Preset ${index}`,
        o: {
          threshold: 96 + index,
          levels: 4,
          palette: {
            name: "User/Adaptive",
            options: {
              colors: ["#000000", "#1f1f1f", "#3f3f3f", "#7f7f7f", "#bfbfbf", "#ffffff"],
            },
          },
        },
      })),
      g: false,
      l: true,
      w: true,
    });

    const encoded = encodeShareState(json);

    expect(encoded.startsWith("z:")).toBe(true);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded.length).toBeLessThan(json.length);
  });

  it("rejects the old uncompressed payload shape", () => {
    expect(() => decodeShareState("eyJ2IjoyfQ%3D%3D")).toThrow("Unsupported share URL format");
  });
});
