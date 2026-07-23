import { describe, expect, it } from "vitest";
import { duboisRedCyanLinear } from "filters/captureSamplingQualityContracts";

// Correct Dubois red/cyan least-squares projection (Sanders & McAllister),
// out = M_left·left + M_right·right, all channels in LINEAR light.
const M_LEFT = [
  [0.4561, 0.500484, 0.176381],
  [-0.0400822, -0.0378246, -0.0157589],
  [-0.0152161, -0.0205971, -0.00546856],
];
const M_RIGHT = [
  [-0.0434706, -0.0879388, -0.00155529],
  [0.378476, 0.73364, -0.0184503],
  [-0.0721527, -0.112961, 1.2264],
];

const reference = (
  l: readonly [number, number, number],
  r: readonly [number, number, number],
): [number, number, number] =>
  [0, 1, 2].map(row =>
    M_LEFT[row][0] * l[0] + M_LEFT[row][1] * l[1] + M_LEFT[row][2] * l[2]
    + M_RIGHT[row][0] * r[0] + M_RIGHT[row][1] * r[1] + M_RIGHT[row][2] * r[2],
  ) as [number, number, number];

describe("Dubois red/cyan projection", () => {
  it("matches the published matrix for a mixed known input", () => {
    const left: [number, number, number] = [0.8, 0.3, 0.1];
    const right: [number, number, number] = [0.2, 0.6, 0.9];
    const out = duboisRedCyanLinear(left, right);
    const expected = reference(left, right);
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(expected[i], 12);
  });

  it("does not leak a pure LEFT (red-eye) input into the cyan G/B channels", () => {
    // Right eye black: only the left matrix column contributes.
    const out = duboisRedCyanLinear([1, 1, 1], [0, 0, 0]);
    const [R, G, B] = out;
    // Red channel carries the left image (sum of left-red row ~= 1.13).
    expect(R).toBeGreaterThan(1);
    // The transpose bug leaked ~0.44 into G and ~0.20 into B. The correct
    // projection sends pure left to only tiny NEGATIVE cyan-channel amounts.
    expect(G).toBeLessThan(0);
    expect(B).toBeLessThan(0);
    expect(Math.abs(G)).toBeLessThan(0.11);
    expect(Math.abs(B)).toBeLessThan(0.05);
  });

  it("passes a pure right (cyan-eye) input through to green and blue", () => {
    const out = duboisRedCyanLinear([0, 0, 0], [1, 1, 1]);
    const [R, G, B] = out;
    expect(G).toBeGreaterThan(1); // 0.378476 + 0.73364 - 0.0184503
    expect(B).toBeGreaterThan(1); // -0.0721527 - 0.112961 + 1.2264
    expect(R).toBeLessThan(0);    // -0.0434706 - 0.0879388 - 0.00155529
  });
});
