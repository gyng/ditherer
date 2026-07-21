import { describe, expect, it } from "vitest";

import {
  CRT_PROFILE,
  crtBeamSigma,
  crtProfileDefaults,
  crtSignalToSrgb,
  decayRetentionFromT10,
  resolveCrtProfileSetting,
  resolveVisibleScanlines,
} from "filters/crtSimulationContracts";
import { filterIndex, filterList } from "filters/index";

const catalogFilter = (displayName: string) =>
  filterList.find((entry) => entry.displayName === displayName)?.filter;

describe("CRT electro-optical transfer", () => {
  it("keeps endpoints stable and forms light with the tube exponent", () => {
    expect(crtSignalToSrgb(0, 2.4)).toBe(0);
    expect(crtSignalToSrgb(1, 2.4)).toBeCloseTo(1, 12);
    expect(crtSignalToSrgb(0.5, 2.4)).toBeCloseTo(0.472, 2);
  });
});

describe("CRT beam and raster contracts", () => {
  it("widens the beam monotonically with drive and corner defocus", () => {
    const darkCenter = crtBeamSigma(0, 0, 0.18, 0.42, 0.12);
    const brightCenter = crtBeamSigma(1, 0, 0.18, 0.42, 0.12);
    const brightCorner = crtBeamSigma(1, 1, 0.18, 0.42, 0.12);
    expect(darkCenter).toBeLessThan(brightCenter);
    expect(brightCenter).toBeLessThan(brightCorner);
  });

  it("resolves profile raster counts independently of output height", () => {
    expect(resolveVisibleScanlines(CRT_PROFILE.CONSUMER_525, 999, 1080)).toBe(240);
    expect(resolveVisibleScanlines(CRT_PROFILE.CONSUMER_625, 999, 2160)).toBe(288);
    expect(resolveVisibleScanlines(CRT_PROFILE.ARCADE_240P, 999, 720)).toBe(240);
    expect(resolveVisibleScanlines(CRT_PROFILE.CUSTOM, 360, 720)).toBe(360);
  });

  it("uses profile geometry until a user makes an explicit adjustment", () => {
    expect(resolveCrtProfileSetting(0.025, 0.025, 0.07)).toBe(0.07);
    expect(resolveCrtProfileSetting(0.04, 0.025, 0.07)).toBe(0.04);
  });
});

describe("CRT phosphor timing", () => {
  it("converts decay-to-10% timing into frame-rate-aware retention", () => {
    expect(decayRetentionFromT10(100, 60)).toBeCloseTo(0.681, 2);
    expect(decayRetentionFromT10(1, 60)).toBeLessThan(1e-12);
    expect(decayRetentionFromT10(0.022, 60)).toBe(0);
  });

  it("encodes measured P22 ordering instead of a green-dominant trail", () => {
    const profile = crtProfileDefaults(CRT_PROFILE.CONSUMER_525);
    expect(profile.phosphorT10Ms).toEqual({ red: 1, green: 0.06, blue: 0.022 });
  });
});

describe("CRT filter surface", () => {
  it.each(["CRT emulation", "Phosphor decay", "CRT Degauss", "Scanline"])(
    "%s describes every generated control",
    (name) => {
      const filter = catalogFilter(name);
      expect(filter).toBeDefined();
      for (const [optionName, option] of Object.entries(filter.optionTypes ?? {})) {
        expect(option.desc, `${name}.${optionName}`).toBeTruthy();
      }
    },
  );

  it("ships calibrated CRT defaults and explicit measured persistence", () => {
    expect(catalogFilter("CRT emulation")?.options).toMatchObject({
      brightness: 0,
      contrast: 0,
      exposure: 1,
      gamma: 2.4,
      blur: false,
    });
    expect(catalogFilter("CRT emulation")?.options?.palette).toMatchObject({
      options: { levels: 256 },
    });
    expect(catalogFilter("Scanline")?.options).toMatchObject({
      mode: "BEAM_PROFILE",
      visibleScanlines: 240,
    });
    expect(filterIndex["Phosphor Decay"].optionTypes?.profile).toBeDefined();
    expect(filterIndex["Phosphor Decay"].options?.profile).toBe("P22_COLOR");
  });
});
