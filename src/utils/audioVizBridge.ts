export type AudioVizChannel = "chain" | "screensaver";
export type AudioVizSource = "microphone" | "display";
export type AudioVizMetric = "level" | "bass" | "mid" | "treble" | "pulse";

export type AudioVizTarget = {
  optionName: string;
  weight: number;
};

export type EntryAudioModulation = {
  metric: AudioVizMetric;
  targets: AudioVizTarget[];
};

export type AudioVizChannelConfig = {
  enabled: boolean;
  source: AudioVizSource;
};

export type AudioVizSnapshot = AudioVizChannelConfig & {
  status: "idle" | "connecting" | "live" | "error";
  error: string | null;
  level: number;
  bass: number;
  mid: number;
  treble: number;
  pulse: number;
};

type ChannelRuntime = {
  snapshot: AudioVizSnapshot;
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  frameHandle: number | null;
  pulseEma: number;
};

const defaultSnapshot = (): AudioVizSnapshot => ({
  enabled: false,
  source: "microphone",
  status: "idle",
  error: null,
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  pulse: 0,
});

const eventTarget = new EventTarget();
let activeChannel: AudioVizChannel = "chain";

const runtimes: Record<AudioVizChannel, ChannelRuntime> = {
  chain: {
    snapshot: defaultSnapshot(),
    stream: null,
    audioContext: null,
    analyser: null,
    sourceNode: null,
    frameHandle: null,
    pulseEma: 0,
  },
  screensaver: {
    snapshot: defaultSnapshot(),
    stream: null,
    audioContext: null,
    analyser: null,
    sourceNode: null,
    frameHandle: null,
    pulseEma: 0,
  },
};

const emitChange = (channel: AudioVizChannel) => {
  eventTarget.dispatchEvent(new CustomEvent<AudioVizChannel>("change", { detail: channel }));
};

const updateSnapshot = (channel: AudioVizChannel, partial: Partial<AudioVizSnapshot>) => {
  runtimes[channel].snapshot = { ...runtimes[channel].snapshot, ...partial };
  emitChange(channel);
};

const stopRuntime = async (channel: AudioVizChannel) => {
  const runtime = runtimes[channel];
  if (runtime.frameHandle != null) {
    cancelAnimationFrame(runtime.frameHandle);
    runtime.frameHandle = null;
  }
  runtime.sourceNode?.disconnect();
  runtime.analyser?.disconnect();
  if (runtime.stream) {
    runtime.stream.getTracks().forEach((track) => track.stop());
  }
  if (runtime.audioContext) {
    await runtime.audioContext.close().catch(() => {});
  }
  runtime.stream = null;
  runtime.audioContext = null;
  runtime.analyser = null;
  runtime.sourceNode = null;
  runtime.pulseEma = 0;
};

const createStream = async (source: AudioVizSource) => {
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
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
};

const startMeterLoop = (channel: AudioVizChannel) => {
  const runtime = runtimes[channel];
  const analyser = runtime.analyser;
  if (!analyser) return;

  const freq = new Uint8Array(analyser.frequencyBinCount);
  const time = new Uint8Array(analyser.fftSize);
  const bucket = (arr: Uint8Array, start: number, end: number) => {
    let total = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      total += arr[i];
      count += 1;
    }
    return count > 0 ? total / (count * 255) : 0;
  };

  const frame = () => {
    const current = runtimes[channel];
    if (!current.analyser) return;
    current.analyser.getByteFrequencyData(freq);
    current.analyser.getByteTimeDomainData(time);

    let rms = 0;
    for (let i = 0; i < time.length; i++) {
      const centered = (time[i] - 128) / 128;
      rms += centered * centered;
    }
    const level = Math.min(1, Math.sqrt(rms / time.length) * 1.8);
    const bass = bucket(freq, 0, Math.max(2, Math.floor(freq.length * 0.08)));
    const mid = bucket(freq, Math.floor(freq.length * 0.08), Math.max(3, Math.floor(freq.length * 0.35)));
    const treble = bucket(freq, Math.floor(freq.length * 0.35), freq.length);
    current.pulseEma = current.pulseEma * 0.82 + level * 0.18;
    const pulse = Math.max(0, Math.min(1, (level - current.pulseEma) * 5));

    updateSnapshot(channel, {
      status: "live",
      error: null,
      level,
      bass,
      mid,
      treble,
      pulse,
    });

    current.frameHandle = requestAnimationFrame(frame);
  };

  runtime.frameHandle = requestAnimationFrame(frame);
};

const startRuntime = async (channel: AudioVizChannel) => {
  const runtime = runtimes[channel];
  const { enabled, source } = runtime.snapshot;
  await stopRuntime(channel);

  if (!enabled) {
    updateSnapshot(channel, { status: "idle", error: null, level: 0, bass: 0, mid: 0, treble: 0, pulse: 0 });
    return;
  }

  updateSnapshot(channel, { status: "connecting", error: null });

  try {
    const stream = await createStream(source);
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("AudioContext is not available in this browser.");
    }
    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNode.connect(analyser);

    runtime.stream = stream;
    runtime.audioContext = audioContext;
    runtime.analyser = analyser;
    runtime.sourceNode = sourceNode;
    runtime.pulseEma = 0;

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (!runtimes[channel].snapshot.enabled) return;
        void updateAudioVizChannel(channel, { enabled: false });
      }, { once: true });
    }

    startMeterLoop(channel);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start audio capture.";
    await stopRuntime(channel);
    updateSnapshot(channel, {
      enabled: false,
      status: "error",
      error: message,
      level: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      pulse: 0,
    });
  }
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
  updateSnapshot(channel, partial);
  await startRuntime(channel);
};

export const setActiveAudioVizChannel = (channel: AudioVizChannel) => {
  activeChannel = channel;
};

export const getActiveAudioVizChannel = () => activeChannel;

export const getActiveAudioVizSnapshot = () => getAudioVizSnapshot(activeChannel);

export const getAudioVizMetricValue = (snapshot: AudioVizSnapshot, metric: AudioVizMetric) => {
  switch (metric) {
    case "bass":
      return snapshot.bass;
    case "mid":
      return snapshot.mid;
    case "treble":
      return snapshot.treble;
    case "pulse":
      return snapshot.pulse;
    case "level":
    default:
      return snapshot.level;
  }
};
