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
import {
  filmGrainAmplitude,
  linearLightLeakChannel,
  projectionArtifactCounts,
} from "filters/analogFilmQualityContracts";
import {
  photocopierGenerationTone,
  substratePatternFrequency,
  washiFiberVariation,
} from "filters/substrateCopyQualityContracts";
import {
  duplexPlateCoverages,
  fixedPrintPlateOffset,
  risographBlurRadius,
  screenHalftoneDecision,
  stencilInkVariation,
} from "filters/printSimulationContracts";
import {
  nightVisionIntensifierResponse,
  nightVisionNoiseAmplitude,
  ultrasoundBackscatter,
  ultrasoundDepthTransmission,
  ultrasoundRayleighEnvelope,
} from "filters/imagingSimulationContracts";
import {
  hannWindow,
  lcdBlackMatrixLevel,
  lcdSubpixelChannel,
  lenticularParallaxOffset,
  lenticularViewPosition,
  spectrogramBinForRow,
  spectrogramMagnitudeLevel,
  spectrogramNyquistBinCount,
  spectrogramOneSidedScale,
} from "filters/displaySpectrumContracts";
import {
  anaglyphDisparity,
  bayerColorAt,
  bayerNoiseSigma,
  duboisRedCyanLinear,
  moireBeatFrequency,
  processScreenAngle,
} from "filters/captureSamplingQualityContracts";
import {
  ccdSpilledCharge,
  oscilloscopeBeamDensity,
  oscilloscopeVoltageRow,
  speckleContrastForDiversity,
} from "filters/instrumentSensorQualityContracts";
import {
  einkReflectanceLevel,
  flashLinearChannel,
  kaleidoChannelLevel,
  kaleidoColorCell,
  mavicaFrameJitterOffset,
  vintageTvRasterGain,
} from "filters/consumerImagingQualityContracts";

const catalogFilter = (displayName: string) =>
  filterList.find((entry) => entry.displayName === displayName)?.filter;

describe("instrument and sensor simulation contracts", () => {
  it("maps signal voltage monotonically from screen bottom to top", () => {
    expect(oscilloscopeVoltageRow(0, 100)).toBe(99);
    expect(oscilloscopeVoltageRow(0.5, 100)).toBeCloseTo(49.5);
    expect(oscilloscopeVoltageRow(1, 100)).toBe(0);
    expect(oscilloscopeVoltageRow(Number.NaN, 0)).toBe(0);
  });

  it("uses a symmetric beam profile that decays away from the trace", () => {
    const centre = oscilloscopeBeamDensity(0, 1.5);
    expect(centre).toBe(1);
    expect(oscilloscopeBeamDensity(-2, 1.5)).toBeCloseTo(oscilloscopeBeamDensity(2, 1.5));
    expect(oscilloscopeBeamDensity(2, 1.5)).toBeLessThan(centre);
    expect(oscilloscopeBeamDensity(8, 1.5)).toBeLessThan(0.001);
  });

  it("accumulates CCD overload and lets anti-blooming drain it", () => {
    const oneWell = ccdSpilledCharge([1], 0.75, 0.8, 0);
    const twoWells = ccdSpilledCharge([1, 1], 0.75, 0.8, 0);
    expect(twoWells).toBeGreaterThan(oneWell * 1.5);
    expect(ccdSpilledCharge([1, 1], 0.75, 0.8, 0.75)).toBeLessThan(twoWells);
    expect(ccdSpilledCharge([0.5], 0.75, 0.8, 0)).toBe(0);
  });

  it("preserves mean irradiance while diversity reduces speckle contrast", () => {
    expect(speckleContrastForDiversity(1, 1)).toBe(1);
    expect(speckleContrastForDiversity(1, 4)).toBeCloseTo(0.5);
    expect(speckleContrastForDiversity(0.6, 9)).toBeCloseTo(0.2);
    expect(speckleContrastForDiversity(Number.NaN, 0)).toBe(0);
  });

  it.each(["Oscilloscope", "CCD Charge Smear", "Laser Speckle Projector"])(
    "%s exposes honest, described controls",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
    },
  );
});

describe("reflective display and consumer-imaging contracts", () => {
  it("quantizes monochrome e-paper to 16 bounded reflectance levels", () => {
    const levels = new Set<number>();
    for (let sample = 0; sample <= 255; sample += 1) {
      const value = einkReflectanceLevel(sample / 255, 15 / 255, 230 / 255);
      expect(value).toBeGreaterThanOrEqual(15 / 255);
      expect(value).toBeLessThanOrEqual(230 / 255);
      levels.add(Number(value.toFixed(8)));
    }
    expect(levels.size).toBe(16);
  });

  it("maps Kaleido channels to four bits and shares one color sample per 3×3 cell", () => {
    const levels = new Set(Array.from({ length: 256 }, (_, value) => kaleidoChannelLevel(value / 255)));
    expect(levels.size).toBe(16);
    expect(kaleidoChannelLevel(0)).toBe(0);
    expect(kaleidoChannelLevel(1)).toBe(1);
    expect([0, 1, 2].map((pixel) => kaleidoColorCell(pixel))).toEqual([1, 1, 1]);
    expect([3, 4, 5].map((pixel) => kaleidoColorCell(pixel))).toEqual([4, 4, 4]);
  });

  it("keeps analogue raster gain bounded and resolution-normalized", () => {
    for (const value of [
      vintageTvRasterGain(20, 240, 240, 0.7),
      vintageTvRasterGain(40, 480, 240, 0.7),
      vintageTvRasterGain(Number.NaN, 0, Number.POSITIVE_INFINITY, -3),
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(vintageTvRasterGain(20, 240, 240, 0.7))
      .toBeCloseTo(vintageTvRasterGain(40.5, 480, 240, 0.7), 2);
  });

  it("adds flash irradiance in linear light and tints only that contribution", () => {
    const ambientOnly = flashLinearChannel(0.25, 1, 0, 2, 1);
    const neutralFlash = flashLinearChannel(0.25, 1, 0.5, 1, 1);
    const warmFlash = flashLinearChannel(0.25, 1, 0.5, 1.2, 1);
    expect(ambientOnly).toBeCloseTo(0.25);
    expect(neutralFlash).toBeGreaterThan(ambientOnly);
    expect(warmFlash).toBeGreaterThan(neutralFlash);
    expect(flashLinearChannel(0.25, 1, 0, 1.2, 1)).toBeCloseTo(ambientOnly);
    expect(flashLinearChannel(Number.NaN, Number.POSITIVE_INFINITY, -4, 9, 0)).toBe(0);
  });

  it("rounds Mavica frame jitter symmetrically around zero", () => {
    const samples = Array.from({ length: 10_000 }, (_, index) => (index + 0.5) / 10_000);
    const horizontal = samples.map((sample) => mavicaFrameJitterOffset(sample, 3, 2));
    const vertical = samples.map((sample) => mavicaFrameJitterOffset(sample, 3, 1));
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(Math.min(...horizontal)).toBe(-3);
    expect(Math.max(...horizontal)).toBe(3);
    expect(Math.abs(mean(horizontal))).toBeLessThan(0.01);
    expect(Math.min(...vertical)).toBe(-1);
    expect(Math.max(...vertical)).toBe(1);
    expect(Math.abs(mean(vertical))).toBeLessThan(0.01);
    expect(mavicaFrameJitterOffset(Number.NaN, Number.POSITIVE_INFINITY, -1)).toBe(0);
  });

  it.each(["E-ink (grayscale)", "Vintage TV", "Digicam Flash"])(
    "%s exposes described controls and honest simulation copy",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
    },
  );
});

describe("visible-RGB infrared estimate", () => {
  it("preserves neutral reflectance when no chromatic material cue exists", () => {
    const neutral = estimateVisibleNir([0.4, 0.4, 0.4], 1, 0.65);
    expect(neutral).toBeCloseTo(0.4, 6);
    for (const channel of aerochromeChannels([0.4, 0.4, 0.4], neutral)) {
      expect(channel).toBeCloseTo(0.4, 6);
    }
  });

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

describe("analog film quality model", () => {
  it("keeps grain bounded and makes middle densities most visible", () => {
    const black = filmGrainAmplitude(0, 0.5);
    const middle = filmGrainAmplitude(0.5, 0.5);
    const white = filmGrainAmplitude(1, 0.5);
    expect(middle).toBeGreaterThan(black);
    expect(middle).toBeGreaterThan(white);
    expect(black).toBeCloseTo(white);
    expect(filmGrainAmplitude(0.5, 1)).toBeLessThanOrEqual(0.25);
    expect(Number.isFinite(filmGrainAmplitude(Number.NaN, Number.POSITIVE_INFINITY))).toBe(true);
  });

  it("scales dust with frame area while keeping enabled default scratches live", () => {
    const small = projectionArtifactCounts(320, 240, 0.5, 0.15);
    const reference = projectionArtifactCounts(640, 480, 0.5, 0.15);
    const large = projectionArtifactCounts(1280, 960, 0.5, 0.15);
    expect(small.dust).toBeLessThan(reference.dust);
    expect(reference.dust).toBeLessThan(large.dust);
    expect(small.scratches).toBeLessThan(large.scratches);
    expect(reference.scratches).toBeGreaterThan(0);
    expect(projectionArtifactCounts(640, 480, 0, 0)).toEqual({ dust: 0, scratches: 0 });
  });

  it("adds leak exposure without a hidden spectral bias", () => {
    const neutral = [0, 1, 2].map(() => linearLightLeakChannel(0.1, 0.8, 0.5));
    expect(neutral[0]).toBeCloseTo(neutral[1]);
    expect(neutral[1]).toBeCloseTo(neutral[2]);
    expect(linearLightLeakChannel(0.3, 1, 0)).toBeCloseTo(0.3);
    expect(linearLightLeakChannel(0, 1, 1)).toBeCloseTo(1);
  });
});

describe("substrate and copy quality model", () => {
  it("keeps repeated-copy tone continuous while reducing local detail", () => {
    const source = 0.42;
    const neighborhood = 0.58;
    const first = photocopierGenerationTone(source, neighborhood, 1.55, 0);
    const repeated = photocopierGenerationTone(source, neighborhood, 1.55, 1);
    expect(Math.abs(repeated - photocopierGenerationTone(neighborhood, neighborhood, 1.55, 1)))
      .toBeLessThan(Math.abs(first - photocopierGenerationTone(neighborhood, neighborhood, 1.55, 0)));

    const ramp = Array.from({ length: 256 }, (_, value) =>
      photocopierGenerationTone(value / 255, value / 255, 1.55, 1));
    expect(new Set(ramp.map(value => Math.round(value * 255))).size).toBeGreaterThan(128);
    for (let index = 1; index < ramp.length; index += 1) {
      expect(ramp[index]).toBeGreaterThanOrEqual(ramp[index - 1]);
    }
  });

  it("caps substrate pattern frequency below the pixel Nyquist limit", () => {
    expect(substratePatternFrequency(40, 240, 16)).toBeLessThanOrEqual(108);
    expect(substratePatternFrequency(12, 240, 16)).toBeGreaterThan(0);
    expect(Number.isFinite(substratePatternFrequency(Number.NaN, 0, Number.POSITIVE_INFINITY))).toBe(true);
  });

  it("models washi as correlated directional fibre rather than pixel static", () => {
    const center = washiFiberVariation(22, 37);
    const neighbor = washiFiberVariation(22.25, 37);
    const distant = washiFiberVariation(91, 103);
    expect(Math.abs(center - neighbor)).toBeLessThan(Math.abs(center - distant));
    for (const sample of [center, neighbor, distant, washiFiberVariation(Number.NaN, Number.POSITIVE_INFINITY)]) {
      expect(Number.isFinite(sample)).toBe(true);
      expect(sample).toBeGreaterThanOrEqual(-1);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });
});

describe("layered print quality model", () => {
  it("makes zero ink bleed a true zero-radius path", () => {
    expect(risographBlurRadius(0)).toBe(0);
    expect(risographBlurRadius(0.2)).toBeGreaterThan(0);
    expect(risographBlurRadius(1)).toBeLessThanOrEqual(8);
  });

  it("keeps plate registration fixed and bounded for a completed sheet", () => {
    const first = fixedPrintPlateOffset(0, 4, 8);
    expect(fixedPrintPlateOffset(0, 4, 8)).toEqual(first);
    expect(fixedPrintPlateOffset(1, 4, 8)).not.toEqual(first);
    for (let layer = 0; layer < 4; layer += 1) {
      const [x, y] = fixedPrintPlateOffset(layer, 4, 8);
      expect(Math.abs(x)).toBeLessThanOrEqual(8);
      expect(Math.abs(y)).toBeLessThanOrEqual(8);
    }
  });

  it("clears both duplex plates toward paper highlights without negative coverage", () => {
    expect(duplexPlateCoverages(1, 1)).toEqual({ dark: 0, accent: 0 });
    const shadow = duplexPlateCoverages(0, 1);
    const middle = duplexPlateCoverages(0.5, 1);
    expect(shadow.dark + shadow.accent).toBeGreaterThan(middle.dark + middle.accent);
    for (const sample of [shadow, middle, duplexPlateCoverages(Number.NaN, Number.POSITIVE_INFINITY)]) {
      expect(sample.dark).toBeGreaterThanOrEqual(0);
      expect(sample.dark).toBeLessThanOrEqual(1);
      expect(sample.accent).toBeGreaterThanOrEqual(0);
      expect(sample.accent).toBeLessThanOrEqual(1);
    }
  });

  it("uses correlated master variation rather than independent output-pixel static", () => {
    const center = stencilInkVariation(16, 24, 1);
    const neighbor = stencilInkVariation(16.25, 24, 1);
    const distant = stencilInkVariation(82, 91, 1);
    expect(Math.abs(center - neighbor)).toBeLessThan(Math.abs(center - distant));
    expect(Number.isFinite(stencilInkVariation(Number.NaN, Number.POSITIVE_INFINITY, -8))).toBe(true);
  });

  it("turns continuous plate coverage into bounded clustered halftone dots", () => {
    let empty = 0, middle = 0, solid = 0;
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        if (screenHalftoneDecision(0, x, y, 8, 22.5, 0)) empty += 1;
        if (screenHalftoneDecision(0.5, x, y, 8, 22.5, 0)) middle += 1;
        if (screenHalftoneDecision(1, x, y, 8, 22.5, 0)) solid += 1;
      }
    }
    expect(empty).toBe(0);
    expect(middle).toBeGreaterThan(256);
    expect(middle).toBeLessThan(768);
    expect(solid).toBe(1024);
  });
});

describe("legacy quality filter surface", () => {
  it("centers normalized synthetic stereo disparity on a convergence plane", () => {
    expect(anaglyphDisparity(0.5, 12, 0.5)).toBe(0);
    expect(anaglyphDisparity(0, 12, 0.5)).toBe(-6);
    expect(anaglyphDisparity(1, 12, 0.5)).toBe(6);
    expect(anaglyphDisparity(255, 12, 0.5)).toBe(6);
    expect(Number.isFinite(anaglyphDisparity(Number.NaN, Number.POSITIVE_INFINITY, -4))).toBe(true);
  });

  it("uses the published Dubois red/cyan linear-light projection", () => {
    expect(duboisRedCyanLinear([1, 0, 0], [0, 0, 0])).toEqual([
      0.4561,
      0.500484,
      0.176381,
    ]);
    expect(duboisRedCyanLinear([0, 0, 0], [0, 0, 1])).toEqual([
      -0.001555,
      -0.01845,
      1.2264,
    ]);
  });

  it("keeps every Bayer layout at two green, one red, and one blue site", () => {
    for (const cfa of ["RGGB", "BGGR", "GRBG", "GBRG"]) {
      const sites = [
        bayerColorAt(cfa, 0, 0),
        bayerColorAt(cfa, 1, 0),
        bayerColorAt(cfa, 0, 1),
        bayerColorAt(cfa, 1, 1),
      ];
      expect(sites.filter(channel => channel === 0), cfa).toHaveLength(1);
      expect(sites.filter(channel => channel === 1), cfa).toHaveLength(2);
      expect(sites.filter(channel => channel === 2), cfa).toHaveLength(1);
    }
  });

  it("combines a read-noise floor with signal-dependent Bayer shot noise", () => {
    expect(bayerNoiseSigma(0, 0.04, 0.006)).toBeCloseTo(0.006);
    expect(bayerNoiseSigma(0.25, 0.04, 0.006))
      .toBeGreaterThan(bayerNoiseSigma(0, 0.04, 0.006));
    expect(bayerNoiseSigma(1, 0.04, 0.006))
      .toBeGreaterThan(bayerNoiseSigma(0.25, 0.04, 0.006));
    expect(Number.isFinite(bayerNoiseSigma(Number.NaN, Number.POSITIVE_INFINITY, -2))).toBe(true);
  });

  it("derives moire beats from lattice frequency and angle mismatch", () => {
    expect(moireBeatFrequency(4, 4, 0)).toBeCloseTo(0);
    expect(moireBeatFrequency(4, 5, 0)).toBeGreaterThan(0);
    expect(moireBeatFrequency(4, 4, 7)).toBeGreaterThan(0);
    expect(moireBeatFrequency(4, 4, 15)).toBeGreaterThan(moireBeatFrequency(4, 4, 7));
    expect(Number.isFinite(moireBeatFrequency(Number.NaN, 0, Number.POSITIVE_INFINITY))).toBe(true);
  });

  it("uses conventional process-screen separation angles", () => {
    expect(["C", "M", "Y", "K"].map(processScreenAngle)).toEqual([15, 75, 0, 45]);
  });

  it.each(["Anaglyph 3D", "Bayer Sensor", "Moiré / Aliasing"])(
    "%s exposes described controls and honest capture-model copy",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
    },
  );

  it("exposes the corrected stereo, sensor, and lattice controls", () => {
    expect(catalogFilter("Anaglyph 3D")?.optionTypes).toMatchObject({
      convergence: expect.any(Object),
    });
    expect(catalogFilter("Anaglyph 3D")?.description).toMatch(/single-image|synthetic/i);
    expect(catalogFilter("Bayer Sensor")?.optionTypes).toMatchObject({
      readNoise: expect.any(Object),
      opticalBlur: expect.any(Object),
    });
    expect(catalogFilter("Bayer Sensor")?.description).toMatch(/gradient-corrected/i);
    expect(catalogFilter("Bayer Sensor")?.temporal).toBe(true);
    expect(catalogFilter("Moiré / Aliasing")?.optionTypes).toMatchObject({
      sourcePitch: expect.any(Object),
      opticalBlur: expect.any(Object),
    });
    expect(catalogFilter("Moiré / Aliasing")?.description).toMatch(/lattice/i);
  });

  it("selects periodic, centered synthetic lenticular views", () => {
    expect(lenticularViewPosition(0.01, 0, 5)).toBe(-1);
    expect(lenticularViewPosition(0.99, 0, 5)).toBe(1);
    expect(lenticularViewPosition(0.37, 0, 7))
      .toBe(lenticularViewPosition(1.37, 0, 7));
    expect(lenticularViewPosition(0.37, -0.5, 7))
      .not.toBe(lenticularViewPosition(0.37, 0.5, 7));
    expect(lenticularViewPosition(0.9, 0, 99))
      .toBe(lenticularViewPosition(0.9, 0, 12));
    expect(lenticularParallaxOffset(-1, 0.6, 8))
      .toBeCloseTo(-lenticularParallaxOffset(1, 0.6, 8));
  });

  it("models RGB stripe and RGBG/Diamond emitter topology", () => {
    expect(lcdSubpixelChannel("STRIPE", 0.1, 0.5, 0, 0)).toBe(0);
    expect(lcdSubpixelChannel("STRIPE", 0.5, 0.5, 0, 0)).toBe(1);
    expect(lcdSubpixelChannel("STRIPE", 0.9, 0.5, 0, 0)).toBe(2);
    expect(lcdSubpixelChannel("STRIPE", 0, 0.5, 0, 0)).toBe(-1);

    const pentile = [0, 1].flatMap((cellX) => [
      lcdSubpixelChannel("PENTILE", 0.25, 0.5, cellX, 0),
      lcdSubpixelChannel("PENTILE", 0.75, 0.5, cellX, 0),
    ]);
    expect(pentile.filter(channel => channel === 0)).toHaveLength(1);
    expect(pentile.filter(channel => channel === 1)).toHaveLength(2);
    expect(pentile.filter(channel => channel === 2)).toHaveLength(1);
    expect(lcdSubpixelChannel("PENTILE", 0.5, 0.5, 0, 0)).toBe(-1);

    const diamondCenters = [
      lcdSubpixelChannel("DIAMOND", 0.5, 0.25, 0, 0),
      lcdSubpixelChannel("DIAMOND", 0.5, 0.75, 0, 0),
      lcdSubpixelChannel("DIAMOND", 0.25, 0.5, 0, 0),
      lcdSubpixelChannel("DIAMOND", 0.75, 0.5, 0, 0),
    ];
    expect(diamondCenters).toEqual([1, 1, 0, 2]);
    expect(lcdSubpixelChannel("DIAMOND", 0, 0, 0, 0)).toBe(-1);
  });

  it("makes the LCD black matrix meaningfully and monotonically darker", () => {
    expect(lcdBlackMatrixLevel(0)).toBeGreaterThan(lcdBlackMatrixLevel(0.5));
    expect(lcdBlackMatrixLevel(0.5)).toBeGreaterThan(lcdBlackMatrixLevel(1));
    expect(lcdBlackMatrixLevel(1)).toBe(0);
  });

  it("uses a Hann-windowed, fixed-reference spatial spectrogram scale", () => {
    expect(hannWindow(0, 1)).toBe(1);
    expect(hannWindow(0, 2)).toBe(1);
    expect(hannWindow(1, 2)).toBe(1);
    expect(hannWindow(0, 9)).toBeCloseTo(0);
    expect(hannWindow(4, 9)).toBeCloseTo(1);
    expect(hannWindow(8, 9)).toBeCloseTo(0);
    expect(spectrogramMagnitudeLevel(0.1, 0, 1, 1, 16, 60))
      .toBeLessThan(spectrogramMagnitudeLevel(1, 0, 1, 1, 16, 60));
    expect(spectrogramMagnitudeLevel(1, 0, 1, 1, 16, 60)).toBe(1);
    expect(spectrogramMagnitudeLevel(0, 0, 1, 1, 16, 60)).toBe(0);
    expect(spectrogramNyquistBinCount(16, 128)).toBe(9);
  });

  it("does not double DC or the even-length Nyquist bin", () => {
    expect(spectrogramOneSidedScale(0, 16)).toBe(1);
    expect(spectrogramOneSidedScale(1, 16)).toBe(2);
    expect(spectrogramOneSidedScale(8, 16)).toBe(1);
    expect(spectrogramOneSidedScale(7, 15)).toBe(2);
  });

  it("maps high frequencies above low frequencies on linear and log axes", () => {
    for (const logarithmic of [false, true]) {
      expect(spectrogramBinForRow(0, 101, 65, logarithmic)).toBe(64);
      expect(spectrogramBinForRow(100, 101, 65, logarithmic)).toBe(0);
    }
    expect(spectrogramBinForRow(50, 101, 65, true))
      .toBeLessThan(spectrogramBinForRow(50, 101, 65, false));
  });

  it.each(["Lenticular", "LCD display", "Spectrogram"])(
    "%s exposes described controls and honest display/analysis copy",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
    },
  );

  it("removes unrelated lenticular rainbow controls and labels the spatial spectrum", () => {
    expect(catalogFilter("Lenticular")?.optionTypes).toMatchObject({
      viewAngle: expect.any(Object),
      viewCount: expect.any(Object),
      parallax: expect.any(Object),
      crosstalk: expect.any(Object),
    });
    expect(catalogFilter("Lenticular")?.optionTypes).not.toHaveProperty("rainbowSpread");
    expect(catalogFilter("Lenticular")?.description).not.toMatch(/holographic|rainbow/i);
    expect(catalogFilter("Spectrogram")?.description).toMatch(/spatial/i);
  });

  it("models bounded intensifier gain with signal-dependent noise", () => {
    expect(nightVisionIntensifierResponse(0, 8)).toBe(0);
    expect(nightVisionIntensifierResponse(0.08, 6))
      .toBeGreaterThan(nightVisionIntensifierResponse(0.08, 1));
    expect(nightVisionIntensifierResponse(1, 8)).toBeLessThanOrEqual(1);

    const background = nightVisionNoiseAmplitude(0, 0.5);
    const dim = nightVisionNoiseAmplitude(0.1, 0.5);
    const bright = nightVisionNoiseAmplitude(0.8, 0.5);
    expect(background).toBeGreaterThan(0);
    expect(dim).toBeGreaterThan(background);
    expect(bright).toBeGreaterThan(dim);
    expect(nightVisionNoiseAmplitude(Number.NaN, Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(0.25);
  });

  it("derives B-mode echoes from impedance boundaries and depth", () => {
    const uniform = ultrasoundBackscatter(0.5, 0.5, 0.5, 0.5, 0.5);
    const boundary = ultrasoundBackscatter(0.2, 0.8, 0.2, 0.8, 0.2);
    expect(uniform).toBeGreaterThan(0);
    expect(uniform).toBeLessThan(0.08);
    expect(boundary).toBeGreaterThan(uniform * 4);
    expect(ultrasoundDepthTransmission(0.8)).toBeLessThan(ultrasoundDepthTransmission(0.2));
  });

  it("uses a finite non-negative Rayleigh envelope for ultrasound speckle", () => {
    for (const value of [
      ultrasoundRayleighEnvelope(0.01, 0.4),
      ultrasoundRayleighEnvelope(0.5, 0.8),
      ultrasoundRayleighEnvelope(0.99, 0.2),
      ultrasoundRayleighEnvelope(Number.NaN, Number.POSITIVE_INFINITY),
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(3);
    }
  });

  it.each(["Night vision", "Ultrasound", "Mavica FD7"])(
    "%s exposes described controls and honest imaging copy",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
      expect(filter?.temporal, `${displayName}.temporal`).toBe(true);
    },
  );

  it("labels source-derived sensor proxies honestly and hides arbitrary overlays by default", () => {
    expect(catalogFilter("Night vision")?.description).toMatch(/visible.*proxy/i);
    expect(catalogFilter("Night vision")?.description).not.toMatch(/gen\s*3/i);
    expect(catalogFilter("Ultrasound")?.description).toMatch(/impedance.*proxy/i);
    expect(catalogFilter("Ultrasound")?.options).toMatchObject({ markers: false });
    expect(catalogFilter("Mavica FD7")?.requiresGL).toBe(true);
  });

  it.each(["Risograph", "Risograph (multi-layer)", "Screen Print / Misregistration", "Duplex / Offset Print"])(
    "%s exposes described controls and honest fixed-print copy",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
      expect(filter?.temporal, `${displayName}.temporal`).not.toBe(true);
    },
  );

  it.each(["Photocopier", "Paper Texture", "Sumi-e"])(
    "%s exposes described controls and honest substrate copy",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
    },
  );

  it.each(["Film grain", "Light leak", "Projection film"])(
    "%s exposes described controls and honest analog-film copy",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
    },
  );

  it("marks moving film grain and projection mechanics as temporal", () => {
    expect(catalogFilter("Film grain")?.temporal).toBe(true);
    expect(catalogFilter("Projection film")?.temporal).toBe(true);
    expect(catalogFilter("Light leak")?.temporal).not.toBe(true);
  });

  it("defaults Film Grain to a restrained density fluctuation", () => {
    expect(catalogFilter("Film grain")?.options).toMatchObject({
      amount: expect.any(Number),
      monochrome: true,
    });
    expect(Number(catalogFilter("Film grain")?.options?.amount)).toBeLessThanOrEqual(0.2);
  });

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

  it.each(["Newspaper", "Polaroid", "Thermal printer", "Watercolor bleed"])(
    "%s exposes described controls and honest simulation copy",
    (displayName) => {
      const filter = catalogFilter(displayName);
      expect(filter).toBeDefined();
      for (const [name, option] of Object.entries(filter?.optionTypes ?? {})) {
        expect(option.desc, `${displayName}.${name}`).toBeTruthy();
      }
      expect(filter?.description, `${displayName}.description`).toBeTruthy();
    },
  );

  it("keeps fixed print and developed-film artifacts non-temporal", () => {
    for (const displayName of ["Newspaper", "Polaroid", "Thermal printer"]) {
      expect(catalogFilter(displayName)?.temporal, displayName).not.toBe(true);
    }
    expect(catalogFilter("Polaroid")?.optionTypes).not.toHaveProperty("animate");
    expect(catalogFilter("Polaroid")?.optionTypes).not.toHaveProperty("animSpeed");
  });

  it("labels Watercolor Bleed as a stylized single-field approximation", () => {
    expect(catalogFilter("Watercolor bleed")?.description).toMatch(/stylized|approximation/i);
    expect(catalogFilter("Watercolor bleed")?.description).not.toMatch(/dark colours migrate faster/i);
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
    expect(catalogFilter("Thermal camera")?.temporal).toBe(true);
  });
});
