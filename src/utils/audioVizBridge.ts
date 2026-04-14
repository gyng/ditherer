export type AudioVizChannel = "chain" | "screensaver";
export type AudioVizSource = "microphone" | "display";
export type AudioVizMetric =
  | "level"
  | "bass"
  | "mid"
  | "treble"
  | "pulse"
  | "beat"
  | "bpm"
  | "beatHold"
  | "onset"
  | "spectralCentroid"
  | "spectralFlux"
  | "bandRatio"
  | "stereoWidth"
  | "stereoBalance"
  | "zeroCrossing"
  | "subKick"
  | "bassEnvelope"
  | "midEnvelope"
  | "trebleEnvelope"
  | "peakDecay"
  | "roughness"
  | "harmonic"
  | "percussive"
  | "tempoPhase"
  | "barPhase"
  | "barBeat"
  | "beatConfidence";

export type AudioVizConnection = {
  metric: AudioVizMetric;
  target: string;
  weight: number;
};

export type EntryAudioModulation = {
  connections: AudioVizConnection[];
  normalizedMetrics?: AudioVizMetric[];
};

export type GlobalAudioVizModulation = EntryAudioModulation;

export type AudioVizChannelConfig = {
  enabled: boolean;
  source: AudioVizSource;
  normalize: boolean;
  deviceId: string | null;
  bpmOverride: number | null;
};

type AudioVizMetricValues = Record<AudioVizMetric, number>;

export type TempoStatus = "idle" | "warmup" | "silent" | "searching" | "locked";

export type AudioVizSnapshot = AudioVizChannelConfig & {
  status: "idle" | "connecting" | "live" | "error";
  error: string | null;
  deviceLabel: string | null;
  detectedBpm: number | null;
  tempoStatus: TempoStatus;
  tempoWarmupProgress: number;
  rawMetrics: AudioVizMetricValues;
  normalizedMetrics: AudioVizMetricValues;
  metrics: AudioVizMetricValues;
};

type ChannelRuntime = {
  snapshot: AudioVizSnapshot;
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  leftAnalyser: AnalyserNode | null;
  rightAnalyser: AnalyserNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  splitter: ChannelSplitterNode | null;
  frameHandle: number | null;
  prevFreq: Float32Array | null;
  levelEma: number;
  onsetEma: number;
  beatPulse: number;
  beatHold: number;
  lastBeatAt: number | null;
  beatIntervalEma: number | null;
  beatConfidence: number;
  peakDecay: number;
  bassEnvelope: number;
  midEnvelope: number;
  trebleEnvelope: number;
  normalizerLow: Partial<Record<AudioVizMetric, number>>;
  normalizerHigh: Partial<Record<AudioVizMetric, number>>;
  noveltyBuffer: Float32Array;
  noveltyIndex: number;
  noveltyFilled: number;
  noveltyLastSampleAt: number;
  tempoBpm: number | null;
  tempoConfidence: number;
  tempoLastEvalAt: number;
  tempoPhaseAnchor: number | null;
  downbeatAnchor: number | null;
  subKickEma: number;
  subKickEmaAtBeat: number;
  beatsSinceAnchor: number;
  requestToken: number;
};

const NOVELTY_HOP_MS = 23;
const NOVELTY_BUFFER_SECONDS = 8;
const NOVELTY_BUFFER_SIZE = Math.round((NOVELTY_BUFFER_SECONDS * 1000) / NOVELTY_HOP_MS);
const TEMPO_EVAL_INTERVAL_MS = 400;
const TEMPO_MIN_BPM = 60;
const TEMPO_MAX_BPM = 180;
const TEMPO_MIN_FRAMES = Math.round((NOVELTY_BUFFER_SECONDS * 0.6 * 1000) / NOVELTY_HOP_MS);

const METRIC_KEYS: AudioVizMetric[] = [
  "level",
  "bass",
  "mid",
  "treble",
  "pulse",
  "beat",
  "bpm",
  "beatHold",
  "onset",
  "spectralCentroid",
  "spectralFlux",
  "bandRatio",
  "stereoWidth",
  "stereoBalance",
  "zeroCrossing",
  "subKick",
  "bassEnvelope",
  "midEnvelope",
  "trebleEnvelope",
  "peakDecay",
  "roughness",
  "harmonic",
  "percussive",
  "tempoPhase",
  "barPhase",
  "barBeat",
  "beatConfidence",
];

const BEATS_PER_BAR = 4;

const emptyMetrics = (): AudioVizMetricValues => Object.fromEntries(
  METRIC_KEYS.map((metric) => [metric, 0]),
) as AudioVizMetricValues;

const defaultSnapshot = (): AudioVizSnapshot => ({
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
  rawMetrics: emptyMetrics(),
  normalizedMetrics: emptyMetrics(),
  metrics: emptyMetrics(),
});

const makeRuntime = (): ChannelRuntime => ({
  snapshot: defaultSnapshot(),
  stream: null,
  audioContext: null,
  analyser: null,
  leftAnalyser: null,
  rightAnalyser: null,
  sourceNode: null,
  splitter: null,
  frameHandle: null,
  prevFreq: null,
  levelEma: 0,
  onsetEma: 0,
  beatPulse: 0,
  beatHold: 0,
  lastBeatAt: null,
  beatIntervalEma: null,
  beatConfidence: 0,
  peakDecay: 0,
  bassEnvelope: 0,
  midEnvelope: 0,
  trebleEnvelope: 0,
  normalizerLow: {},
  normalizerHigh: {},
  noveltyBuffer: new Float32Array(NOVELTY_BUFFER_SIZE),
  noveltyIndex: 0,
  noveltyFilled: 0,
  noveltyLastSampleAt: 0,
  tempoBpm: null,
  tempoConfidence: 0,
  tempoLastEvalAt: 0,
  tempoPhaseAnchor: null,
  downbeatAnchor: null,
  subKickEma: 0,
  subKickEmaAtBeat: 0,
  beatsSinceAnchor: 0,
  requestToken: 0,
});

const eventTarget = new EventTarget();
let activeChannel: AudioVizChannel = "chain";
const runtimes: Record<AudioVizChannel, ChannelRuntime> = {
  chain: makeRuntime(),
  screensaver: makeRuntime(),
};
const globalModulations: Record<AudioVizChannel, GlobalAudioVizModulation | null> = {
  chain: null,
  screensaver: null,
};

const emitChange = (channel: AudioVizChannel) => {
  eventTarget.dispatchEvent(new CustomEvent<AudioVizChannel>("change", { detail: channel }));
};

const updateSnapshot = (channel: AudioVizChannel, partial: Partial<AudioVizSnapshot>) => {
  runtimes[channel].snapshot = { ...runtimes[channel].snapshot, ...partial };
  emitChange(channel);
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const BPM_NORMALIZATION_MAX = 240;
const NORMALIZER_RELEASE = 0.004;
const NORMALIZER_MIN_SPAN = 0.08;
const MIN_BEAT_INTERVAL_MS = 260;
const MAX_BEAT_INTERVAL_MS = 1600;
const BPM_RESET_IDLE_MS = 9000;

// Pure adaptive-range calculation used by normalizeMetric. Exported for
// unit tests; fast-attack / slow-release toward the current sample, with a
// minimum span so silent inputs don't divide by zero.
export const computeAdaptiveRange = (
  value: number,
  prevLow: number | undefined,
  prevHigh: number | undefined,
): { normalized: number; low: number; high: number } => {
  const lowAnchor = prevLow ?? value;
  const highAnchor = prevHigh ?? value;
  const low = value < lowAnchor
    ? value
    : lowAnchor + (value - lowAnchor) * NORMALIZER_RELEASE;
  const high = value > highAnchor
    ? value
    : highAnchor + (value - highAnchor) * NORMALIZER_RELEASE;
  const span = Math.max(NORMALIZER_MIN_SPAN, high - low);
  const floor = high - span;
  return { normalized: clamp01((value - floor) / span), low, high };
};

const normalizeMetric = (runtime: ChannelRuntime, metric: AudioVizMetric, value: number) => {
  const { normalized, low, high } = computeAdaptiveRange(
    value,
    runtime.normalizerLow[metric],
    runtime.normalizerHigh[metric],
  );
  runtime.normalizerLow[metric] = low;
  runtime.normalizerHigh[metric] = high;
  return normalized;
};

const stopRuntime = async (channel: AudioVizChannel) => {
  const runtime = runtimes[channel];
  if (runtime.frameHandle != null) {
    cancelAnimationFrame(runtime.frameHandle);
    runtime.frameHandle = null;
  }
  runtime.sourceNode?.disconnect();
  runtime.analyser?.disconnect();
  runtime.leftAnalyser?.disconnect();
  runtime.rightAnalyser?.disconnect();
  runtime.splitter?.disconnect();
  if (runtime.stream) {
    runtime.stream.getTracks().forEach((track) => track.stop());
  }
  if (runtime.audioContext) {
    await runtime.audioContext.close().catch(() => {});
  }
  const source = runtime.snapshot.source;
  const normalize = runtime.snapshot.normalize;
  const deviceId = runtime.snapshot.deviceId;
  const bpmOverride = runtime.snapshot.bpmOverride;
  const requestToken = runtime.requestToken;
  runtimes[channel] = {
    ...makeRuntime(),
    requestToken,
    snapshot: {
      ...defaultSnapshot(),
      source,
      normalize,
      deviceId,
      bpmOverride,
      enabled: false,
      status: "idle",
    },
  };
};

const resetTempoState = (runtime: ChannelRuntime) => {
  runtime.beatPulse = 0;
  runtime.beatHold = 0;
  runtime.lastBeatAt = null;
  runtime.beatIntervalEma = null;
  runtime.beatConfidence = 0;
  runtime.noveltyBuffer.fill(0);
  runtime.noveltyIndex = 0;
  runtime.noveltyFilled = 0;
  runtime.tempoBpm = null;
  runtime.tempoConfidence = 0;
  runtime.tempoLastEvalAt = 0;
  runtime.tempoPhaseAnchor = null;
  runtime.downbeatAnchor = null;
  runtime.subKickEma = 0;
  runtime.subKickEmaAtBeat = 0;
  runtime.beatsSinceAnchor = 0;
};

export const tapDownbeat = (channel: AudioVizChannel) => {
  const runtime = runtimes[channel];
  const now = performance.now();
  runtime.downbeatAnchor = now;
  runtime.beatsSinceAnchor = 0;
  if (runtime.tempoPhaseAnchor == null) {
    runtime.tempoPhaseAnchor = now;
  }
  emitChange(channel);
};


const resetIdleBeatState = (runtime: ChannelRuntime) => {
  runtime.beatPulse = 0;
  runtime.beatHold = 0;
  runtime.lastBeatAt = null;
  runtime.beatConfidence *= 0.5;
};

/**
 * Pure autocorrelation tempo tracker. Given an onset-novelty ring buffer,
 * scans lag values across the musical BPM range and returns the dominant
 * candidate BPM plus a z-score style confidence. Exported for unit tests.
 * Returns null when the signal is too short, flat, or has no positive peak.
 */
export const findDominantTempo = (params: {
  buffer: Float32Array;
  filled: number;
  bufferIndex: number;
  hopMs: number;
  minBpm: number;
  maxBpm: number;
  minFrames: number;
}): { bpm: number; confidence: number } | null => {
  const { buffer, filled, bufferIndex, hopMs, minBpm, maxBpm, minFrames } = params;
  if (filled < minFrames) return null;
  let mean = 0;
  for (let i = 0; i < filled; i++) {
    const idx = (bufferIndex - filled + i + buffer.length) % buffer.length;
    mean += buffer[idx];
  }
  mean /= filled;
  let variance = 0;
  for (let i = 0; i < filled; i++) {
    const idx = (bufferIndex - filled + i + buffer.length) % buffer.length;
    const v = buffer[idx] - mean;
    variance += v * v;
  }
  if (variance < 1e-6) return null;

  const minLag = Math.max(1, Math.round(60000 / (maxBpm * hopMs)));
  const maxLag = Math.round(60000 / (minBpm * hopMs));
  let bestScore = -Infinity;
  let bestLag = -1;
  let scoreSum = 0;
  let scoreSqSum = 0;
  let scoreCount = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const count = filled - lag;
    if (count <= 8) continue;
    let score = 0;
    for (let i = 0; i < count; i++) {
      const idxA = (bufferIndex - filled + i + buffer.length) % buffer.length;
      const idxB = (bufferIndex - filled + i + lag + buffer.length) % buffer.length;
      score += (buffer[idxA] - mean) * (buffer[idxB] - mean);
    }
    score /= count;
    const musicalWeight = 1 - Math.abs(120 - 60000 / (lag * hopMs)) / 600;
    const weightedScore = score * Math.max(0.35, musicalWeight);
    scoreSum += weightedScore;
    scoreSqSum += weightedScore * weightedScore;
    scoreCount += 1;
    if (weightedScore > bestScore) {
      bestScore = weightedScore;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestScore <= 0 || scoreCount === 0) return null;

  const bestPeriodMs = bestLag * hopMs;
  const bpm = 60000 / bestPeriodMs;
  const scoreMean = scoreSum / scoreCount;
  const scoreStd = Math.sqrt(Math.max(0, scoreSqSum / scoreCount - scoreMean * scoreMean));
  const confidence = clamp01(scoreStd > 1e-8 ? (bestScore - scoreMean) / (scoreStd * 4) : 0);
  return { bpm, confidence };
};

const evaluateTempo = (runtime: ChannelRuntime) => {
  const candidate = findDominantTempo({
    buffer: runtime.noveltyBuffer,
    filled: runtime.noveltyFilled,
    bufferIndex: runtime.noveltyIndex,
    hopMs: NOVELTY_HOP_MS,
    minBpm: TEMPO_MIN_BPM,
    maxBpm: TEMPO_MAX_BPM,
    minFrames: TEMPO_MIN_FRAMES,
  });
  if (!candidate) return;
  const { bpm: candidateBpm, confidence } = candidate;

  if (runtime.tempoBpm == null) {
    runtime.tempoBpm = candidateBpm;
    runtime.tempoConfidence = Math.max(0.1, confidence);
    return;
  }
  const smoothing = 0.2 + confidence * 0.45;
  const currentBpm = runtime.tempoBpm;
  const halfCandidate = candidateBpm / 2;
  const doubleCandidate = candidateBpm * 2;
  const bestAligned = [candidateBpm, halfCandidate, doubleCandidate]
    .filter((bpm) => bpm >= TEMPO_MIN_BPM && bpm <= TEMPO_MAX_BPM)
    .reduce((best, bpm) => Math.abs(bpm - currentBpm) < Math.abs(best - currentBpm) ? bpm : best, candidateBpm);
  runtime.tempoBpm = currentBpm * (1 - smoothing) + bestAligned * smoothing;
  runtime.tempoConfidence = runtime.tempoConfidence * 0.7 + confidence * 0.3;
};

const createStream = async (source: AudioVizSource, deviceId: string | null) => {
  if (source === "display") {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("No audio track was shared. Choose a tab/window with audio enabled.");
    }
    return stream;
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
    video: false,
  });
};

export const bucketAverage = (arr: Uint8Array, start: number, end: number) => {
  let total = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    total += arr[i];
    count += 1;
  }
  return count > 0 ? total / (count * 255) : 0;
};

export const zeroCrossRate = (arr: Uint8Array) => {
  let crossings = 0;
  let prev = arr[0] - 128;
  for (let i = 1; i < arr.length; i++) {
    const current = arr[i] - 128;
    if ((prev >= 0 && current < 0) || (prev < 0 && current >= 0)) {
      crossings += 1;
    }
    prev = current;
  }
  return crossings / arr.length;
};

export const spectralCentroid = (arr: Uint8Array) => {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    const magnitude = arr[i] / 255;
    weighted += i * magnitude;
    total += magnitude;
  }
  return total > 0 ? weighted / (total * Math.max(1, arr.length - 1)) : 0;
};

export const stereoStats = (
  leftFreq: Uint8Array | null,
  rightFreq: Uint8Array | null,
  leftTime: Uint8Array | null,
  rightTime: Uint8Array | null,
) => {
  if (!leftFreq || !rightFreq) {
    return { width: 0, balance: 0.5 };
  }
  const freqLength = Math.min(leftFreq.length, rightFreq.length);
  let leftTotal = 0;
  let rightTotal = 0;
  for (let i = 0; i < freqLength; i++) {
    leftTotal += leftFreq[i] / 255;
    rightTotal += rightFreq[i] / 255;
  }
  const total = leftTotal + rightTotal;
  const balance = total > 0 ? clamp01((leftTotal - rightTotal) / total * 0.5 + 0.5) : 0.5;

  let width = 0;
  if (leftTime && rightTime) {
    const timeLength = Math.min(leftTime.length, rightTime.length);
    let midSquared = 0;
    let sideSquared = 0;
    for (let i = 0; i < timeLength; i++) {
      const l = (leftTime[i] - 128) / 128;
      const r = (rightTime[i] - 128) / 128;
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      midSquared += mid * mid;
      sideSquared += side * side;
    }
    const midRms = Math.sqrt(midSquared / Math.max(1, timeLength));
    const sideRms = Math.sqrt(sideSquared / Math.max(1, timeLength));
    const denom = midRms + sideRms;
    width = denom > 1e-5 ? sideRms / denom : 0;
  }

  return { width, balance };
};

const startMeterLoop = (channel: AudioVizChannel) => {
  const runtime = runtimes[channel];
  if (!runtime.analyser) return;

  const freq = new Uint8Array(runtime.analyser.frequencyBinCount);
  const time = new Uint8Array(runtime.analyser.fftSize);
  const leftFreq = runtime.leftAnalyser ? new Uint8Array(runtime.leftAnalyser.frequencyBinCount) : null;
  const rightFreq = runtime.rightAnalyser ? new Uint8Array(runtime.rightAnalyser.frequencyBinCount) : null;
  const leftTime = runtime.leftAnalyser ? new Uint8Array(runtime.leftAnalyser.fftSize) : null;
  const rightTime = runtime.rightAnalyser ? new Uint8Array(runtime.rightAnalyser.fftSize) : null;

  const frame = () => {
    const current = runtimes[channel];
    if (!current.analyser) return;

    current.analyser.getByteFrequencyData(freq);
    current.analyser.getByteTimeDomainData(time);
    current.leftAnalyser?.getByteFrequencyData(leftFreq!);
    current.rightAnalyser?.getByteFrequencyData(rightFreq!);
    current.leftAnalyser?.getByteTimeDomainData(leftTime!);
    current.rightAnalyser?.getByteTimeDomainData(rightTime!);

    let rms = 0;
    for (let i = 0; i < time.length; i++) {
      const centered = (time[i] - 128) / 128;
      rms += centered * centered;
    }
    const level = clamp01(Math.sqrt(rms / time.length) * 1.8);
    const subKick = bucketAverage(freq, 0, Math.max(1, Math.floor(freq.length * 0.025)));
    const bass = bucketAverage(freq, 0, Math.max(2, Math.floor(freq.length * 0.08)));
    const mid = bucketAverage(freq, Math.floor(freq.length * 0.08), Math.max(3, Math.floor(freq.length * 0.35)));
    const treble = bucketAverage(freq, Math.floor(freq.length * 0.35), freq.length);
    current.bassEnvelope = current.bassEnvelope * 0.8 + bass * 0.2;
    current.midEnvelope = current.midEnvelope * 0.84 + mid * 0.16;
    current.trebleEnvelope = current.trebleEnvelope * 0.88 + treble * 0.12;

    let flux = 0;
    if (current.prevFreq) {
      for (let i = 0; i < freq.length; i++) {
        flux += Math.max(0, freq[i] / 255 - current.prevFreq[i]);
      }
      flux /= freq.length;
    }
    current.prevFreq = Float32Array.from(freq, (value) => value / 255);
    const spectralFlux = clamp01(flux * 4);
    current.onsetEma = current.onsetEma * 0.9 + spectralFlux * 0.1;
    const onset = clamp01((spectralFlux - current.onsetEma) * 6);

    const nowForNovelty = performance.now();
    if (nowForNovelty - current.noveltyLastSampleAt >= NOVELTY_HOP_MS) {
      current.noveltyLastSampleAt = nowForNovelty;
      const novelty = Math.max(0, spectralFlux - current.onsetEma);
      current.noveltyBuffer[current.noveltyIndex] = novelty;
      current.noveltyIndex = (current.noveltyIndex + 1) % current.noveltyBuffer.length;
      if (current.noveltyFilled < current.noveltyBuffer.length) current.noveltyFilled += 1;
      if (nowForNovelty - current.tempoLastEvalAt >= TEMPO_EVAL_INTERVAL_MS) {
        current.tempoLastEvalAt = nowForNovelty;
        evaluateTempo(current);
      }
    }

    current.levelEma = current.levelEma * 0.82 + level * 0.18;
    const pulse = clamp01((level - current.levelEma) * 5);
    current.peakDecay = Math.max(level, current.peakDecay * 0.93);
    const centroid = spectralCentroid(freq);
    const bandRatio = clamp01(bass / Math.max(0.05, treble + 0.05));
    const { width: stereoWidth, balance: stereoBalance } = stereoStats(leftFreq, rightFreq, leftTime, rightTime);
    const roughness = clamp01((zeroCrossRate(time) * 1.5 + treble * 0.7) / 2.2);
    const harmonic = clamp01((1 - spectralFlux) * (0.35 + mid * 0.65));
    const percussive = clamp01((onset * 0.7) + (pulse * 0.3));
    const now = performance.now();
    const overrideBpm = current.snapshot.bpmOverride != null && current.snapshot.bpmOverride > 0
      ? current.snapshot.bpmOverride
      : null;
    const msSinceLastBeat = current.lastBeatAt == null ? Number.POSITIVE_INFINITY : now - current.lastBeatAt;
    const beatEnergy = Math.max(
      subKick * 1.35 + pulse * 0.85,
      bass * 0.95 + onset * 1.15,
      percussive * 1.2 + level * 0.45,
    );
    const bassFloor = current.bassEnvelope * 1.3 + 0.04;
    const energyFloor = Math.max(0.3, current.levelEma * 1.7 + current.onsetEma * 4.5);
    const beatTriggered = msSinceLastBeat >= MIN_BEAT_INTERVAL_MS && (
      (subKick > 0.07 && pulse > 0.06)
      || (onset > 0.12 && bass > bassFloor)
      || beatEnergy > energyFloor
    );

    if (overrideBpm != null) {
      const overrideBeatIntervalMs = 60000 / overrideBpm;
      if (current.lastBeatAt == null) {
        current.lastBeatAt = now;
        current.beatPulse = 1;
        current.beatHold = 1;
      } else if (now - current.lastBeatAt >= overrideBeatIntervalMs) {
        const beatsElapsed = Math.max(1, Math.floor((now - current.lastBeatAt) / overrideBeatIntervalMs));
        current.lastBeatAt += beatsElapsed * overrideBeatIntervalMs;
        current.beatPulse = 1;
        current.beatHold = 1;
      } else {
        current.beatPulse *= 0.72;
        current.beatHold *= 0.9;
      }
      current.beatConfidence = 1;
      current.beatIntervalEma = overrideBeatIntervalMs;
    } else if (beatTriggered) {
      if (current.lastBeatAt != null) {
        const interval = now - current.lastBeatAt;
        if (interval >= MIN_BEAT_INTERVAL_MS && interval < MAX_BEAT_INTERVAL_MS) {
          current.beatIntervalEma = current.beatIntervalEma == null
            ? interval
            : current.beatIntervalEma * 0.8 + interval * 0.2;
          const error = current.beatIntervalEma == null ? 0 : Math.abs(interval - current.beatIntervalEma);
          current.beatConfidence = clamp01(1 - error / Math.max(180, current.beatIntervalEma || 1));
        }
      }
      current.lastBeatAt = now;
      current.beatPulse = 1;
      current.beatHold = 1;
    } else {
      current.beatPulse *= 0.72;
      current.beatHold *= 0.9;
      current.beatConfidence *= 0.992;
      if (current.lastBeatAt != null && now - current.lastBeatAt > BPM_RESET_IDLE_MS) {
        resetIdleBeatState(current);
      }
    }
    const detectedBeatBpm = current.tempoBpm;
    const detectedBpm = overrideBpm ?? detectedBeatBpm;
    const effectiveBpm = detectedBpm;
    const effectiveBeatIntervalMs = effectiveBpm != null && effectiveBpm > 0
      ? 60000 / effectiveBpm
      : null;
    current.subKickEma = current.subKickEma * 0.85 + subKick * 0.15;

    let tempoPhase = 0;
    let barPhase = 0;
    let barBeat = 0;
    if (effectiveBeatIntervalMs != null && effectiveBeatIntervalMs > 0) {
      const barIntervalMs = effectiveBeatIntervalMs * BEATS_PER_BAR;
      if (beatTriggered) {
        let advancedCycles = 0;
        if (current.tempoPhaseAnchor == null) {
          current.tempoPhaseAnchor = now;
          current.downbeatAnchor = now;
          current.beatsSinceAnchor = 0;
          current.subKickEmaAtBeat = subKick;
        } else {
          const elapsed = now - current.tempoPhaseAnchor;
          const cycles = elapsed / effectiveBeatIntervalMs;
          const nearestWhole = Math.round(cycles);
          const drift = Math.abs(cycles - nearestWhole);
          if (nearestWhole >= 1 && drift < 0.22) {
            current.tempoPhaseAnchor += nearestWhole * effectiveBeatIntervalMs;
            advancedCycles = nearestWhole;
          }
        }

        current.subKickEmaAtBeat = current.subKickEmaAtBeat * 0.75 + subKick * 0.25;
        current.beatsSinceAnchor += advancedCycles;

        const kickPeak = subKick > Math.max(0.08, current.subKickEmaAtBeat * 1.35);
        const clearOfRecentAnchor = current.beatsSinceAnchor >= 2;
        if (current.downbeatAnchor == null || (kickPeak && clearOfRecentAnchor)) {
          current.downbeatAnchor = current.tempoPhaseAnchor ?? now;
          current.beatsSinceAnchor = 0;
        }
      }
      const phaseAnchor = current.tempoPhaseAnchor ?? current.lastBeatAt ?? now;
      tempoPhase = ((now - phaseAnchor) % effectiveBeatIntervalMs) / effectiveBeatIntervalMs;
      if (tempoPhase < 0) tempoPhase += 1;

      const barAnchor = current.downbeatAnchor ?? phaseAnchor;
      barPhase = ((now - barAnchor) % barIntervalMs) / barIntervalMs;
      if (barPhase < 0) barPhase += 1;
      barBeat = Math.floor(barPhase * BEATS_PER_BAR) / (BEATS_PER_BAR - 1);
    } else {
      current.tempoPhaseAnchor = null;
      current.downbeatAnchor = null;
      current.beatsSinceAnchor = 0;
    }

    const rawMetrics: AudioVizMetricValues = {
      level,
      bass,
      mid,
      treble,
      pulse,
      beat: current.beatPulse,
      bpm: clamp01((effectiveBpm ?? 0) / BPM_NORMALIZATION_MAX),
      beatHold: current.beatHold,
      onset,
      spectralCentroid: centroid,
      spectralFlux,
      bandRatio,
      stereoWidth: clamp01(stereoWidth * 1.6),
      stereoBalance,
      zeroCrossing: clamp01(zeroCrossRate(time) * 4),
      subKick,
      bassEnvelope: current.bassEnvelope,
      midEnvelope: current.midEnvelope,
      trebleEnvelope: current.trebleEnvelope,
      peakDecay: current.peakDecay,
      roughness,
      harmonic,
      percussive,
      tempoPhase,
      barPhase,
      barBeat,
      beatConfidence: overrideBpm != null ? 1 : current.tempoConfidence,
    };

    const normalizedMetrics = Object.fromEntries(
      METRIC_KEYS.map((metric) => [metric, normalizeMetric(current, metric, rawMetrics[metric])]),
    ) as AudioVizMetricValues;
    const metrics = current.snapshot.normalize ? normalizedMetrics : rawMetrics;

    const warmupProgress = clamp01(current.noveltyFilled / TEMPO_MIN_FRAMES);
    let tempoStatus: TempoStatus;
    if (overrideBpm != null) {
      tempoStatus = "locked";
    } else if (warmupProgress < 1) {
      tempoStatus = "warmup";
    } else if (current.levelEma < 0.015) {
      tempoStatus = "silent";
    } else if (current.tempoBpm == null) {
      tempoStatus = "searching";
    } else {
      tempoStatus = "locked";
    }

    updateSnapshot(channel, {
      status: "live",
      error: null,
      detectedBpm: effectiveBpm,
      tempoStatus,
      tempoWarmupProgress: warmupProgress,
      rawMetrics,
      normalizedMetrics,
      metrics,
    });

    current.frameHandle = requestAnimationFrame(frame);
  };

  runtime.frameHandle = requestAnimationFrame(frame);
};

const startRuntime = async (channel: AudioVizChannel) => {
  const requestToken = runtimes[channel].requestToken + 1;
  runtimes[channel].requestToken = requestToken;
  const initialSnapshot = runtimes[channel].snapshot;
  const { enabled, source, normalize, deviceId } = initialSnapshot;
  await stopRuntime(channel);

  if (runtimes[channel].requestToken !== requestToken) return;

  if (!enabled) {
    updateSnapshot(channel, { enabled: false, status: "idle", error: null, detectedBpm: null, tempoStatus: "idle", tempoWarmupProgress: 0, rawMetrics: emptyMetrics(), normalizedMetrics: emptyMetrics(), metrics: emptyMetrics(), normalize });
    return;
  }

  updateSnapshot(channel, { enabled: true, status: "connecting", error: null, normalize });

  try {
    const stream = await createStream(source, deviceId);
    if (runtimes[channel].requestToken !== requestToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("AudioContext is not available in this browser.");
    }

    const audioContext = new AudioContextCtor();
    if (runtimes[channel].requestToken !== requestToken) {
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch(() => {});
      return;
    }
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;

    const leftAnalyser = audioContext.createAnalyser();
    leftAnalyser.fftSize = 512;
    leftAnalyser.smoothingTimeConstant = 0.82;
    const rightAnalyser = audioContext.createAnalyser();
    rightAnalyser.fftSize = 512;
    rightAnalyser.smoothingTimeConstant = 0.82;

    const sourceNode = audioContext.createMediaStreamSource(stream);
    const splitter = audioContext.createChannelSplitter(2);
    sourceNode.connect(analyser);
    sourceNode.connect(splitter);
    splitter.connect(leftAnalyser, 0);
    splitter.connect(rightAnalyser, 1);

    const runtime = runtimes[channel];
    if (runtime.requestToken !== requestToken) {
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch(() => {});
      return;
    }
    runtime.stream = stream;
    runtime.audioContext = audioContext;
    runtime.analyser = analyser;
    runtime.leftAnalyser = leftAnalyser;
    runtime.rightAnalyser = rightAnalyser;
    runtime.sourceNode = sourceNode;
    runtime.splitter = splitter;

    const audioTrack = stream.getAudioTracks()[0] ?? null;
    const settings = audioTrack?.getSettings?.();
    updateSnapshot(channel, {
      enabled: true,
      source,
      normalize,
      deviceId: typeof settings?.deviceId === "string" ? settings.deviceId : runtime.snapshot.deviceId,
      deviceLabel: audioTrack?.label || (source === "microphone" ? "Microphone" : "Shared audio"),
      status: "live",
      error: null,
    });

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (!runtimes[channel].snapshot.enabled) return;
        void updateAudioVizChannel(channel, { enabled: false });
      }, { once: true });
    }

    startMeterLoop(channel);
  } catch (error) {
    if (runtimes[channel].requestToken !== requestToken) return;
    const message = error instanceof Error ? error.message : "Failed to start audio capture.";
    await stopRuntime(channel);
    if (runtimes[channel].requestToken !== requestToken) return;
    updateSnapshot(channel, {
      enabled: false,
      source,
      normalize,
      deviceId,
      status: "error",
      error: message,
      deviceLabel: null,
      detectedBpm: null,
      tempoStatus: "idle",
      tempoWarmupProgress: 0,
      rawMetrics: emptyMetrics(),
      normalizedMetrics: emptyMetrics(),
      metrics: emptyMetrics(),
    });
  }
};

export const listAudioInputDevices = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput");
};

if (typeof window !== "undefined") {
  (window as unknown as { __audioVizDebug: unknown }).__audioVizDebug = {
    getRuntime: (channel: AudioVizChannel = "chain") => runtimes[channel],
    getSnapshot: (channel: AudioVizChannel = "chain") => runtimes[channel].snapshot,
    sampleTime: (channel: AudioVizChannel = "chain") => {
      const analyser = runtimes[channel].analyser;
      if (!analyser) return { hasAnalyser: false };
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      let min = 255, max = 0, sumAbs = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] < min) min = buf[i];
        if (buf[i] > max) max = buf[i];
        sumAbs += Math.abs(buf[i] - 128);
      }
      return { min, max, meanAbs: sumAbs / buf.length, sample: Array.from(buf.slice(0, 16)) };
    },
    trackSettings: (channel: AudioVizChannel = "chain") => {
      const tracks = runtimes[channel].stream?.getAudioTracks() ?? [];
      return tracks.map((track) => ({
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        settings: track.getSettings(),
      }));
    },
    contextState: (channel: AudioVizChannel = "chain") => runtimes[channel].audioContext?.state ?? null,
    report: (channel: AudioVizChannel = "chain") => {
      const runtime = runtimes[channel];
      const analyser = runtime.analyser;
      const leftAnalyser = runtime.leftAnalyser;
      const rightAnalyser = runtime.rightAnalyser;
      let timeStats: Record<string, unknown> = { hasAnalyser: false };
      if (analyser) {
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        let min = 255, max = 0, sumAbs = 0;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] < min) min = buf[i];
          if (buf[i] > max) max = buf[i];
          sumAbs += Math.abs(buf[i] - 128);
        }
        timeStats = { hasAnalyser: true, min, max, meanAbs: +(sumAbs / buf.length).toFixed(2), firstBytes: Array.from(buf.slice(0, 8)) };
      }
      let stereoStats: Record<string, unknown> = { hasSplit: false };
      if (leftAnalyser && rightAnalyser) {
        const lt = new Uint8Array(leftAnalyser.fftSize);
        const rt = new Uint8Array(rightAnalyser.fftSize);
        leftAnalyser.getByteTimeDomainData(lt);
        rightAnalyser.getByteTimeDomainData(rt);
        let midSq = 0, sideSq = 0, lSq = 0, rSq = 0;
        for (let i = 0; i < lt.length; i++) {
          const l = (lt[i] - 128) / 128;
          const r = (rt[i] - 128) / 128;
          midSq += ((l + r) * 0.5) ** 2;
          sideSq += ((l - r) * 0.5) ** 2;
          lSq += l * l;
          rSq += r * r;
        }
        stereoStats = {
          hasSplit: true,
          leftRms: +Math.sqrt(lSq / lt.length).toFixed(4),
          rightRms: +Math.sqrt(rSq / rt.length).toFixed(4),
          midRms: +Math.sqrt(midSq / lt.length).toFixed(4),
          sideRms: +Math.sqrt(sideSq / lt.length).toFixed(4),
        };
      }
      const tracks = runtime.stream?.getAudioTracks() ?? [];
      const snapshot = runtime.snapshot;
      return {
        channel,
        contextState: runtime.audioContext?.state ?? null,
        snapshot: {
          enabled: snapshot.enabled,
          source: snapshot.source,
          status: snapshot.status,
          error: snapshot.error,
          deviceLabel: snapshot.deviceLabel,
          detectedBpm: snapshot.detectedBpm,
          normalize: snapshot.normalize,
          rawLevel: +snapshot.rawMetrics.level.toFixed(4),
          rawBass: +snapshot.rawMetrics.bass.toFixed(4),
          rawStereoWidth: +snapshot.rawMetrics.stereoWidth.toFixed(4),
        },
        tracks: tracks.map((track) => ({
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          channelCount: track.getSettings().channelCount,
          sampleRate: track.getSettings().sampleRate,
        })),
        analyser: timeStats,
        stereo: stereoStats,
        tempo: {
          bpm: runtime.tempoBpm,
          confidence: +runtime.tempoConfidence.toFixed(3),
          noveltyFilled: runtime.noveltyFilled,
          noveltyBufferSize: runtime.noveltyBuffer.length,
        },
      };
    },
  };
}

export const requestMicPermissionAndList = async () => {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) return [];
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    // Fall through to enumerateDevices which may still return something
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput" && device.deviceId);
};

export const getAudioVizSnapshot = (channel: AudioVizChannel) => runtimes[channel].snapshot;

export const subscribeAudioViz = (listener: (channel: AudioVizChannel) => void) => {
  const handleChange = (event: Event) => {
    listener((event as CustomEvent<AudioVizChannel>).detail);
  };
  eventTarget.addEventListener("change", handleChange);
  return () => eventTarget.removeEventListener("change", handleChange);
};

export const updateAudioVizChannel = async (
  channel: AudioVizChannel,
  partial: Partial<AudioVizChannelConfig>,
) => {
  const shouldRestart = "enabled" in partial || "source" in partial || "deviceId" in partial;
  updateSnapshot(channel, partial);
  if (shouldRestart) {
    await startRuntime(channel);
  }
};

export const resetAudioVizTempo = async (
  channel: AudioVizChannel,
  options?: { clearOverride?: boolean },
) => {
  const runtime = runtimes[channel];
  resetTempoState(runtime);
  runtime.normalizerLow = {};
  runtime.normalizerHigh = {};
  runtime.peakDecay = 0;
  runtime.noveltyBuffer.fill(0);
  runtime.noveltyFilled = 0;
  runtime.noveltyIndex = 0;
  runtime.tempoBpm = null;
  runtime.tempoConfidence = 0;
  const clearOverride = options?.clearOverride ?? false;
  const bpmOverride = clearOverride ? null : runtime.snapshot.bpmOverride;
  const bpmValue = bpmOverride != null && bpmOverride > 0
    ? clamp01(bpmOverride / BPM_NORMALIZATION_MAX)
    : 0;
  updateSnapshot(channel, {
    ...(clearOverride ? { bpmOverride: null } : {}),
    detectedBpm: bpmOverride,
    rawMetrics: {
      ...runtime.snapshot.rawMetrics,
      beat: 0,
      bpm: bpmValue,
      beatHold: 0,
      tempoPhase: 0,
      beatConfidence: 0,
    },
    normalizedMetrics: {
      ...runtime.snapshot.normalizedMetrics,
      beat: 0,
      bpm: bpmValue,
      beatHold: 0,
      tempoPhase: 0,
      beatConfidence: 0,
    },
    metrics: {
      ...runtime.snapshot.metrics,
      beat: 0,
      bpm: bpmValue,
      beatHold: 0,
      tempoPhase: 0,
      beatConfidence: 0,
    },
  });
};

export const setActiveAudioVizChannel = (channel: AudioVizChannel) => {
  activeChannel = channel;
};

export const getActiveAudioVizChannel = () => activeChannel;

export const getActiveAudioVizSnapshot = () => getAudioVizSnapshot(activeChannel);

export const getAudioVizMetricValue = (snapshot: AudioVizSnapshot, metric: AudioVizMetric) =>
  snapshot.metrics[metric] ?? 0;

export const getAudioVizMetricValueForMode = (
  snapshot: AudioVizSnapshot,
  metric: AudioVizMetric,
  normalized: boolean,
) => (normalized ? snapshot.normalizedMetrics[metric] : snapshot.rawMetrics[metric]) ?? 0;

export const getGlobalAudioVizModulation = (channel: AudioVizChannel) => globalModulations[channel];

const globalModulationTarget = new EventTarget();

export const subscribeGlobalAudioVizModulation = (listener: (channel: AudioVizChannel) => void) => {
  const handleChange = (event: Event) => {
    listener((event as CustomEvent<AudioVizChannel>).detail);
  };
  globalModulationTarget.addEventListener("change", handleChange);
  return () => globalModulationTarget.removeEventListener("change", handleChange);
};

export const setGlobalAudioVizModulation = (
  channel: AudioVizChannel,
  modulation: GlobalAudioVizModulation | null,
) => {
  globalModulations[channel] = modulation;
  emitChange(channel);
  globalModulationTarget.dispatchEvent(new CustomEvent<AudioVizChannel>("change", { detail: channel }));
};
