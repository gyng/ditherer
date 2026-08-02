const unit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const smoothstep = (low: number, high: number, value: number): number => {
  const t = unit((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

export type FilmBurnDamage = {
  heat: number;
  blister: number;
  core: number;
};

/** Bounded radial material zones around an irregular projector-burn front. */
export const filmBurnDamage = (
  normalizedDistance: number,
  intensity: number,
  roughnessSample = 0.5,
): FilmBurnDamage => {
  const distance = Math.max(0, Number.isFinite(normalizedDistance) ? normalizedDistance : 0);
  const strength = unit(intensity);
  const activity = smoothstep(0, 0.25, strength);
  const front = 0.12 + strength * 0.75;
  const irregularity = (unit(roughnessSample) - 0.5) * 0.16;
  const signedDistance = distance - front - irregularity;
  return {
    heat: (1 - smoothstep(0, 0.42, signedDistance)) * activity,
    blister: (1 - smoothstep(0.025, 0.13, Math.abs(signedDistance))) * activity,
    core: (1 - smoothstep(-0.2, -0.045, signedDistance)) * activity,
  };
};
