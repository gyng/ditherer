import React, { useEffect, useMemo, useState } from "react";
import {
  getAudioVizSnapshot,
  listAudioInputDevices,
  requestMicPermissionAndList,
  subscribeAudioViz,
  updateAudioVizChannel,
  type AudioVizChannel,
  type AudioVizSnapshot,
  type AudioVizSource,
} from "utils/audioVizBridge";
import AudioBeatStrip from "./AudioBeatStrip";
import AudioBpmReadout from "./AudioBpmReadout";

import s from "./AudioVizControls.module.css";

const SOURCE_OPTIONS: Array<{ value: AudioVizSource; label: string }> = [
  { value: "microphone", label: "Microphone" },
  { value: "display", label: "Tab/System audio" },
];

const isFirefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);

const AudioVizControls = ({
  channel,
  title,
}: {
  channel: AudioVizChannel;
  title?: string;
}) => {
  const [snapshot, setSnapshot] = useState<AudioVizSnapshot>(() => getAudioVizSnapshot(channel));
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [requestingDevices, setRequestingDevices] = useState(false);
  const needsPermissionGrant = snapshot.source === "microphone"
    && audioDevices.length > 0
    && audioDevices.every((device) => !device.deviceId);

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

  useEffect(() => {
    if (snapshot.status !== "live" || snapshot.source !== "microphone") return;
    let cancelled = false;
    const hasLabelledStereoMix = audioDevices.some((device) => device.deviceId && device.label);
    if (hasLabelledStereoMix) return;
    (async () => {
      try {
        const devices = await listAudioInputDevices();
        if (!cancelled) setAudioDevices(devices);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [snapshot.status, snapshot.source, audioDevices]);

  useEffect(() => {
    if (snapshot.source !== "microphone") return;
    const anyLabelled = audioDevices.some((device) => device.label);
    if (anyLabelled) return;
    let cancelled = false;
    setRequestingDevices(true);
    (async () => {
      try {
        const devices = await requestMicPermissionAndList();
        if (!cancelled && devices.length > 0) setAudioDevices(devices);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setRequestingDevices(false);
      }
    })();
    return () => { cancelled = true; };
  }, [snapshot.source]);

  const levelPercent = Math.round(Math.min(1, Math.max(0, snapshot.rawMetrics.level)) * 100);
  const peakPercent = Math.round(Math.min(1, Math.max(0, snapshot.rawMetrics.peakDecay)) * 100);

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
              if (nextSource === "display" && isFirefox) return;
              void updateAudioVizChannel(channel, {
                source: nextSource,
                enabled: true,
                ...(nextSource === "display" ? { deviceId: null } : {}),
              });
            }}
          >
            {SOURCE_OPTIONS.map((option) => {
              const disabledForFirefox = option.value === "display" && isFirefox;
              return (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={disabledForFirefox}
                >
                  {option.label}{disabledForFirefox ? " (not supported on Firefox)" : ""}
                </option>
              );
            })}
          </select>
          {isFirefox && snapshot.source === "microphone" && (
            <span className={s.deviceHint}>
              Firefox doesn&apos;t support tab/system audio capture. Use a mic (Stereo Mix, VB-CABLE, etc.).
            </span>
          )}
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
          {(audioDevices.length === 0 || needsPermissionGrant) && (
            <button
              type="button"
              className={s.permissionButton}
              disabled={requestingDevices}
              onClick={async () => {
                setRequestingDevices(true);
                try {
                  const devices = await requestMicPermissionAndList();
                  setAudioDevices(devices);
                } finally {
                  setRequestingDevices(false);
                }
              }}
            >
              {requestingDevices ? "Requesting..." : "Grant mic permission to list devices"}
            </button>
          )}
          {audioDevices.length === 0 && (
            <div className={s.deviceHint}>
              In Firefox, microphones are only listed once permission is granted. Click above to unlock the dropdown.
            </div>
          )}
          {!audioDevices.some((device) => device.deviceId === snapshot.deviceId) && snapshot.deviceLabel && snapshot.deviceId && (
            <div className={s.deviceHint}>
              Current device is active but no longer in the available device list.
            </div>
          )}
        </div>
      )}
      {snapshot.enabled && snapshot.status === "live" && (
        <>
          <div
            className={s.levelMeter}
            title="Live input level (RMS) — lets you confirm the selected source is receiving audio."
          >
            <span>In</span>
            <div className={s.levelMeterTrack}>
              <div
                className={s.levelMeterFill}
                style={{ width: `${Math.max(2, Math.round(levelPercent))}%` }}
              />
              <div
                className={s.levelMeterPeak}
                style={{ left: `${Math.max(0, Math.min(100, peakPercent))}%` }}
              />
            </div>
            <span className={s.levelMeterValue}>{Math.round(levelPercent)}%</span>
          </div>
          <div
            className={s.levelMeter}
            title={snapshot.detectedBpm != null
              ? `Beat grid — ${Math.round(snapshot.detectedBpm)} BPM`
              : "Beat grid — waiting for a detected BPM"}
          >
            <span>Beat</span>
            <div style={{ flex: 1 }}>
              <AudioBeatStrip channel={channel} boxes={8} height={10} />
            </div>
            <span className={s.levelMeterValue}>
              <AudioBpmReadout channel={channel} snapshot={snapshot} showUnit={false} compact />
            </span>
          </div>
        </>
      )}
      <label
        className={s.row}
        title="When on, every metric is auto-scaled to the recent min/max it has observed, so the full 0-100% range gets used even on quiet or uneven audio. Turn off for raw values."
      >
        <input
          type="checkbox"
          checked={snapshot.normalize}
          disabled={!snapshot.enabled}
          onChange={(event) => {
            void updateAudioVizChannel(channel, { normalize: event.target.checked });
          }}
        />
        <span>Auto-normalize all metrics</span>
      </label>
      <div className={s.hint}>
        Stretches every metric to its recent range. Per-metric overrides are available on each patch-panel node.
      </div>
      {snapshot.source !== "microphone" && (
        <div className={s.status}>{statusText}</div>
      )}
    </div>
  );
};

export default AudioVizControls;
