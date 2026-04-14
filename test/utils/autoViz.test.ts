import { describe, it, expect } from "vitest";
import {
  applyAudioModulationToOptions,
  AUTO_VIZ_DEFAULT_DENSITY,
  AUTO_VIZ_DENSITY,
  AUTO_VIZ_METRIC_GROUPS,
  AUTO_VIZ_NORMALIZE_SKIP,
  AUTO_VIZ_WEIGHT_RANGES,
  buildAutoVizConnections,
  pickMetricsForMode,
  scoreParamForMetric,
  weightRangeFor,
  type AutoVizMode,
  type AutoVizTargetOption,
  type RangeOptionTypeMap,
} from "utils/autoViz";
import type { AudioVizSnapshot } from "utils/audioVizBridge";

const allModes: AutoVizMode[] = ["balanced", "punchy", "flow", "chaotic"];

const makeTargets = (names: string[]): Array<readonly [string, AutoVizTargetOption]> =>
  names.map((name) => [name, { label: name, range: [0, 1], step: 0.01 }] as const);

describe("AUTO_VIZ_METRIC_GROUPS", () => {
  it("each mode has at least 8 metrics in its pool for variety", () => {
    for (const mode of allModes) {
      expect(AUTO_VIZ_METRIC_GROUPS[mode].length).toBeGreaterThanOrEqual(8);
    }
  });

  it("'flow' avoids transient-only metrics like beat triggers", () => {
    expect(AUTO_VIZ_METRIC_GROUPS.flow).not.toContain("beat");
    expect(AUTO_VIZ_METRIC_GROUPS.flow).not.toContain("onset");
  });

  it("'chaotic' includes noise-leaning metrics", () => {
    expect(AUTO_VIZ_METRIC_GROUPS.chaotic).toContain("roughness");
    expect(AUTO_VIZ_METRIC_GROUPS.chaotic).toContain("zeroCrossing");
  });
});

describe("AUTO_VIZ_DENSITY", () => {
  it("defaults to a sensible single value across modes", () => {
    for (const mode of allModes) {
      expect(AUTO_VIZ_DENSITY[mode]).toBe(AUTO_VIZ_DEFAULT_DENSITY);
    }
  });
});

describe("AUTO_VIZ_NORMALIZE_SKIP", () => {
  it("skips metrics that already report a 0..1 range natively", () => {
    expect(AUTO_VIZ_NORMALIZE_SKIP.has("bpm")).toBe(true);
    expect(AUTO_VIZ_NORMALIZE_SKIP.has("tempoPhase")).toBe(true);
    expect(AUTO_VIZ_NORMALIZE_SKIP.has("barPhase")).toBe(true);
    expect(AUTO_VIZ_NORMALIZE_SKIP.has("level")).toBe(false);
  });
});

describe("weightRangeFor", () => {
  it("returns the configured range for known metrics", () => {
    expect(weightRangeFor("beat")).toEqual(AUTO_VIZ_WEIGHT_RANGES.beat);
    expect(weightRangeFor("tempoPhase")).toEqual(AUTO_VIZ_WEIGHT_RANGES.tempoPhase);
  });

  it("falls back to the default range for unknown metrics", () => {
    // @ts-expect-error - intentionally probing an unknown metric key
    expect(weightRangeFor("not-a-metric")).toEqual([0.3, 0.95]);
  });
});

describe("scoreParamForMetric", () => {
  it("scores higher when the param name matches a category keyword", () => {
    const beatVsBlur = scoreParamForMetric("beat", "blur", "Blur amount");
    const beatVsRandom = scoreParamForMetric("beat", "color", "Color temperature");
    expect(beatVsBlur).toBeGreaterThan(beatVsRandom);
  });

  it("treble metrics favour tone-related params (hue, saturation)", () => {
    const tonal = scoreParamForMetric("treble", "hue", "Hue rotation");
    const motion = scoreParamForMetric("treble", "scan", "Scan offset");
    expect(tonal).toBeGreaterThan(motion);
  });

  it("noise metrics favour glitch/noise params", () => {
    const noise = scoreParamForMetric("roughness", "glitch", "Glitch amount");
    const calm = scoreParamForMetric("roughness", "rotate", "Rotate angle");
    expect(noise).toBeGreaterThan(calm);
  });

  it("returns the default base score for completely unmatched params", () => {
    expect(scoreParamForMetric("level", "completely-unrelated-name")).toBe(2);
  });
});

describe("pickMetricsForMode", () => {
  it("returns at most `count` metrics", () => {
    const picked = pickMetricsForMode("balanced", 4, null);
    expect(picked.length).toBeLessThanOrEqual(4);
  });

  it("never returns more than the pool size", () => {
    const poolSize = AUTO_VIZ_METRIC_GROUPS.balanced.length;
    const picked = pickMetricsForMode("balanced", 999, null);
    expect(picked.length).toBe(poolSize);
  });

  it("flow mode does not inject a beat metric when none chosen", () => {
    const picked = pickMetricsForMode("flow", 3, null);
    expect(picked).not.toContain("beat");
    // flow's pool doesn't include "beat", so it never appears
  });

  it("non-flow modes inject a beat or beatHold when none was sampled", () => {
    // Run many times — at least one run should land on the injection branch.
    let injected = false;
    for (let i = 0; i < 30; i++) {
      const picked = pickMetricsForMode("balanced", 3, null);
      if (picked.includes("beat") || picked.includes("beatHold")) {
        injected = true;
        break;
      }
    }
    expect(injected).toBe(true);
  });

  it("prefers metrics absent from the previous selection", () => {
    const previous = [
      { metric: "beatHold" as const, target: "x", weight: 0.5 },
      { metric: "bassEnvelope" as const, target: "y", weight: 0.5 },
    ];
    // With count = pool size, every metric appears, but the order should put
    // fresh metrics ahead of the reused ones.
    const pool = AUTO_VIZ_METRIC_GROUPS.balanced;
    const picked = pickMetricsForMode("balanced", pool.length, previous);
    const beatHoldIdx = picked.indexOf("beatHold");
    const bassEnvelopeIdx = picked.indexOf("bassEnvelope");
    // Fresh metrics from the pool should appear before the reused ones
    const freshMetrics = pool.filter(
      (m) => m !== "beatHold" && m !== "bassEnvelope",
    );
    for (const m of freshMetrics) {
      const idx = picked.indexOf(m);
      if (idx !== -1) {
        expect(idx).toBeLessThan(Math.max(beatHoldIdx, bassEnvelopeIdx));
      }
    }
  });
});

describe("buildAutoVizConnections", () => {
  it("returns no connections when there are no targets", () => {
    const result = buildAutoVizConnections("balanced", []);
    expect(result.connections).toEqual([]);
    expect(result.normalizedMetrics).toEqual([]);
  });

  it("respects density override (higher density → more connections)", () => {
    const targets = makeTargets(Array.from({ length: 30 }, (_, i) => `t${i}`));
    const sparse = buildAutoVizConnections("balanced", targets, null, 0.1);
    const dense = buildAutoVizConnections("balanced", targets, null, 0.4);
    expect(dense.connections.length).toBeGreaterThan(sparse.connections.length);
  });

  it("clamps connection count to MIN..MAX bounds", () => {
    // 1 target → density yields 0 → clamped up to MIN (3) but still bounded by available targets.
    const oneTarget = buildAutoVizConnections("balanced", makeTargets(["only"]));
    expect(oneTarget.connections.length).toBeLessThanOrEqual(1);

    // Many targets at density 1.0 capped at MAX (10).
    const manyTargets = makeTargets(Array.from({ length: 50 }, (_, i) => `t${i}`));
    const huge = buildAutoVizConnections("balanced", manyTargets, null, 1.0);
    expect(huge.connections.length).toBeLessThanOrEqual(10);
  });

  it("never assigns the same target twice", () => {
    const targets = makeTargets(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const result = buildAutoVizConnections("punchy", targets, null, 0.5);
    const seen = new Set<string>();
    for (const conn of result.connections) {
      expect(seen.has(conn.target)).toBe(false);
      seen.add(conn.target);
    }
  });

  it("normalized metric list excludes pre-normalized metrics", () => {
    const targets = makeTargets(Array.from({ length: 20 }, (_, i) => `t${i}`));
    const result = buildAutoVizConnections("balanced", targets, null, 0.5);
    for (const metric of result.normalizedMetrics) {
      expect(AUTO_VIZ_NORMALIZE_SKIP.has(metric)).toBe(false);
    }
  });

  it("falls back to a beatHold connection when no metrics survived selection", () => {
    // Force the empty-metrics path by calling with a single target and
    // density that would yield zero — the function still returns >=1 conn.
    const result = buildAutoVizConnections("balanced", makeTargets(["only"]), null, 0.001);
    expect(result.connections.length).toBeGreaterThanOrEqual(1);
  });

  it("chaotic mode tends to include a negative weight", () => {
    const targets = makeTargets(Array.from({ length: 12 }, (_, i) => `t${i}`));
    let foundNegative = false;
    for (let i = 0; i < 30; i++) {
      const result = buildAutoVizConnections("chaotic", targets, null, 0.5);
      if (result.connections.some((c) => c.weight < 0)) {
        foundNegative = true;
        break;
      }
    }
    expect(foundNegative).toBe(true);
  });

  it("connection weights stay within configured bounds", () => {
    const targets = makeTargets(Array.from({ length: 12 }, (_, i) => `t${i}`));
    const result = buildAutoVizConnections("balanced", targets, null, 0.4);
    for (const conn of result.connections) {
      expect(conn.weight).toBeLessThanOrEqual(30);
      expect(conn.weight).toBeGreaterThanOrEqual(-30);
    }
  });
});

describe("applyAudioModulationToOptions", () => {
  const makeMetrics = () => {
    const keys = [
      "level", "bass", "mid", "treble", "pulse", "beat", "bpm", "beatHold",
      "onset", "spectralCentroid", "spectralFlux", "bandRatio", "stereoWidth",
      "stereoBalance", "zeroCrossing", "subKick", "bassEnvelope", "midEnvelope",
      "trebleEnvelope", "peakDecay", "roughness", "harmonic", "percussive",
      "tempoPhase", "barPhase", "barBeat", "beatConfidence",
    ] as const;
    const metrics: Record<string, number> = {};
    for (const k of keys) metrics[k] = 0;
    return metrics;
  };

  const makeSnapshot = (overrides: Partial<AudioVizSnapshot> = {}): AudioVizSnapshot => ({
    enabled: true,
    source: "microphone",
    normalize: false,
    deviceId: null,
    bpmOverride: null,
    status: "live",
    error: null,
    deviceLabel: null,
    detectedBpm: 120,
    tempoStatus: "locked",
    tempoWarmupProgress: 1,
    rawMetrics: makeMetrics() as never,
    normalizedMetrics: makeMetrics() as never,
    metrics: makeMetrics() as never,
    ...overrides,
  });

  const optionTypes: RangeOptionTypeMap = {
    amount: { type: "RANGE", range: [0, 100], step: 1 },
    scale: { type: "RANGE", range: [0.1, 1.0], step: 0.01 },
    skipped: { type: "ENUM" },
  };

  it("adds metric*weight*span to the option value and clamps within range", () => {
    const snapshot = makeSnapshot();
    snapshot.rawMetrics.beat = 1;
    const result = applyAudioModulationToOptions(
      { amount: 50 },
      optionTypes,
      { connections: [{ metric: "beat", target: "amount", weight: 0.4 }] },
      snapshot,
    );
    // 50 + 1 * 0.4 * 100 = 90, step=1
    expect(result.amount).toBe(90);
  });

  it("clamps modulation that exceeds the option's max", () => {
    const snapshot = makeSnapshot();
    snapshot.rawMetrics.beat = 1;
    const result = applyAudioModulationToOptions(
      { amount: 80 },
      optionTypes,
      { connections: [{ metric: "beat", target: "amount", weight: 5 }] },
      snapshot,
    );
    expect(result.amount).toBe(100);
  });

  it("clamps modulation that goes below the option's min", () => {
    const snapshot = makeSnapshot();
    snapshot.rawMetrics.beat = 1;
    const result = applyAudioModulationToOptions(
      { scale: 0.3 },
      optionTypes,
      { connections: [{ metric: "beat", target: "scale", weight: -10 }] },
      snapshot,
    );
    expect(result.scale).toBe(0.1);
  });

  it("ignores connections whose target is not a RANGE option", () => {
    const snapshot = makeSnapshot();
    snapshot.rawMetrics.beat = 1;
    const result = applyAudioModulationToOptions(
      { skipped: "x" },
      optionTypes,
      { connections: [{ metric: "beat", target: "skipped", weight: 1 }] },
      snapshot,
    );
    // Untouched
    expect(result.skipped).toBe("x");
  });

  it("ignores connections whose target is missing from optionTypes", () => {
    const snapshot = makeSnapshot();
    snapshot.rawMetrics.beat = 1;
    const result = applyAudioModulationToOptions(
      { amount: 50 },
      optionTypes,
      { connections: [{ metric: "beat", target: "unknown", weight: 1 }] },
      snapshot,
    );
    expect(result.amount).toBe(50);
  });

  it("strips an entry-id prefix from the target name", () => {
    const snapshot = makeSnapshot();
    snapshot.rawMetrics.beat = 1;
    const result = applyAudioModulationToOptions(
      { amount: 0 },
      optionTypes,
      { connections: [{ metric: "beat", target: "entry-1:amount", weight: 0.5 }] },
      snapshot,
      "entry-1",
    );
    // 0 + 1 * 0.5 * 100 = 50
    expect(result.amount).toBe(50);
  });

  it("sums multiple connections targeting the same option", () => {
    const snapshot = makeSnapshot();
    snapshot.rawMetrics.beat = 1;
    snapshot.rawMetrics.bass = 1;
    const result = applyAudioModulationToOptions(
      { amount: 0 },
      optionTypes,
      { connections: [
        { metric: "beat", target: "amount", weight: 0.2 },
        { metric: "bass", target: "amount", weight: 0.3 },
      ] },
      snapshot,
    );
    // 0 + (1*0.2 + 1*0.3) * 100 = 50
    expect(result.amount).toBe(50);
  });

  it("uses normalized metrics when listed in normalizedMetrics", () => {
    const snapshot = makeSnapshot();
    snapshot.rawMetrics.bass = 0;
    snapshot.normalizedMetrics.bass = 1;
    const result = applyAudioModulationToOptions(
      { amount: 0 },
      optionTypes,
      {
        connections: [{ metric: "bass", target: "amount", weight: 0.5 }],
        normalizedMetrics: ["bass"],
      },
      snapshot,
    );
    expect(result.amount).toBe(50);
  });

  it("uses the global normalize flag to switch every metric to normalized", () => {
    const snapshot = makeSnapshot({ normalize: true });
    snapshot.rawMetrics.bass = 0;
    snapshot.normalizedMetrics.bass = 1;
    const result = applyAudioModulationToOptions(
      { amount: 0 },
      optionTypes,
      { connections: [{ metric: "bass", target: "amount", weight: 0.5 }] },
      snapshot,
    );
    expect(result.amount).toBe(50);
  });
});
