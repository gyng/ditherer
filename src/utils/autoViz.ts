import type { AudioVizConnection, AudioVizMetric, AudioVizSnapshot } from "./audioVizBridge";
import { getAudioVizMetricValueForMode } from "./audioVizBridge";

export type AutoVizMode = "balanced" | "punchy" | "flow" | "chaotic";

export type AutoVizTargetOption = {
  label?: string;
  optionName?: string;
  targetLabel?: string;
  range?: number[];
  step?: number;
  type?: string;
  visibleWhen?: ((options: Record<string, unknown>) => boolean) | undefined;
};

export const AUTO_VIZ_METRIC_GROUPS: Record<AutoVizMode, AudioVizMetric[]> = {
  balanced: [
    "beatHold", "beat", "bassEnvelope", "midEnvelope", "trebleEnvelope",
    "spectralCentroid", "tempoPhase", "barBeat", "bandRatio",
    "percussive", "harmonic", "peakDecay",
  ],
  punchy: [
    "beat", "beatHold", "subKick", "onset", "percussive", "peakDecay",
    "bassEnvelope", "pulse", "zeroCrossing", "barBeat", "spectralFlux",
  ],
  flow: [
    "tempoPhase", "barPhase", "barBeat", "spectralCentroid", "harmonic",
    "midEnvelope", "bassEnvelope", "trebleEnvelope", "bandRatio",
    "stereoWidth", "stereoBalance", "beatConfidence",
  ],
  chaotic: [
    "beat", "onset", "spectralFlux", "percussive", "roughness", "zeroCrossing",
    "pulse", "stereoWidth", "stereoBalance", "spectralCentroid",
    "beatHold", "subKick",
  ],
};

export const AUTO_VIZ_DEFAULT_DENSITY = 0.2;
export const AUTO_VIZ_DENSITY: Record<AutoVizMode, number> = {
  balanced: AUTO_VIZ_DEFAULT_DENSITY,
  punchy: AUTO_VIZ_DEFAULT_DENSITY,
  flow: AUTO_VIZ_DEFAULT_DENSITY,
  chaotic: AUTO_VIZ_DEFAULT_DENSITY,
};
export const AUTO_VIZ_MIN_CONNECTIONS = 3;
export const AUTO_VIZ_MAX_CONNECTIONS = 10;
export const AUTO_VIZ_NORMALIZE_SKIP = new Set<AudioVizMetric>([
  "bpm", "tempoPhase", "barPhase", "barBeat", "stereoBalance", "beatConfidence",
]);
export const AUDIO_METRIC_WEIGHT_MIN = -30;
export const AUDIO_METRIC_WEIGHT_MAX = 30;

export const AUTO_VIZ_WEIGHT_RANGES: Partial<Record<AudioVizMetric, [number, number]>> = {
  bpm: [0.3, 0.95],
  tempoPhase: [0.15, 0.5],
  barPhase: [0.18, 0.55],
  barBeat: [0.25, 0.75],
  beat: [0.55, 1.3],
  beatHold: [0.45, 1.1],
  bassEnvelope: [0.4, 1.05],
  midEnvelope: [0.3, 0.9],
  trebleEnvelope: [0.3, 0.9],
  peakDecay: [0.3, 0.9],
  subKick: [0.4, 1.15],
  pulse: [0.3, 0.9],
  onset: [0.4, 1.05],
  spectralCentroid: [0.3, 0.85],
  spectralFlux: [0.4, 1.0],
  roughness: [0.3, 0.85],
  zeroCrossing: [0.3, 0.85],
  bandRatio: [0.3, 0.8],
  harmonic: [0.3, 0.85],
  percussive: [0.4, 1.05],
  stereoWidth: [0.35, 0.95],
  stereoBalance: [0.3, 0.8],
  beatConfidence: [0.2, 0.65],
  level: [0.3, 0.9],
  bass: [0.3, 0.9],
  mid: [0.3, 0.85],
  treble: [0.3, 0.85],
};
export const weightRangeFor = (metric: AudioVizMetric): [number, number] =>
  AUTO_VIZ_WEIGHT_RANGES[metric] ?? [0.3, 0.95];

const TRANSIENT_PARAMS = [
  "amount", "mix", "intensity", "strength", "threshold", "glitch", "noise",
  "contrast", "edge", "detail", "sharpen", "poster", "posterize",
  "density", "count", "morph", "iterations", "spread", "dust", "grit",
];
const HEAVY_PARAMS = [
  "size", "scale", "radius", "blur", "smear", "feedback", "decay",
  "persistence", "block", "pixel", "distort", "warp", "offset", "displace",
  "line", "scan", "depth", "rows", "cols", "grid", "cell", "tile", "chunk",
];
const TONE_PARAMS = [
  "hue", "color", "palette", "gamma", "brightness", "saturation", "tone",
  "warm", "cool", "channel", "rgb", "contrast",
  "temperature", "lightness", "chroma", "tint", "shade", "value",
];
const FLOW_PARAMS = [
  "phase", "speed", "angle", "rotate", "offset", "scroll", "drift", "wave",
  "wobble", "frequency", "motion",
  "shift", "time", "step", "cycle", "sweep",
];
const NOISE_PARAMS = [
  "noise", "glitch", "detail", "edge", "grain", "jitter", "spark", "rough",
  "scratch", "hash", "fizz", "speckle",
];
const SCORE_DEFAULT = 2;

export const scoreParamForMetric = (metric: AudioVizMetric, optionName: string, label?: string) => {
  const haystack = `${optionName} ${label || ""}`.toLowerCase();
  const includesKeyword = (keywords: string[]) => keywords.some((keyword) => haystack.includes(keyword));
  let score = SCORE_DEFAULT;
  if (metric === "beat" || metric === "beatHold" || metric === "onset" || metric === "percussive" || metric === "pulse" || metric === "subKick") {
    score += includesKeyword(TRANSIENT_PARAMS) ? 6 : 0;
    score += includesKeyword(HEAVY_PARAMS) ? 2 : 0;
  }
  if (metric === "bassEnvelope" || metric === "peakDecay" || metric === "bass") {
    score += includesKeyword(HEAVY_PARAMS) ? 7 : 0;
    score += includesKeyword(TRANSIENT_PARAMS) ? 2 : 0;
  }
  if (metric === "spectralCentroid" || metric === "treble" || metric === "harmonic" || metric === "trebleEnvelope" || metric === "bandRatio") {
    score += includesKeyword(TONE_PARAMS) ? 7 : 0;
    score += includesKeyword(TRANSIENT_PARAMS) ? 1 : 0;
  }
  if (metric === "tempoPhase" || metric === "bpm" || metric === "barPhase" || metric === "barBeat") {
    score += includesKeyword(FLOW_PARAMS) ? 7 : 0;
    score += includesKeyword(HEAVY_PARAMS) ? 1 : 0;
  }
  if (metric === "spectralFlux" || metric === "roughness" || metric === "zeroCrossing") {
    score += includesKeyword(NOISE_PARAMS) ? 7 : 0;
    score += includesKeyword(TRANSIENT_PARAMS) ? 2 : 0;
  }
  if (metric === "stereoWidth" || metric === "stereoBalance") {
    score += includesKeyword(FLOW_PARAMS) ? 3 : 0;
    score += includesKeyword(TONE_PARAMS) ? 2 : 0;
    score += includesKeyword(HEAVY_PARAMS) ? 2 : 0;
  }
  if (metric === "midEnvelope" || metric === "mid") {
    score += includesKeyword(TRANSIENT_PARAMS) ? 3 : 0;
    score += includesKeyword(HEAVY_PARAMS) ? 2 : 0;
    score += includesKeyword(TONE_PARAMS) ? 2 : 0;
  }
  return score;
};

const shuffleArray = <T,>(items: T[]) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

export const pickMetricsForMode = (
  mode: AutoVizMode,
  count: number,
  previous: AudioVizConnection[] | null,
): AudioVizMetric[] => {
  const pool = AUTO_VIZ_METRIC_GROUPS[mode];
  const prevMetrics = new Set((previous ?? []).map((c) => c.metric));
  const shuffled = shuffleArray(pool);
  const fresh = shuffled.filter((m) => !prevMetrics.has(m));
  const reused = shuffled.filter((m) => prevMetrics.has(m));
  const ordered = [...fresh, ...reused];
  const slice = ordered.slice(0, Math.min(count, pool.length));
  if (mode !== "flow" && !slice.includes("beat") && !slice.includes("beatHold") && slice.length > 0) {
    const inject: AudioVizMetric = Math.random() < 0.5 ? "beat" : "beatHold";
    if (!slice.includes(inject)) slice[slice.length - 1] = inject;
  }
  return slice;
};

export const buildAutoVizConnections = (
  mode: AutoVizMode,
  rangeOptions: Array<readonly [string, AutoVizTargetOption]>,
  previous: AudioVizConnection[] | null = null,
  densityOverride: number | null = null,
): { connections: AudioVizConnection[]; normalizedMetrics: AudioVizMetric[] } => {
  if (rangeOptions.length === 0) {
    return { connections: [], normalizedMetrics: [] };
  }

  const density = densityOverride != null && densityOverride > 0
    ? densityOverride
    : AUTO_VIZ_DENSITY[mode];
  const desired = Math.round(rangeOptions.length * density);
  const clamped = Math.max(
    AUTO_VIZ_MIN_CONNECTIONS,
    Math.min(AUTO_VIZ_MAX_CONNECTIONS, Math.min(desired, rangeOptions.length)),
  );
  const chosenMetrics = pickMetricsForMode(mode, clamped, previous);

  const previousTargets = new Set((previous ?? []).map((c) => c.target));
  const availableTargets = new Set(rangeOptions.map(([optionName]) => optionName));
  const connections: AudioVizConnection[] = [];

  for (const metric of chosenMetrics) {
    const ranked = shuffleArray(rangeOptions)
      .filter(([key]) => availableTargets.has(key))
      .map((entry) => {
        const score = scoreParamForMetric(metric, entry[1].optionName || entry[0], entry[1].label);
        const novelty = previousTargets.has(entry[0]) ? 0 : 1.5;
        const jitter = Math.random() * 1.2;
        return { entry, combined: score + novelty + jitter };
      })
      .sort((a, b) => b.combined - a.combined);
    const winner = ranked[0]?.entry;
    if (!winner) continue;
    const [target] = winner;
    availableTargets.delete(target);
    const [lo, hi] = weightRangeFor(metric);
    const baseWeight = randomBetween(lo, hi);
    const sign = mode === "chaotic"
      ? (Math.random() < 0.4 ? -1 : 1)
      : (Math.random() < 0.14 ? -1 : 1);
    connections.push({
      metric,
      target,
      weight: Math.max(AUDIO_METRIC_WEIGHT_MIN, Math.min(AUDIO_METRIC_WEIGHT_MAX, baseWeight * sign)),
    });
  }

  if (mode === "chaotic" && connections.length > 1 && connections.every((c) => c.weight >= 0)) {
    const flip = Math.floor(Math.random() * connections.length);
    connections[flip].weight = -connections[flip].weight;
  }

  if (connections.length === 0 && rangeOptions.length > 0) {
    connections.push({
      metric: "beatHold",
      target: rangeOptions[0][0],
      weight: 0.6,
    });
  }

  const normalizedMetrics = connections
    .map((connection) => connection.metric)
    .filter((metric, index, all) => !AUTO_VIZ_NORMALIZE_SKIP.has(metric) && all.indexOf(metric) === index);
  return { connections, normalizedMetrics };
};

export type RangeOptionType = {
  type: string;
  range?: number[];
  step?: number;
};

export type RangeOptionTypeMap = Record<string, RangeOptionType | undefined>;

/**
 * Apply a set of audio-viz connections to an option map, mutating a copy of
 * `options` and returning it. Each modulated value is clamped to the option's
 * declared range and quantized to its step. Pure: callers pass the audio
 * snapshot in directly so this can be unit-tested without the bridge.
 */
export const applyAudioModulationToOptions = (
  options: Record<string, unknown>,
  optionTypes: RangeOptionTypeMap,
  modulation: { connections: AudioVizConnection[]; normalizedMetrics?: AudioVizMetric[] },
  snapshot: AudioVizSnapshot,
  entryId?: string,
): Record<string, unknown> => {
  const nextOptions: Record<string, unknown> = { ...options };
  const modulationByTarget = new Map<string, number>();
  const normalizedMetrics = new Set(modulation.normalizedMetrics ?? []);
  for (const connection of modulation.connections) {
    const value = getAudioVizMetricValueForMode(
      snapshot,
      connection.metric,
      snapshot.normalize || normalizedMetrics.has(connection.metric),
    ) * connection.weight;
    modulationByTarget.set(connection.target, (modulationByTarget.get(connection.target) ?? 0) + value);
  }
  for (const [optionName, modulationValue] of modulationByTarget) {
    let resolvedOptionName = optionName;
    if (!(resolvedOptionName in optionTypes) && entryId && optionName.startsWith(`${entryId}:`)) {
      resolvedOptionName = optionName.slice(entryId.length + 1);
    }
    const optionType = optionTypes[resolvedOptionName];
    if (!optionType || optionType.type !== "RANGE" || !Array.isArray(optionType.range)) {
      continue;
    }
    const currentValue = Number(options[resolvedOptionName]);
    if (!Number.isFinite(currentValue)) continue;
    const [min, max] = optionType.range as [number, number];
    const step = typeof optionType.step === "number" ? optionType.step : 0;
    const span = max - min;
    const modulated = currentValue + modulationValue * span;
    const clamped = Math.min(max, Math.max(min, modulated));
    nextOptions[resolvedOptionName] = step > 0 ? Math.round(clamped / step) * step : clamped;
  }
  return nextOptions;
};
