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

export type AudioVizSnapshot = AudioVizChannelConfig & {
  status: "idle" | "connecting" | "live" | "error";
  error: string | null;
  deviceLabel: string | null;
  detectedBpm: number | null;
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
  requestToken: number;
};

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
  "beatConfidence",
];

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
const MIN_BEAT_INTERVAL_MS = 180;
const MAX_BEAT_INTERVAL_MS = 1600;
const BPM_RESET_IDLE_MS = 4000;

const normalizeMetric = (runtime: ChannelRuntime, metric: AudioVizMetric, value: number) => {
  const prevLow = runtime.normalizerLow[metric] ?? value;
  const prevHigh = runtime.normalizerHigh[metric] ?? value;
  const low = value < prevLow
    ? value
    : prevLow + (value - prevLow) * NORMALIZER_RELEASE;
  const high = value > prevHigh
    ? value
    : prevHigh + (value - prevHigh) * NORMALIZER_RELEASE;
  runtime.normalizerLow[metric] = low;
  runtime.normalizerHigh[metric] = high;
  const span = Math.max(NORMALIZER_MIN_SPAN, high - low);
  const floor = high - span;
  return clamp01((value - floor) / span);
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
    },
    video: false,
  });
};

const bucketAverage = (arr: Uint8Array, start: number, end: number) => {
  let total = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    total += arr[i];
    count += 1;
  }
  return count > 0 ? total / (count * 255) : 0;
};

const zeroCrossRate = (arr: Uint8Array) => {
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

const spectralCentroid = (arr: Uint8Array) => {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    const magnitude = arr[i] / 255;
    weighted += i * magnitude;
    total += magnitude;
  }
  return total > 0 ? weighted / (total * Math.max(1, arr.length - 1)) : 0;
};

const stereoStats = (left: Uint8Array | null, right: Uint8Array | null) => {
  if (!left || !right) {
    return { width: 0, balance: 0.5 };
  }
  const length = Math.min(left.length, right.length);
  let leftTotal = 0;
  let rightTotal = 0;
  let diffTotal = 0;
  for (let i = 0; i < length; i++) {
    const l = left[i] / 255;
    const r = right[i] / 255;
    leftTotal += l;
    rightTotal += r;
    diffTotal += Math.abs(l - r);
  }
  const total = leftTotal + rightTotal;
  return {
    width: length > 0 ? diffTotal / length : 0,
    balance: total > 0 ? clamp01((leftTotal - rightTotal) / total * 0.5 + 0.5) : 0.5,
  };
};

const startMeterLoop = (channel: AudioVizChannel) => {
  const runtime = runtimes[channel];
  if (!runtime.analyser) return;

  const freq = new Uint8Array(runtime.analyser.frequencyBinCount);
  const time = new Uint8Array(runtime.analyser.fftSize);
  const leftFreq = runtime.leftAnalyser ? new Uint8Array(runtime.leftAnalyser.frequencyBinCount) : null;
  const rightFreq = runtime.rightAnalyser ? new Uint8Array(runtime.rightAnalyser.frequencyBinCount) : null;

  const frame = () => {
    const current = runtimes[channel];
    if (!current.analyser) return;

    current.analyser.getByteFrequencyData(freq);
    current.analyser.getByteTimeDomainData(time);
    current.leftAnalyser?.getByteFrequencyData(leftFreq!);
    current.rightAnalyser?.getByteFrequencyData(rightFreq!);

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

    current.levelEma = current.levelEma * 0.82 + level * 0.18;
    const pulse = clamp01((level - current.levelEma) * 5);
    current.peakDecay = Math.max(level, current.peakDecay * 0.93);
    const centroid = spectralCentroid(freq);
    const bandRatio = clamp01(bass / Math.max(0.05, treble + 0.05));
    const { width: stereoWidth, balance: stereoBalance } = stereoStats(leftFreq, rightFreq);
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
    const beatTriggered = msSinceLastBeat >= MIN_BEAT_INTERVAL_MS && (
      (subKick > 0.055 && pulse > 0.035)
      || (onset > 0.1 && bass > 0.075)
      || beatEnergy > 0.34
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
        resetTempoState(current);
      }
    }
    const detectedBeatBpm = current.beatIntervalEma != null && current.beatIntervalEma > 0
      ? 60000 / current.beatIntervalEma
      : null;
    const detectedBpm = overrideBpm ?? detectedBeatBpm;
    const effectiveBpm = detectedBpm;
    const effectiveBeatIntervalMs = effectiveBpm != null && effectiveBpm > 0
      ? 60000 / effectiveBpm
      : null;
    let tempoPhase = 0;
    if (effectiveBeatIntervalMs != null && effectiveBeatIntervalMs > 0) {
      const phaseAnchor = current.lastBeatAt ?? 0;
      tempoPhase = ((now - phaseAnchor) % effectiveBeatIntervalMs) / effectiveBeatIntervalMs;
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
      stereoWidth: clamp01(stereoWidth * 2),
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
      beatConfidence: current.beatConfidence,
    };

    const normalizedMetrics = Object.fromEntries(
      METRIC_KEYS.map((metric) => [metric, normalizeMetric(current, metric, rawMetrics[metric])]),
    ) as AudioVizMetricValues;
    const metrics = current.snapshot.normalize ? normalizedMetrics : rawMetrics;

    updateSnapshot(channel, {
      status: "live",
      error: null,
      detectedBpm: effectiveBpm,
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
    updateSnapshot(channel, { enabled: false, status: "idle", error: null, detectedBpm: null, rawMetrics: emptyMetrics(), normalizedMetrics: emptyMetrics(), metrics: emptyMetrics(), normalize });
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

export const setGlobalAudioVizModulation = (
  channel: AudioVizChannel,
  modulation: GlobalAudioVizModulation | null,
) => {
  globalModulations[channel] = modulation;
  emitChange(channel);
};
