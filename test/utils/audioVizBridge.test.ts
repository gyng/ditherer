import { describe, it, expect } from "vitest";
import {
  bucketAverage,
  zeroCrossRate,
  spectralCentroid,
  stereoStats,
  computeAdaptiveRange,
  findDominantTempo,
  getAudioVizMetricValue,
  getAudioVizMetricValueForMode,
  getAudioVizSnapshot,
  getActiveAudioVizChannel,
  setActiveAudioVizChannel,
  getGlobalAudioVizModulation,
  setGlobalAudioVizModulation,
  subscribeGlobalAudioVizModulation,
  subscribeAudioViz,
  type AudioVizSnapshot,
  type GlobalAudioVizModulation,
} from "utils/audioVizBridge";

const makeSnapshot = (overrides: Partial<AudioVizSnapshot> = {}): AudioVizSnapshot => ({
  enabled: false,
  source: "microphone",
  normalize: false,
  deviceId: null,
  bpmOverride: null,
  status: "idle",
  error: null,
  deviceLabel: null,
  detectedBpm: null,
  tempoStatus: "idle",
  tempoWarmupProgress: 0,
  rawMetrics: {
    level: 0, bass: 0, mid: 0, treble: 0, pulse: 0, beat: 0, bpm: 0, beatHold: 0,
    onset: 0, spectralCentroid: 0, spectralFlux: 0, bandRatio: 0, stereoWidth: 0,
    stereoBalance: 0.5, zeroCrossing: 0, subKick: 0, bassEnvelope: 0, midEnvelope: 0,
    trebleEnvelope: 0, peakDecay: 0, roughness: 0, harmonic: 0, percussive: 0,
    tempoPhase: 0, barPhase: 0, barBeat: 0, beatConfidence: 0,
  },
  normalizedMetrics: {
    level: 0, bass: 0, mid: 0, treble: 0, pulse: 0, beat: 0, bpm: 0, beatHold: 0,
    onset: 0, spectralCentroid: 0, spectralFlux: 0, bandRatio: 0, stereoWidth: 0,
    stereoBalance: 0.5, zeroCrossing: 0, subKick: 0, bassEnvelope: 0, midEnvelope: 0,
    trebleEnvelope: 0, peakDecay: 0, roughness: 0, harmonic: 0, percussive: 0,
    tempoPhase: 0, barPhase: 0, barBeat: 0, beatConfidence: 0,
  },
  metrics: {
    level: 0, bass: 0, mid: 0, treble: 0, pulse: 0, beat: 0, bpm: 0, beatHold: 0,
    onset: 0, spectralCentroid: 0, spectralFlux: 0, bandRatio: 0, stereoWidth: 0,
    stereoBalance: 0.5, zeroCrossing: 0, subKick: 0, bassEnvelope: 0, midEnvelope: 0,
    trebleEnvelope: 0, peakDecay: 0, roughness: 0, harmonic: 0, percussive: 0,
    tempoPhase: 0, barPhase: 0, barBeat: 0, beatConfidence: 0,
  },
  ...overrides,
});

describe("bucketAverage", () => {
  it("returns the average over the slice divided by 255", () => {
    const arr = new Uint8Array([0, 0, 255, 255, 128, 128]);
    // range [2, 4) → values 255, 255 → avg 255 / 255 = 1
    expect(bucketAverage(arr, 2, 4)).toBe(1);
    // range [0, 2) → 0 / 255 = 0
    expect(bucketAverage(arr, 0, 2)).toBe(0);
    // range [4, 6) → 128 / 255
    expect(bucketAverage(arr, 4, 6)).toBeCloseTo(128 / 255, 5);
  });

  it("returns 0 for an empty slice", () => {
    const arr = new Uint8Array([100, 200, 50]);
    expect(bucketAverage(arr, 1, 1)).toBe(0);
  });
});

describe("zeroCrossRate", () => {
  it("counts sign changes around the 128 midpoint", () => {
    // alternating 0, 255 → 4 crossings (between every pair) / 5 samples
    const arr = new Uint8Array([0, 255, 0, 255, 0]);
    expect(zeroCrossRate(arr)).toBeCloseTo(4 / 5, 5);
  });

  it("is zero for a DC signal at 128", () => {
    const arr = new Uint8Array(64).fill(128);
    expect(zeroCrossRate(arr)).toBe(0);
  });

  it("handles constant non-center signal without false crossings", () => {
    const arr = new Uint8Array(32).fill(50);
    expect(zeroCrossRate(arr)).toBe(0);
  });
});

describe("spectralCentroid", () => {
  it("returns 0 for a zero spectrum", () => {
    expect(spectralCentroid(new Uint8Array(32))).toBe(0);
  });

  it("lands near the low end when only low bins have energy", () => {
    const arr = new Uint8Array(32);
    arr[0] = 255;
    arr[1] = 255;
    // Weighted mean of indices [0,1] normalized by length-1 (31) → ~0.5/31
    expect(spectralCentroid(arr)).toBeLessThan(0.05);
  });

  it("lands near the high end when only high bins have energy", () => {
    const arr = new Uint8Array(32);
    arr[30] = 255;
    arr[31] = 255;
    expect(spectralCentroid(arr)).toBeGreaterThan(0.9);
  });

  it("lands near the middle for a flat spectrum", () => {
    const arr = new Uint8Array(32).fill(128);
    const value = spectralCentroid(arr);
    expect(value).toBeGreaterThan(0.45);
    expect(value).toBeLessThan(0.55);
  });
});

describe("stereoStats", () => {
  it("returns zero width and centred balance when no frequency data is supplied", () => {
    const stats = stereoStats(null, null, null, null);
    expect(stats.width).toBe(0);
    expect(stats.balance).toBe(0.5);
  });

  it("returns zero width and centred balance for mono identical channels", () => {
    const freq = new Uint8Array([100, 100, 100, 100]);
    const time = new Uint8Array(32).fill(200);
    const stats = stereoStats(freq, freq.slice(), time, time.slice());
    expect(stats.width).toBe(0);
    expect(stats.balance).toBeCloseTo(0.5, 5);
  });

  it("returns non-zero width when left and right time domains differ", () => {
    const freqL = new Uint8Array([200, 200, 200, 200]);
    const freqR = new Uint8Array([100, 100, 100, 100]);
    // Left time swings +0.5 around 128, right swings -0.5 → big side component
    const timeL = new Uint8Array([64, 192, 64, 192, 64, 192, 64, 192]);
    const timeR = new Uint8Array([192, 64, 192, 64, 192, 64, 192, 64]);
    const stats = stereoStats(freqL, freqR, timeL, timeR);
    expect(stats.width).toBeGreaterThan(0.5);
    // Left has more total frequency energy → balance > 0.5
    expect(stats.balance).toBeGreaterThan(0.55);
  });

  it("balances toward right when right has more energy", () => {
    const freqL = new Uint8Array([50, 50, 50]);
    const freqR = new Uint8Array([200, 200, 200]);
    const stats = stereoStats(freqL, freqR, null, null);
    expect(stats.balance).toBeLessThan(0.45);
  });
});

describe("computeAdaptiveRange", () => {
  it("initializes both bounds to the first sample", () => {
    const result = computeAdaptiveRange(0.5, undefined, undefined);
    expect(result.low).toBeCloseTo(0.5, 5);
    expect(result.high).toBeCloseTo(0.5, 5);
    // Span falls back to minimum, so normalized is 1 when value == high
    expect(result.normalized).toBeCloseTo(1, 5);
  });

  it("snaps the high bound up immediately on a new peak", () => {
    const result = computeAdaptiveRange(0.9, 0.1, 0.2);
    expect(result.high).toBe(0.9);
  });

  it("snaps the low bound down immediately on a new valley", () => {
    const result = computeAdaptiveRange(0.0, 0.3, 0.9);
    expect(result.low).toBe(0.0);
  });

  it("decays the unused bound slowly toward the current value", () => {
    // prevHigh = 1.0, value = 0.0. High should creep down by <= release factor.
    const result = computeAdaptiveRange(0.0, 0.0, 1.0);
    expect(result.high).toBeGreaterThan(0.99);
    expect(result.high).toBeLessThan(1.0);
  });

  it("clamps the normalized output to [0, 1]", () => {
    const below = computeAdaptiveRange(-10, 0, 1);
    expect(below.normalized).toBe(0);
    const above = computeAdaptiveRange(10, 0, 1);
    expect(above.normalized).toBe(1);
  });
});

describe("findDominantTempo", () => {
  const makeNoveltyBuffer = (bufferLen: number, periodSamples: number, pulseWidth = 1) => {
    const buf = new Float32Array(bufferLen);
    for (let i = 0; i < bufferLen; i++) {
      const phase = i % periodSamples;
      buf[i] = phase < pulseWidth ? 1 : 0;
    }
    return buf;
  };

  it("returns null when the buffer is not filled enough", () => {
    const buffer = new Float32Array(200);
    const result = findDominantTempo({
      buffer,
      filled: 10,
      bufferIndex: 10,
      hopMs: 23,
      minBpm: 60,
      maxBpm: 180,
      minFrames: 100,
    });
    expect(result).toBeNull();
  });

  it("returns null when the signal has no variance", () => {
    const buffer = new Float32Array(300).fill(0.3);
    const result = findDominantTempo({
      buffer,
      filled: 300,
      bufferIndex: 0,
      hopMs: 23,
      minBpm: 60,
      maxBpm: 180,
      minFrames: 100,
    });
    expect(result).toBeNull();
  });

  it("recovers a 120 BPM periodic signal", () => {
    // At hopMs=23ms, 120 BPM = 500ms period = ~21.74 samples
    const periodSamples = Math.round(500 / 23); // 22 samples
    const buffer = makeNoveltyBuffer(350, periodSamples);
    const result = findDominantTempo({
      buffer,
      filled: 350,
      bufferIndex: 0,
      hopMs: 23,
      minBpm: 60,
      maxBpm: 180,
      minFrames: 200,
    });
    expect(result).not.toBeNull();
    // 22 samples * 23ms = 506ms → 60000/506 ≈ 118.58 BPM
    expect(result!.bpm).toBeGreaterThan(110);
    expect(result!.bpm).toBeLessThan(130);
    expect(result!.confidence).toBeGreaterThan(0);
  });

  it("recovers a 90 BPM periodic signal", () => {
    // 90 BPM = 666.66ms → 29 samples at 23ms hop
    const periodSamples = 29;
    const buffer = makeNoveltyBuffer(350, periodSamples);
    const result = findDominantTempo({
      buffer,
      filled: 350,
      bufferIndex: 0,
      hopMs: 23,
      minBpm: 60,
      maxBpm: 180,
      minFrames: 200,
    });
    expect(result).not.toBeNull();
    // 29 * 23 = 667ms → ~89.9 BPM
    expect(result!.bpm).toBeGreaterThan(82);
    expect(result!.bpm).toBeLessThan(98);
  });
});

describe("getAudioVizMetricValue", () => {
  it("returns the metric from snapshot.metrics", () => {
    const snapshot = makeSnapshot({
      metrics: { ...makeSnapshot().metrics, level: 0.42 },
    });
    expect(getAudioVizMetricValue(snapshot, "level")).toBe(0.42);
  });

  it("returns 0 when the metric is missing", () => {
    const snapshot = makeSnapshot();
    // @ts-expect-error — intentionally probing an invalid key
    expect(getAudioVizMetricValue(snapshot, "nope")).toBe(0);
  });
});

describe("getAudioVizMetricValueForMode", () => {
  it("reads from normalizedMetrics when normalized is true", () => {
    const snapshot = makeSnapshot({
      rawMetrics: { ...makeSnapshot().rawMetrics, bass: 0.1 },
      normalizedMetrics: { ...makeSnapshot().normalizedMetrics, bass: 0.9 },
    });
    expect(getAudioVizMetricValueForMode(snapshot, "bass", true)).toBe(0.9);
    expect(getAudioVizMetricValueForMode(snapshot, "bass", false)).toBe(0.1);
  });
});

describe("active channel selection", () => {
  it("round-trips the active channel", () => {
    setActiveAudioVizChannel("screensaver");
    expect(getActiveAudioVizChannel()).toBe("screensaver");
    setActiveAudioVizChannel("chain");
    expect(getActiveAudioVizChannel()).toBe("chain");
  });
});

describe("snapshot defaults", () => {
  it("returns an idle default snapshot for each channel", () => {
    const snap = getAudioVizSnapshot("chain");
    expect(snap.enabled).toBe(false);
    expect(snap.detectedBpm).toBeNull();
    expect(snap.status).not.toBe("live");
    expect(Object.keys(snap.rawMetrics).length).toBeGreaterThan(20);
  });
});

describe("global modulation pub/sub", () => {
  it("stores and retrieves the global modulation per channel", () => {
    const modulation: GlobalAudioVizModulation = {
      connections: [{ metric: "beat", target: "amount", weight: 0.5 }],
      normalizedMetrics: [],
    };
    setGlobalAudioVizModulation("chain", modulation);
    expect(getGlobalAudioVizModulation("chain")).toEqual(modulation);
    setGlobalAudioVizModulation("chain", null);
    expect(getGlobalAudioVizModulation("chain")).toBeNull();
  });

  it("notifies subscribers when the modulation changes", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeGlobalAudioVizModulation((channel) => seen.push(channel));
    setGlobalAudioVizModulation("screensaver", { connections: [], normalizedMetrics: [] });
    setGlobalAudioVizModulation("screensaver", null);
    unsubscribe();
    setGlobalAudioVizModulation("screensaver", { connections: [], normalizedMetrics: [] });
    expect(seen).toEqual(["screensaver", "screensaver"]);
    // Reset
    setGlobalAudioVizModulation("chain", null);
    setGlobalAudioVizModulation("screensaver", null);
  });

  it("forwards frame change events through subscribeAudioViz", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAudioViz((channel) => seen.push(channel));
    // setGlobalAudioVizModulation emits on the frame channel too
    setGlobalAudioVizModulation("chain", { connections: [], normalizedMetrics: [] });
    unsubscribe();
    expect(seen).toContain("chain");
    setGlobalAudioVizModulation("chain", null);
  });
});

import { resetAudioVizTempo, tapDownbeat } from "utils/audioVizBridge";

describe("resetAudioVizTempo", () => {
  it("resolves without error when the channel has no active runtime", async () => {
    await expect(resetAudioVizTempo("chain")).resolves.toBeUndefined();
  });

  it("clears detectedBpm in the snapshot", async () => {
    await resetAudioVizTempo("chain");
    const snapshot = getAudioVizSnapshot("chain");
    expect(snapshot.detectedBpm).toBeNull();
    expect(snapshot.rawMetrics.beat).toBe(0);
    expect(snapshot.rawMetrics.tempoPhase).toBe(0);
  });

  it("optionally clears bpmOverride when requested", async () => {
    await resetAudioVizTempo("chain", { clearOverride: true });
    expect(getAudioVizSnapshot("chain").bpmOverride).toBeNull();
  });
});

describe("tapDownbeat", () => {
  it("emits a change notification on the audio-viz channel", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAudioViz((channel) => seen.push(channel));
    tapDownbeat("chain");
    unsubscribe();
    expect(seen).toContain("chain");
  });
});
