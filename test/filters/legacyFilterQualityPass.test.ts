import { describe, expect, it } from "vitest";

import {
  aerochromeChannels,
  daguerreotypePlateReflection,
  daguerreotypeScatter,
  estimateVisibleNir,
  lcdOrderedDecision,
  mezzotintInkCoverage,
  MEZZOTINT_ROCKER_ANGLES,
} from "filters/legacyFilterQualityContracts";
import { filterList } from "filters/index";
import { filmBurnDamage } from "filters/filmBurnContracts";
import { inkBleedCoverage } from "filters/inkBleedContracts";
import {
  cyanotypeBlueDensity,
  cyanotypeGrainAmplitude,
  thermalProxyLevelSpan,
} from "filters/physicalImagingQualityContracts";

const catalogFilter = (displayName: string) =>
  filterList.find((entry) => entry.displayName === displayName)?.filter;

describe("visible-RGB infrared estimate", () => {
  it("raises green foliage proxies and suppresses blue-sky proxies", () => {
    const foliage = estimateVisibleNir([0.12, 0.65, 0.1], 1, 0.65);
    const neutral = estimateVisibleNir([0.4, 0.4, 0.4], 1, 0.65);
    const sky = estimateVisibleNir([0.1, 0.25, 0.8], 1, 0.65);

    expect(foliage).toBeGreaterThan(neutral);
    expect(sky).toBeLessThan(neutral);
  });

  it("maps estimated NIR, visible red, and visible green into CIR channels", () => {
    expect(aerochromeChannels([0.2, 0.4, 0.7], 0.9)).toEqual([0.9, 0.2, 0.4]);
  });

  it("bounds malformed and out-of-range inputs", () => {
    expect(estimateVisibleNir([Number.NaN, 8, -2], 1, 0.65)).toBeGreaterThanOrEqual(0);
    expect(estimateVisibleNir([Number.NaN, 8, -2], 1, 0.65)).toBeLessThanOrEqual(1);
  });
});

describe("mezzotint plate model", () => {
  it("works continuously from a dark ink ground toward paper highlights", () => {
    const dark = mezzotintInkCoverage(0.05, 0.92, 1.1, 0.08);
    const middle = mezzotintInkCoverage(0.5, 0.92, 1.1, 0.08);
    const light = mezzotintInkCoverage(0.95, 0.92, 1.1, 0.08);

    expect(dark).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(light);
    expect(dark).toBeGreaterThan(0.8);
    expect(light).toBeLessThan(0.1);
  });

  it("lightens a worn plate without reversing tonal order", () => {
    expect(mezzotintInkCoverage(0.3, 0.92, 1.1, 0.8))
      .toBeLessThan(mezzotintInkCoverage(0.3, 0.92, 1.1, 0));
  });

  it("rocks the ground in multiple non-duplicate directions", () => {
    expect(MEZZOTINT_ROCKER_ANGLES).toEqual([0, 45, 90, 135]);
    expect(new Set(MEZZOTINT_ROCKER_ANGLES).size).toBe(4);
  });
});

describe("daguerreotype plate model", () => {
  it("preserves direct-positive tonal ordering and strengthens gilded contrast", () => {
    expect(daguerreotypeScatter(0.8, 0.65)).toBeGreaterThan(daguerreotypeScatter(0.2, 0.65));
    const ungildedRange = daguerreotypeScatter(0.75, 0) - daguerreotypeScatter(0.25, 0);
    const gildedRange = daguerreotypeScatter(0.75, 1) - daguerreotypeScatter(0.25, 1);
    expect(gildedRange).toBeGreaterThan(ungildedRange);
  });

  it("changes mirror reflection with the viewing-light direction", () => {
    const facing = daguerreotypePlateReflection(0.8, 0, 0, 0.7);
    const opposite = daguerreotypePlateReflection(0.8, 0, 180, 0.7);
    expect(facing).toBeGreaterThan(opposite);
    expect(facing).toBeLessThanOrEqual(1);
    expect(opposite).toBeGreaterThanOrEqual(0);
  });
});

describe("projection film burn damage", () => {
  it("expands destroyed emulsion as heat intensity increases", () => {
    expect(filmBurnDamage(0.62, 0.85).core).toBeGreaterThan(filmBurnDamage(0.62, 0.2).core);
    expect(filmBurnDamage(0.9, 0.85).heat).toBeGreaterThan(filmBurnDamage(0.9, 0.2).heat);
  });

  it("separates a destroyed core, blister front, and undamaged exterior", () => {
    const core = filmBurnDamage(0.1, 0.5);
    const front = filmBurnDamage(0.51, 0.5);
    const exterior = filmBurnDamage(1.2, 0.5);
    expect(core.core).toBeGreaterThan(0.9);
    expect(front.blister).toBeGreaterThan(0.8);
    expect(exterior.heat).toBeLessThan(0.1);
  });

  it("keeps malformed inputs finite and bounded", () => {
    for (const value of Object.values(filmBurnDamage(Number.NaN, Number.POSITIVE_INFINITY, -8))) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("ink transport through paper fibers", () => {
  it("deposits more ink from dark marks than light marks", () => {
    expect(inkBleedCoverage(0.1, 1, 0.5, 1)).toBeGreaterThan(inkBleedCoverage(0.9, 1, 0.5, 1));
  });

  it("transfers neighboring dark ink as absorbency increases", () => {
    const dry = inkBleedCoverage(1, 0.05, 0.1, 0.8);
    const absorbent = inkBleedCoverage(1, 0.05, 0.8, 0.8);
    expect(absorbent).toBeGreaterThan(dry);
  });

  it("bounds malformed transport inputs", () => {
    expect(inkBleedCoverage(Number.NaN, -8, Number.POSITIVE_INFINITY, 9)).toBeGreaterThanOrEqual(0);
    expect(inkBleedCoverage(Number.NaN, -8, Number.POSITIVE_INFINITY, 9)).toBeLessThanOrEqual(1);
  });
});

describe("cyanotype chemistry surface", () => {
  it("forms more Prussian-blue density from dark positive-image values", () => {
    expect(cyanotypeBlueDensity(0.1, 0, 1.4, 0.9))
      .toBeGreaterThan(cyanotypeBlueDensity(0.9, 0, 1.4, 0.9));
  });

  it("reverses tonal ordering for a negative print", () => {
    expect(cyanotypeBlueDensity(0.1, 0, 1.4, 0.9, true))
      .toBeLessThan(cyanotypeBlueDensity(0.9, 0, 1.4, 0.9, true));
  });

  it("keeps grain in normalized tone units", () => {
    expect(cyanotypeGrainAmplitude(0.06)).toBe(0.06);
    expect(cyanotypeGrainAmplitude(80)).toBe(1);
  });
});

describe("visible-proxy thermal display", () => {
  it("maps level and span monotonically with a centered midpoint", () => {
    expect(thermalProxyLevelSpan(0.2, 0.5, 0.8)).toBeLessThan(thermalProxyLevelSpan(0.5, 0.5, 0.8));
    expect(thermalProxyLevelSpan(0.5, 0.5, 0.8)).toBeCloseTo(0.5);
    expect(thermalProxyLevelSpan(0.8, 0.5, 0.8)).toBeGreaterThan(thermalProxyLevelSpan(0.5, 0.5, 0.8));
  });

  it("clamps values outside the display window and malformed inputs", () => {
    expect(thermalProxyLevelSpan(-2, 0.5, 0.4)).toBe(0);
    expect(thermalProxyLevelSpan(3, 0.5, 0.4)).toBe(1);
    expect(Number.isFinite(thermalProxyLevelSpan(Number.NaN, Number.NaN, Number.NaN))).toBe(true);
  });
});

describe("legacy quality filter surface", () => {
  it.each(["Infrared photography", "Mezzotint", "Nokia LCD", "Daguerreotype", "Film burn", "Ink Bleed", "Cyanotype", "Thermal camera"])(
    "%s exposes described controls and a real WebGL implementation",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      expect(filter?.requiresGL).toBe(true);
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
    },
  );

  it("labels the infrared estimate honestly and defaults mezzotint to toned ink", () => {
    expect(catalogFilter("Infrared photography")?.description).toMatch(/estimated/i);
    expect(catalogFilter("Mezzotint")?.options).toMatchObject({
      inkColor: [18, 16, 20],
      paperColor: [239, 232, 216],
    });
  });

  it("keeps Nokia output binary while spatially distributing middle gray", () => {
    const activeCount = (luminance: number) => {
      let active = 0;
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          if (lcdOrderedDecision(luminance, x, y, 128, 1)) active += 1;
        }
      }
      return active;
    };
    expect(activeCount(0.05)).toBe(15);
    expect(activeCount(0.5)).toBe(8);
    expect(activeCount(0.95)).toBe(1);
    expect(catalogFilter("Nokia LCD")?.options).toMatchObject({
      ditherStrength: 0.65,
      palette: { options: { levels: 256 } },
    });
  });

  it("defaults Daguerreotype to a detailed gilded silver plate", () => {
    expect(catalogFilter("Daguerreotype")?.options).toMatchObject({
      softFocus: 0,
      gilding: 0.65,
      metallic: 0.7,
      plateAge: 0.08,
    });
    expect(catalogFilter("Daguerreotype")?.description).toMatch(/detail/i);
  });

  it("defaults Film burn to visible emulsion damage rather than a warm grade", () => {
    expect(catalogFilter("Film burn")?.options).toMatchObject({
      intensity: 0.55,
      distortion: 0.35,
      blistering: 0.7,
      roughness: 0.55,
    });
    expect(catalogFilter("Film burn")?.description).toMatch(/blister|emulsion/i);
  });

  it("defaults Ink Bleed to fiber-directed dark ink on paper", () => {
    expect(catalogFilter("Ink Bleed")?.options).toMatchObject({
      spread: 4,
      absorbency: 0.55,
      anisotropy: 0.65,
      inkColor: [24, 18, 14],
    });
    expect(catalogFilter("Ink Bleed")?.description).toMatch(/fiber|capillary/i);
  });

  it("defaults Cyanotype to bounded grain and washed Prussian-blue density", () => {
    expect(catalogFilter("Cyanotype")?.options).toMatchObject({
      grain: 0.06,
      wash: 0.8,
      blueDensity: 0.9,
      fiberTexture: 0.18,
    });
  });

  it("labels Thermal camera as a visible proxy with level/span sampling", () => {
    expect(catalogFilter("Thermal camera")?.options).toMatchObject({
      level: 0.5,
      span: 0.8,
      sensorWidth: 160,
      noiseAmount: 0.015,
    });
    expect(catalogFilter("Thermal camera")?.description).toMatch(/visible.*proxy/i);
    expect(catalogFilter("Thermal camera")?.description).not.toMatch(/measure/i);
  });
});
