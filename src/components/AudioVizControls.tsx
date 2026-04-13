import React, { useEffect, useMemo, useState } from "react";
import {
  getAudioVizSnapshot,
  listAudioInputDevices,
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

const AudioVizControls = ({
  channel,
  title,
}: {
  channel: AudioVizChannel;
  title?: string;
}) => {
  const [snapshot, setSnapshot] = useState<AudioVizSnapshot>(() => getAudioVizSnapshot(channel));
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => subscribeAudioViz((changedChannel) => {
    if (changedChannel === channel) {
      setSnapshot(getAudioVizSnapshot(channel));
    }
  }), [channel]);

  useEffect(() => {
    let cancelled = false;

    const refreshDevices = async () => {
      try {
        const devices = await listAudioInputDevices();
        if (!cancelled) {
          setAudioDevices(devices);
        }
      } catch {
        if (!cancelled) {
          setAudioDevices([]);
        }
      }
    };

    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    };
  }, []);

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
      <div className={s.fieldRow}>
        <label className={s.field}>
          <span>Source</span>
          <select
            className={s.input}
            value={snapshot.source}
            onChange={(event) => {
              const nextSource = event.target.value as AudioVizSource;
              void updateAudioVizChannel(channel, {
                source: event.target.value as AudioVizSource,
                enabled: true,
                ...(nextSource === "display" ? { deviceId: null } : {}),
              });
            }}
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {snapshot.source === "microphone" && (
          <label className={s.field}>
            <span>Microphone</span>
            <select
              className={s.input}
              value={snapshot.deviceId ?? ""}
              onChange={(event) => {
                void updateAudioVizChannel(channel, {
                  source: "microphone",
                  deviceId: event.target.value || null,
                  enabled: true,
                });
              }}
            >
              <option value="">
                {audioDevices.length > 0 ? "Default microphone" : "Request permission to list microphones"}
              </option>
              {audioDevices.map((device, index) => (
                <option key={device.deviceId || `${device.label}-${index}`} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {snapshot.source === "microphone" && (
        <div className={s.deviceBlock}>
          <div className={s.deviceRow}>
            <div className={s.deviceLabel}>
              Connected mic: {snapshot.deviceLabel || (snapshot.status === "connecting" ? "Requesting permission..." : "Not connected")}
            </div>
            <div className={s.deviceStatus}>{statusText}</div>
          </div>
          {audioDevices.length === 0 && (
            <div className={s.deviceHint}>
              Choose `Microphone` above to allow browser mic access and populate this list.
            </div>
          )}
          {!audioDevices.some((device) => device.deviceId === snapshot.deviceId) && snapshot.deviceLabel && snapshot.deviceId && (
            <div className={s.deviceHint}>
              Current device is active but no longer in the available device list.
            </div>
          )}
        </div>
      )}
      <label className={s.row}>
        <input
          type="checkbox"
          checked={snapshot.normalize}
          disabled={!snapshot.enabled}
          onChange={(event) => {
            void updateAudioVizChannel(channel, { normalize: event.target.checked, enabled: snapshot.enabled });
          }}
        />
        <span>Normalize range</span>
      </label>
      {snapshot.source !== "microphone" && (
        <div className={s.status}>{statusText}</div>
      )}
    </div>
  );
};

export default AudioVizControls;
