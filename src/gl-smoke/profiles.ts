import { BOOL, ENUM, PALETTE, RANGE } from "@gyng/ditherer-filters";
import type { FilterLike } from "./types";

export const shaderValidationOverrides = (
  name: string,
  defaults: Record<string, unknown>,
): Record<string, unknown> => {
  if (name === "Quantize") {
    const palette = defaults.palette as Record<string, unknown> | undefined;
    return {
      palette: {
        ...palette,
        options: {
          ...((palette?.options as Record<string, unknown> | undefined) ?? {}),
          colors: [[0, 0, 0], [255, 255, 255], [255, 64, 32]],
          colorDistanceAlgorithm: "RGB",
        },
      },
    };
  }
  if (name === "CRT Degauss") return { triggerMode: "MOTION", triggerThreshold: 0.01 };
  return {};
};

export const outputScaleFor = (name: string): number => name === "Pixel Art Upscale" ? 2 : 1;

export const STRICT_SPEC_FILTERS = new Set([
  "Apollo Slow-Scan TV",
  "Apple II HGR",
  "Baird Televisor",
  "CGA Composite",
  "DLP Color Wheel",
  "Gameboy Camera",
  "PAL / SECAM",
  "PLATO Plasma",
  "PXL-2000",
  "Teletext",
  "Wavelet Codec",
  "ZX Spectrum",
]);

export const enumBranches = (
  filter: FilterLike,
): { key: string; label: string; value: unknown }[] => {
  const output: { key: string; label: string; value: unknown }[] = [];
  const defaults = filter.defaults ?? {};
  for (const [key, spec] of Object.entries(filter.optionTypes ?? {})) {
    if (spec?.type !== ENUM || !Array.isArray(spec.options)) continue;
    for (const entry of spec.options) {
      if (entry.value === defaults[key]) continue;
      output.push({ key, label: String(entry.value), value: entry.value });
    }
  }
  return output;
};

export const scalarProfiles = (
  filter: FilterLike,
): { label: string; values: Record<string, unknown> }[] => {
  const minimum: Record<string, unknown> = {};
  const maximum: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(filter.optionTypes ?? {})) {
    if (spec.type === BOOL) {
      minimum[key] = false;
      maximum[key] = true;
    } else if (spec.type === RANGE && spec.range) {
      minimum[key] = spec.range[0];
      maximum[key] = spec.range[1];
    }
  }
  if (Object.keys(minimum).length === 0) return [];
  return [
    { label: "scalar-minimum-disabled", values: minimum },
    { label: "scalar-maximum-enabled", values: maximum },
  ];
};

export const hasPaletteControl = (filter: FilterLike): boolean =>
  Object.values(filter.optionTypes ?? {}).some((spec) => spec.type === PALETTE);

export const scalarOptionKeys = (filter: FilterLike): string[] =>
  Object.entries(filter.optionTypes ?? {})
    .filter(([, spec]) => spec.type === BOOL || spec.type === RANGE)
    .map(([key]) => key);

export const enumOptionKeys = (filter: FilterLike): string[] =>
  Object.entries(filter.optionTypes ?? {})
    .filter(([, spec]) => spec.type === ENUM)
    .map(([key]) => key);

export const migratedScalarDefaults = new Set([
  "Contour Map",
  "Palette Mapper",
  "Voronoi",
  "VHS / NTSC",
]);

export const migratedEnumDefaults = new Set([
  "Anaglyph:depthSource",
  "Convolve:kernel",
]);
