import { useEffect, useRef, useState } from "react";

import {
  getAudioVizSnapshot,
  subscribeAudioViz,
  type AudioVizChannel,
} from "utils/audioVizBridge";

type Props = {
  channel: AudioVizChannel;
  boxes?: number;
  height?: number;
  title?: string;
  mode?: "bar" | "beat";
};

const AudioBeatStrip = ({ channel, boxes = 4, height = 10, title, mode = "bar" }: Props) => {
  const [, setTick] = useState(0);
  const snapshotRef = useRef(getAudioVizSnapshot(channel));

  useEffect(() => {
    snapshotRef.current = getAudioVizSnapshot(channel);
    const unsubscribe = subscribeAudioViz((ch) => {
      if (ch === channel) snapshotRef.current = getAudioVizSnapshot(channel);
    });
    let rafId: number;
    const tick = () => {
      setTick((value) => (value + 1) % 1_000_000);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      unsubscribe();
      cancelAnimationFrame(rafId);
    };
  }, [channel]);

  const snapshot = snapshotRef.current;
  const rawPhase = mode === "bar"
    ? snapshot.rawMetrics.barPhase ?? snapshot.rawMetrics.tempoPhase ?? 0
    : snapshot.rawMetrics.tempoPhase ?? 0;
  const phase = Math.min(1, Math.max(0, rawPhase));
  const pulse = Math.min(1, Math.max(0, snapshot.rawMetrics.beat ?? 0));
  const hasTempo = snapshot.detectedBpm != null && snapshot.detectedBpm > 0;
  const head = phase * boxes;
  const active = Math.min(boxes - 1, Math.floor(head));

  return (
    <div
      title={title ?? (hasTempo
        ? `${Math.round(snapshot.detectedBpm!)} BPM — current beat ${active + 1} of ${boxes}`
        : "No detected BPM yet")}
      style={{ display: "flex", gap: 2, width: "100%" }}
    >
      {Array.from({ length: boxes }).map((_, i) => {
        let intensity: number;
        if (!hasTempo) {
          intensity = 0;
        } else {
          const distance = head - (i + 0.5);
          if (distance < -0.5) {
            intensity = 0;
          } else if (distance <= 0.5) {
            intensity = 1 - Math.abs(distance);
          } else {
            intensity = Math.max(0, 0.55 - distance * 0.18);
          }
        }
        const alpha = 0.18 + intensity * (0.6 + pulse * 0.35);
        const isDownbeat = i === 0 && mode === "bar";
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height,
              background: !hasTempo
                ? "rgba(127,127,127,0.2)"
                : isDownbeat
                  ? `rgba(255,170,90,${Math.min(1, alpha + 0.15)})`
                  : `rgba(80,160,220,${Math.min(1, alpha)})`,
              border: isDownbeat ? "1px solid rgba(140,70,0,0.55)" : i === 0 ? "1px solid rgba(0,0,0,0.4)" : "none",
            }}
          />
        );
      })}
    </div>
  );
};

export default AudioBeatStrip;
