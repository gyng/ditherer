import { useEffect, useState } from "react";

import {
  getAudioVizSnapshot,
  subscribeAudioViz,
  type AudioVizChannel,
  type AudioVizSnapshot,
} from "utils/audioVizBridge";

import s from "./AudioBpmReadout.module.css";

type Props = {
  channel: AudioVizChannel;
  showUnit?: boolean;
  compact?: boolean;
  snapshot?: AudioVizSnapshot;
};

const AudioBpmReadout = ({ channel, showUnit = true, compact = false, snapshot: externalSnapshot }: Props) => {
  const [localSnapshot, setLocalSnapshot] = useState(() => externalSnapshot ?? getAudioVizSnapshot(channel));
  useEffect(() => {
    if (externalSnapshot) return undefined;
    return subscribeAudioViz((ch) => {
      if (ch === channel) setLocalSnapshot(getAudioVizSnapshot(channel));
    });
  }, [channel, externalSnapshot]);

  const snapshot = externalSnapshot ?? localSnapshot;
  const { detectedBpm, bpmOverride, tempoStatus, tempoWarmupProgress, status, enabled } = snapshot;

  if (detectedBpm != null) {
    return (
      <span className={compact ? s.compact : s.readout}>
        {Math.round(detectedBpm)}{showUnit ? " BPM" : ""}
        {bpmOverride != null ? <span className={s.suffix}> override</span> : null}
      </span>
    );
  }

  if (!enabled || status === "idle") {
    return <span className={compact ? s.compactMuted : s.muted}>off</span>;
  }

  if (status === "error") {
    return <span className={compact ? s.compactMuted : s.muted}>err</span>;
  }

  const pct = Math.round(tempoWarmupProgress * 100);
  const tooltip = status === "connecting"
    ? "Connecting to audio source"
    : tempoStatus === "silent"
      ? "Signal too quiet for tempo lock"
      : tempoStatus === "warmup"
        ? `Warming up (${pct}%) — needs ~5 seconds of audio`
        : tempoStatus === "searching"
          ? "Searching for tempo"
          : "Waiting for tempo";

  return (
    <span
      className={compact ? s.compactPending : s.pending}
      title={tooltip}
    >
      <span className={s.spinner} aria-hidden="true" />
      <span className={s.pendingText}>
        {tempoStatus === "warmup" ? `${pct}%` : tempoStatus === "silent" ? "quiet" : tempoStatus === "searching" ? "search" : "wait"}
      </span>
    </span>
  );
};

export default AudioBpmReadout;
