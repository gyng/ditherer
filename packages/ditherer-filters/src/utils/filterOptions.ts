type PaletteLike = {
  getColor?: unknown;
  options?: unknown;
  [key: string]: unknown;
};

export const normalizeRangeOption = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = false,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.max(minimum, Math.min(maximum, value));
  return integer ? Math.round(bounded) : bounded;
};

export const normalizeBooleanOption = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

/** Validate a COLOR option to a 3-element 0..255 integer array, else fallback. */
export const normalizeColorOption = (value: unknown, fallback: readonly number[]): number[] => {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return [0, 1, 2].map((i) => normalizeRangeOption(value[i], fallback[i], 0, 255, true));
};

export const normalizeEnumOption = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export const normalizePaletteOption = <T extends PaletteLike>(value: unknown, fallback: T): T => {
  if (typeof value !== "object" || value === null) return fallback;
  const palette = value as PaletteLike;
  if (typeof palette.getColor !== "function") return fallback;
  const fallbackOptions =
    typeof fallback.options === "object" && fallback.options !== null
      ? (fallback.options as Record<string, unknown>)
      : {};
  const suppliedOptions =
    typeof palette.options === "object" && palette.options !== null
      ? (palette.options as Record<string, unknown>)
      : {};
  const options = { ...fallbackOptions, ...suppliedOptions };
  if ("levels" in fallbackOptions) {
    options.levels = normalizeRangeOption(
      suppliedOptions.levels,
      Number(fallbackOptions.levels),
      1,
      256,
      true,
    );
  }
  return { ...fallback, ...palette, options } as T;
};
