export const CRT_PROFILE = {
  CONSUMER_525: "CONSUMER_525",
  CONSUMER_625: "CONSUMER_625",
  ARCADE_240P: "ARCADE_240P",
  APERTURE_GRILLE: "APERTURE_GRILLE",
  BROADCAST: "BROADCAST",
  CUSTOM: "CUSTOM",
} as const;

export type CrtProfile = (typeof CRT_PROFILE)[keyof typeof CRT_PROFILE];

export type CrtProfileDefaults = {
  visibleScanlines: number;
  interlaced: boolean;
  mask: "VERTICAL" | "STAGGERED" | "LADDER" | "TILED" | "HEX_GAP";
  overscan: number;
  curvature: number;
  beamMinSigma: number;
  beamMaxSigma: number;
  cornerFocus: number;
  damperWires: number;
  phosphorT10Ms: { red: number; green: number; blue: number };
};

const P22_T10_MS = Object.freeze({ red: 1, green: 0.06, blue: 0.022 });

const PROFILES: Record<CrtProfile, CrtProfileDefaults> = {
  [CRT_PROFILE.CONSUMER_525]: {
    visibleScanlines: 240,
    interlaced: true,
    mask: "HEX_GAP",
    overscan: 0.035,
    curvature: 0.1,
    beamMinSigma: 0.18,
    beamMaxSigma: 0.42,
    cornerFocus: 0.12,
    damperWires: 0,
    phosphorT10Ms: P22_T10_MS,
  },
  [CRT_PROFILE.CONSUMER_625]: {
    visibleScanlines: 288,
    interlaced: true,
    mask: "TILED",
    overscan: 0.035,
    curvature: 0.1,
    beamMinSigma: 0.18,
    beamMaxSigma: 0.42,
    cornerFocus: 0.12,
    damperWires: 0,
    phosphorT10Ms: P22_T10_MS,
  },
  [CRT_PROFILE.ARCADE_240P]: {
    visibleScanlines: 240,
    interlaced: false,
    mask: "TILED",
    overscan: 0.025,
    curvature: 0.08,
    beamMinSigma: 0.16,
    beamMaxSigma: 0.39,
    cornerFocus: 0.1,
    damperWires: 0,
    phosphorT10Ms: P22_T10_MS,
  },
  [CRT_PROFILE.APERTURE_GRILLE]: {
    visibleScanlines: 480,
    interlaced: false,
    mask: "VERTICAL",
    overscan: 0.01,
    curvature: 0.025,
    beamMinSigma: 0.24,
    beamMaxSigma: 0.46,
    cornerFocus: 0.06,
    damperWires: 2,
    phosphorT10Ms: P22_T10_MS,
  },
  [CRT_PROFILE.BROADCAST]: {
    visibleScanlines: 480,
    interlaced: true,
    mask: "LADDER",
    overscan: 0.07,
    curvature: 0.045,
    beamMinSigma: 0.22,
    beamMaxSigma: 0.44,
    cornerFocus: 0.055,
    damperWires: 0,
    phosphorT10Ms: P22_T10_MS,
  },
  [CRT_PROFILE.CUSTOM]: {
    visibleScanlines: 240,
    interlaced: false,
    mask: "HEX_GAP",
    overscan: 0,
    curvature: 0,
    beamMinSigma: 0.18,
    beamMaxSigma: 0.42,
    cornerFocus: 0,
    damperWires: 0,
    phosphorT10Ms: P22_T10_MS,
  },
};

export const crtProfileDefaults = (profile: unknown): CrtProfileDefaults => {
  const resolved = PROFILES[String(profile) as CrtProfile] ?? PROFILES[CRT_PROFILE.CUSTOM];
  return {
    ...resolved,
    phosphorT10Ms: { ...resolved.phosphorT10Ms },
  };
};

export const resolveVisibleScanlines = (
  profile: unknown,
  customLines: number,
  outputHeight: number,
): number => {
  const key = String(profile) as CrtProfile;
  const desired =
    key === CRT_PROFILE.CUSTOM
      ? customLines
      : (PROFILES[key] ?? PROFILES[CRT_PROFILE.CUSTOM]).visibleScanlines;
  const finite = Number.isFinite(desired) ? desired : 240;
  return Math.max(1, Math.min(Math.max(1, Math.round(outputHeight)), Math.round(finite)));
};

/** Apply a tube profile baseline while preserving a control the user changed. */
export const resolveCrtProfileSetting = (
  value: number,
  controlDefault: number,
  profileDefault: number,
): number => (value === controlDefault ? profileDefault : value);

export const crtBeamSigma = (
  luminance: number,
  normalizedRadius: number,
  minimum: number,
  maximum: number,
  cornerFocus: number,
): number => {
  const luma = Math.min(1, Math.max(0, Number.isFinite(luminance) ? luminance : 0));
  const radius = Math.min(
    1.5,
    Math.max(0, Number.isFinite(normalizedRadius) ? normalizedRadius : 0),
  );
  const low = Math.max(0.01, Number.isFinite(minimum) ? minimum : 0.18);
  const high = Math.max(low, Number.isFinite(maximum) ? maximum : 0.42);
  const corner = Math.max(0, Number.isFinite(cornerFocus) ? cornerFocus : 0);
  return low + (high - low) * Math.sqrt(luma) + corner * radius * radius;
};

const srgbEncode = (linear: number): number => {
  const value = Math.min(1, Math.max(0, linear));
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
};

export const crtSignalToSrgb = (signal: number, gamma: number): number => {
  const voltage = Math.min(1, Math.max(0, Number.isFinite(signal) ? signal : 0));
  const exponent = Math.max(0.01, Number.isFinite(gamma) ? gamma : 2.4);
  return srgbEncode(voltage ** exponent);
};

/** Retained light after one frame when t10 is the measured decay-to-10% time. */
export const decayRetentionFromT10 = (t10Ms: number, refreshRate: number): number => {
  if (!Number.isFinite(t10Ms) || t10Ms <= 0) return 0;
  const hz = Number.isFinite(refreshRate) && refreshRate > 0 ? refreshRate : 60;
  const exponent = -(1000 / hz) / t10Ms;
  const retained = 10 ** exponent;
  return retained < Number.EPSILON ? 0 : retained;
};
