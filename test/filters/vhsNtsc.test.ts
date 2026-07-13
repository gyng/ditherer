import { describe, expect, it } from "vitest";

import { filterIndex, filterList } from "filters";
import vhs, {
  buildTrackingRowShift,
  defaults as vhsDefaults,
  stochasticEventCount,
} from "filters/vhs";
import vhsNtsc, { defaults as vhsNtscDefaults } from "filters/vhsNtsc";

describe("VHS emulation frame state", () => {
  it("turns fractional expected event counts into deterministic occasional events", () => {
    expect(stochasticEventCount(0.8, 0.79)).toBe(1);
    expect(stochasticEventCount(0.8, 0.8)).toBe(0);
    expect(stochasticEventCount(2.25, 0.24)).toBe(3);
    expect(stochasticEventCount(2.25, 0.25)).toBe(2);
  });

  it("keeps tracking deterministic and changes adjacent frames smoothly", () => {
    const frame0 = buildTrackingRowShift(240, 12, 0.8, 0);
    const frame0Again = buildTrackingRowShift(240, 12, 0.8, 0);
    const frame1 = buildTrackingRowShift(240, 12, 0.8, 1);
    const frame8 = buildTrackingRowShift(240, 12, 0.8, 8);

    expect(Array.from(frame0Again)).toEqual(Array.from(frame0));

    const adjacentDelta = frame0.reduce(
      (sum, value, index) => sum + Math.abs(value - frame1[index]),
      0,
    );
    const profileDelta = frame0.reduce(
      (sum, value, index) => sum + Math.abs(value - frame8[index]),
      0,
    );

    expect(adjacentDelta).toBeLessThan(profileDelta);
  });

  it("ships a tape-like chroma bandwidth default", () => {
    expect(vhsDefaults.chromaBandwidth).toBeGreaterThan(0);
    expect(vhs.temporal).toBe(true);
  });
});

describe("VHS / NTSC filter", () => {
  it("is a registered GL-only signal-model filter", () => {
    expect(vhsNtsc.requiresGL).toBe(true);
    expect(vhsNtsc.temporal).toBe(true);
    expect(filterIndex["VHS / NTSC"]).toBe(vhsNtsc);
    expect(filterList.some((entry) => entry.displayName === "VHS / NTSC")).toBe(true);
  });

  it("defaults to LP tape and an NTSC notch decoder", () => {
    expect(vhsNtscDefaults.tapeSpeed).toBe("LP");
    expect(vhsNtscDefaults.demodulation).toBe("NOTCH");
    expect(vhsNtscDefaults.fieldMode).toBe("INTERLEAVED");
    expect(vhsNtscDefaults.chromaVertBlend).toBe(true);
    expect(vhsNtscDefaults.snow).toBe(0.00025);
    expect(vhsNtscDefaults.chromaPhaseNoise).toBe(0.001);
    expect(vhsNtscDefaults.chromaLoss).toBe(0.000025);
  });

  it("exposes the main transmission and tape controls", () => {
    expect(vhsNtsc.optionTypes).toMatchObject({
      tapeSpeed: { type: "ENUM" },
      demodulation: { type: "ENUM" },
      compositeNoise: { type: "RANGE" },
      headSwitching: { type: "RANGE" },
      trackingNoise: { type: "RANGE" },
      chromaPhaseNoise: { type: "RANGE" },
      chromaLoss: { type: "RANGE" },
      chromaVertBlend: { type: "BOOL" },
    });
  });
});
