import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import useDraggable from "./useDraggable";

import Controls from "components/controls";
import ChainList from "components/ChainList";
import { CHAIN_PRESETS, type PresetFilterEntry } from "components/ChainList/presets";
import Exporter from "components/App/Exporter";
import WebMCPBadge from "components/App/WebMCPBadge";
import SaveAs from "components/SaveAs";
import Range from "components/controls/Range";
import Enum from "components/controls/Enum";
import { HelpHint } from "components/controls/ControlLabel";
import WindowDialog from "components/WindowDialog";
import CollapsibleSection from "components/CollapsibleSection";
import AudioVizControls from "components/AudioVizControls";
import AudioBeatStrip from "components/AudioBeatStrip";
import AudioBpmReadout from "components/AudioBpmReadout";

import { useFilter } from "context/useFilter";
import { getScaleForMaxWidth } from "context/autoScale";
import {
  createReadbackCanvas,
  getReadbackContext,
  SCALING_ALGORITHM,
  SCALING_ALGORITHM_OPTIONS,
} from "@gyng/ditherer-filters";
import {
  dispatchRandomCycleSeconds,
  getCurrentRandomCycleSeconds,
  getLastRandomCycleSeconds,
  dispatchScreensaverCycleSeconds,
  getCurrentScreensaverCycleSeconds,
  getLastScreensaverCycleSeconds,
  setRememberedScreensaverCycleSeconds,
  notifyScreensaverVideoSwap,
  getLastScreensaverChainSwapAt,
  getLastScreensaverVideoSwapAt,
  resetScreensaverSwapMarkers,
} from "utils/randomCycleBridge";
import { AUTO_VIZ_DENSITY, buildAutoVizConnections } from "utils/autoViz";
import type { AudioVizConnection, AudioVizMetric, EntryAudioModulation, GlobalAudioVizModulation } from "utils/audioVizBridge";
import { getGlobalAudioVizModulation, getAudioVizMetricValueForMode, getAudioVizSnapshot as getChannelAudioVizSnapshot, resetAudioVizTempo, setActiveAudioVizChannel, setGlobalAudioVizModulation, subscribeAudioViz, tapDownbeat, updateAudioVizChannel } from "utils/audioVizBridge";
import { getWebMCPAvailability, setupWebMCP, type WebMCPStatus } from "@src/webmcp";
import {
  TEST_IMAGE_FILES,
  TEST_VIDEO_FILES,
  parseSharedTestMedia,
  sharedTestMediaForSource,
  updateTestMediaSearch,
  type SharedTestMedia,
} from "utils/testMediaShare";

import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

const testAssetUrl = (kind: "image" | "video", file: string) =>
  `${import.meta.env.BASE_URL}test-assets/${kind}/${file}`;

const TEST_IMAGE_ASSETS = TEST_IMAGE_FILES.map((file) => testAssetUrl("image", file));
const TEST_VIDEO_ASSETS = TEST_VIDEO_FILES.map((file) => testAssetUrl("video", file));

const pickRandom = <T,>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

const pickRandomDifferent = <T,>(items: T[], previous?: T | null): T => {
  if (items.length <= 1 || previous == null) return pickRandom(items);
  const choices = items.filter(item => item !== previous);
  return pickRandom(choices.length > 0 ? choices : items);
};

const DEFAULT_TEST_IMAGE_ASSET = testAssetUrl("image", "pepper.png");
const DEFAULT_TEST_VIDEO_ASSET = testAssetUrl("video", "akiyo.mp4");
const basename = (path: string) => path.split("/").pop() || path;
const syncSharedTestMediaUrl = (kind: "image" | "video" | null, src?: string) => {
  const media = kind && src ? sharedTestMediaForSource(kind, src) : null;
  const search = updateTestMediaSearch(window.location.search, media);
  const next = `${window.location.pathname}${search}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) history.replaceState(null, "", next);
};
const DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH = 250;
const FULLSCREEN_CURSOR_IDLE_MS = 1500;
const DEFAULT_INPUT_WINDOW_POSITION = { x: 340, y: 10 };
const DEFAULT_OUTPUT_WINDOW_POSITION = { x: 660, y: 20 };
type WorkspaceLayout = "docked" | "floating" | "output";
type WorkbenchTask = "source" | "compose" | "adjust" | "preview" | "export";

const WORKBENCH_TASKS: ReadonlyArray<{
  id: WorkbenchTask;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "source",
    label: "Source",
    title: "Choose source media",
    description: "Load an image or video, then prepare its size and playback.",
  },
  {
    id: "compose",
    label: "Compose",
    title: "Build the filter chain",
    description: "Choose a look, add stages, and arrange the processing order.",
  },
  {
    id: "adjust",
    label: "Adjust",
    title: "Tune the active stage",
    description: "Refine parameters and input processing for the selected filter.",
  },
  {
    id: "preview",
    label: "Preview",
    title: "Review the output",
    description: "Check the result, compare it with the source, and set output scaling.",
  },
  {
    id: "export",
    label: "Export",
    title: "Export the result",
    description: "Choose a still or video format and save the finished work.",
  },
];

const secondsToBpm = (seconds: number) => 240 / seconds;
const bpmToSeconds = (bpm: number) => 240 / bpm;
const isBundledTestVideoSource = (src: string | null | undefined) => {
  if (!src) return false;
  try {
    const normalizedSrc = new URL(src, window.location.href).href;
    return TEST_VIDEO_ASSETS.some((assetSrc) => new URL(assetSrc, window.location.href).href === normalizedSrc);
  } catch {
    return TEST_VIDEO_ASSETS.includes(src);
  }
};
const getAnchoredDialogPosition = (
  anchorRect: DOMRect | undefined,
  fallback: { x: number; y: number },
  estimatedSize: { width: number; height: number },
) => {
  if (!anchorRect) return fallback;
  return {
    x: Math.min(Math.max(16, anchorRect.left - 24), Math.max(16, window.innerWidth - estimatedSize.width - 16)),
    y: Math.min(Math.max(16, anchorRect.bottom + 8), Math.max(16, window.innerHeight - estimatedSize.height - 16)),
  };
};

type PreviousCanvasProps = {
  inputImage?: CanvasImageSource | null;
  outputImage?: CanvasImageSource | null;
  scale?: number;
  time?: number | null;
};
const TEST_IMAGE_OPTIONS = TEST_IMAGE_ASSETS.map((src) => ({ value: src, label: basename(src) }));
const TEST_VIDEO_OPTIONS = TEST_VIDEO_ASSETS.map((src) => ({ value: src, label: basename(src) }));
const cloneImageToCanvas = (image: CanvasImageSource & {
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
}) => {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = createReadbackCanvas(width, height);
  const ctx = getReadbackContext(canvas);
  if (ctx) ctx.drawImage(image, 0, 0, width, height);
  return canvas;
};

type ScreensaverMediaRestore = {
  filename: string | null;
  sharedMedia: SharedTestMedia | null;
  wasRandomTestVideo: boolean;
} & (
  | { kind: "image"; image: HTMLCanvasElement }
  | {
      kind: "video";
      source: string | File;
      time: number;
      paused: boolean;
      volume: number;
      playbackRate: number;
    }
);

type ScreensaverRestore = {
  fullscreenMode: "contain" | "cover";
  scale: number;
  scalingAlgorithm: string;
  media: Promise<ScreensaverMediaRestore | null>;
};

const formatVideoTime = (seconds?: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const InfoHint = ({ text }: { text: string }) => <HelpHint label="this setting" text={text} />;

const INPUT_SCALE_HELP = "Scales the source image or video before filtering. Lower values reduce processing cost; higher values give the filter more pixels to work with.";
const OUTPUT_SCALE_HELP = "Scales the rendered output view. This changes display size only and does not change how the filter itself processes the source.";
const SCALING_ALGORITHM_HELP = "Controls how enlarged canvases are drawn on screen. Auto uses smooth browser scaling; Pixelated keeps hard nearest-neighbor edges.";
const GRAYSCALE_HELP = "Converts the source to grayscale before the chain runs. Useful for monochrome dithers or filters that should ignore color.";
const GAMMA_HELP = "Runs the pipeline in gamma-correct space for more perceptually accurate blending and brightness. It can look better, but may change results and cost a bit more work.";
const FIX_INPUT_WIDTH_HELP = "Keeps the current input scale when loading a new image or video so the visible canvas width stays steadier during source swaps.";
type AudioMetricSection = {
  key: string;
  label: string;
  defaultOpen: boolean;
  metrics: Array<{ value: AudioVizMetric; label: string }>;
};

const AUDIO_METRIC_SECTIONS: AudioMetricSection[] = [
  {
    key: "tempo",
    label: "Tempo & rhythm",
    defaultOpen: true,
    metrics: [
      { value: "bpm", label: "BPM" },
      { value: "beat", label: "Beat" },
      { value: "beatHold", label: "Beat hold" },
      { value: "barBeat", label: "Bar beat" },
      { value: "barPhase", label: "Bar phase" },
      { value: "tempoPhase", label: "Tempo phase" },
      { value: "beatConfidence", label: "Beat confidence" },
    ],
  },
  {
    key: "loudness",
    label: "Loudness & transients",
    defaultOpen: true,
    metrics: [
      { value: "level", label: "Level" },
      { value: "pulse", label: "Pulse" },
      { value: "onset", label: "Onset" },
      { value: "peakDecay", label: "Peak decay" },
      { value: "subKick", label: "Sub kick" },
    ],
  },
  {
    key: "bands",
    label: "Bands (raw)",
    defaultOpen: false,
    metrics: [
      { value: "bass", label: "Bass" },
      { value: "mid", label: "Mid" },
      { value: "treble", label: "Treble" },
    ],
  },
  {
    key: "envelopes",
    label: "Bands (smoothed)",
    defaultOpen: false,
    metrics: [
      { value: "bassEnvelope", label: "Bass envelope" },
      { value: "midEnvelope", label: "Mid envelope" },
      { value: "trebleEnvelope", label: "Treble envelope" },
    ],
  },
  {
    key: "character",
    label: "Character",
    defaultOpen: false,
    metrics: [
      { value: "percussive", label: "Percussive" },
      { value: "harmonic", label: "Harmonic" },
      { value: "roughness", label: "Roughness" },
      { value: "spectralCentroid", label: "Spectral centroid" },
      { value: "spectralFlux", label: "Spectral flux" },
      { value: "bandRatio", label: "Band ratio" },
      { value: "zeroCrossing", label: "Zero crossing" },
    ],
  },
  {
    key: "stereo",
    label: "Stereo",
    defaultOpen: false,
    metrics: [
      { value: "stereoWidth", label: "Stereo width" },
      { value: "stereoBalance", label: "Stereo balance" },
    ],
  },
];

const AUDIO_METRIC_OPTIONS: Array<{ value: AudioVizMetric; label: string }> =
  AUDIO_METRIC_SECTIONS.flatMap((section) => section.metrics);
const AUDIO_METRIC_HELP: Record<AudioVizMetric, string> = {
  level: "Overall RMS loudness of the incoming audio.",
  bass: "Low-frequency energy. Good for heavier, slower modulation.",
  mid: "Mid-band energy from the incoming audio.",
  treble: "High-frequency energy. Good for crispness and fine detail changes.",
  pulse: "Short-term loudness spike relative to recent average level.",
  beat: "A short beat trigger pulse when the detector thinks a beat just hit.",
  bpm: "Detected tempo in beats per minute.",
  beatHold: "A slower-decaying version of the beat trigger.",
  onset: "Transient detection. Good for hits, attacks, and sudden changes.",
  spectralCentroid: "Perceived brightness of the sound from dark to bright.",
  spectralFlux: "How much the spectrum changed since the last frame.",
  bandRatio: "Low-band energy relative to high-band energy.",
  stereoWidth: "Difference between left and right channels.",
  stereoBalance: "Left/right energy balance.",
  zeroCrossing: "Noisiness or high-frequency sign-change rate in the waveform.",
  subKick: "Very low-end energy, useful for kick and sub movement.",
  bassEnvelope: "Smoothed low-frequency energy.",
  midEnvelope: "Smoothed mid-frequency energy.",
  trebleEnvelope: "Smoothed high-frequency energy.",
  peakDecay: "A falling peak meter that holds louder moments briefly.",
  roughness: "A harshness/noise-style metric from treble and zero crossings.",
  harmonic: "Bias toward more tonal, sustained content.",
  percussive: "Bias toward more transient, percussive content.",
  tempoPhase: "Looping phase between detected beats.",
  barPhase: "Looping phase across one 4-beat bar, anchored to the detected downbeat.",
  barBeat: "Which beat of the bar (0, 0.33, 0.66, 1) based on detected downbeat.",
  beatConfidence: "How stable the current beat detection seems.",
};
const DEFAULT_AUDIO_METRIC_WEIGHT = 0.5;
const AUDIO_METRIC_WEIGHT_MIN = -30;
const AUDIO_METRIC_WEIGHT_MAX = 30;
const AUDIO_VIZ_BPM_OVERRIDE_MIN = 40;
const AUDIO_VIZ_BPM_OVERRIDE_MAX = 240;
const AUDIO_VIZ_BPM_OVERRIDE_DEFAULT = 120;
type AutoVizMode = "balanced" | "punchy" | "flow" | "chaotic";
const AUTO_VIZ_MODES: Array<{ value: AutoVizMode; label: string }> = [
  { value: "balanced", label: "Balanced" },
  { value: "punchy", label: "Punchy" },
  { value: "flow", label: "Flow" },
  { value: "chaotic", label: "Chaotic" },
];
type AudioPatchTargetOption = {
  label?: string;
  optionName?: string;
  targetLabel?: string;
  range?: number[];
  step?: number;
  type?: string;
  visibleWhen?: ((options: Record<string, unknown>) => boolean) | undefined;
};
const buildAudioConnectionDraft = (modulation: EntryAudioModulation | GlobalAudioVizModulation | null | undefined) =>
  (modulation?.connections ?? []).map((connection) => ({ ...connection }));
const buildNormalizedMetricsDraft = (modulation: EntryAudioModulation | GlobalAudioVizModulation | null | undefined) =>
  [...(modulation?.normalizedMetrics ?? [])];

const meterStyle = (value: number) => ({ width: `${Math.max(4, Math.round(value * 100))}%` });
// Auto-viz logic lives in src/utils/autoViz.ts so it can be unit tested
// without spinning up the full App component.
const formatAudioMetricReadout = (
  snapshot: ReturnType<typeof getChannelAudioVizSnapshot>,
  metric: AudioVizMetric,
  value: number,
) => {
  if (metric === "bpm") {
    return snapshot.detectedBpm != null
      ? `${Math.round(snapshot.detectedBpm)} BPM${snapshot.bpmOverride != null ? " override" : ""}`
      : "-- BPM";
  }
  return `${Math.round(value * 100)}%`;
};

export const ScreensaverDebugOverlay = ({
  chain,
  activeIndex,
  chainSwapSeconds,
  videoSwapEnabled,
  videoSwapSeconds,
}: {
  chain: Array<{ id: string; displayName: string; enabled: boolean }>;
  activeIndex: number;
  chainSwapSeconds: number | null;
  videoSwapEnabled: boolean;
  videoSwapSeconds: number | null;
}) => {
  const [snapshot, setSnapshot] = useState(() => getChannelAudioVizSnapshot("screensaver"));
  const [, setNow] = useState(() => performance.now());

  useEffect(() => subscribeAudioViz((ch) => {
    if (ch === "screensaver") setSnapshot(getChannelAudioVizSnapshot("screensaver"));
  }), []);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      setNow(performance.now());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const modulation = getGlobalAudioVizModulation("screensaver");
  const tempoLabel: Record<string, string> = {
    idle: "idle",
    warmup: `warming up ${Math.round(snapshot.tempoWarmupProgress * 100)}%`,
    silent: "signal too quiet",
    searching: "searching",
    locked: "locked",
  };
  const levelPct = Math.round(Math.min(1, Math.max(0, snapshot.rawMetrics.level ?? 0)) * 100);
  const beatConfidencePct = Math.round(Math.min(1, Math.max(0, snapshot.rawMetrics.beatConfidence ?? 0)) * 100);

  const now = performance.now();
  const formatCountdown = (interval: number | null, lastAt: number | null) => {
    if (interval == null || interval <= 0) return "--";
    if (lastAt == null) return `~${interval.toFixed(2)}s`;
    const elapsed = (now - lastAt) / 1000;
    const remaining = Math.max(0, interval - elapsed);
    return `${remaining.toFixed(2)}s / ${interval.toFixed(2)}s`;
  };
  const progressBar = (interval: number | null, lastAt: number | null) => {
    if (interval == null || interval <= 0) return null;
    const elapsed = lastAt != null ? (now - lastAt) / 1000 : 0;
    const ratio = Math.max(0, Math.min(1, elapsed / interval));
    return (
      <div style={{ height: 3, background: "rgba(255,255,255,0.15)", marginTop: 2 }}>
        <div style={{ height: "100%", width: `${ratio * 100}%`, background: "#6cf" }} />
      </div>
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        padding: "6px 10px",
        background: "rgba(0,0,0,0.72)",
        color: "#fff",
        font: "11px/1.4 'Courier New', monospace",
        pointerEvents: "none",
        zIndex: 10,
        borderRadius: 3,
        minWidth: 220,
        maxWidth: 360,
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 4, color: "#6cf" }}>Screensaver debug</div>

      <div style={{ marginBottom: 4 }}>
        <div style={{ color: "#aaa" }}>audio</div>
        <div>{snapshot.enabled ? snapshot.source : "off"} / {snapshot.status} / level {levelPct}%</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span>bpm</span>
          <AudioBpmReadout channel="screensaver" snapshot={snapshot} showUnit={false} compact />
          <span>/ {tempoLabel[snapshot.tempoStatus] ?? snapshot.tempoStatus} / conf {beatConfidencePct}%</span>
        </div>
        <div style={{ marginTop: 2 }}>
          <AudioBeatStrip channel="screensaver" boxes={8} height={8} />
        </div>
      </div>

      <div style={{ marginBottom: 4 }}>
        <div style={{ color: "#aaa" }}>chain swap</div>
        <div>next {formatCountdown(chainSwapSeconds, getLastScreensaverChainSwapAt())}</div>
        {progressBar(chainSwapSeconds, getLastScreensaverChainSwapAt())}
      </div>

      {videoSwapEnabled && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ color: "#aaa" }}>video swap</div>
          <div>next {formatCountdown(videoSwapSeconds, getLastScreensaverVideoSwapAt())}</div>
          {progressBar(videoSwapSeconds, getLastScreensaverVideoSwapAt())}
        </div>
      )}

      <div style={{ marginBottom: 4 }}>
        <div style={{ color: "#aaa" }}>chain ({chain.length})</div>
        {chain.length === 0 ? (
          <div style={{ opacity: 0.6 }}>(empty)</div>
        ) : chain.map((entry, idx) => (
          <div
            key={entry.id}
            style={{
              color: idx === activeIndex ? "#ffd166" : entry.enabled ? "#fff" : "rgba(255,255,255,0.45)",
              fontWeight: idx === activeIndex ? "bold" : "normal",
            }}
          >
            {idx === activeIndex ? "> " : "  "}{entry.displayName}{!entry.enabled ? " (off)" : ""}
          </div>
        ))}
      </div>

      <div>
        <div style={{ color: "#aaa" }}>patches ({modulation?.connections.length ?? 0})</div>
        {(!modulation || modulation.connections.length === 0) ? (
          <div style={{ opacity: 0.6 }}>(none)</div>
        ) : modulation.connections.map((conn, idx) => {
          const live = (snapshot.rawMetrics[conn.metric] ?? 0) * conn.weight;
          return (
            <div key={idx} style={{ display: "flex", gap: 4 }}>
              <span style={{ flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {conn.metric} {"->"} {conn.target}
              </span>
              <span style={{ flex: "0 0 auto", color: "#6cf" }}>
                {Math.round(conn.weight * 100)}% ({Math.round(live * 100)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AudioPatchPanel = ({
  channel,
  rangeOptions,
  optionValues,
  connections,
  normalizedMetrics,
  onNormalizedMetricsChange,
  onConnectionsChange,
  autoVizMode,
  onAutoVizModeChange,
  autoVizOnChainChange,
  onAutoVizOnChainChange,
  collapsibleBody = false,
  bodyDefaultOpen = true,
  bodyTitle = "Patch panel",
}: {
  channel: "chain" | "screensaver";
  rangeOptions: Array<readonly [string, AudioPatchTargetOption]>;
  optionValues: Record<string, unknown>;
  connections: AudioVizConnection[];
  normalizedMetrics: AudioVizMetric[];
  onNormalizedMetricsChange: (metrics: AudioVizMetric[]) => void;
  onConnectionsChange: (connections: AudioVizConnection[]) => void;
  autoVizMode?: AutoVizMode;
  onAutoVizModeChange?: (mode: AutoVizMode) => void;
  autoVizOnChainChange?: boolean;
  onAutoVizOnChainChange?: (enabled: boolean) => void;
  collapsibleBody?: boolean;
  bodyDefaultOpen?: boolean;
  bodyTitle?: string;
}) => {
  const [snapshot, setSnapshot] = useState(() => getChannelAudioVizSnapshot(channel));
  const [localAutoVizMode, setLocalAutoVizMode] = useState<AutoVizMode>("balanced");
  const [bodyOpen, setBodyOpen] = useState(bodyDefaultOpen);
  const [draggingMetric, setDraggingMetric] = useState<AudioVizMetric | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const [hoveredMetricJack, setHoveredMetricJack] = useState<AudioVizMetric | null>(null);
  const [hoveredTargetName, setHoveredTargetName] = useState<string | null>(null);
  const [hoveredConnectionKey, setHoveredConnectionKey] = useState<string | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<{
    connection: AudioVizConnection;
    startY: number;
    startWeight: number;
    moved: boolean;
  } | null>(null);
  const connectionDragRef = useRef<typeof connectionDrag>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const metricRefs = useRef<Partial<Record<AudioVizMetric, HTMLButtonElement | null>>>({});
  const targetRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [nodeRects, setNodeRects] = useState<{
    metrics: Partial<Record<AudioVizMetric, { x: number; y: number }>>;
    targets: Record<string, { x: number; y: number }>;
  }>({ metrics: {}, targets: {} });

  useEffect(() => subscribeAudioViz((changedChannel) => {
    if (changedChannel === channel) {
      setSnapshot(getChannelAudioVizSnapshot(channel));
    }
  }), [channel]);

  useEffect(() => {
    connectionDragRef.current = connectionDrag;
  }, [connectionDrag]);

  const measureNodes = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const metrics = Object.fromEntries(
      AUDIO_METRIC_OPTIONS.flatMap((option) => {
        const element = metricRefs.current[option.value];
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        return [[option.value, {
          x: rect.left - panelRect.left + rect.width / 2 + panel.scrollLeft,
          y: rect.top - panelRect.top + rect.height / 2 + panel.scrollTop,
        }]];
      }),
    ) as Partial<Record<AudioVizMetric, { x: number; y: number }>>;
    const targets = Object.fromEntries(
      rangeOptions.flatMap(([optionName]) => {
        const element = targetRefs.current[optionName];
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        return [[optionName, {
          x: rect.left - panelRect.left + rect.width / 2 + panel.scrollLeft,
          y: rect.top - panelRect.top + rect.height / 2 + panel.scrollTop,
        }]];
      }),
    );
    setNodeRects({ metrics, targets });
  }, [rangeOptions]);

  useEffect(() => {
    measureNodes();
  }, [connections, measureNodes, rangeOptions, snapshot.metrics]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const handle = () => measureNodes();
    const resizeObserver = new ResizeObserver(handle);
    resizeObserver.observe(panel);
    panel.addEventListener("scroll", handle, { passive: true });
    window.addEventListener("resize", handle);
    return () => {
      resizeObserver.disconnect();
      panel.removeEventListener("scroll", handle);
      window.removeEventListener("resize", handle);
    };
  }, [measureNodes]);

  useEffect(() => {
    if (!draggingMetric) return undefined;
    const handleMove = (event: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      setDragPointer({
        x: event.clientX - rect.left + panel.scrollLeft,
        y: event.clientY - rect.top + panel.scrollTop,
      });
    };
    const handleUp = () => {
      setDraggingMetric(null);
      setDragPointer(null);
      setHoveredTargetName(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingMetric]);

  const connectedTargets = new Set(connections.map((connection) => connection.target));
  const connectedMetrics = new Set(connections.map((connection) => connection.metric));
  const normalizedMetricSet = new Set(normalizedMetrics);
  const hoveredConnection = hoveredConnectionKey
    ? connections.find((connection) => `${connection.metric}:${connection.target}` === hoveredConnectionKey) ?? null
    : null;
  const modulationByTarget = new Map<string, number>();
  for (const connection of connections) {
    modulationByTarget.set(
      connection.target,
      (modulationByTarget.get(connection.target) ?? 0)
        + getAudioVizMetricValueForMode(snapshot, connection.metric, snapshot.normalize || normalizedMetricSet.has(connection.metric)) * connection.weight,
    );
  }

  const setConnectionWeight = useCallback((connection: AudioVizConnection) => {
    const currentPercent = Math.round(connection.weight * 100);
    const response = window.prompt("Influence %", String(currentPercent));
    if (response == null) return;
    const nextPercent = Number.parseFloat(response);
    if (!Number.isFinite(nextPercent)) {
      window.alert("Please enter a number.");
      return;
    }
    onConnectionsChange(
      connections.map((item) =>
        item.metric === connection.metric && item.target === connection.target
          ? { ...item, weight: nextPercent / 100 }
          : item),
    );
  }, [connections, onConnectionsChange]);

  const removeConnection = useCallback((connection: AudioVizConnection) => {
    onConnectionsChange(
      connections.filter((item) => !(item.metric === connection.metric && item.target === connection.target)),
    );
  }, [connections, onConnectionsChange]);

  const toggleConnection = useCallback((metric: AudioVizMetric, target: string) => {
    const existing = connections.find((connection) => connection.metric === metric && connection.target === target);
    if (existing) {
      onConnectionsChange(connections.filter((connection) => !(connection.metric === metric && connection.target === target)));
      return;
    }
    onConnectionsChange([...connections, { metric, target, weight: DEFAULT_AUDIO_METRIC_WEIGHT }]);
  }, [connections, onConnectionsChange]);

  const updateConnectionWeight = useCallback((connection: AudioVizConnection, weight: number) => {
    const nextWeight = Math.max(AUDIO_METRIC_WEIGHT_MIN, Math.min(AUDIO_METRIC_WEIGHT_MAX, weight));
    onConnectionsChange(
      connections.map((item) =>
        item.metric === connection.metric && item.target === connection.target
          ? { ...item, weight: nextWeight }
          : item),
    );
  }, [connections, onConnectionsChange]);

  useEffect(() => {
    if (!connectionDrag) return undefined;

    const handleMove = (event: MouseEvent) => {
      const activeDrag = connectionDragRef.current;
      if (!activeDrag) return;
      const deltaY = activeDrag.startY - event.clientY;
      const nextWeight = activeDrag.startWeight + deltaY * 0.02;
      if (Math.abs(deltaY) > 3) {
        if (!activeDrag.moved) {
          const movedDrag = { ...activeDrag, moved: true };
          connectionDragRef.current = movedDrag;
          setConnectionDrag(movedDrag);
        }
      }
      updateConnectionWeight(activeDrag.connection, nextWeight);
    };

    const handleUp = () => {
      const activeDrag = connectionDragRef.current;
      connectionDragRef.current = null;
      setConnectionDrag(null);
      document.body.style.cursor = "";
      if (!activeDrag) return;
      if (!activeDrag.moved) {
        setConnectionWeight(activeDrag.connection);
      }
    };

    document.body.style.cursor = "ns-resize";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [connectionDrag, setConnectionWeight, updateConnectionWeight]);

  const startConnectionWeightDrag = useCallback((event: React.MouseEvent<SVGElement>, connection: AudioVizConnection) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setConnectionDrag({
      connection,
      startY: event.clientY,
      startWeight: connection.weight,
      moved: false,
    });
  }, []);

  const [density, setDensity] = useState(0);
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(AUDIO_METRIC_SECTIONS.map((section) => [section.key, section.defaultOpen])));
  const toggleSection = useCallback((key: string) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const [, setRafTick] = useState(0);
  useEffect(() => {
    let id: number;
    const tick = () => {
      setRafTick((value) => (value + 1) % 1_000_000);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  const applyAutoViz = useCallback((mode: AutoVizMode) => {
    const effectiveDensity = density > 0 ? density : null;
    const next = buildAutoVizConnections(mode, rangeOptions, connections, effectiveDensity);
    onConnectionsChange(next.connections);
    onNormalizedMetricsChange(next.normalizedMetrics);
  }, [connections, density, onConnectionsChange, onNormalizedMetricsChange, rangeOptions]);
  const resolvedAutoVizMode = autoVizMode ?? localAutoVizMode;
  const setResolvedAutoVizMode = onAutoVizModeChange ?? setLocalAutoVizMode;
  const [showAutoVizSettings, setShowAutoVizSettings] = useState(true);
  const bpmOverrideEnabled = snapshot.bpmOverride != null && snapshot.bpmOverride > 0;
  const bpmOverrideSliderValue = Math.round(
    Math.max(
      AUDIO_VIZ_BPM_OVERRIDE_MIN,
      Math.min(
        AUDIO_VIZ_BPM_OVERRIDE_MAX,
        snapshot.bpmOverride ?? snapshot.detectedBpm ?? AUDIO_VIZ_BPM_OVERRIDE_DEFAULT,
      ),
    ),
  );

  return (
    <div
      ref={panelRef}
      className={[
        s.audioPatchPanel,
        collapsibleBody && !bodyOpen ? s.audioPatchPanelCollapsed : "",
      ].join(" ")}
    >
      <div className={s.audioPatchToolbar}>
        <span className={s.audioPatchToolbarLabel}>Auto Viz</span>
        <select
          className={s.audioPatchToolbarSelect}
          aria-label="Auto Viz mode"
          value={resolvedAutoVizMode}
          onChange={(event) => setResolvedAutoVizMode(event.target.value as AutoVizMode)}
        >
          {AUTO_VIZ_MODES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className={s.audioPatchToolbarButton}
          type="button"
          onClick={() => applyAutoViz(resolvedAutoVizMode)}
          disabled={rangeOptions.length === 0}
          title="Reroll metric-to-parameter cables for the selected mode."
        >
          Reroll
        </button>
        <button
          className={[s.audioPatchToolbarButton, showAutoVizSettings ? s.audioPatchToolbarButtonActive : ""].join(" ")}
          type="button"
          onClick={() => setShowAutoVizSettings((value) => !value)}
          title="Auto Viz settings"
          aria-label="Toggle auto viz settings"
        >
          ⚙
        </button>
      </div>
      {showAutoVizSettings && (
        <div className={s.audioPatchToolbarSettings}>
          <label
            className={s.audioPatchToolbarDensity}
            title="Fraction of available chain parameters to patch on each Reroll. Higher = more parameters wired up. Set to 0 to use the mode's default."
          >
            <span>
              Density
              <InfoHint text="Fraction of chain parameters that get patched per Reroll. Higher density = more cables. Each mode has a sensible default; nudge this if it feels too sparse or too busy." />
            </span>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.05"
              value={density}
              onChange={(event) => setDensity(Number(event.target.value))}
            />
            <span className={s.audioPatchToolbarDensityValue}>
              {density === 0 ? `auto (${Math.round(AUTO_VIZ_DENSITY[resolvedAutoVizMode] * 100)}%)` : `${Math.round(density * 100)}%`}
            </span>
          </label>
          {typeof autoVizOnChainChange === "boolean" && onAutoVizOnChainChange && (
            <label className={s.audioPatchToolbarCheck}>
              <input
                type="checkbox"
                checked={autoVizOnChainChange}
                onChange={(event) => onAutoVizOnChainChange(event.target.checked)}
              />
              <span>Refresh on chain change</span>
            </label>
          )}
        </div>
      )}
      {collapsibleBody && (
        <div className={s.audioPatchSubbar}>
          <button
            type="button"
            className={s.audioPatchCollapse}
            onClick={() => setBodyOpen((value) => !value)}
          >
            {bodyOpen ? "[-]" : "[+]"} {bodyTitle}
          </button>
        </div>
      )}
      {(!collapsibleBody || bodyOpen) && (
        <>
          <svg
            className={s.audioPatchSvg}
            aria-hidden="true"
            onMouseDown={(event) => {
              if (!hoveredConnection) return;
              startConnectionWeightDrag(event, hoveredConnection);
            }}
          >
            {connections.map((connection) => {
              const from = nodeRects.metrics[connection.metric];
              const to = nodeRects.targets[connection.target];
              if (!from || !to) return null;
              const connectionKey = `${connection.metric}:${connection.target}`;
              const hovered = hoveredConnectionKey === connectionKey;
              const basePercent = Math.round(connection.weight * 100);
              const liveMetric = snapshot.rawMetrics[connection.metric] ?? 0;
              const effectiveWeight = liveMetric * connection.weight;
              const effectivePercent = Math.round(effectiveWeight * 100);
              const effectiveMagnitude = Math.min(1, Math.abs(effectiveWeight));
              const midX = (from.x + to.x) / 2;
              const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
              const metricLabel = AUDIO_METRIC_OPTIONS.find((option) => option.value === connection.metric)?.label ?? connection.metric;
              const targetOption = rangeOptions.find(([optionName]) => optionName === connection.target)?.[1];
              const targetLabel = targetOption?.targetLabel || targetOption?.label || connection.target;
              const normalizedActive = snapshot.normalize || normalizedMetricSet.has(connection.metric);
              const tooltip = `${metricLabel} -> ${targetLabel}\nWeight: ${basePercent}% | Live: ${effectivePercent}%${normalizedActive ? " (normalized)" : ""}\nDrag to adjust, right-click to remove`;
              const isNegative = connection.weight < 0;
              const baseStroke = isNegative ? "#a0411e" : "#0f6da5";
              const hotStroke = isNegative ? "#ff9d3a" : "#7ad6ff";
              return (
                <g key={connectionKey}>
                  <path
                    className={s.audioPatchLineHit}
                    d={path}
                    onMouseDown={(event) => startConnectionWeightDrag(event, connection)}
                    onMouseEnter={() => setHoveredConnectionKey(connectionKey)}
                    onMouseLeave={() => setHoveredConnectionKey((current) => current === connectionKey ? null : current)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      removeConnection(connection);
                    }}
                  >
                    <title>{tooltip}</title>
                  </path>
                  <path
                    className={s.audioPatchLine}
                    d={path}
                    style={{
                      stroke: hovered ? "#ff7b22" : baseStroke,
                      strokeWidth: hovered ? 4 + effectiveMagnitude * 3 : 1.5 + effectiveMagnitude * 3,
                      opacity: hovered ? 1 : 0.4 + effectiveMagnitude * 0.6,
                    }}
                  >
                    <title>{tooltip}</title>
                  </path>
                  {effectiveMagnitude > 0.15 && (
                    <path
                      d={path}
                      fill="none"
                      stroke={hotStroke}
                      strokeWidth={1 + effectiveMagnitude * 5}
                      strokeLinecap="round"
                      style={{
                        opacity: Math.min(0.45, effectiveMagnitude * 0.6),
                        filter: "blur(2px)",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  <rect
                    className={s.audioPatchLabelHit}
                    x={midX - 34}
                    y={(from.y + to.y) / 2 - 19}
                    width="68"
                    height="26"
                    rx="4"
                    ry="4"
                    onMouseDown={(event) => startConnectionWeightDrag(event, connection)}
                    onMouseEnter={() => setHoveredConnectionKey(connectionKey)}
                    onMouseLeave={() => setHoveredConnectionKey((current) => current === connectionKey ? null : current)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      removeConnection(connection);
                    }}
                  >
                    <title>{tooltip}</title>
                  </rect>
                  <text
                    className={[s.audioPatchLabel, hovered ? s.audioPatchLabelHovered : ""].join(" ")}
                    x={midX}
                    y={(from.y + to.y) / 2 - 6}
                    textAnchor="middle"
                    onMouseDown={(event) => startConnectionWeightDrag(event, connection)}
                    onMouseEnter={() => setHoveredConnectionKey(connectionKey)}
                    onMouseLeave={() => setHoveredConnectionKey((current) => current === connectionKey ? null : current)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      removeConnection(connection);
                    }}
                  >
                    <title>{tooltip}</title>
                    {basePercent}%
                  </text>
                </g>
              );
            })}
            {draggingMetric && dragPointer && nodeRects.metrics[draggingMetric] && (
              <path
                className={s.audioPatchLinePreview}
                d={`M ${nodeRects.metrics[draggingMetric]!.x} ${nodeRects.metrics[draggingMetric]!.y} C ${(nodeRects.metrics[draggingMetric]!.x + dragPointer.x) / 2} ${nodeRects.metrics[draggingMetric]!.y}, ${(nodeRects.metrics[draggingMetric]!.x + dragPointer.x) / 2} ${dragPointer.y}, ${dragPointer.x} ${dragPointer.y}`}
              />
            )}
          </svg>
          <div className={s.audioPatchColumns}>
        <div className={s.audioPatchLeft}>
          {AUDIO_METRIC_SECTIONS.map((section) => {
            const open = sectionsOpen[section.key] ?? section.defaultOpen;
            const activeInSection = section.metrics.filter((m) => connectedMetrics.has(m.value));
            const visibleMetrics = open ? section.metrics : activeInSection;
            return (
              <div key={section.key} className={s.audioPatchSection}>
                <button
                  type="button"
                  className={[s.audioPatchSectionHeader, open ? s.audioPatchSectionHeaderOpen : ""].join(" ")}
                  onClick={() => toggleSection(section.key)}
                  aria-expanded={open}
                >
                  <span className={s.audioPatchSectionCaret}>{open ? "▾" : "▸"}</span>
                  <span className={[s.audioPatchSectionLabel, controls.subsectionHeader].join(" ")}>{section.label}</span>
                  <span className={s.audioPatchSectionCount}>
                    {activeInSection.length > 0 ? `${activeInSection.length} on` : `${section.metrics.length}`}
                  </span>
                </button>
                {visibleMetrics.map((option) => {
              const metricValue = getAudioVizMetricValueForMode(
                snapshot,
                option.value,
                snapshot.normalize || normalizedMetricSet.has(option.value),
              );
              return (
                <div
                  key={option.value}
                  className={[
                    s.audioPatchNode,
                    option.value === "bpm" ? s.audioPatchNodeBpm : "",
                    connectedMetrics.has(option.value) ? s.audioPatchNodeActive : "",
                    hoveredMetricJack === option.value ? s.audioPatchNodeHover : "",
                  ].join(" ")}
                >
                  <div className={s.audioPatchNodeGrid}>
                    <span className={s.audioPatchNodeLabel}>
                      {option.label}
                      <InfoHint text={AUDIO_METRIC_HELP[option.value]} />
                      {option.value === "bpm" && (() => {
                        let text: string | null = null;
                        let severity: "warn" | "info" = "info";
                        if (!snapshot.enabled) {
                          text = "Audio input disabled — enable above to detect tempo.";
                        } else if (snapshot.status === "connecting") {
                          text = "Connecting to audio source...";
                        } else if (snapshot.status === "error") {
                          text = `Audio error: ${snapshot.error ?? "unknown"}`;
                          severity = "warn";
                        } else if (!bpmOverrideEnabled) {
                          if (snapshot.tempoStatus === "warmup") {
                            text = `Warming up (${Math.round(snapshot.tempoWarmupProgress * 100)}%) — needs ~5s of audio to lock tempo.`;
                          } else if (snapshot.tempoStatus === "silent") {
                            text = "Signal too quiet for tempo lock. Raise input level or pick a louder source.";
                            severity = "warn";
                          } else if (snapshot.tempoStatus === "searching") {
                            text = "Searching for tempo — no strong periodic beat yet.";
                          }
                        }
                        const visible = text != null;
                        return (
                          <span
                            className={[
                              severity === "warn" ? s.audioPatchBpmBadgeWarn : s.audioPatchBpmBadge,
                              visible ? "" : s.audioPatchBpmBadgeHidden,
                            ].join(" ")}
                            title={text ?? ""}
                            aria-label={text ?? ""}
                            aria-hidden={visible ? undefined : true}
                          >
                            !
                          </span>
                        );
                      })()}
                    </span>
                    <span className={s.audioPatchMetricValue}>
                      {option.value === "bpm"
                        ? <AudioBpmReadout channel={channel} snapshot={snapshot} />
                        : formatAudioMetricReadout(snapshot, option.value, metricValue)}
                    </span>
                    <div className={s.audioPatchNodeMeta}>
                      {connections.filter((connection) => connection.metric === option.value).length || 0} outs
                    </div>
                    <button
                      ref={(element) => { metricRefs.current[option.value] = element; }}
                      className={[
                        s.audioPatchJack,
                        hoveredMetricJack === option.value ? s.audioPatchJackHover : "",
                      ].join(" ")}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraggingMetric(option.value);
                        const panel = panelRef.current;
                        if (panel) {
                          const rect = panel.getBoundingClientRect();
                          setDragPointer({
                            x: event.clientX - rect.left + panel.scrollLeft,
                            y: event.clientY - rect.top + panel.scrollTop,
                          });
                        }
                      }}
                      onMouseEnter={() => setHoveredMetricJack(option.value)}
                      onMouseLeave={() => setHoveredMetricJack((current) => current === option.value ? null : current)}
                      title={`Patch ${option.label}`}
                    />
                    {option.value === "bpm" ? (
                      <div className={s.audioPatchBeatStripSlot}>
                        <AudioBeatStrip channel={channel} boxes={4} height={8} />
                      </div>
                    ) : (
                      <div className={s.audioPatchMeter}>
                        <div className={s.audioPatchMeterFill} style={meterStyle(metricValue)} />
                      </div>
                    )}
                    {option.value === "bpm" && (
                      <div className={s.audioPatchBpmControls}>
                        <div className={s.audioPatchBpmControlsTop}>
                          <label className={s.audioPatchBpmToggle}>
                            <input
                              type="checkbox"
                              checked={bpmOverrideEnabled}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                void updateAudioVizChannel(channel, {
                                  bpmOverride: checked
                                    ? bpmOverrideSliderValue
                                    : null,
                                });
                              }}
                            />
                            <span>Override</span>
                          </label>
                          <span className={s.audioPatchBpmSliderValue}>
                            {bpmOverrideEnabled ? `${bpmOverrideSliderValue} BPM` : "Auto"}
                          </span>
                          <button
                            type="button"
                            className={s.audioPatchBpmReset}
                            onClick={() => tapDownbeat(channel)}
                            title="Tap on felt beat 1 to realign the bar phase."
                          >
                            Tap
                          </button>
                          <button
                            type="button"
                            className={s.audioPatchBpmReset}
                            onClick={() => {
                              void resetAudioVizTempo(channel, { clearOverride: true });
                            }}
                          >
                            Reset
                          </button>
                        </div>
                        {bpmOverrideEnabled && (
                          <input
                            className={s.audioPatchBpmSlider}
                            type="range"
                            aria-label="BPM override"
                            min={AUDIO_VIZ_BPM_OVERRIDE_MIN}
                            max={AUDIO_VIZ_BPM_OVERRIDE_MAX}
                            step="1"
                            value={bpmOverrideSliderValue}
                            onChange={(event) => {
                              void updateAudioVizChannel(channel, {
                                bpmOverride: Number(event.target.value),
                              });
                            }}
                          />
                        )}
                      </div>
                    )}
                    <label className={s.audioPatchNormalize}>
                      <input
                        type="checkbox"
                        checked={normalizedMetricSet.has(option.value)}
                        onChange={(event) => onNormalizedMetricsChange(
                          event.target.checked
                            ? (normalizedMetricSet.has(option.value) ? normalizedMetrics : [...normalizedMetrics, option.value])
                            : normalizedMetrics.filter((item) => item !== option.value),
                        )}
                      />
                      <span>Normalize</span>
                    </label>
                  </div>
                </div>
              );
            })}
              </div>
            );
          })}
        </div>
        <div className={s.audioPatchRight}>
          {rangeOptions.length > 0 ? rangeOptions.map(([optionName, optionType]) => (
            <div
              key={optionName}
              className={[
                s.audioPatchTarget,
                connectedTargets.has(optionName) ? s.audioPatchTargetActive : "",
                draggingMetric ? s.audioPatchTargetDroppable : "",
                hoveredTargetName === optionName ? s.audioPatchTargetHover : "",
              ].join(" ")}
              onMouseUp={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!draggingMetric) return;
                toggleConnection(draggingMetric, optionName);
                setDraggingMetric(null);
                setDragPointer(null);
                setHoveredTargetName(null);
              }}
              onMouseEnter={() => setHoveredTargetName(optionName)}
              onMouseLeave={() => setHoveredTargetName((current) => current === optionName ? null : current)}
            >
              <button
                ref={(element) => { targetRefs.current[optionName] = element; }}
                className={[
                  s.audioPatchJack,
                  draggingMetric ? s.audioPatchJackDroppable : "",
                  hoveredTargetName === optionName ? s.audioPatchJackHover : "",
                ].join(" ")}
                title={`Patch to ${optionType.targetLabel || optionType.label || optionName}`}
              />
              <div className={s.audioPatchTargetBody}>
                <span className={s.audioPatchTargetLabel}>{optionType.targetLabel || optionType.label || optionName}</span>
                {Array.isArray((optionType as { range?: number[] }).range) && (() => {
                  const currentValue = Number(optionValues[optionName]);
                  if (!Number.isFinite(currentValue)) return null;
                  const [min, max] = (optionType as { range: number[] }).range;
                  const step = "step" in optionType && typeof optionType.step === "number" ? optionType.step : 0;
                  const span = max - min;
                  const modulated = currentValue + (modulationByTarget.get(optionName) ?? 0) * span;
                  const nextValue = step > 0 ? Math.round(modulated / step) * step : modulated;
                  return (
                    <span className={s.audioPatchTargetPreview}>
                      {currentValue.toFixed(step >= 1 ? 0 : 2).replace(/\.?0+$/, "")}
                      {" -> "}
                      {nextValue.toFixed(step >= 1 ? 0 : 2).replace(/\.?0+$/, "")}
                    </span>
                  );
                })()}
              </div>
            </div>
          )) : (
            <div className={s.screensaverHint}>No numeric range parameters are available to modulate.</div>
          )}
        </div>
          </div>
        </>
      )}
    </div>
  );
};

const App = () => {
  const { state, actions, filterList } = useFilter();
  const [dropping, setDropping] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("ditherer-theme") || "default");
  const [canvasDropping, setCanvasDropping] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [videoPaused, setVideoPaused] = useState(false);
  const [preserveInputWidthOnNewMedia, setPreserveInputWidthOnNewMedia] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [editingAudioEntryId, setEditingAudioEntryId] = useState<string | null>(null);
  const [showChainAudioGlobalEditor, setShowChainAudioGlobalEditor] = useState(false);
  const [playPauseIndicator, setPlayPauseIndicator] = useState<"play" | "pause" | null>(null);
  const [inputLoadingLabel, setInputLoadingLabel] = useState<string | null>(null);
  const [inputLoadError, setInputLoadError] = useState<string | null>(null);
  const [inputFilename, setInputFilename] = useState<string | null>(null);
  const [outputFullscreen, setOutputFullscreen] = useState(false);
  const [outputFullscreenMode, setOutputFullscreenMode] = useState<"contain" | "cover">("contain");
  const [fullscreenCursorHidden, setFullscreenCursorHidden] = useState(false);
  const [showFullscreenMenu, setShowFullscreenMenu] = useState(false);
  const [inputWindowPosition, setInputWindowPosition] = useState(DEFAULT_INPUT_WINDOW_POSITION);
  const [outputWindowPosition, setOutputWindowPosition] = useState(DEFAULT_OUTPUT_WINDOW_POSITION);
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(() =>
    (localStorage.getItem("ditherer-workspace-layout") as WorkspaceLayout | null) || "docked"
  );
  const [windowsLocked, setWindowsLocked] = useState(true);
  const [comparisonEnabled, setComparisonEnabled] = useState(false);
  const [comparisonPosition, setComparisonPosition] = useState(50);
  const [comparisonHold, setComparisonHold] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandActiveIndex, setCommandActiveIndex] = useState(0);
  const [webMCPStatus, setWebMCPStatus] = useState<WebMCPStatus>(getWebMCPAvailability);
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem("ditherer-onboarding-complete") !== "1");
  const [openPresetLibraryRequest, setOpenPresetLibraryRequest] = useState(0);
  const [activeTask, setActiveTask] = useState<WorkbenchTask>("source");
  const [inspectorQuery, setInspectorQuery] = useState("");
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const historyApplyingRef = useRef<string | null>(null);
  const historyChainStructureRef = useRef<string | null>(null);
  const historyActionsRef = useRef(actions);
  historyActionsRef.current = actions;
  const [screensaverActive, setScreensaverActive] = useState(false);
  const [showScreensaverDialog, setShowScreensaverDialog] = useState(false);
  const [screensaverDialogPosition, setScreensaverDialogPosition] = useState({ x: 640, y: 120 });
  const [audioEditorPosition, setAudioEditorPosition] = useState({ x: 500, y: 120 });
  const [screensaverSwapSecondsDraft, setScreensaverSwapSecondsDraft] = useState("2");
  const [screensaverSwapBpmDraft, setScreensaverSwapBpmDraft] = useState("120");
  const [screensaverRandomVideoDraft, setScreensaverRandomVideoDraft] = useState(false);
  const [screensaverVideoSwapSecondsDraft, setScreensaverVideoSwapSecondsDraft] = useState("8");
  const [screensaverScalingAlgorithmDraft, setScreensaverScalingAlgorithmDraft] = useState(state.scalingAlgorithm);
  const [screensaverVideoMaxWidthDraft, setScreensaverVideoMaxWidthDraft] = useState(String(DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH));
  const [audioModConnectionsDraft, setAudioModConnectionsDraft] = useState<AudioVizConnection[]>([]);
  const [audioModNormalizedMetricsDraft, setAudioModNormalizedMetricsDraft] = useState<AudioVizMetric[]>([]);
  const [chainAudioGlobalConnectionsDraft, setChainAudioGlobalConnectionsDraft] = useState<AudioVizConnection[]>([]);
  const [chainAudioGlobalNormalizedMetricsDraft, setChainAudioGlobalNormalizedMetricsDraft] = useState<AudioVizMetric[]>([]);
  const [screensaverAudioGlobalConnectionsDraft, setScreensaverAudioGlobalConnectionsDraft] = useState<AudioVizConnection[]>([]);
  const [screensaverAudioGlobalNormalizedMetricsDraft, setScreensaverAudioGlobalNormalizedMetricsDraft] = useState<AudioVizMetric[]>([]);
  const [chainAudioAutoVizMode, setChainAudioAutoVizMode] = useState<AutoVizMode>("balanced");
  const [chainAudioAutoVizOnChainChange, setChainAudioAutoVizOnChainChange] = useState(false);
  const [screensaverAudioAutoVizMode, setScreensaverAudioAutoVizMode] = useState<AutoVizMode>("balanced");
  const [screensaverAudioAutoVizOnChainChange, setScreensaverAudioAutoVizOnChainChange] = useState(true);
  const [chainAudioBpmSwapEnabled, setChainAudioBpmSwapEnabled] = useState(false);
  const [chainAudioBpmSwapBeats, setChainAudioBpmSwapBeats] = useState("4");
  const chainAudioBpmSwapRestoreRef = useRef<number | null | undefined>(undefined);
  const [screensaverBpmSwapEnabled, setScreensaverBpmSwapEnabled] = useState(false);
  const [screensaverBpmSwapBeats, setScreensaverBpmSwapBeats] = useState("4");
  const screensaverBpmSwapRestoreRef = useRef<number | null | undefined>(undefined);
  const [screensaverVideoBpmSwapEnabled, setScreensaverVideoBpmSwapEnabled] = useState(false);
  const [screensaverVideoBpmSwapBeats, setScreensaverVideoBpmSwapBeats] = useState("16");
  const screensaverVideoSwapSecondsRef = useRef<number>(8);
  const [screensaverShowDebugDraft, setScreensaverShowDebugDraft] = useState(false);
  const [screensaverShowDebug, setScreensaverShowDebug] = useState(false);
  const [seekDraftTime, setSeekDraftTime] = useState<number | null>(null);
  const playPauseTimerRef = useRef<number | null>(null);
  const seekCommitTimerRef = useRef<number | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const workspaceToolbarRef = useRef<HTMLElement | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const onboardingInitialChainRef = useRef(state.chain);
  const estimatedFrameStepRef = useRef(1 / 30);
  const screensaverRestoreRef = useRef<ScreensaverRestore | null>(null);
  const screensaverHasEnteredFullscreenRef = useRef(false);
  const screensaverConfigRef = useRef<{ swapSeconds: number; randomVideo: boolean; videoSwapSeconds: number; scalingAlgorithm: string; videoMaxWidth: number }>({
    swapSeconds: 2,
    randomVideo: false,
    videoSwapSeconds: 8,
    scalingAlgorithm: SCALING_ALGORITHM.PIXELATED,
    videoMaxWidth: DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH,
  });
  const screensaverVideoSwapTimerRef = useRef<number | null>(null);
  const screensaverVideoSwapGenerationRef = useRef(0);
  const screensaverVideoSwapInFlightRef = useRef<Promise<void> | null>(null);
  const currentInputIsRandomTestVideoRef = useRef(false);
  const warmedTestVideoRef = useRef<HTMLVideoElement | null>(null);
  const warmedTestVideoSrcRef = useRef<string | null>(null);
  const warmedTestVideoPromiseRef = useRef<Promise<string | null> | null>(null);

  const stopScreensaverVideoSwapLoop = useCallback(() => {
    screensaverVideoSwapGenerationRef.current += 1;
    if (screensaverVideoSwapTimerRef.current != null) {
      window.clearTimeout(screensaverVideoSwapTimerRef.current);
      screensaverVideoSwapTimerRef.current = null;
    }
  }, []);

  const clearWarmedTestVideo = useCallback(() => {
    const warmedVideo = warmedTestVideoRef.current;
    if (warmedVideo) {
      warmedVideo.pause();
      warmedVideo.removeAttribute("src");
      warmedVideo.load();
    }
    warmedTestVideoRef.current = null;
    warmedTestVideoSrcRef.current = null;
    warmedTestVideoPromiseRef.current = null;
  }, []);

  const flashPlayPause = (kind: "play" | "pause") => {
    setPlayPauseIndicator(kind);
    if (playPauseTimerRef.current) window.clearTimeout(playPauseTimerRef.current);
    playPauseTimerRef.current = window.setTimeout(() => setPlayPauseIndicator(null), 600);
  };

  const inputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const comparisonCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Ref callbacks run synchronously when the DOM node is attached, before any
  // effect or render-driven getContext call. willReadFrequently is a sticky
  // flag set on the very first getContext call per canvas, so claim the
  // context here to guarantee filterOnMainThread's downstream getImageData
  // reads don't pay a GPU readback cost.
  const bindReadbackCanvasRef = (
    ref: { current: HTMLCanvasElement | null },
  ) => (el: HTMLCanvasElement | null) => {
    ref.current = el;
    if (el) el.getContext("2d", { willReadFrequently: true });
  };
  const inputCanvasRefCb = bindReadbackCanvasRef(inputCanvasRef);
  const outputCanvasRefCb = bindReadbackCanvasRef(outputCanvasRef);
  const outputWindowRef = useRef<HTMLDivElement | null>(null);
  const fullscreenMenuRef = useRef<HTMLDivElement | null>(null);
  const screensaverButtonRef = useRef<HTMLButtonElement | null>(null);
  const screensaverDialogRef = useRef<HTMLDivElement | null>(null);
  const audioEditorRef = useRef<HTMLDivElement | null>(null);
  // Draggable canvas windows live below the fixed 10,000+ modal layer. Keeping
  // these bands separate prevents a raised canvas stacking context from
  // intercepting controls inside Save As, screensaver, or audio dialogs.
  const zIndexRef = useRef(100);
  const canvasWindowPositionsSeededRef = useRef(false);
  const inputDragRef = useRef(null);
  const outputDragRef = useRef(null);
  const saveAsDragRef = useRef(null);
  const dragScaleStart = useRef({ input: 1, output: 1 });
  const hasLoadedTestImageRef = useRef(false);
  const hasLoadedTestVideoRef = useRef(false);
  const hasAutoLoadedDefaultMediaRef = useRef(false);
  const initialSharedTestMediaRef = useRef(parseSharedTestMedia(window.location.search));
  const lastTestImageAssetRef = useRef<string | null>(null);
  const lastTestVideoAssetRef = useRef<string | null>(null);
  const imageAssetPromiseCacheRef = useRef<Map<string, Promise<HTMLImageElement>>>(new Map());
  const pendingLoadedMediaFilterRef = useRef(false);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    setShowOnboarding(false);
  }, []);

  const navigateToTask = useCallback((task: WorkbenchTask) => {
    setActiveTask(task);
    requestAnimationFrame(() => {
      chromeRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, []);

  const openExport = useCallback(() => {
    setActiveTask("export");
    setShowSaveAs(true);
  }, []);

  const closeExport = useCallback(() => {
    setShowSaveAs(false);
    setActiveTask("preview");
  }, []);

  useEffect(() => {
    if (!showOnboarding || state.chain === onboardingInitialChainRef.current) return;
    completeOnboarding();
  }, [completeOnboarding, showOnboarding, state.chain]);
  const webmcpRefs = useRef({ state, actions, filterList });
  webmcpRefs.current = { state, actions, filterList };
  const waitForWebMCPMediaReady = useCallback((previousState: Pick<typeof state, "inputImage" | "outputImage">) => (
    new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + 10_000;
      let filterRequested = false;
      const check = () => {
        const current = webmcpRefs.current.state;
        const inputReady = Boolean(current.inputImage) && current.inputImage !== previousState.inputImage;
        const inputCanvasReady = inputReady
          && Boolean(inputCanvasRef.current)
          && inputCanvasRef.current?.width === Math.floor((current.inputImage?.width || 0) * current.scale)
          && inputCanvasRef.current?.height === Math.floor((current.inputImage?.height || 0) * current.scale);
        const outputReady = Boolean(current.outputImage)
          && current.outputImage !== previousState.outputImage
          && current.outputFrameToken === current.inputFrameToken;
        if (inputCanvasReady && outputReady) {
          requestAnimationFrame(() => resolve());
          return;
        }
        if (performance.now() >= deadline) {
          const diagnostic = {
            inputFrameToken: current.inputFrameToken,
            outputFrameToken: current.outputFrameToken,
            inputSize: current.inputImage
              ? [current.inputImage.width, current.inputImage.height]
              : null,
            outputSize: current.outputImage
              ? [current.outputImage.width, current.outputImage.height]
              : null,
          };
          console.error("[webmcp] Media output readiness timed out", diagnostic);
          reject(new Error(`Media loaded, but the filtered output did not become ready: ${JSON.stringify(diagnostic)}`));
          return;
        }
        if (inputCanvasReady && !filterRequested) {
          filterRequested = true;
          webmcpRefs.current.actions.filterImageAsync(inputCanvasRef.current);
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    })
  ), []);

  const inputDrag = useDraggable(inputDragRef, {
    defaultPosition: inputWindowPosition,
    onPositionChange: setInputWindowPosition,
    onScale: (delta) => {
      const newScale = Math.round(Math.max(0.05, Math.min(16, state.scale + delta)) * 10) / 10;
      actions.setScale(newScale);
    },
    onScaleAbsolute: (ratio) => {
      // ratio=1.0 at start → capture; subsequent calls use captured start
      if (Math.abs(ratio - 1) < 0.005) dragScaleStart.current.input = state.scale;
      const newScale = Math.max(0.05, Math.min(16, dragScaleStart.current.input * ratio));
      actions.setScale(Math.round(newScale * 100) / 100);
    }
  });
  const outputDrag = useDraggable(outputDragRef, {
    defaultPosition: outputWindowPosition,
    onPositionChange: setOutputWindowPosition,
    onScale: (delta) => {
      const newScale = Math.round(Math.max(0.05, Math.min(16, state.outputScale + delta)) * 10) / 10;
      actions.setOutputScale(newScale);
    },
    onScaleAbsolute: (ratio) => {
      if (Math.abs(ratio - 1) < 0.005) dragScaleStart.current.output = state.outputScale;
      const newScale = Math.max(0.05, Math.min(16, dragScaleStart.current.output * ratio));
      actions.setOutputScale(Math.round(newScale * 100) / 100);
    }
  });
  const saveAsDrag = useDraggable(saveAsDragRef, { defaultPosition: { x: 160, y: 400 } });
  const screensaverDrag = useDraggable(screensaverDialogRef, {
    defaultPosition: screensaverDialogPosition,
    onPositionChange: setScreensaverDialogPosition,
  });
  const audioEditorDrag = useDraggable(audioEditorRef, {
    defaultPosition: audioEditorPosition,
    onPositionChange: setAudioEditorPosition,
  });

  useEffect(() => {
    const video = state.video;
    if (!video) {
      setVideoPaused(false);
      estimatedFrameStepRef.current = 1 / 30;
      setSeekDraftTime(null);
      if (seekCommitTimerRef.current) {
        window.clearTimeout(seekCommitTimerRef.current);
        seekCommitTimerRef.current = null;
      }
      return;
    }

    const syncPaused = () => setVideoPaused(video.paused);
    syncPaused();
    video.addEventListener("play", syncPaused);
    video.addEventListener("pause", syncPaused);
    video.addEventListener("loadedmetadata", syncPaused);

    return () => {
      video.removeEventListener("play", syncPaused);
      video.removeEventListener("pause", syncPaused);
      video.removeEventListener("loadedmetadata", syncPaused);
    };
  }, [state.video]);

  useEffect(() => {
    return () => {
      if (seekCommitTimerRef.current) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => clearWarmedTestVideo, [clearWarmedTestVideo]);

  useEffect(() => () => {
    dispatchScreensaverCycleSeconds(null);
  }, []);

  useEffect(() => {
    setActiveAudioVizChannel(screensaverActive ? "screensaver" : "chain");
  }, [screensaverActive]);

  useEffect(() => {
    const syncOutputFullscreen = () => {
      setOutputFullscreen(document.fullscreenElement === outputWindowRef.current);
    };

    syncOutputFullscreen();
    document.addEventListener("fullscreenchange", syncOutputFullscreen);

    return () => {
      document.removeEventListener("fullscreenchange", syncOutputFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!outputFullscreen) {
      setFullscreenCursorHidden(false);
      return undefined;
    }

    let idleTimer: number | null = null;
    const resetIdleTimer = () => {
      setFullscreenCursorHidden(false);
      if (idleTimer != null) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(() => {
        setFullscreenCursorHidden(true);
      }, FULLSCREEN_CURSOR_IDLE_MS);
    };

    resetIdleTimer();
    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "touchstart", "keydown", "wheel"];
    for (const eventName of events) {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    }

    return () => {
      if (idleTimer != null) {
        window.clearTimeout(idleTimer);
      }
      for (const eventName of events) {
        window.removeEventListener(eventName, resetIdleTimer);
      }
      setFullscreenCursorHidden(false);
    };
  }, [outputFullscreen]);

  useEffect(() => {
    if (!showFullscreenMenu) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (fullscreenMenuRef.current?.contains(target)) return;
      setShowFullscreenMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowFullscreenMenu(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showFullscreenMenu]);

  useLayoutEffect(() => {
    if (canvasWindowPositionsSeededRef.current) return;
    const sidebarRight = chromeRef.current?.getBoundingClientRect().right;
    if (!sidebarRight) return;
    const toolbarBottom = workspaceToolbarRef.current?.getBoundingClientRect().bottom ?? 44;
    const windowTop = Math.round(toolbarBottom + 10);
    setInputWindowPosition({ x: Math.round(sidebarRight + 10), y: windowTop });
    setOutputWindowPosition({ x: Math.round(sidebarRight + 330), y: windowTop + 10 });
    canvasWindowPositionsSeededRef.current = true;
  }, []);

  useEffect(() => {
    localStorage.setItem("ditherer-workspace-layout", workspaceLayout);
  }, [workspaceLayout]);

  useEffect(() => {
    setInspectorQuery("");
  }, [state.activeIndex, state.chain[state.activeIndex]?.displayName]);

  useEffect(() => {
    const snapshot = historyActionsRef.current.exportState(state);
    const chainStructure = JSON.stringify(state.chain.map((entry) => [
      entry.id,
      entry.displayName,
      entry.enabled,
    ]));
    const commitSnapshot = () => {
      if (historyApplyingRef.current === snapshot) {
        historyApplyingRef.current = null;
        return;
      }
      const current = historyRef.current[historyIndexRef.current];
      if (current === snapshot) return;
      const next = historyRef.current.slice(0, historyIndexRef.current + 1);
      next.push(snapshot);
      historyRef.current = next.slice(-50);
      historyIndexRef.current = historyRef.current.length - 1;
      setHistoryVersion((version) => version + 1);
    };

    // Chain structure changes are discrete commands: never merge a quick
    // reorder/toggle/remove into the slider debounce or Undo can skip it.
    if (historyChainStructureRef.current !== chainStructure) {
      historyChainStructureRef.current = chainStructure;
      commitSnapshot();
      return;
    }

    const timeout = window.setTimeout(commitSnapshot, 220);
    return () => window.clearTimeout(timeout);
  }, [state.chain, state.convertGrayscale, state.linearize, state.outputScale, state.realtimeFiltering, state.scale, state.scalingAlgorithm, state.wasmAcceleration, state.webglAcceleration]);

  const restoreHistory = useCallback((offset: -1 | 1) => {
    const nextIndex = historyIndexRef.current + offset;
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    historyIndexRef.current = nextIndex;
    historyApplyingRef.current = snapshot;
    historyActionsRef.current.importState(snapshot);
    setHistoryVersion((version) => version + 1);
  }, []);

  const canUndo = historyVersion >= 0 && historyIndexRef.current > 0;
  const canRedo = historyVersion >= 0 && historyIndexRef.current < historyRef.current.length - 1;

  useEffect(() => {
    const handleWorkbenchShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || Boolean(target?.isContentEditable);
      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && event.key.toLowerCase() === "z" && !isTyping) {
        event.preventDefault();
        restoreHistory(event.shiftKey ? 1 : -1);
        return;
      }
      if ((event.key === "/" || (commandKey && event.key.toLowerCase() === "k")) && !isTyping) {
        event.preventDefault();
        setCommandQuery("");
        setCommandActiveIndex(0);
        setShowCommandPalette(true);
      }
    };
    window.addEventListener("keydown", handleWorkbenchShortcut);
    return () => window.removeEventListener("keydown", handleWorkbenchShortcut);
  }, [restoreHistory]);

  useEffect(() => {
    if (screensaverActive && outputFullscreen) {
      screensaverHasEnteredFullscreenRef.current = true;
    }

    if (!screensaverHasEnteredFullscreenRef.current) return;
    if (outputFullscreen || !screensaverActive) return;
    const restore = screensaverRestoreRef.current;
    const pendingVideoSwap = screensaverVideoSwapInFlightRef.current;
    setScreensaverActive(false);
    screensaverHasEnteredFullscreenRef.current = false;
    if (!restore) return;
    stopScreensaverVideoSwapLoop();
    clearWarmedTestVideo();
    dispatchScreensaverCycleSeconds(null);
    setOutputFullscreenMode(restore.fullscreenMode);
    screensaverRestoreRef.current = null;
    void (async () => {
      if (pendingVideoSwap) await pendingVideoSwap.catch(() => undefined);
      const media = await restore.media.catch((error) => {
        console.error("Failed to preserve the pre-screensaver input:", error);
        return null;
      });

      if (media?.kind === "image") {
        actions.loadImage(media.image);
      } else if (media?.kind === "video") {
        if (typeof media.source === "string") {
          await actions.loadVideoFromUrlAsync(
            media.source,
            media.volume,
            media.playbackRate,
            { preserveScale: true },
          );
        } else {
          await actions.loadMediaAsync(
            media.source,
            media.volume,
            media.playbackRate,
            { preserveScale: true },
          );
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const restoredVideo = webmcpRefs.current.state.video as (HTMLVideoElement & { __manualPause?: boolean }) | null;
        if (restoredVideo) {
          if (Number.isFinite(media.time) && media.time > 0) {
            try { restoredVideo.currentTime = media.time; } catch { /* media may not be seekable */ }
          }
          if (media.paused) {
            restoredVideo.__manualPause = true;
            restoredVideo.pause();
          } else {
            restoredVideo.play().catch(() => undefined);
          }
        }
      }

      if (media) {
        setInputFilename(media.filename);
        currentInputIsRandomTestVideoRef.current = media.wasRandomTestVideo;
        if (media.sharedMedia) {
          const restoredSrc = testAssetUrl(media.sharedMedia.kind, media.sharedMedia.file);
          syncSharedTestMediaUrl(media.sharedMedia.kind, restoredSrc);
          if (media.sharedMedia.kind === "image") lastTestImageAssetRef.current = restoredSrc;
          else lastTestVideoAssetRef.current = restoredSrc;
        } else {
          syncSharedTestMediaUrl(null);
        }
      }
      actions.setScale(restore.scale);
      actions.setScalingAlgorithm(restore.scalingAlgorithm);
    })();
  }, [actions, clearWarmedTestVideo, outputFullscreen, screensaverActive, stopScreensaverVideoSwapLoop]);

  const buildScreensaverConfig = useCallback(() => {
    const swapSeconds = Number.parseFloat(screensaverSwapSecondsDraft.trim());
    if (!Number.isFinite(swapSeconds) || swapSeconds <= 0) {
      window.alert("Please enter a positive screensaver swap interval.");
      return null;
    }

    let videoSwapSeconds = Number.parseFloat(screensaverVideoSwapSecondsDraft.trim());
    let videoMaxWidth = Number.parseFloat(screensaverVideoMaxWidthDraft.trim());
    if (screensaverRandomVideoDraft) {
      if (!Number.isFinite(videoSwapSeconds) || videoSwapSeconds <= 0) {
        window.alert("Please enter a positive random video swap interval.");
        return null;
      }
      if (!Number.isFinite(videoMaxWidth) || videoMaxWidth <= 0) {
        window.alert("Please enter a positive max video width.");
        return null;
      }
    } else {
      videoSwapSeconds = swapSeconds * 4;
      videoMaxWidth = screensaverConfigRef.current.videoMaxWidth || DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH;
    }

    return {
      swapSeconds,
      randomVideo: screensaverRandomVideoDraft,
      videoSwapSeconds,
      scalingAlgorithm: screensaverScalingAlgorithmDraft,
      videoMaxWidth,
    };
  }, [screensaverRandomVideoDraft, screensaverScalingAlgorithmDraft, screensaverSwapSecondsDraft, screensaverVideoMaxWidthDraft, screensaverVideoSwapSecondsDraft]);

  useEffect(() => {
    if (!screensaverActive || !screensaverConfigRef.current.randomVideo) return;
    if (!state.video || !state.inputImage || !currentInputIsRandomTestVideoRef.current) return;

    const rounded = getScaleForMaxWidth(state.inputImage.width, screensaverConfigRef.current.videoMaxWidth);
    if (Math.abs(rounded - state.scale) > 0.001) {
      actions.setScale(rounded);
    }
  }, [actions, screensaverActive, state.inputImage, state.scale, state.video]);

  useEffect(() => {
    if (seekDraftTime == null) return;
    if (state.time == null) return;
    if (Math.abs(state.time - seekDraftTime) < 0.02) {
      setSeekDraftTime(null);
    }
  }, [seekDraftTime, state.time]);

  useEffect(() => {
    const video = state.video as (HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    }) | null;
    if (!video || typeof video.requestVideoFrameCallback !== "function") return;

    let frameHandle: number | null = null;
    let lastMediaTime: number | null = null;
    let cancelled = false;

    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (cancelled) return;
      if (lastMediaTime != null) {
        const delta = metadata.mediaTime - lastMediaTime;
        if (delta > 0 && Number.isFinite(delta) && delta < 0.25) {
          estimatedFrameStepRef.current = delta;
        }
      }
      lastMediaTime = metadata.mediaTime;
      frameHandle = video.requestVideoFrameCallback?.(onFrame) ?? null;
    };

    frameHandle = video.requestVideoFrameCallback(onFrame);

    return () => {
      cancelled = true;
      if (frameHandle != null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameHandle);
      }
    };
  }, [state.video]);

  const toggleOutputFullscreen = useCallback(async (mode: "contain" | "cover") => {
    const outputWindow = outputWindowRef.current;
    if (!outputWindow) return;

    setOutputFullscreenMode(mode);

    if (document.fullscreenElement === outputWindow) {
      return;
    }

    await outputWindow.requestFullscreen();
  }, []);

  // Apply saved theme on mount
  useEffect(() => {
    if (theme === "rainy-day") {
      document.documentElement.setAttribute("data-theme", "rainy-day");
    }
  }, []);

  // Register WebMCP tools once (current document API, with a legacy navigator fallback).
  // Tool handlers read latest app state/actions via refs.
  useEffect(() => {
    return setupWebMCP(
      {
        getState: () => webmcpRefs.current.state,
        getActions: () => webmcpRefs.current.actions,
        getFilterList: () => webmcpRefs.current.filterList,
        getOutputCanvas: () => outputCanvasRef.current,
        waitForMediaReady: waitForWebMCPMediaReady,
      },
      { onStatus: setWebMCPStatus },
    );
  }, [waitForWebMCPMediaReady]);

  // Register input canvas with state
  useEffect(() => {
    if (inputCanvasRef.current) {
      actions.setInputCanvas(inputCanvasRef.current);
    }
  }, []);

  // Draw to canvas when input/output changes
  const prevPropsRef = useRef<PreviousCanvasProps>({});
  useEffect(() => {
    const prev = prevPropsRef.current;

    const drawToCanvas = (
      canvas: HTMLCanvasElement,
      image: CanvasImageSource & { width: number; height: number },
      scale: number,
    ) => {
      const finalWidth = image.width * scale;
      const finalHeight = image.height * scale;
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      // willReadFrequently on first access — this canvas (the React-mounted
      // input/output <canvas>) is repeatedly sampled by filterOnMainThread
      // via getImageData, and the flag is sticky from the first getContext call.
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = state.scalingAlgorithm === SCALING_ALGORITHM.AUTO;
        ctx.drawImage(image, 0, 0, finalWidth, finalHeight);
      }
    };

    const newInput = state.inputImage !== prev.inputImage;
    const newScale = state.scale !== prev.scale;
    const newTime = state.time !== prev.time;

    if (inputCanvasRef.current && state.inputImage && (newTime || newInput || newScale)) {
      drawToCanvas(inputCanvasRef.current, state.inputImage, state.scale);
    }

    if (outputCanvasRef.current && state.outputImage && state.outputImage !== prev.outputImage) {
      drawToCanvas(outputCanvasRef.current, state.outputImage, state.outputScale);
    }

    if (comparisonCanvasRef.current && inputCanvasRef.current) {
      const comparison = comparisonCanvasRef.current;
      const output = outputCanvasRef.current;
      comparison.width = output?.width || inputCanvasRef.current.width;
      comparison.height = output?.height || inputCanvasRef.current.height;
      const comparisonContext = comparison.getContext("2d");
      if (comparisonContext) {
        comparisonContext.imageSmoothingEnabled = state.scalingAlgorithm !== SCALING_ALGORITHM.PIXELATED;
        comparisonContext.clearRect(0, 0, comparison.width, comparison.height);
        comparisonContext.drawImage(inputCanvasRef.current, 0, 0, comparison.width, comparison.height);
      }
    }

    prevPropsRef.current = {
      inputImage: state.inputImage,
      outputImage: state.outputImage,
      scale: state.scale,
      time: state.time,
    };
  }, [comparisonEnabled, state.inputImage, state.outputImage, state.scale, state.outputScale, state.time, state.scalingAlgorithm]);

  // Auto-filter when settings change and realtimeFiltering is on
  useEffect(() => {
    if (!state.realtimeFiltering || !inputCanvasRef.current || !state.inputImage) return;
    requestAnimationFrame(() => {
      actions.filterImageAsync(inputCanvasRef.current);
    });
  }, [
    state.chain, state.linearize, state.wasmAcceleration,
    state.convertGrayscale, state.realtimeFiltering, state.inputImage,
    state.scale, state.outputScale, state.time,
  ]);

  const bringToTop = useCallback((e: React.MouseEvent<HTMLElement>) => {
    zIndexRef.current += 1;
    e.currentTarget.style.zIndex = `${zIndexRef.current}`;
  }, []);

  useEffect(() => {
    if (!showScreensaverDialog || !screensaverDialogRef.current) return;
    zIndexRef.current += 1;
    screensaverDialogRef.current.style.zIndex = `${zIndexRef.current}`;
    screensaverDialogRef.current.focus({ preventScroll: true });
  }, [showScreensaverDialog]);

  useEffect(() => {
    if (!showScreensaverDialog) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setShowScreensaverDialog(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showScreensaverDialog]);

  useEffect(() => {
    if ((!editingAudioEntryId && !showChainAudioGlobalEditor) || !audioEditorRef.current) return;
    audioEditorRef.current.focus({ preventScroll: true });
  }, [editingAudioEntryId, showChainAudioGlobalEditor]);

  useLayoutEffect(() => {
    if ((!editingAudioEntryId && !showChainAudioGlobalEditor) || !audioEditorRef.current) return;
    const rect = audioEditorRef.current.getBoundingClientRect();
    const maxX = Math.max(16, window.innerWidth - rect.width - 16);
    const maxY = Math.max(16, window.innerHeight - rect.height - 16);
    setAudioEditorPosition((current) => {
      const next = {
        x: Math.min(Math.max(16, current.x), maxX),
        y: Math.min(Math.max(16, current.y), maxY),
      };
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [audioEditorPosition, editingAudioEntryId, showChainAudioGlobalEditor]);

  const withInputLoading = useCallback(async (label: string, loader: () => Promise<void> | void) => {
    setInputLoadError(null);
    setInputLoadingLabel(label);
    try {
      await loader();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Failed to load input asset:", error);
      setInputLoadError(error instanceof Error ? error.message : "Failed to load the selected media.");
    } finally {
      setInputLoadingLabel(null);
    }
  }, []);

  const queueLoadedMediaFilter = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (inputCanvasRef.current) {
          actions.filterImageAsync(inputCanvasRef.current);
        }
      });
    });
  }, [actions]);

  // After a new media source is loaded, run one filter pass once the first
  // input frame has reached the canvas, even if auto-apply is off.
  useEffect(() => {
    if (!pendingLoadedMediaFilterRef.current || !inputCanvasRef.current || !state.inputImage) return;
    pendingLoadedMediaFilterRef.current = false;
    queueLoadedMediaFilter();
  }, [queueLoadedMediaFilter, state.inputImage, state.time]);

  const loadImageAsset = useCallback((src: string) => {
    const cached = imageAssetPromiseCacheRef.current.get(src);
    if (cached) return cached;

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        imageAssetPromiseCacheRef.current.delete(src);
        reject(new Error(`Failed to load image asset: ${src}`));
      };
      img.src = src;
    });

    imageAssetPromiseCacheRef.current.set(src, promise);
    return promise;
  }, []);

  const prefetchRandomImage = useCallback((excludeSrc?: string | null) => {
    const src = pickRandomDifferent(TEST_IMAGE_ASSETS, excludeSrc ?? null);
    void loadImageAsset(src).catch(() => {});
  }, [loadImageAsset]);

  const loadUserFile = useCallback((file?: File | null) => {
    if (!file) return;
    completeOnboarding();
    syncSharedTestMediaUrl(null);
    const label = file.type.startsWith("video/") ? "LOADING VIDEO" : "LOADING IMAGE";
    pendingLoadedMediaFilterRef.current = true;
    currentInputIsRandomTestVideoRef.current = false;
    setInputFilename(file.name);
    void withInputLoading(label, () =>
      actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate, {
        preserveScale: preserveInputWidthOnNewMedia,
      })
    );
  }, [actions, completeOnboarding, preserveInputWidthOnNewMedia, state.videoPlaybackRate, state.videoVolume, withInputLoading]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      const items = Array.from(clipboardData.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;

      const target = event.target as HTMLElement | null;
      const isEditableTarget = !!target && (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      );

      const pastedFile = imageItem.getAsFile();
      if (!pastedFile) return;

      event.preventDefault();
      if (!isEditableTarget || pastedFile.size > 0) {
        loadUserFile(
          pastedFile.name
            ? pastedFile
            : new File([pastedFile], `pasted-image.${pastedFile.type.split("/")[1] || "png"}`, {
                type: pastedFile.type || "image/png",
              })
        );
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadUserFile]);

  const commitSeekVideo = useCallback((nextTime: number) => {
    const video = state.video;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const clampedTime = Math.max(0, Math.min(video.duration, nextTime));
    setSeekDraftTime(clampedTime);
    video.currentTime = clampedTime;
  }, [state.video]);

  const seekVideo = useCallback((nextTime: number) => {
    const video = state.video;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const clampedTime = Math.max(0, Math.min(video.duration, nextTime));
    setSeekDraftTime(clampedTime);
    if (seekCommitTimerRef.current) {
      window.clearTimeout(seekCommitTimerRef.current);
    }
    seekCommitTimerRef.current = window.setTimeout(() => {
      seekCommitTimerRef.current = null;
      commitSeekVideo(clampedTime);
    }, 40);
  }, [commitSeekVideo, state.video]);

  const flushSeekVideo = useCallback((nextTime: number) => {
    if (seekCommitTimerRef.current) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    commitSeekVideo(nextTime);
  }, [commitSeekVideo]);

  const getEstimatedFrameStep = useCallback(() => {
    const video = state.video as (HTMLVideoElement & {
      webkitDecodedFrameCount?: number;
      mozPresentedFrames?: number;
      getVideoPlaybackQuality?: () => { totalVideoFrames?: number };
    }) | null;
    if (!video) return 1 / 30;

    const observed = estimatedFrameStepRef.current;
    if (observed > 0 && Number.isFinite(observed)) return observed;

    const elapsed = video.currentTime;
    const qualityFrames = video.getVideoPlaybackQuality?.().totalVideoFrames;
    if (elapsed > 0.1 && qualityFrames && qualityFrames > 0) return elapsed / qualityFrames;

    const webkitFrames = video.webkitDecodedFrameCount;
    if (elapsed > 0.1 && webkitFrames && webkitFrames > 0) return elapsed / webkitFrames;

    const mozFrames = video.mozPresentedFrames;
    if (elapsed > 0.1 && mozFrames && mozFrames > 0) return elapsed / mozFrames;

    return 1 / 30;
  }, [state.video]);

  const stepVideoFrame = useCallback((direction: -1 | 1) => {
    const video = state.video;
    if (!video) return;
    (video as HTMLVideoElement & { __manualPause?: boolean }).__manualPause = true;
    video.pause();
    setVideoPaused(true);
    flushSeekVideo((video.currentTime || 0) + getEstimatedFrameStep() * direction);
  }, [flushSeekVideo, getEstimatedFrameStep, state.video]);

  const loadTestImageFromSrc = useCallback((src: string) => {
    hasLoadedTestImageRef.current = true;
    lastTestImageAssetRef.current = src;
    pendingLoadedMediaFilterRef.current = true;
    currentInputIsRandomTestVideoRef.current = false;
    syncSharedTestMediaUrl("image", src);
    setInputFilename(basename(src));
    void withInputLoading("LOADING IMAGE", async () => {
      const perfStart = performance.now();
      const hadCache = imageAssetPromiseCacheRef.current.has(src);
      const logPerf = (stage: string, extra: Record<string, unknown> = {}) => {
        const elapsedMs = Math.round(performance.now() - perfStart);
        console.info(`[perf][random-image-load] ${stage} +${elapsedMs}ms`, { src, ...extra });
      };
      logPerf("click", { cache: hadCache ? "hit" : "miss" });
      const img = await loadImageAsset(src);
      logPerf("image-ready", { width: img.naturalWidth, height: img.naturalHeight });
      actions.loadImage(cloneImageToCanvas(img));
      logPerf("loadImage-dispatched");
      queueLoadedMediaFilter();
      prefetchRandomImage(src);
    });
  }, [actions, loadImageAsset, prefetchRandomImage, queueLoadedMediaFilter, withInputLoading]);

  const loadRandomTestImage = useCallback(() => {
    const src = hasLoadedTestImageRef.current
      ? pickRandomDifferent(TEST_IMAGE_ASSETS, lastTestImageAssetRef.current)
      : DEFAULT_TEST_IMAGE_ASSET;
    loadTestImageFromSrc(src);
  }, [loadTestImageFromSrc]);

  useEffect(() => {
    void loadImageAsset(DEFAULT_TEST_IMAGE_ASSET).then(() => {
      prefetchRandomImage(DEFAULT_TEST_IMAGE_ASSET);
    }).catch(() => {});
  }, [loadImageAsset, prefetchRandomImage]);

  const loadTestVideoFromSrc = useCallback((src: string, options?: { isRandomPick?: boolean; forceScreensaverScale?: boolean }) => {
    hasLoadedTestVideoRef.current = true;
    lastTestVideoAssetRef.current = src;
    pendingLoadedMediaFilterRef.current = true;
    currentInputIsRandomTestVideoRef.current = Boolean(options?.isRandomPick);
    syncSharedTestMediaUrl("video", src);
    setInputFilename(basename(src));
    return withInputLoading("LOADING VIDEO", async () => {
      const perfStart = performance.now();
      const logPerf = (stage: string, extra: Record<string, unknown> = {}) => {
        const elapsedMs = Math.round(performance.now() - perfStart);
        console.info(`[perf][random-video-load] ${stage} +${elapsedMs}ms`, { src, ...extra });
      };
      logPerf("click");
      await actions.loadVideoFromUrlAsync(
        src,
        state.videoVolume,
        state.videoPlaybackRate,
        { preserveScale: options?.forceScreensaverScale || preserveInputWidthOnNewMedia }
      );
      if (options?.forceScreensaverScale) {
        const loadedVideo = webmcpRefs.current.state.video;
        if (loadedVideo?.videoWidth) {
          actions.setScale(getScaleForMaxWidth(loadedVideo.videoWidth, screensaverConfigRef.current.videoMaxWidth));
        }
      }
      logPerf("loadVideoFromUrlAsync-resolved");
      queueLoadedMediaFilter();
    });
  }, [actions, preserveInputWidthOnNewMedia, queueLoadedMediaFilter, state.videoPlaybackRate, state.videoVolume, withInputLoading]);

  useEffect(() => {
    if (hasAutoLoadedDefaultMediaRef.current) return;
    if (state.inputImage || state.video) return;
    hasAutoLoadedDefaultMediaRef.current = true;
    const sharedMedia = initialSharedTestMediaRef.current;
    if (sharedMedia?.kind === "image") {
      const src = testAssetUrl("image", sharedMedia.file);
      loadTestImageFromSrc(src);
      return;
    }
    const src = sharedMedia?.kind === "video"
      ? testAssetUrl("video", sharedMedia.file)
      : DEFAULT_TEST_VIDEO_ASSET;
    void loadTestVideoFromSrc(src);
  }, [loadTestImageFromSrc, loadTestVideoFromSrc, state.inputImage, state.video]);

  const loadRandomTestVideo = useCallback(() => {
    const src = hasLoadedTestVideoRef.current
      ? pickRandomDifferent(TEST_VIDEO_ASSETS, lastTestVideoAssetRef.current)
      : DEFAULT_TEST_VIDEO_ASSET;
    return loadTestVideoFromSrc(src, { isRandomPick: true });
  }, [loadTestVideoFromSrc]);

  const getNextRandomTestVideoSrc = useCallback((excludeSrc?: string | null) => {
    const previous = excludeSrc ?? lastTestVideoAssetRef.current;
    return hasLoadedTestVideoRef.current
      ? pickRandomDifferent(TEST_VIDEO_ASSETS, previous)
      : DEFAULT_TEST_VIDEO_ASSET;
  }, []);

  const warmTestVideoSrc = useCallback((src: string) => {
    if (warmedTestVideoSrcRef.current === src && warmedTestVideoPromiseRef.current) {
      return warmedTestVideoPromiseRef.current;
    }

    clearWarmedTestVideo();

    const warmedVideo = document.createElement("video");
    warmedVideo.preload = "auto";
    warmedVideo.muted = true;
    warmedVideo.loop = true;
    warmedVideo.playsInline = true;

    const warmedPromise = new Promise<string | null>((resolve) => {
      let settled = false;
      const finalize = (value: string | null) => {
        if (settled) return;
        settled = true;
        warmedVideo.onloadeddata = null;
        warmedVideo.onerror = null;
        resolve(value);
      };

      warmedVideo.onloadeddata = () => finalize(src);
      warmedVideo.onerror = () => finalize(null);
      warmedVideo.src = src;
      const playPromise = warmedVideo.play();
      if (playPromise) {
        playPromise
          .then(() => {
            warmedVideo.pause();
          })
          .catch(() => {
            // Some browsers won't autoplay the detached preloader even when muted.
            // Keeping the src loaded is still useful for cache warmup.
          });
      }
    }).then((warmedSrc) => {
      if (warmedSrc !== src) {
        if (warmedTestVideoRef.current === warmedVideo) {
          warmedTestVideoRef.current = null;
        }
        if (warmedTestVideoSrcRef.current === src) {
          warmedTestVideoSrcRef.current = null;
        }
        if (warmedTestVideoPromiseRef.current === warmedPromise) {
          warmedTestVideoPromiseRef.current = null;
        }
        warmedVideo.pause();
        warmedVideo.removeAttribute("src");
        warmedVideo.load();
        return null;
      }

      warmedTestVideoRef.current = warmedVideo;
      warmedTestVideoSrcRef.current = src;
      if (warmedTestVideoPromiseRef.current === warmedPromise) {
        warmedTestVideoPromiseRef.current = null;
      }
      return src;
    });

    warmedTestVideoPromiseRef.current = warmedPromise;
    return warmedPromise;
  }, [clearWarmedTestVideo]);

  const warmNextRandomTestVideo = useCallback((excludeSrc?: string | null) => {
    const nextSrc = getNextRandomTestVideoSrc(excludeSrc);
    return warmTestVideoSrc(nextSrc);
  }, [getNextRandomTestVideoSrc, warmTestVideoSrc]);

  const captureScreensaverMedia = useCallback(async (): Promise<ScreensaverMediaRestore | null> => {
    const inputImage = state.inputImage;
    if (!inputImage) return null;

    const common = {
      filename: inputFilename,
      sharedMedia: parseSharedTestMedia(window.location.search),
      wasRandomTestVideo: currentInputIsRandomTestVideoRef.current,
    };
    const video = state.video;
    if (!video) {
      return {
        ...common,
        kind: "image",
        image: cloneImageToCanvas(inputImage),
      };
    }

    const src = video.currentSrc || video.src;
    if (!src) return null;
    let source: string | File = src;
    if (src.startsWith("blob:")) {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`Unable to snapshot uploaded video (${response.status})`);
      const blob = await response.blob();
      source = new File([blob], inputFilename || "screensaver-input.webm", {
        type: blob.type || "video/webm",
      });
    }

    return {
      ...common,
      kind: "video",
      source,
      time: video.currentTime,
      paused: video.paused,
      volume: state.videoVolume,
      playbackRate: state.videoPlaybackRate,
    };
  }, [inputFilename, state.inputImage, state.video, state.videoPlaybackRate, state.videoVolume]);

  const startScreensaverVideoSwapLoop = useCallback((videoSwapSeconds: number) => {
    stopScreensaverVideoSwapLoop();
    const generation = screensaverVideoSwapGenerationRef.current;
    screensaverVideoSwapSecondsRef.current = videoSwapSeconds;
    void warmNextRandomTestVideo(lastTestVideoAssetRef.current);

    const scheduleNextSwap = () => {
      if (generation !== screensaverVideoSwapGenerationRef.current) return;
      const interval = Math.max(0.05, screensaverVideoSwapSecondsRef.current);
      screensaverVideoSwapTimerRef.current = window.setTimeout(async () => {
        if (generation !== screensaverVideoSwapGenerationRef.current) return;
        notifyScreensaverVideoSwap();
        const warmedSrc = warmedTestVideoSrcRef.current;
        const nextSrc = warmedSrc || getNextRandomTestVideoSrc(lastTestVideoAssetRef.current);
        clearWarmedTestVideo();
        const load = loadTestVideoFromSrc(nextSrc, { isRandomPick: true, forceScreensaverScale: true });
        screensaverVideoSwapInFlightRef.current = load;
        await load;
        if (screensaverVideoSwapInFlightRef.current === load) {
          screensaverVideoSwapInFlightRef.current = null;
        }
        if (generation !== screensaverVideoSwapGenerationRef.current) return;
        void warmNextRandomTestVideo(nextSrc);
        scheduleNextSwap();
      }, interval * 1000);
    };

    scheduleNextSwap();
  }, [clearWarmedTestVideo, getNextRandomTestVideoSrc, loadTestVideoFromSrc, stopScreensaverVideoSwapLoop, warmNextRandomTestVideo]);

  const startScreensaver = useCallback(async (config: { swapSeconds: number; randomVideo: boolean; videoSwapSeconds: number; scalingAlgorithm: string; videoMaxWidth: number }) => {
    const outputWindow = outputWindowRef.current;
    if (!outputWindow) return;

    const media = config.randomVideo
      ? captureScreensaverMedia()
      : Promise.resolve<ScreensaverMediaRestore | null>(null);
    screensaverRestoreRef.current = {
      fullscreenMode: outputFullscreenMode,
      scale: state.scale,
      scalingAlgorithm: state.scalingAlgorithm,
      media,
    };
    screensaverHasEnteredFullscreenRef.current = false;
    resetScreensaverSwapMarkers();
    setScreensaverActive(true);
    setOutputFullscreenMode("cover");
    screensaverConfigRef.current = config;
    dispatchScreensaverCycleSeconds(config.swapSeconds);
    actions.setScalingAlgorithm(config.scalingAlgorithm);
    if (!config.randomVideo) {
      stopScreensaverVideoSwapLoop();
      clearWarmedTestVideo();
    }

    if (document.fullscreenElement !== outputWindow) {
      await outputWindow.requestFullscreen();
    }
    if (config.randomVideo) {
      await media;
      if (screensaverRestoreRef.current?.media === media) {
        startScreensaverVideoSwapLoop(config.videoSwapSeconds);
      }
    }
  }, [actions, captureScreensaverMedia, clearWarmedTestVideo, outputFullscreenMode, startScreensaverVideoSwapLoop, state.scale, state.scalingAlgorithm, stopScreensaverVideoSwapLoop]);


  const requestAudioVizPermissions = useCallback((channel: "chain" | "screensaver") => {
    const snapshot = getChannelAudioVizSnapshot(channel);
    if (snapshot.source !== "microphone") return;
    void updateAudioVizChannel(channel, {
      source: "microphone",
      enabled: true,
      deviceId: snapshot.deviceId,
      normalize: snapshot.normalize,
    });
  }, []);

  useEffect(() => {
    if (!chainAudioBpmSwapEnabled) {
      if (chainAudioBpmSwapRestoreRef.current !== undefined) {
        dispatchRandomCycleSeconds(chainAudioBpmSwapRestoreRef.current);
        chainAudioBpmSwapRestoreRef.current = undefined;
      }
      return;
    }

    if (chainAudioBpmSwapRestoreRef.current === undefined) {
      chainAudioBpmSwapRestoreRef.current = getCurrentRandomCycleSeconds() ?? getLastRandomCycleSeconds() ?? null;
    }

    const beatsPerSwap = Number.parseFloat(chainAudioBpmSwapBeats);
    if (!Number.isFinite(beatsPerSwap) || beatsPerSwap <= 0) {
      return;
    }

    const syncBpmSwap = () => {
      const snapshot = getChannelAudioVizSnapshot("chain");
      if (!snapshot.enabled || snapshot.status !== "live" || !snapshot.detectedBpm || snapshot.detectedBpm <= 0) {
        return;
      }
      const secondsPerSwap = (60 / snapshot.detectedBpm) * beatsPerSwap;
      dispatchRandomCycleSeconds(secondsPerSwap > 0 ? secondsPerSwap : null);
    };

    syncBpmSwap();
    return subscribeAudioViz((changedChannel) => {
      if (changedChannel !== "chain") return;
      syncBpmSwap();
    });
  }, [chainAudioBpmSwapBeats, chainAudioBpmSwapEnabled]);

  useEffect(() => {
    if (!screensaverVideoBpmSwapEnabled) return;
    const beatsPerSwap = Number.parseFloat(screensaverVideoBpmSwapBeats);
    if (!Number.isFinite(beatsPerSwap) || beatsPerSwap <= 0) return;

    const syncVideoBpmSwap = () => {
      const snapshot = getChannelAudioVizSnapshot("screensaver");
      if (!snapshot.enabled || snapshot.status !== "live" || !snapshot.detectedBpm || snapshot.detectedBpm <= 0) return;
      const secondsPerSwap = (60 / snapshot.detectedBpm) * beatsPerSwap;
      if (secondsPerSwap > 0) {
        screensaverVideoSwapSecondsRef.current = secondsPerSwap;
        screensaverConfigRef.current.videoSwapSeconds = secondsPerSwap;
      }
    };

    syncVideoBpmSwap();
    return subscribeAudioViz((changedChannel) => {
      if (changedChannel !== "screensaver") return;
      syncVideoBpmSwap();
    });
  }, [screensaverVideoBpmSwapBeats, screensaverVideoBpmSwapEnabled]);

  useEffect(() => {
    if (!screensaverBpmSwapEnabled) {
      if (screensaverBpmSwapRestoreRef.current !== undefined) {
        dispatchScreensaverCycleSeconds(screensaverBpmSwapRestoreRef.current);
        screensaverBpmSwapRestoreRef.current = undefined;
      }
      return;
    }

    if (screensaverBpmSwapRestoreRef.current === undefined) {
      screensaverBpmSwapRestoreRef.current = getLastScreensaverCycleSeconds() ?? null;
    }

    const beatsPerSwap = Number.parseFloat(screensaverBpmSwapBeats);
    if (!Number.isFinite(beatsPerSwap) || beatsPerSwap <= 0) {
      return;
    }

    const syncBpmSwap = () => {
      const snapshot = getChannelAudioVizSnapshot("screensaver");
      if (!snapshot.enabled || snapshot.status !== "live" || !snapshot.detectedBpm || snapshot.detectedBpm <= 0) {
        return;
      }
      const secondsPerSwap = (60 / snapshot.detectedBpm) * beatsPerSwap;
      dispatchScreensaverCycleSeconds(secondsPerSwap > 0 ? secondsPerSwap : null);
    };

    syncBpmSwap();
    return subscribeAudioViz((changedChannel) => {
      if (changedChannel !== "screensaver") return;
      syncBpmSwap();
    });
  }, [screensaverBpmSwapBeats, screensaverBpmSwapEnabled]);

  const openScreensaverDialog = useCallback(() => {
    const currentSwapSeconds = getLastScreensaverCycleSeconds() ?? screensaverConfigRef.current.swapSeconds ?? 2;
    const currentVideoSrc = state.video?.currentSrc || state.video?.src || null;
    const randomVideoDefault =
      currentInputIsRandomTestVideoRef.current ||
      isBundledTestVideoSource(currentVideoSrc) ||
      screensaverConfigRef.current.randomVideo;
    const videoSwapSeconds = screensaverConfigRef.current.videoSwapSeconds > 0
      ? screensaverConfigRef.current.videoSwapSeconds
      : currentSwapSeconds * 4;
    const screensaverAudioMod = getGlobalAudioVizModulation("screensaver");
    const buttonRect = screensaverButtonRef.current?.getBoundingClientRect();
    setScreensaverDialogPosition(getAnchoredDialogPosition(
      buttonRect,
      screensaverDialogPosition,
      { width: 820, height: 760 },
    ));
    setScreensaverSwapSecondsDraft(currentSwapSeconds.toString());
    setScreensaverSwapBpmDraft(secondsToBpm(currentSwapSeconds).toFixed(2).replace(/\.?0+$/, ""));
    setScreensaverRandomVideoDraft(randomVideoDefault);
    setScreensaverVideoSwapSecondsDraft(videoSwapSeconds.toString());
    setScreensaverScalingAlgorithmDraft(screensaverConfigRef.current.scalingAlgorithm || state.scalingAlgorithm);
    setScreensaverVideoMaxWidthDraft((screensaverConfigRef.current.videoMaxWidth || DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH).toString());
    setScreensaverAudioGlobalConnectionsDraft(buildAudioConnectionDraft(screensaverAudioMod));
    setScreensaverAudioGlobalNormalizedMetricsDraft(buildNormalizedMetricsDraft(screensaverAudioMod));
    setScreensaverShowDebugDraft(screensaverShowDebug);
    setShowScreensaverDialog(true);
    requestAudioVizPermissions("screensaver");
  }, [requestAudioVizPermissions, screensaverDialogPosition.x, screensaverDialogPosition.y, state.scalingAlgorithm, state.video]);

  const handleScreensaverSwapSecondsChange = useCallback((value: string) => {
    setScreensaverSwapSecondsDraft(value);
    const seconds = Number.parseFloat(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    setScreensaverSwapBpmDraft(secondsToBpm(seconds).toFixed(2).replace(/\.?0+$/, ""));
  }, []);

  const handleScreensaverSwapBpmChange = useCallback((value: string) => {
    setScreensaverSwapBpmDraft(value);
    const bpm = Number.parseFloat(value);
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    setScreensaverSwapSecondsDraft(bpmToSeconds(bpm).toFixed(3).replace(/\.?0+$/, ""));
  }, []);

  const buildGlobalModulation = useCallback((connectionsDraft: AudioVizConnection[], normalizedMetricsDraft: AudioVizMetric[]): GlobalAudioVizModulation | null => {
    const connections = connectionsDraft
      .filter((connection) =>
        typeof connection.target === "string"
        && typeof connection.metric === "string"
        && Number.isFinite(connection.weight)
        && Math.abs(connection.weight) > 0.001)
      .map((connection) => ({ ...connection }));
    const normalizedMetrics = normalizedMetricsDraft.filter((metric, index, all) => typeof metric === "string" && all.indexOf(metric) === index);
    return connections.length > 0 || normalizedMetrics.length > 0 ? { connections, normalizedMetrics } : null;
  }, []);

  const confirmScreensaverDialog = useCallback(() => {
    const config = buildScreensaverConfig();
    if (!config) return;
    screensaverConfigRef.current = config;
    setRememberedScreensaverCycleSeconds(config.swapSeconds);
    setScreensaverShowDebug(screensaverShowDebugDraft);
    setGlobalAudioVizModulation("screensaver", buildGlobalModulation(screensaverAudioGlobalConnectionsDraft, screensaverAudioGlobalNormalizedMetricsDraft));
    setShowScreensaverDialog(false);
    void startScreensaver(config);
  }, [
    buildGlobalModulation,
    buildScreensaverConfig,
    screensaverAudioGlobalConnectionsDraft,
    screensaverAudioGlobalNormalizedMetricsDraft,
    screensaverShowDebugDraft,
    startScreensaver,
  ]);

  const openAudioModEditor = useCallback((entryId: string, anchorRect?: DOMRect) => {
    const entry = state.chain.find((item) => item.id === entryId);
    if (!entry) return;
    setShowChainAudioGlobalEditor(false);
    setEditingAudioEntryId(entryId);
    setAudioModConnectionsDraft(buildAudioConnectionDraft(entry.audioMod));
    setAudioModNormalizedMetricsDraft(buildNormalizedMetricsDraft(entry.audioMod));
    setAudioEditorPosition((current) => getAnchoredDialogPosition(anchorRect, current, { width: 820, height: 760 }));
    requestAudioVizPermissions("chain");
  }, [requestAudioVizPermissions, state.chain]);

  const closeAudioModEditor = useCallback(() => {
    setEditingAudioEntryId(null);
  }, []);

  useEffect(() => {
    if (!editingAudioEntryId) return;
    actions.setChainAudioModulation(
      editingAudioEntryId,
      buildGlobalModulation(audioModConnectionsDraft, audioModNormalizedMetricsDraft),
    );
  }, [actions, audioModConnectionsDraft, audioModNormalizedMetricsDraft, buildGlobalModulation, editingAudioEntryId]);

  const saveAudioModEditor = useCallback(() => {
    setEditingAudioEntryId(null);
  }, []);

  const openChainAudioGlobalEditor = useCallback((anchorRect?: DOMRect) => {
    const modulation = getGlobalAudioVizModulation("chain");
    setEditingAudioEntryId(null);
    setShowChainAudioGlobalEditor(true);
    setChainAudioGlobalConnectionsDraft(buildAudioConnectionDraft(modulation));
    setChainAudioGlobalNormalizedMetricsDraft(buildNormalizedMetricsDraft(modulation));
    setAudioEditorPosition((current) => getAnchoredDialogPosition(anchorRect, current, { width: 820, height: 760 }));
    requestAudioVizPermissions("chain");
  }, [requestAudioVizPermissions]);

  useEffect(() => {
    if (!showChainAudioGlobalEditor) return;
    setGlobalAudioVizModulation("chain", buildGlobalModulation(chainAudioGlobalConnectionsDraft, chainAudioGlobalNormalizedMetricsDraft));
  }, [buildGlobalModulation, chainAudioGlobalConnectionsDraft, chainAudioGlobalNormalizedMetricsDraft, showChainAudioGlobalEditor]);

  const saveChainAudioGlobalEditor = useCallback(() => {
    setShowChainAudioGlobalEditor(false);
  }, []);

  const saveCurrentChain = useCallback(() => {
    const name = prompt("Save chain as:");
    if (!name) return;
    const stateJson = actions.exportState(state);
    const filters = state.chain.map((entry) => entry.displayName);
    const data = { name, desc: filters.join(" -> "), filters, stateJson };
    localStorage.setItem(`_chain_${name}`, JSON.stringify(data));
    window.dispatchEvent(new Event("ditherer-saved-chains-change"));
  }, [actions, state]);

  const exportCurrentChain = useCallback(() => {
    const url = actions.getExportUrl(state);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    window.alert(`Share URL copied:\n\n${url}`);
  }, [actions, state]);

  const fitInputToWindow = useCallback(() => {
    if (!state.inputImage) return;

    const sidebarRight = chromeRef.current?.getBoundingClientRect().right ?? 0;
    const horizontalPadding = 36;
    const verticalPadding = 48;
    const frameAllowance = 24; // input window chrome around the canvas

    const availableWidth = Math.max(
      120,
      window.innerWidth - sidebarRight - horizontalPadding - frameAllowance
    );
    const availableHeight = Math.max(
      120,
      window.innerHeight - verticalPadding - frameAllowance
    );

    const fitScale = Math.min(
      availableWidth / state.inputImage.width,
      availableHeight / state.inputImage.height
    );

    const clampedScale = Math.max(0.05, Math.min(16, fitScale));
    actions.setScale(Math.round(clampedScale * 100) / 100);
  }, [actions, state.inputImage]);

  const editingAudioEntry = editingAudioEntryId
    ? state.chain.find((entry) => entry.id === editingAudioEntryId) ?? null
    : null;
  useEffect(() => {
    if ((!editingAudioEntry && !showChainAudioGlobalEditor) || !audioEditorRef.current) return;
    zIndexRef.current += 1;
    audioEditorRef.current.style.zIndex = `${zIndexRef.current}`;
  }, [editingAudioEntry, showChainAudioGlobalEditor]);
  const chainAudioGlobalActive = Boolean(getGlobalAudioVizModulation("chain"));
  const editingAudioRangeOptions = useMemo(() => (
    editingAudioEntry
      ? Object.entries(editingAudioEntry.filter.optionTypes || {}).filter(([optionName, optionType]) =>
          !optionName.startsWith("_") &&
          optionType.type === "RANGE" &&
          (typeof optionType.visibleWhen !== "function" || optionType.visibleWhen(editingAudioEntry.filter.options || {}))
        )
      : []
  ), [editingAudioEntry]);
  const chainWideRangeOptions = useMemo(() => (
    state.chain.flatMap((entry, index) =>
      Object.entries(entry.filter.optionTypes || {})
        .filter(([optionName, optionType]) =>
          !optionName.startsWith("_") &&
          optionType.type === "RANGE" &&
          (typeof optionType.visibleWhen !== "function" || optionType.visibleWhen(entry.filter.options || {}))
        )
        .map(([optionName, optionType]) => [
          `${entry.id}:${optionName}`,
          {
            ...optionType,
            optionName,
            targetLabel: `${index + 1}. ${entry.displayName} / ${optionType.label || optionName}`,
          },
        ] as const)
    )
  ), [state.chain]);
  const chainWideOptionValues = useMemo(() => (
    Object.fromEntries(
      chainWideRangeOptions.map(([targetKey, optionType]) => {
        const optionName = optionType.optionName || targetKey;
        const separatorIndex = targetKey.indexOf(":");
        const entryId = separatorIndex >= 0 ? targetKey.slice(0, separatorIndex) : targetKey;
        const entry = state.chain.find((item) => item.id === entryId);
        return [targetKey, entry?.filter.options?.[optionName]];
      }),
    )
  ), [chainWideRangeOptions, state.chain]);
  const chainStructureSignature = useMemo(
    () => state.chain.map((entry) => `${entry.id}:${entry.displayName}:${entry.enabled ? 1 : 0}`).join("|"),
    [state.chain],
  );

  useEffect(() => {
    if (!chainAudioAutoVizOnChainChange || chainWideRangeOptions.length === 0) return;
    const next = buildAutoVizConnections(chainAudioAutoVizMode, chainWideRangeOptions, chainAudioGlobalConnectionsDraft);
    setChainAudioGlobalConnectionsDraft(next.connections);
    setChainAudioGlobalNormalizedMetricsDraft(next.normalizedMetrics);
    setGlobalAudioVizModulation("chain", buildGlobalModulation(next.connections, next.normalizedMetrics));
  }, [buildGlobalModulation, chainAudioAutoVizMode, chainAudioAutoVizOnChainChange, chainStructureSignature, chainWideRangeOptions]);

  useEffect(() => {
    if (!screensaverAudioAutoVizOnChainChange || chainWideRangeOptions.length === 0) return;
    const next = buildAutoVizConnections(screensaverAudioAutoVizMode, chainWideRangeOptions, screensaverAudioGlobalConnectionsDraft);
    setScreensaverAudioGlobalConnectionsDraft(next.connections);
    setScreensaverAudioGlobalNormalizedMetricsDraft(next.normalizedMetrics);
    setGlobalAudioVizModulation("screensaver", buildGlobalModulation(next.connections, next.normalizedMetrics));
  }, [buildGlobalModulation, chainStructureSignature, chainWideRangeOptions, screensaverAudioAutoVizMode, screensaverAudioAutoVizOnChainChange]);

  const resolvePresetFilter = useCallback((entry: PresetFilterEntry) => {
    const match = filterList.find((f) => f && f.displayName === entry.name);
    if (!match) return null;
    return {
      displayName: entry.name,
      filter: {
        ...match.filter,
        options: {
          ...(match.filter.defaults || match.filter.options || {}),
          ...(entry.options || {}),
        },
      },
    };
  }, [filterList]);

  const loadPresetFromFilters = useCallback((presetFilters: PresetFilterEntry[]) => {
    if (!presetFilters.length) return;
    const first = resolvePresetFilter(presetFilters[0]);
    if (!first) return;
    actions.selectFilter(first.displayName, first.filter);
    for (let i = 1; i < presetFilters.length; i++) {
      const resolved = resolvePresetFilter(presetFilters[i]);
      if (resolved) actions.chainAdd(resolved.displayName, resolved.filter);
    }
  }, [actions, resolvePresetFilter]);

  const findPresetsForActiveFilter = useCallback(() => {
    const activeName = state.chain[state.activeIndex]?.displayName;
    if (!activeName) return;

    const matches = CHAIN_PRESETS.filter((preset) =>
      preset.filters.some((entry) => entry.name === activeName)
    );

    if (matches.length === 0) {
      window.alert(`No presets currently use "${activeName}".`);
      return;
    }

    const promptText = [
      `Presets using "${activeName}":`,
      ...matches.map((preset, idx) => `${idx + 1}. ${preset.name}`),
      "",
      "Enter number to load preset (Cancel to keep current chain).",
    ].join("\n");

    const raw = window.prompt(promptText, "1");
    if (!raw) return;
    const picked = Number.parseInt(raw, 10);
    if (!Number.isFinite(picked) || picked < 1 || picked > matches.length) {
      window.alert("Invalid selection.");
      return;
    }
    loadPresetFromFilters(matches[picked - 1].filters);
  }, [loadPresetFromFilters, state.activeIndex, state.chain]);

  const applyChain = useCallback(() => {
    setFiltering(true);
    document.body.style.cursor = "wait";
    requestAnimationFrame(() => {
      actions.filterImageAsync(inputCanvasRef.current);
      setFiltering(false);
      document.body.style.cursor = "";
    });
  }, [actions]);

  const workbenchCommands = [
    { label: "Apply filter chain", hint: "Enter", run: applyChain },
    { label: "Undo", hint: "Ctrl/⌘ Z", disabled: !canUndo, run: () => restoreHistory(-1) },
    { label: "Redo", hint: "Ctrl/⌘ Shift Z", disabled: !canRedo, run: () => restoreHistory(1) },
    { label: "Dock canvases", hint: "Layout", run: () => { setWorkspaceLayout("docked"); setWindowsLocked(true); } },
    { label: "Float canvases", hint: "Layout", run: () => { setWorkspaceLayout("floating"); setWindowsLocked(false); } },
    { label: "Toggle output-only view", hint: "Layout", run: () => setWorkspaceLayout((layout) => layout === "output" ? "docked" : "output") },
    { label: "Toggle before/after comparison", hint: "Preview", run: () => setComparisonEnabled((value) => !value) },
    { label: "Save current chain", hint: "Project", run: saveCurrentChain },
    { label: "Copy share link", hint: "Project", run: exportCurrentChain },
    { label: "Export image or video", hint: "Export", run: openExport },
  ].filter((command) => command.label.toLowerCase().includes(commandQuery.trim().toLowerCase()));
  const activeCommand = workbenchCommands[commandActiveIndex];
  const effectiveCommandActiveIndex = activeCommand && !activeCommand.disabled
    ? commandActiveIndex
    : workbenchCommands.findIndex((command) => !command.disabled);

  const moveCommandSelection = (direction: -1 | 1) => {
    const enabledIndexes = workbenchCommands
      .map((command, index) => command.disabled ? -1 : index)
      .filter((index) => index >= 0);
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(effectiveCommandActiveIndex);
    const nextPosition = position < 0
      ? (direction > 0 ? 0 : enabledIndexes.length - 1)
      : (position + direction + enabledIndexes.length) % enabledIndexes.length;
    setCommandActiveIndex(enabledIndexes[nextPosition]);
  };

  const runActiveCommand = () => {
    const command = workbenchCommands[effectiveCommandActiveIndex];
    if (!command || command.disabled) return;
    command.run();
    setShowCommandPalette(false);
  };

  return (
    <div className={s.app} data-active-task={activeTask}>
      <div className={s.chrome} ref={chromeRef}>
        <h1>ＤＩＴＨＥＲＥＲ ▓▒░</h1>
        {showOnboarding && (
          <aside className={s.onboarding} aria-label="Getting started">
            <strong>Ready to remix</strong>
            <span>A sample video and starter dither are already running. Choose a look, tune it, then swap in your own media.</span>
            <span>1 Choose a look → 2 Adjust → 3 Replace media → 4 Export</span>
            <div>
              <button onClick={() => {
                completeOnboarding();
                navigateToTask("compose");
                setOpenPresetLibraryRequest((request) => request + 1);
              }}>Browse looks</button>
              <button onClick={() => {
                completeOnboarding();
                navigateToTask("source");
                sourceFileInputRef.current?.click();
              }}>Use my media</button>
              <button onClick={completeOnboarding}>Dismiss</button>
            </div>
          </aside>
        )}

        {(() => {
          const taskIndex = WORKBENCH_TASKS.findIndex((task) => task.id === activeTask);
          const task = WORKBENCH_TASKS[taskIndex];
          return (
            <section className={s.taskContext} aria-labelledby="active-task-title" aria-live="polite">
              <span className={s.taskContextStep}>Step {taskIndex + 1} of {WORKBENCH_TASKS.length}</span>
              <strong id="active-task-title">{task.title}</strong>
              <span>{task.description}</span>
            </section>
          );
        })()}

        {/* Input section */}
        <div id="source-task" className={s.sourceTask}>
          <h2>Input</h2>
          <div
            className={[controls.group, dropping ? controls.dropping : null].join(" ")}
            onDragLeave={() => setDropping(false)}
            onDragOver={() => setDropping(true)}
            onDragEnter={() => setDropping(true)}
            onDrop={() => setDropping(false)}
          >
            <span className={controls.name}>File</span>
            <input
              id="imageLoader"
              ref={sourceFileInputRef}
              className={[controls.file, s.nativeFileInput].join(" ")}
              type="file"
              accept="image/*,video/*"
              onChange={e => {
                loadUserFile(e.target.files?.[0] || null);
                e.target.value = "";
              }}
              title="Load an image or video file"
              aria-label="Choose an image or video file"
            />
            <p className={s.inputHelpText}>
              {state.inputImage || state.video
                ? "Paste, drag, or choose media to replace the current input."
                : "Paste, drag, or choose an image or video to get started."}
            </p>
            {inputLoadError && (
              <div className={s.inputError} role="alert">
                <span>{inputLoadError}</span>
                <button type="button" onClick={() => setInputLoadError(null)}>Dismiss</button>
              </div>
            )}
          </div>
          <div className={[controls.group, s.testMediaPicker].join(" ")}>
            <span className={controls.name}>Examples</span>
            <div className={s.testMediaToolbar}>
              <select
                id="test-image-select"
                className={s.testMediaTrigger}
                value=""
                onChange={(e) => loadTestImageFromSrc(e.target.value)}
                title="Load a test image"
                aria-label="Choose an example image"
              >
                <option value="" disabled>Image...</option>
                {TEST_IMAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className={s.testMediaButton}
                onClick={loadRandomTestImage}
                title="Load a random test image"
              >
                Img?
              </button>
              <select
                id="test-video-select"
                className={s.testMediaTrigger}
                value=""
                onChange={(e) => loadTestVideoFromSrc(e.target.value)}
                title="Load a test video"
                aria-label="Choose an example video"
              >
                <option value="" disabled>Video...</option>
                {TEST_VIDEO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className={s.testMediaButton}
                onClick={loadRandomTestVideo}
                title="Load a random test video"
              >
                Vid?
              </button>
            </div>
          </div>
          {(state.inputImage || state.video) && (
            <CollapsibleSection title="Input Tweaks">
              <fieldset className={[controls.optionGroup, s.inputTweaks].join(" ")}>
                <legend className={controls.optionGroupLegend}>Input Tweaks</legend>
                <Range
                  name="Input Scale"
                  types={{ range: [0.05, 16], desc: INPUT_SCALE_HELP }}
                  step={0.05}
                  onSetFilterOption={(_, value) => actions.setScale(Number(value))}
                  value={state.scale}
                  defaultValue={1}
                />
                {state.video && state.inputImage ? (
                  <div className={s.inputTweakRow}>
                    <button
                      onClick={fitInputToWindow}
                      title="Scale the input video to comfortably fit the browser area right of the sidebar"
                    >
                      Fit to window
                    </button>
                    <label className={[controls.checkbox, s.inputTweakCheck].join(" ")}>
                      <input
                        name="preserveInputWidthOnNewMedia"
                        type="checkbox"
                        checked={preserveInputWidthOnNewMedia}
                        onChange={e => setPreserveInputWidthOnNewMedia(e.target.checked)}
                      />
                      <span className={controls.label}>
                        Fix input width
                        <InfoHint text={FIX_INPUT_WIDTH_HELP} />
                      </span>
                    </label>
                  </div>
                ) : (
                  <label className={controls.checkbox}>
                    <input
                      name="preserveInputWidthOnNewMedia"
                      type="checkbox"
                      checked={preserveInputWidthOnNewMedia}
                      onChange={e => setPreserveInputWidthOnNewMedia(e.target.checked)}
                    />
                    <span className={controls.label}>
                      Fix input width on new media
                      <InfoHint text={FIX_INPUT_WIDTH_HELP} />
                    </span>
                  </label>
                )}
                {state.video && (<>
                  <div className={controls.separator} />
                  <div className={s.videoSeekRow}>
                    <span className={controls.label}>Position</span>
                    <button
                      className={s.videoFrameStep}
                      onClick={() => stepVideoFrame(-1)}
                      title="Step backward by roughly one frame"
                    >
                      &lt;
                    </button>
                    <input
                      className={s.videoSeek}
                      type="range"
                      min={0}
                      max={Number.isFinite(state.video?.duration) && state.video && state.video.duration > 0 ? state.video.duration : 0}
                      step={0.01}
                      value={Math.min(
                        seekDraftTime ?? state.time ?? 0,
                        Number.isFinite(state.video?.duration) ? state.video?.duration || 0 : 0
                      )}
                      onInput={(e) => seekVideo(Number((e.target as HTMLInputElement).value))}
                      onChange={(e) => flushSeekVideo(Number(e.target.value))}
                      disabled={!state.video || !Number.isFinite(state.video.duration) || state.video.duration <= 0}
                      title="Seek through the loaded video"
                      aria-label="Video position"
                    />
                    <button
                      className={s.videoFrameStep}
                      onClick={() => stepVideoFrame(1)}
                      title="Step forward by roughly one frame"
                    >
                      &gt;
                    </button>
                    <span className={s.videoSeekTime}>{formatVideoTime(state.time)} / {formatVideoTime(state.video?.duration)}</span>
                  </div>
                  <div className={s.videoControlRow}>
                    <button onClick={() => { actions.toggleVideo(); flashPlayPause(videoPaused ? "play" : "pause"); }}>
                      {videoPaused ? "\u25B6 Play" : "\u23F8 Pause"}
                    </button>
                    <label className={[controls.label, s.videoRateInline].join(" ")} htmlFor="playback-rate-inline">
                      <span>Rate</span>
                      <input
                        id="playback-rate-inline"
                        className={s.videoRateSlider}
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={state.videoPlaybackRate}
                        onChange={(e) => actions.setInputPlaybackRate(Number(e.target.value))}
                        title="Adjust playback rate"
                      />
                      <span className={s.videoRateValue}>{state.videoPlaybackRate.toFixed(2)}x</span>
                    </label>
                    <label className={controls.label} htmlFor="mute">
                      <input
                        id="mute"
                        type="checkbox"
                        checked={state.videoVolume === 0}
                        onChange={() => {
                          const newVol = state.videoVolume > 0 ? 0 : 1;
                          actions.setInputVolume(newVol);
                          localStorage.setItem("ditherer-mute", newVol === 0 ? "1" : "0");
                        }}
                      />
                      Mute
                    </label>
                  </div>
                </>)}
              </fieldset>
            </CollapsibleSection>
          )}
        </div>

        {/* Algorithm section */}
        <div id="compose-task" className={s.composeTask}>
        <CollapsibleSection title={activeTask === "adjust" ? "Filter settings" : "Stages"} defaultOpen>
          <div className={["filterOptions", s.filterOptions].join(" ")}>
            <div className={s.chainComposer} id="chain-composer">
              <ChainList
                onEditAudioMod={openAudioModEditor}
                onEditChainAudioMod={openChainAudioGlobalEditor}
                chainAudioActive={chainAudioGlobalActive}
                openPresetLibraryRequest={openPresetLibraryRequest}
              />
            </div>
            <div
              className={[controls.group, s.filterInspector].join(" ")}
              id="active-filter-options"
              role="region"
              aria-label="Active filter parameters"
            >
              <div className={s.filterInspectorHeader}>
                <span className={s.filterInspectorKicker}>
                  Stage {state.activeIndex + 1} of {state.chain.length} · Parameters
                </span>
                <strong className={s.filterInspectorTitle}>
                  {state.chain[state.activeIndex]?.displayName ?? "Options"}
                </strong>
                {(() => {
                  const activeName = state.chain[state.activeIndex]?.displayName;
                  const activeFilter = filterList.find((entry) => entry?.displayName === activeName);
                  return activeFilter?.description ? (
                    <span className={s.filterInspectorDescription}>{activeFilter.description}</span>
                  ) : null;
                })()}
              </div>
              <input
                className={s.inspectorSearch}
                type="search"
                value={inspectorQuery}
                onChange={(event) => setInspectorQuery(event.target.value)}
                placeholder="Search this filter’s settings…"
                aria-label="Search active filter settings"
              />
              <Controls inputCanvas={inputCanvasRef.current} query={inspectorQuery} />
              <div className={s.inspectorActions} aria-label="Active filter actions">
                {state.selected?.filter?.defaults && (
                  <button
                    onClick={() => {
                      const name = state.selected.displayName || state.selected.name;
                      const filter = filterList.find(f => f && f.displayName === name);
                      if (filter) {
                        const entry = state.chain[state.activeIndex];
                        if (entry) actions.chainReplace(entry.id, name, filter.filter);
                      }
                    }}
                  >
                    Reset all
                  </button>
                )}
                {state.chain[state.activeIndex] && (
                  <button
                    onClick={findPresetsForActiveFilter}
                    title="Find presets that include the active filter"
                  >
                    Find presets
                  </button>
                )}
                {state.chain[state.activeIndex] && (
                  <button
                    onClick={(event) => openAudioModEditor(
                      state.chain[state.activeIndex].id,
                      event.currentTarget.getBoundingClientRect(),
                    )}
                    title="Map audio visualizer to this filter's numeric parameters"
                  >
                    Audio mapping…
                  </button>
                )}
              </div>
            </div>
            <div className={s.pipelineOptions}>
              <div className={controls.separator} />
              <label className={controls.checkbox}>
                <input
                  name="convertGrayscale"
                  type="checkbox"
                  checked={state.convertGrayscale}
                  onChange={e => actions.setConvertGrayscale(e.target.checked)}
                />
                <span className={controls.label}>
                  Pre-convert to grayscale
                  <InfoHint text={GRAYSCALE_HELP} />
                </span>
              </label>
              <label className={controls.checkbox}>
                <input
                  name="linearize"
                  type="checkbox"
                  checked={state.linearize}
                  onChange={e => actions.setLinearize(e.target.checked)}
                />
                <span className={controls.label}>
                  Gamma-correct input
                  <InfoHint text={GAMMA_HELP} />
                </span>
              </label>
            </div>
          </div>
        </CollapsibleSection>
        </div>

        {/* Filter button — always visible, sticky on mobile */}
        <div className={[s.filterBar, s.composeTask].join(" ")}>
          <button
            className={[s.filterButton, s.waitButton].join(" ")}
            disabled={filtering}
            onClick={applyChain}
          >
            {filtering ? "▓░ Processing…" : "Apply Chain"}
          </button>
          <div className={s.applyStatus} role="status" aria-live="polite">
            {filtering
              ? "Processing current chain"
              : state.realtimeFiltering
                ? "Auto apply on · output updates as you edit"
                : state.inputFrameToken !== state.outputFrameToken
                  ? "Output is stale · apply the chain to refresh"
                  : "Manual apply · output is current"}
          </div>
        </div>

        {/* Output section */}
        <div className={s.outputSettingsTask} id="preview-output-settings">
        <CollapsibleSection title="Output" defaultOpen>
          <Range
            name="Output Scale"
            types={{ range: [0.05, 16], desc: OUTPUT_SCALE_HELP }}
            step={0.05}
            onSetFilterOption={(_, value) => actions.setOutputScale(Number(value))}
            value={state.outputScale}
            defaultValue={1}
          />
          <Enum
            name="Scaling algorithm"
            onSetFilterOption={(_, algorithm) => actions.setScalingAlgorithm(String(algorithm))}
            value={state.scalingAlgorithm}
            defaultValue={SCALING_ALGORITHM.PIXELATED}
            types={{ ...SCALING_ALGORITHM_OPTIONS, desc: SCALING_ALGORITHM_HELP }}
          />
          <button
            className={s.copyButton}
            onClick={async () => {
              // For video sources: record the filtered output canvas for one full
              // loop of the source video, then load it back as a new video input.
              // This bakes the current filter chain into the video.
              if (state.video && outputCanvasRef.current) {
                const canvas = outputCanvasRef.current;
                const stream = canvas.captureStream(30);
                // Pick a supported mime type
                const mimeCandidates = [
                  "video/webm;codecs=vp9",
                  "video/webm;codecs=vp8",
                  "video/webm",
                ];
                const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
                const chunks: BlobPart[] = [];
                const recorder = new MediaRecorder(stream, { mimeType });
                recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
                recorder.onstop = () => {
                  const blob = new Blob(chunks, { type: mimeType });
                  const file = new File([blob], "filtered.webm", { type: mimeType });
                  syncSharedTestMediaUrl(null);
                  setInputFilename(file.name);
                  void withInputLoading("LOADING VIDEO", () =>
                    actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate)
                  );
                };

                // Restart video from beginning so we capture a full loop
                const v = state.video;
                const wasPaused = v.paused;
                try { v.currentTime = 0; } catch { /* ignore */ }
                if (wasPaused) await v.play().catch(() => {});

                const duration = isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
                recorder.start();
                window.setTimeout(() => {
                  if (recorder.state !== "inactive") recorder.stop();
                  stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
                }, duration * 1000 + 100);
                return;
              }

              // For static images: copy the current filtered frame
              if (outputCanvasRef.current) {
                void withInputLoading("LOADING IMAGE", () => new Promise<void>((resolve, reject) => {
                  const image = new Image();
                  image.onload = () => {
                    syncSharedTestMediaUrl(null);
                    actions.loadImage(image);
                    actions.setScale(1);
                    setInputFilename("filtered-output.png");
                    resolve();
                  };
                  image.onerror = () => reject(new Error("Failed to copy output image to input"));
                  image.src = outputCanvasRef.current?.toDataURL("image/png") ?? "";
                }));
              }
            }}
          >
            {"<< Copy output to input"}
          </button>
        </CollapsibleSection>
        </div>

        {activeTask !== "export" && (() => {
          const taskIndex = WORKBENCH_TASKS.findIndex((task) => task.id === activeTask);
          const previousTask = WORKBENCH_TASKS[taskIndex - 1];
          const nextTask = WORKBENCH_TASKS[taskIndex + 1];
          return (
            <nav className={s.taskProgress} aria-label="Workflow progress">
              {previousTask ? (
                <button className={s.taskBack} onClick={() => navigateToTask(previousTask.id)}>
                  ← {previousTask.label}
                </button>
              ) : <span />}
              {nextTask && (
                <button
                  className={s.taskNext}
                  onClick={() => nextTask.id === "export" ? openExport() : navigateToTask(nextTask.id)}
                >
                  Next: {nextTask.label} →
                </button>
              )}
            </nav>
          );
        })()}

        {/* Settings section */}
        <div className={s.settingsTask}>
        <CollapsibleSection title="Settings" collapsible>
          <label className={controls.checkbox}>
            <input
              name="realtimeFiltering"
              type="checkbox"
              checked={state.realtimeFiltering}
              onChange={e => actions.setRealtimeFiltering(e.target.checked)}
            />
            <span className={controls.label}>
              Apply automatically
            </span>
          </label>
          <label className={controls.checkbox}>
            <input
              name="wasmAcceleration"
              type="checkbox"
              checked={state.wasmAcceleration}
              onChange={e => actions.setWasmAcceleration(e.target.checked)}
            />
            <span className={controls.label}>
              WASM acceleration
            </span>
          </label>
          <label className={controls.checkbox}>
            <input
              name="webglAcceleration"
              type="checkbox"
              checked={state.webglAcceleration}
              onChange={e => actions.setWebglAcceleration(e.target.checked)}
            />
            <span className={controls.label}>
              WebGL acceleration
            </span>
          </label>
          <div className={controls.separator} />
          <label className={controls.checkbox}>
            <input
              name="theme"
              type="checkbox"
              checked={theme === "rainy-day"}
              onChange={e => {
                const newTheme = e.target.checked ? "rainy-day" : "default";
                setTheme(newTheme);
                localStorage.setItem("ditherer-theme", newTheme);
                if (newTheme === "rainy-day") {
                  document.documentElement.setAttribute("data-theme", "rainy-day");
                } else {
                  document.documentElement.removeAttribute("data-theme");
                }
              }}
            />
            <span className={controls.label}>
              Rainy Day theme
            </span>
          </label>
          <div className={controls.separator} />
          <Exporter />
        </CollapsibleSection>
        </div>

        {state.frameTime != null && (
          <div className={[s.perfStats, state.frameTime > 50 ? s.perfStatsSlow : ""].join(" ")}>
            {state.stepTimes && state.stepTimes.length > 1
              ? `${state.stepTimes.length} filters`
              : state.stepTimes?.[0]?.name ?? "Filter"
            } | {state.frameTime.toFixed(0)}ms | {(1000 / state.frameTime).toFixed(1)} fps
            {state.frameTime > 50 ? " · Try a lower input scale or fewer temporal filters" : " · Realtime ready"}
          </div>
        )}
        <div className={s.github}>
          <a href="https://github.com/gyng/ditherer/">GitHub</a>
          <WebMCPBadge status={webMCPStatus} />
        </div>
      </div>

      {/* Task navigation and canvas workbench */}
      <main className={s.workspace}>
        <nav ref={workspaceToolbarRef} className={s.workspaceToolbar} aria-label="Workbench tasks and layout">
          <div className={s.taskNav}>
            <span className={s.toolbarLabel}>Workflow</span>
            {WORKBENCH_TASKS.map((task, index) => (
              <button
                key={task.id}
                aria-current={activeTask === task.id ? "page" : undefined}
                title={`Step ${index + 1}: ${task.title}`}
                onClick={() => {
                  if (task.id === "export") {
                    openExport();
                  } else {
                    navigateToTask(task.id);
                    if (task.id === "preview") {
                      requestAnimationFrame(() => outputWindowRef.current?.focus());
                    }
                  }
                }}
              >
                <span className={s.taskNumber} aria-hidden="true">{index + 1}</span>
                <span>{task.label}</span>
              </button>
            ))}
          </div>
          <div className={s.layoutTools}>
            <span className={s.toolbarLabel}>Layout</span>
            <button onClick={() => restoreHistory(-1)} disabled={!canUndo} title="Undo (Ctrl/Command Z)" aria-label="Undo">↶</button>
            <button onClick={() => restoreHistory(1)} disabled={!canRedo} title="Redo (Ctrl/Command Shift Z)" aria-label="Redo">↷</button>
            <button
              aria-pressed={workspaceLayout === "docked"}
              onClick={() => { setWorkspaceLayout("docked"); setWindowsLocked(true); }}
              title="Dock input and output side by side"
            >Dock</button>
            <button
              aria-pressed={workspaceLayout === "floating"}
              onClick={() => { setWorkspaceLayout("floating"); setWindowsLocked(false); }}
              title="Float canvas windows"
            >Float</button>
            <button
              aria-pressed={workspaceLayout === "output"}
              onClick={() => setWorkspaceLayout(workspaceLayout === "output" ? "docked" : "output")}
              title="Show only the output canvas"
            >Output only</button>
            <button
              aria-pressed={comparisonEnabled}
              onClick={() => setComparisonEnabled((value) => !value)}
              title="Compare source and output with a split view"
            >Compare</button>
            <button
              aria-pressed={windowsLocked}
              disabled={workspaceLayout !== "floating"}
              onClick={() => setWindowsLocked((value) => !value)}
              title="Lock floating canvas positions"
            >Lock</button>
            <button onClick={() => {
              const sidebarRight = chromeRef.current?.getBoundingClientRect().right || 350;
              const toolbarBottom = workspaceToolbarRef.current?.getBoundingClientRect().bottom ?? 44;
              const windowTop = Math.round(toolbarBottom + 10);
              setInputWindowPosition({ x: Math.round(sidebarRight + 10), y: windowTop });
              setOutputWindowPosition({ x: Math.round(sidebarRight + 430), y: windowTop });
            }} title="Reset floating canvas positions">Reset</button>
            <button onClick={fitInputToWindow} title="Fit the input in the available workspace">Fit</button>
            <button onClick={() => { setCommandQuery(""); setCommandActiveIndex(0); setShowCommandPalette(true); }} title="Open command palette (Ctrl/Command K or /)">Commands…</button>
          </div>
          <div className={s.exportTools} role="group" aria-label="Save and export">
            <span className={s.toolbarLabel}>Project</span>
            <button onClick={saveCurrentChain}>Save chain</button>
            <button onClick={exportCurrentChain}>Share</button>
            <button onClick={openExport}>Export…</button>
          </div>
        </nav>
        <div className={s.workspaceStatus} role="status" aria-live="polite">
          <span className={s.statusMode} data-active={state.realtimeFiltering ? "true" : "false"}>
            <span className={s.statusLamp} aria-hidden="true" />
            {state.realtimeFiltering ? "AUTO" : "MANUAL"}
          </span>
          <span>{state.chain.filter((entry) => entry.enabled).length}/{state.chain.length} stages active</span>
          {state.inputCanvas ? <span>IN {state.inputCanvas.width}×{state.inputCanvas.height}</span> : <span>NO INPUT</span>}
          {state.outputImage ? <span>OUT {state.outputImage.width}×{state.outputImage.height}</span> : <span>OUTPUT PENDING</span>}
          {state.frameTime != null ? <span>{state.frameTime.toFixed(1)}ms · {(1000 / state.frameTime).toFixed(1)} fps</span> : null}
          <span className={s.statusHint}>/ commands · Ctrl/⌘ Z undo</span>
        </div>
      <div className={[
        s.canvases,
        workspaceLayout === "floating" ? s.canvasesFloating : s.canvasesDocked,
        workspaceLayout === "output" ? s.canvasesOutputOnly : "",
      ].join(" ")}>
        <div
          className={[s.canvasWindow, s.inputCanvasWindow].join(" ")}
          ref={inputDragRef}
          role="presentation"
          onMouseDown={workspaceLayout === "floating" && !windowsLocked ? inputDrag.onMouseDown : undefined}
          onMouseDownCapture={bringToTop}
          onMouseMove={workspaceLayout === "floating" && !windowsLocked ? inputDrag.onMouseMove : undefined}
          onDragOver={e => { e.preventDefault(); setCanvasDropping(true); }}
          onDragLeave={() => setCanvasDropping(false)}
          onDrop={e => {
            e.preventDefault();
            setCanvasDropping(false);
            const file = e.dataTransfer.files[0];
            loadUserFile(file);
          }}
        >
          <div
            className={[controls.window, s.inputWindow, canvasDropping ? s.dropping : ""].join(" ")}
            style={!state.inputImage ? { minWidth: Math.round(200 * state.scale), minHeight: Math.round(200 * state.scale) } : undefined}
          >
            <div className={["handle", controls.titleBar].join(" ")}>
              {inputFilename ? `Input - ${inputFilename}` : "Input"}
            </div>
            <div className={s.canvasArea}>
              {(!state.inputImage || canvasDropping) && (
                <div
                  className={s.dropPlaceholder}
                  onClick={() => !canvasDropping && !inputDrag.didDrag.current && document.getElementById("imageLoader")?.click()}
                  style={{ cursor: canvasDropping ? undefined : "pointer" }}
                >
                  <span>{canvasDropping ? "Drop to load" : "Drop or click to load image/video"}</span>
                </div>
              )}
              <canvas
                className={[s.canvas, s[state.scalingAlgorithm]].join(" ")}
                ref={inputCanvasRefCb}
                onClick={() => {
                  if (state.video && !inputDrag.didDrag.current) {
                    actions.toggleVideo();
                    const nowPaused = !videoPaused;
                    setVideoPaused(nowPaused);
                    flashPlayPause(nowPaused ? "pause" : "play");
                  }
                }}
                style={state.video ? { cursor: "pointer" } : undefined}
              />
              {playPauseIndicator && (
                <div className={s.playPauseOverlay}>
                  {playPauseIndicator === "play" ? "▶ PLAY" : "❚❚ PAUSE"}
                </div>
              )}
              {inputLoadingLabel && (
                <div className={[s.playPauseOverlay, s.inputLoadingOverlay].join(" ")}>
                  {inputLoadingLabel}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className={[s.canvasWindow, s.outputCanvasWindow].join(" ")}
          ref={outputDragRef}
          role="presentation"
          onMouseDown={outputFullscreen || workspaceLayout !== "floating" || windowsLocked ? undefined : outputDrag.onMouseDown}
          onMouseDownCapture={bringToTop}
          onMouseMove={outputFullscreen || workspaceLayout !== "floating" || windowsLocked ? undefined : outputDrag.onMouseMove}
        >
          <div
            className={[
              controls.window,
              s.outputWindow,
              comparisonEnabled ? s.outputWindowComparing : "",
              outputFullscreen ? s.outputWindowFullscreen : "",
              outputFullscreen && fullscreenCursorHidden ? s.outputWindowFullscreenCursorHidden : "",
            ].join(" ")}
            ref={outputWindowRef}
            tabIndex={-1}
          >
            <div className={["handle", controls.titleBar, s.windowChrome].join(" ")}>
              {inputFilename ? `Output - ${inputFilename}` : "Output"}
            </div>
            <div className={[s.menuBar, s.windowChrome].join(" ")}>
              <button
                className={s.menuItem}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => {
                  openExport();
                }}
              >
                Save As...
              </button>
              <label className={s.menuSelectWrap} onMouseDown={e => e.stopPropagation()}>
                <select
                  className={s.menuSelect}
                  value={state.scalingAlgorithm}
                  onChange={(e) => actions.setScalingAlgorithm(e.target.value)}
                  title="Set output display scaling"
                  aria-label="Output display scaling"
                >
                  {SCALING_ALGORITHM_OPTIONS.options.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <div
                ref={fullscreenMenuRef}
                className={s.menuPopupWrap}
                onMouseDown={e => e.stopPropagation()}
              >
                <button
                  className={[s.menuItem, outputFullscreen || showFullscreenMenu ? s.menuItemActive : ""].join(" ")}
                  onClick={() => setShowFullscreenMenu((value) => !value)}
                  title="Choose fullscreen mode"
                >
                  Fullscreen
                </button>
                {showFullscreenMenu && (
                  <div className={s.menuPopup}>
                    <button
                      className={[s.menuPopupItem, outputFullscreenMode === "contain" ? s.menuPopupItemActive : ""].join(" ")}
                      onClick={() => {
                        setShowFullscreenMenu(false);
                        void toggleOutputFullscreen("contain");
                      }}
                    >
                      Contain
                    </button>
                    <button
                      className={[s.menuPopupItem, outputFullscreenMode === "cover" ? s.menuPopupItemActive : ""].join(" ")}
                      onClick={() => {
                        setShowFullscreenMenu(false);
                        void toggleOutputFullscreen("cover");
                      }}
                    >
                      Cover
                    </button>
                  </div>
                )}
              </div>
              <button
                ref={screensaverButtonRef}
                className={[s.menuItem, screensaverActive || showScreensaverDialog ? s.menuItemActive : ""].join(" ")}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => {
                  openScreensaverDialog();
                }}
                title={screensaverActive
                  ? "Screensaver active."
                  : "Configure and start screensaver."}
              >
                Screensaver
              </button>
            </div>
            <div className={s.outputCanvasStage}>
              <canvas
                className={[
                  s.canvas,
                  s[state.scalingAlgorithm],
                  outputFullscreen ? s.outputCanvasFullscreen : "",
                  outputFullscreenMode === "cover" ? s.outputCanvasCover : s.outputCanvasContain,
                ].join(" ")}
                ref={outputCanvasRefCb}
              />
              {comparisonEnabled && (
                <>
                  <canvas
                    ref={comparisonCanvasRef}
                    className={[
                      s.canvas,
                      s.comparisonCanvas,
                      comparisonHold ? s.comparisonCanvasHold : "",
                      s[state.scalingAlgorithm],
                    ].join(" ")}
                    style={{ "--compare-position": `${comparisonPosition}%` } as React.CSSProperties}
                    aria-label="Source side of before and after comparison"
                  />
                  <div
                    className={s.comparisonDivider}
                    style={{ left: `${comparisonPosition}%` }}
                    aria-hidden="true"
                  />
                  <div className={s.comparisonControl}>
                    <label className={s.comparisonSlider}>
                      <span>Split</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={comparisonPosition}
                        onChange={(event) => setComparisonPosition(Number(event.target.value))}
                        aria-label="Before / after"
                      />
                    </label>
                    <button
                      type="button"
                      aria-pressed={comparisonHold}
                      onPointerDown={() => setComparisonHold(true)}
                      onPointerUp={() => setComparisonHold(false)}
                      onPointerCancel={() => setComparisonHold(false)}
                      onPointerLeave={() => setComparisonHold(false)}
                      onKeyDown={(event) => {
                        if (event.key === " " || event.key === "Enter") setComparisonHold(true);
                      }}
                      onKeyUp={(event) => {
                        if (event.key === " " || event.key === "Enter") setComparisonHold(false);
                      }}
                      onBlur={() => setComparisonHold(false)}
                    >
                      Hold before
                    </button>
                  </div>
                </>
              )}
              {screensaverActive && screensaverShowDebug && (
                <ScreensaverDebugOverlay
                  chain={state.chain.map((entry) => ({
                    id: entry.id,
                    displayName: entry.displayName,
                    enabled: entry.enabled,
                  }))}
                  activeIndex={state.activeIndex}
                  chainSwapSeconds={getCurrentScreensaverCycleSeconds() ?? screensaverConfigRef.current.swapSeconds ?? null}
                  videoSwapEnabled={screensaverConfigRef.current.randomVideo}
                  videoSwapSeconds={screensaverVideoSwapSecondsRef.current}
                />
              )}
            </div>
          </div>
        </div>

        {showScreensaverDialog && (
          <div className={s.screensaverOverlay} onMouseDown={() => setShowScreensaverDialog(false)}>
            <div
              ref={screensaverDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Screensaver settings"
              tabIndex={-1}
              className={s.screensaverFloat}
              style={{ transform: `translate(${screensaverDialogPosition.x}px, ${screensaverDialogPosition.y}px)` }}
              onMouseDownCapture={bringToTop}
              onMouseDown={(e) => {
                e.stopPropagation();
                const target = e.target as HTMLElement | null;
                if (!target?.closest(".handle")) return;
                screensaverDrag.onMouseDown(e);
              }}
              onMouseMove={screensaverDrag.onMouseMove}
            >
            <div className={s.screensaverDialog} onMouseDown={e => e.stopPropagation()}>
              <div
                className={["handle", s.screensaverTitleBar].join(" ")}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  screensaverDrag.onMouseDown(event);
                }}
              >
                <span>Screensaver</span>
                <button
                  className={s.screensaverClose}
                  aria-label="Close screensaver settings"
                  onClick={() => setShowScreensaverDialog(false)}
                >
                  x
                </button>
              </div>
              <div className={s.screensaverButtons}>
                <button className={s.screensaverButton} onClick={confirmScreensaverDialog}>
                  Start
                </button>
                <button className={s.screensaverButton} onClick={() => setShowScreensaverDialog(false)}>
                  Cancel
                </button>
              </div>
              <div className={s.screensaverBody}>
                <div className={s.screensaverColumns}>
                <div className={s.screensaverColumnLeft}>
                <fieldset className={controls.optionGroup}>
                  <legend className={controls.optionGroupLegend}>Chain swap timing</legend>
                  <div className={s.screensaverRadioRow}>
                    <label className={s.screensaverRadioOption}>
                      <input
                        type="radio"
                        name="screensaverChainSwapMode"
                        checked={!screensaverBpmSwapEnabled}
                        onChange={() => setScreensaverBpmSwapEnabled(false)}
                      />
                      <span>Fixed interval</span>
                    </label>
                    <label className={s.screensaverRadioOption}>
                      <input
                        type="radio"
                        name="screensaverChainSwapMode"
                        checked={screensaverBpmSwapEnabled}
                        onChange={() => setScreensaverBpmSwapEnabled(true)}
                      />
                      <span>Sync to detected BPM</span>
                    </label>
                  </div>
                  {!screensaverBpmSwapEnabled ? (
                    <div className={s.screensaverFieldRow}>
                      <label className={s.screensaverField}>
                        <span>Seconds per swap</span>
                        <input
                          className={s.screensaverInput}
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={screensaverSwapSecondsDraft}
                          onChange={(e) => handleScreensaverSwapSecondsChange(e.target.value)}
                        />
                      </label>
                      <label className={s.screensaverField}>
                        <span>= BPM</span>
                        <input
                          className={s.screensaverInput}
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={screensaverSwapBpmDraft}
                          onChange={(e) => handleScreensaverSwapBpmChange(e.target.value)}
                        />
                      </label>
                    </div>
                  ) : (
                    <>
                      <label className={s.screensaverField}>
                        <span>Beats per swap</span>
                        <input
                          className={s.screensaverInput}
                          type="number"
                          min="0.25"
                          step="0.25"
                          value={screensaverBpmSwapBeats}
                          onChange={(event) => setScreensaverBpmSwapBeats(event.target.value)}
                        />
                      </label>
                      <div className={s.screensaverHint}>
                        {(() => {
                          const beatsPerSwap = Number.parseFloat(screensaverBpmSwapBeats);
                          const bpm = getChannelAudioVizSnapshot("screensaver").detectedBpm;
                          if (!Number.isFinite(beatsPerSwap) || !bpm || bpm <= 0) {
                            return "Waiting for a detected BPM from the screensaver audio input.";
                          }
                          const seconds = (60 / bpm) * beatsPerSwap;
                          return `Resolves to ~${seconds.toFixed(2)}s (${Math.round(bpm)} BPM × ${beatsPerSwap} beats). Updates live as tempo drifts.`;
                        })()}
                      </div>
                    </>
                  )}
                </fieldset>
                <fieldset className={controls.optionGroup}>
                  <legend className={controls.optionGroupLegend}>Random video swaps</legend>
                  <label className={s.screensaverCheck}>
                    <input
                      type="checkbox"
                      checked={screensaverRandomVideoDraft}
                      onChange={(e) => {
                        const nextChecked = e.target.checked;
                        setScreensaverRandomVideoDraft(nextChecked);
                        if (nextChecked) {
                          const swapSeconds = Number.parseFloat(screensaverSwapSecondsDraft);
                          if (Number.isFinite(swapSeconds) && swapSeconds > 0) {
                            setScreensaverVideoSwapSecondsDraft((swapSeconds * 4).toFixed(3).replace(/\.?0+$/, ""));
                          }
                        }
                      }}
                    />
                    <span>Auto swap random video</span>
                  </label>
                  {screensaverRandomVideoDraft && (
                    <>
                      <div className={[s.screensaverSubgroupLabel, controls.subsectionHeader].join(" ")}>Video swap timing</div>
                      <div className={s.screensaverRadioRow}>
                        <label className={s.screensaverRadioOption}>
                          <input
                            type="radio"
                            name="screensaverVideoSwapMode"
                            checked={!screensaverVideoBpmSwapEnabled}
                            onChange={() => setScreensaverVideoBpmSwapEnabled(false)}
                          />
                          <span>Fixed interval</span>
                        </label>
                        <label className={s.screensaverRadioOption}>
                          <input
                            type="radio"
                            name="screensaverVideoSwapMode"
                            checked={screensaverVideoBpmSwapEnabled}
                            onChange={() => setScreensaverVideoBpmSwapEnabled(true)}
                          />
                          <span>Sync to detected BPM</span>
                        </label>
                      </div>
                      {!screensaverVideoBpmSwapEnabled ? (
                        <label className={s.screensaverField}>
                          <span>Seconds per video swap</span>
                          <input
                            className={s.screensaverInput}
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={screensaverVideoSwapSecondsDraft}
                            onChange={(e) => setScreensaverVideoSwapSecondsDraft(e.target.value)}
                          />
                        </label>
                      ) : (
                        <>
                          <label className={s.screensaverField}>
                            <span>Beats per video swap</span>
                            <input
                              className={s.screensaverInput}
                              type="number"
                              min="0.25"
                              step="0.25"
                              value={screensaverVideoBpmSwapBeats}
                              onChange={(event) => setScreensaverVideoBpmSwapBeats(event.target.value)}
                            />
                          </label>
                          <div className={s.screensaverHint}>
                            {(() => {
                              const beatsPerSwap = Number.parseFloat(screensaverVideoBpmSwapBeats);
                              const bpm = getChannelAudioVizSnapshot("screensaver").detectedBpm;
                              if (!Number.isFinite(beatsPerSwap) || !bpm || bpm <= 0) {
                                return "Waiting for a detected BPM from the screensaver audio input.";
                              }
                              const seconds = (60 / bpm) * beatsPerSwap;
                              return `Resolves to ~${seconds.toFixed(2)}s (${Math.round(bpm)} BPM × ${beatsPerSwap} beats). Updates live as tempo drifts.`;
                            })()}
                          </div>
                        </>
                      )}
                      <div className={s.screensaverFieldRow}>
                        <label className={s.screensaverField}>
                          <span>Video width (px)</span>
                          <input
                            className={s.screensaverInput}
                            type="number"
                            min="1"
                            step="1"
                            value={screensaverVideoMaxWidthDraft}
                            onChange={(e) => setScreensaverVideoMaxWidthDraft(e.target.value)}
                          />
                        </label>
                        <label className={s.screensaverField}>
                          <span>Video scaling</span>
                          <select
                            className={s.screensaverInput}
                            value={screensaverScalingAlgorithmDraft}
                            onChange={(e) => setScreensaverScalingAlgorithmDraft(e.target.value)}
                          >
                            {SCALING_ALGORITHM_OPTIONS.options.map((option) => (
                              <option key={String(option.value)} value={String(option.value)}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className={s.screensaverHint}>
                        Input scale is clamped to the video width above for performance.
                      </div>
                    </>
                  )}
                </fieldset>
                <AudioVizControls
                  channel="screensaver"
                  title="Screensaver Audio"
                />
                <label className={s.screensaverCheck}>
                  <input
                    type="checkbox"
                    checked={screensaverShowDebugDraft}
                    onChange={(e) => setScreensaverShowDebugDraft(e.target.checked)}
                  />
                  <span>Show debug overlay on output</span>
                </label>
                </div>
                <div className={s.screensaverColumnRight}>
                <AudioPatchPanel
                  channel="screensaver"
                  rangeOptions={chainWideRangeOptions}
                  optionValues={chainWideOptionValues}
                  connections={screensaverAudioGlobalConnectionsDraft}
                  normalizedMetrics={screensaverAudioGlobalNormalizedMetricsDraft}
                  onNormalizedMetricsChange={setScreensaverAudioGlobalNormalizedMetricsDraft}
                  onConnectionsChange={setScreensaverAudioGlobalConnectionsDraft}
                  autoVizMode={screensaverAudioAutoVizMode}
                  onAutoVizModeChange={setScreensaverAudioAutoVizMode}
                  autoVizOnChainChange={screensaverAudioAutoVizOnChainChange}
                  onAutoVizOnChainChange={setScreensaverAudioAutoVizOnChainChange}
                  bodyTitle="Screensaver patch panel"
                />
                </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}

        {(editingAudioEntry || showChainAudioGlobalEditor) && (
          <div
            className={s.screensaverOverlay}
            onMouseDown={() => {
              closeAudioModEditor();
              setShowChainAudioGlobalEditor(false);
            }}
          >
            <div
              ref={audioEditorRef}
              role="dialog"
              aria-modal="true"
              aria-label={editingAudioEntry ? `Audio visualizer settings for ${editingAudioEntry.displayName}` : "Chain audio visualizer settings"}
              tabIndex={-1}
              className={s.audioModFloat}
              style={{ transform: `translate(${audioEditorPosition.x}px, ${audioEditorPosition.y}px)` }}
              onMouseDownCapture={bringToTop}
              onMouseMove={audioEditorDrag.onMouseMove}
            >
              <div className={s.audioModDialog} onMouseDown={(event) => event.stopPropagation()}>
                <div
                  className={["handle", s.screensaverTitleBar].join(" ")}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    audioEditorDrag.onMouseDown(event);
                  }}
                >
                  <span>{editingAudioEntry ? `Audio Viz - ${editingAudioEntry.displayName}` : "Chain Audio Viz"}</span>
                  <button
                    className={s.screensaverClose}
                    aria-label="Close audio visualizer settings"
                    onClick={() => {
                      closeAudioModEditor();
                      setShowChainAudioGlobalEditor(false);
                    }}
                  >
                    x
                  </button>
                </div>
                <div className={s.audioModBody}>
                  <div className={s.screensaverColumns}>
                    <div className={s.screensaverColumnLeft}>
                      {!editingAudioEntry ? (
                        <AudioVizControls channel="chain" title="Input" />
                      ) : (
                        <div className={s.screensaverHint}>
                          Audio input is shared with the chain channel. Configure source, mic and normalization from the chain-level editor.
                        </div>
                      )}
                      {!editingAudioEntry && (
                        <fieldset className={controls.optionGroup}>
                          <legend className={controls.optionGroupLegend}>Chain swap timing (from BPM)</legend>
                          <div className={s.screensaverRadioRow}>
                            <label className={s.screensaverRadioOption}>
                              <input
                                type="radio"
                                name="chainAudioSwapMode"
                                checked={!chainAudioBpmSwapEnabled}
                                onChange={() => setChainAudioBpmSwapEnabled(false)}
                              />
                              <span>Off</span>
                            </label>
                            <label className={s.screensaverRadioOption}>
                              <input
                                type="radio"
                                name="chainAudioSwapMode"
                                checked={chainAudioBpmSwapEnabled}
                                onChange={() => setChainAudioBpmSwapEnabled(true)}
                              />
                              <span>Sync to detected BPM</span>
                            </label>
                          </div>
                          {chainAudioBpmSwapEnabled && (
                            <>
                              <label className={s.screensaverField}>
                                <span>Beats per swap</span>
                                <input
                                  className={s.screensaverInput}
                                  type="number"
                                  min="0.25"
                                  step="0.25"
                                  value={chainAudioBpmSwapBeats}
                                  onChange={(event) => setChainAudioBpmSwapBeats(event.target.value)}
                                />
                              </label>
                              <div className={s.screensaverHint}>
                                {(() => {
                                  const beatsPerSwap = Number.parseFloat(chainAudioBpmSwapBeats);
                                  const bpm = getChannelAudioVizSnapshot("chain").detectedBpm;
                                  if (!Number.isFinite(beatsPerSwap) || !bpm || bpm <= 0) {
                                    return "Waiting for stable BPM detection.";
                                  }
                                  const seconds = (60 / bpm) * beatsPerSwap;
                                  return `Resolves to ~${seconds.toFixed(2).replace(/\.?0+$/, "")}s per random filter-chain swap at ${Math.round(bpm)} BPM. Updates live as tempo drifts.`;
                                })()}
                              </div>
                            </>
                          )}
                        </fieldset>
                      )}
                    </div>
                    <div className={s.screensaverColumnRight}>
                      <AudioPatchPanel
                        channel="chain"
                        rangeOptions={editingAudioEntry ? editingAudioRangeOptions : chainWideRangeOptions}
                        optionValues={editingAudioEntry ? (editingAudioEntry.filter.options || {}) : chainWideOptionValues}
                        connections={editingAudioEntry ? audioModConnectionsDraft : chainAudioGlobalConnectionsDraft}
                        normalizedMetrics={editingAudioEntry ? audioModNormalizedMetricsDraft : chainAudioGlobalNormalizedMetricsDraft}
                        onNormalizedMetricsChange={editingAudioEntry ? setAudioModNormalizedMetricsDraft : setChainAudioGlobalNormalizedMetricsDraft}
                        onConnectionsChange={editingAudioEntry ? setAudioModConnectionsDraft : setChainAudioGlobalConnectionsDraft}
                        {...(editingAudioEntry ? {} : {
                          autoVizMode: chainAudioAutoVizMode,
                          onAutoVizModeChange: setChainAudioAutoVizMode,
                          autoVizOnChainChange: chainAudioAutoVizOnChainChange,
                          onAutoVizOnChainChange: setChainAudioAutoVizOnChainChange,
                        })}
                      />
                    </div>
                  </div>
                </div>
                <div className={s.screensaverButtons}>
                  <button
                    className={s.screensaverButton}
                    onClick={() => {
                      if (editingAudioEntry) {
                        actions.setChainAudioModulation(editingAudioEntry.id, null);
                        closeAudioModEditor();
                      } else {
                        setGlobalAudioVizModulation("chain", null);
                        setShowChainAudioGlobalEditor(false);
                      }
                    }}
                  >
                    Clear
                  </button>
                  <button
                    className={s.screensaverButton}
                    onClick={() => {
                      if (editingAudioEntry) {
                        saveAudioModEditor();
                      } else {
                        saveChainAudioGlobalEditor();
                      }
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          className={s.dialogHost}
          ref={saveAsDragRef}
          role="presentation"
          onMouseDown={(e) => {
            const target = e.target as HTMLElement | null;
            if (!target?.closest(".handle")) return;
            saveAsDrag.onMouseDown(e);
          }}
          onMouseMove={saveAsDrag.onMouseMove}
          style={showSaveAs ? undefined : { display: "none" }}
        >
          {showSaveAs && (
            <div className={s.dialogOverlay} onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeExport();
            }}>
            <SaveAs
              outputCanvasRef={outputCanvasRef}
              onClose={closeExport}
            />
            </div>
          )}
        </div>
      </div>
      {showCommandPalette && (
        <div className={s.dialogOverlay}>
          <WindowDialog className={s.commandPalette} title="Command palette" onClose={() => setShowCommandPalette(false)}>
            <div className={s.commandTitleBar}>
              <strong>Commands</strong>
              <button onClick={() => setShowCommandPalette(false)} aria-label="Close command palette">×</button>
            </div>
            <input
              data-dialog-initial-focus="true"
              className={s.commandSearch}
              value={commandQuery}
              onChange={(event) => {
                setCommandQuery(event.target.value);
                setCommandActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveCommandSelection(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveCommandSelection(-1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  runActiveCommand();
                }
              }}
              placeholder="Type a command…"
              aria-label="Search commands"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-list"
              aria-activedescendant={workbenchCommands[effectiveCommandActiveIndex] ? `command-${effectiveCommandActiveIndex}` : undefined}
            />
            <div id="command-list" className={s.commandList}>
              {workbenchCommands.map((command, index) => (
                <button
                  id={`command-${index}`}
                  key={command.label}
                  disabled={command.disabled}
                  className={index === effectiveCommandActiveIndex ? s.commandActive : ""}
                  aria-current={index === effectiveCommandActiveIndex ? "true" : undefined}
                  onMouseEnter={() => setCommandActiveIndex(index)}
                  onClick={() => { command.run(); setShowCommandPalette(false); }}
                >
                  <span>{command.label}</span><kbd>{command.hint}</kbd>
                </button>
              ))}
              {workbenchCommands.length === 0 && <p>No matching commands.</p>}
            </div>
          </WindowDialog>
        </div>
      )}
      </main>
    </div>
  );
};

export default App;
