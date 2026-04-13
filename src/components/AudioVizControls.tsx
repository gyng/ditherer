import React, { useEffect, useMemo, useState } from "react";
import {
  getAudioVizSnapshot,
  subscribeAudioViz,
  updateAudioVizChannel,
  type AudioVizChannel,
  type AudioVizSnapshot,
  type AudioVizSource,
} from "utils/audioVizBridge";

import s from "./AudioVizControls.module.css";

const SOURCE_OPTIONS: Array<{ value: AudioVizSource; label: string }> = [
  { value: "microphone", label: "Microphone" },
  { value: "display", label: "Tab/System audio" },
];

const meterStyle = (value: number) => ({ width: `${Math.max(4, Math.round(value * 100))}%` });

const AudioVizControls = ({
  channel,
  title,
}: {
  channel: AudioVizChannel;
  title?: string;
}) => {
  const [snapshot, setSnapshot] = useState<AudioVizSnapshot>(() => getAudioVizSnapshot(channel));

  useEffect(() => subscribeAudioViz((changedChannel) => {
    if (changedChannel === channel) {
      setSnapshot(getAudioVizSnapshot(channel));
    }
  }), [channel]);

  const statusText = useMemo(() => {
    if (snapshot.status === "error" && snapshot.error) return snapshot.error;
    if (snapshot.status === "connecting") return "Connecting...";
    if (snapshot.status === "live") return snapshot.source === "display" ? "Listening to shared audio" : "Listening to microphone";
    return "Idle";
  }, [snapshot]);

  return (
    <div className={s.panel}>
      {title ? <div className={s.title}>{title}</div> : null}
      <label className={s.row}>
        <input
          type="checkbox"
          checked={snapshot.enabled}
          onChange={(event) => {
            void updateAudioVizChannel(channel, { enabled: event.target.checked });
          }}
        />
        <span>Enable audio visualizer input</span>
      </label>
      <label className={s.field}>
        <span>Source</span>
        <select
          className={s.input}
          value={snapshot.source}
          disabled={!snapshot.enabled}
          onChange={(event) => {
            void updateAudioVizChannel(channel, { source: event.target.value as AudioVizSource, enabled: snapshot.enabled });
          }}
        >
          {SOURCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className={s.status}>{statusText}</div>
      <div className={s.meters}>
        <div className={s.meterRow}>
          <span>Level</span>
          <div className={s.meterTrack}><div className={s.meterFill} style={meterStyle(snapshot.level)} /></div>
        </div>
        <div className={s.meterRow}>
          <span>Bass</span>
          <div className={s.meterTrack}><div className={s.meterFill} style={meterStyle(snapshot.bass)} /></div>
        </div>
        <div className={s.meterRow}>
          <span>Mid</span>
          <div className={s.meterTrack}><div className={s.meterFill} style={meterStyle(snapshot.mid)} /></div>
        </div>
        <div className={s.meterRow}>
          <span>Treble</span>
          <div className={s.meterTrack}><div className={s.meterFill} style={meterStyle(snapshot.treble)} /></div>
        </div>
        <div className={s.meterRow}>
          <span>Pulse</span>
          <div className={s.meterTrack}><div className={s.meterFill} style={meterStyle(snapshot.pulse)} /></div>
        </div>
      </div>
    </div>
  );
};

export default AudioVizControls;
