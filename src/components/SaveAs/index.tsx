import { useState, useRef, useEffect, useCallback } from "react";
import { useFilter } from "context/useFilter";
import Range from "components/controls/Range";
import Enum from "components/controls/Enum";
import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

const makeFilename = (ext: string) => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `ditherer-${stamp}.${ext}`;
};

const IMAGE_FORMAT_OPTIONS = {
  options: [{ value: "png" }, { value: "jpeg" }, { value: "webp" }],
};

type RecordingFormat = {
  label: string;       // e.g. "webm (vp9)"
  container: string;   // e.g. "webm"
  mimeType: string;    // e.g. "video/webm; codecs=vp9"
  ext: string;         // file extension
};

const detectRecordingFormats = (): RecordingFormat[] => {
  const codecCandidates: { container: string; codec: string; mime: string; ext: string }[] = [
    { container: "webm", codec: "vp9",  mime: "video/webm; codecs=vp9",  ext: "webm" },
    { container: "webm", codec: "vp8",  mime: "video/webm; codecs=vp8",  ext: "webm" },
    { container: "webm", codec: "av1",  mime: "video/webm; codecs=av01", ext: "webm" },
    { container: "mp4",  codec: "h264", mime: "video/mp4; codecs=avc1",  ext: "mp4" },
    { container: "mp4",  codec: "h265", mime: "video/mp4; codecs=hvc1",  ext: "mp4" },
  ];
  const fallbacks: { container: string; mime: string; ext: string }[] = [
    { container: "webm", mime: "video/webm", ext: "webm" },
    { container: "mp4",  mime: "video/mp4",  ext: "mp4" },
  ];

  const formats: RecordingFormat[] = [];
  const containersWithCodec = new Set<string>();

  for (const c of codecCandidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) {
      formats.push({
        label: `${c.container} (${c.codec})`,
        container: c.container,
        mimeType: c.mime,
        ext: c.ext,
      });
      containersWithCodec.add(c.container);
    }
  }

  // Only add a bare-container fallback if no codec-specific variant was found
  for (const f of fallbacks) {
    if (!containersWithCodec.has(f.container) && MediaRecorder.isTypeSupported(f.mime)) {
      formats.push({
        label: f.container,
        container: f.container,
        mimeType: f.mime,
        ext: f.ext,
      });
    }
  }

  return formats;
};

interface SaveAsProps {
  outputCanvasRef: React.RefObject<HTMLCanvasElement>;
  onClose: () => void;
}

const SaveAs = ({ outputCanvasRef, onClose }: SaveAsProps) => {
  const { state } = useFilter();

  // Tab
  // Detect temporal/animated filters in the active chain (mirrors MAIN_THREAD_FILTERS in FilterContext)
  const TEMPORAL_FILTERS = new Set([
    "Glitch", "Motion Detect", "Long Exposure", "Frame Blend",
    "Temporal Edge", "Phosphor Decay", "Matrix Rain", "Infinite Call Windows",
  ]);
  const hasAnimatedFilter = (state.chain || []).some(
    (e: any) => e.enabled !== false && TEMPORAL_FILTERS.has(e.filter?.name)
  );
  const isAnimated = !!state.video || hasAnimatedFilter;
  const showVideoTab = isAnimated || state.realtimeFiltering;
  // Default to Video tab only when input is actually video/animated, not just because realtime is on
  const [activeTab, setActiveTab] = useState<"image" | "video">(
    isAnimated ? "video" : "image"
  );

  // Image settings
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState(0.92);
  const [resolution, setResolution] = useState("1");
  const [customMultiplier, setCustomMultiplier] = useState(2);

  // Video settings
  const [recordingFormats] = useState(() => detectRecordingFormats());
  const [videoFormat, setVideoFormat] = useState("recording"); // "recording" | "gif" | "sequence"
  const [selectedRecFormat, setSelectedRecFormat] = useState(0); // index into recordingFormats
  const [autoBitrate, setAutoBitrate] = useState(true);
  const [bitrate, setBitrate] = useState(2.5);
  const [autoRecordFps, setAutoRecordFps] = useState(true);
  const [recordFps, setRecordFps] = useState(30);
  const [frames, setFrames] = useState(30);
  const [gifFps, setGifFps] = useState(10);
  const [loopAutoFps, setLoopAutoFps] = useState(true);

  // Recording state
  const [capturing, setCapturing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  const activeRecFormat = recordingFormats[selectedRecFormat] ?? recordingFormats[0];

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []);

  // While recording with a video source, mirror its currentTime/duration for the seekbar
  useEffect(() => {
    if (!capturing) return;
    const vid = state.video as HTMLVideoElement | null;
    if (!vid) return;
    setSourceDuration(vid.duration || 0);
    const onUpdate = () => {
      setSourceTime(vid.currentTime);
      if (vid.duration && vid.duration !== sourceDuration) {
        setSourceDuration(vid.duration);
      }
    };
    vid.addEventListener("timeupdate", onUpdate);
    vid.addEventListener("durationchange", onUpdate);
    onUpdate();
    return () => {
      vid.removeEventListener("timeupdate", onUpdate);
      vid.removeEventListener("durationchange", onUpdate);
    };
  }, [capturing, state.video]);

  // Wire video element to live stream while recording, then to recorded blob URL
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (capturing && streamRef.current) {
      el.srcObject = streamRef.current;
      el.muted = true; // avoid feedback during recording
      el.play().catch(() => {});
    } else if (recordedUrl) {
      el.srcObject = null;
      el.src = recordedUrl;
      el.muted = false;
      el.play().catch(() => {});
    }
  }, [capturing, recordedUrl]);

  // Keyboard
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturing && !exporting) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, capturing, exporting]);

  // -- Helpers --

  const canvas = outputCanvasRef.current;
  const canvasReady = canvas && canvas.width > 0 && canvas.height > 0;
  const mult = resolution === "custom" ? customMultiplier : parseInt(resolution);
  const exportW = (canvas?.width ?? 0) * mult;
  const exportH = (canvas?.height ?? 0) * mult;
  const largeExport = exportW > 4096 || exportH > 4096;

  const getScaledCanvas = useCallback((): HTMLCanvasElement | null => {
    const source = outputCanvasRef.current;
    if (!source) return null;
    if (mult === 1) return source;
    const scaled = document.createElement("canvas");
    scaled.width = source.width * mult;
    scaled.height = source.height * mult;
    const ctx = scaled.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
    return scaled;
  }, [outputCanvasRef, mult]);

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // -- Image export --

  const handleSave = useCallback(() => {
    const c = getScaledCanvas();
    if (!c) return;
    const mimeType = `image/${format}`;
    c.toBlob(
      blob => { if (blob) download(blob, makeFilename(format)); },
      mimeType,
      format === "png" ? undefined : quality
    );
  }, [getScaledCanvas, format, quality]);

  const handleCopy = useCallback(async () => {
    const c = getScaledCanvas();
    if (!c) return;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        c.toBlob(b => (b ? resolve(b) : reject()), "image/png");
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // clipboard not available or denied
    }
  }, [getScaledCanvas]);

  // -- WebM recording --

  const handleRecord = useCallback(() => {
    if (capturing) {
      // Stop recorder first — this triggers ondataavailable then onstop
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setCapturing(false);
      return;
    }

    const source = outputCanvasRef.current;
    if (!source) return;

    const fps = autoRecordFps ? undefined : recordFps;
    const stream = fps != null ? source.captureStream(fps) : source.captureStream();
    streamRef.current = stream;

    // Mix audio from video source if available
    if (state.video && state.videoVolume > 0) {
      const vid = state.video as any;
      if (vid.captureStream) {
        const vidStream = fps != null ? vid.captureStream(fps) : vid.captureStream();
        if (vidStream) {
          vidStream.getAudioTracks().forEach((t: MediaStreamTrack) => stream.addTrack(t.clone()));
        }
      }
    }

    const recorderOpts: MediaRecorderOptions = {
      mimeType: activeRecFormat?.mimeType || "video/webm",
    };
    if (!autoBitrate) {
      recorderOpts.videoBitsPerSecond = bitrate * 1_000_000;
    }
    const recorder = new MediaRecorder(stream, recorderOpts);
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = e => chunksRef.current.push(e.data);
    recorder.onstop = () => {
      // Stop tracks after recorder has flushed all data
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const blob = new Blob(chunksRef.current, { type: activeRecFormat?.mimeType || "video/webm" });
      setRecordedBlob(blob);
      setRecordedUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    };

    recorder.start(100); // timeslice: flush data every 100ms
    setCapturing(true);
    setRecordingTime(0);
    setRecordedBlob(null);
    timerRef.current = window.setInterval(() => {
      setRecordingTime(t => t + 1);
    }, 1000);
  }, [capturing, outputCanvasRef, state.video, state.videoVolume, activeRecFormat, bitrate, autoBitrate, autoRecordFps, recordFps]);

  const handleSaveVideo = useCallback(() => {
    if (recordedBlob) download(recordedBlob, makeFilename(activeRecFormat?.ext || "webm"));
  }, [recordedBlob, activeRecFormat]);

  const handleCopyVideo = useCallback(async () => {
    if (!recordedBlob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ [recordedBlob.type]: recordedBlob }),
      ]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.warn("Video clipboard copy failed (browser may not support video mime type):", err);
    }
  }, [recordedBlob]);

  // Record exactly one loop of the source video, starting from t=0
  const handleRecordLoop = useCallback(() => {
    const vid = state.video as HTMLVideoElement | null;
    if (!vid || capturing) return;

    const source = outputCanvasRef.current;
    if (!source) return;

    const startRecording = () => {
      const fps = autoRecordFps ? undefined : recordFps;
      const stream = fps != null ? source.captureStream(fps) : source.captureStream();
      streamRef.current = stream;

      // Mix audio
      if (state.videoVolume > 0 && (vid as any).captureStream) {
        const vidStream = fps != null ? (vid as any).captureStream(fps) : (vid as any).captureStream();
        if (vidStream) {
          vidStream.getAudioTracks().forEach((t: MediaStreamTrack) => stream.addTrack(t.clone()));
        }
      }

      const recorderOpts: MediaRecorderOptions = {
        mimeType: activeRecFormat?.mimeType || "video/webm",
      };
      if (!autoBitrate) recorderOpts.videoBitsPerSecond = bitrate * 1_000_000;
      const recorder = new MediaRecorder(stream, recorderOpts);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = e => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: activeRecFormat?.mimeType || "video/webm" });
        setRecordedBlob(blob);
        setRecordedUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setCapturing(false);
      };

      recorder.start(100);
      setCapturing(true);
      setRecordingTime(0);
      setRecordedBlob(null);
      timerRef.current = window.setInterval(() => setRecordingTime(t => t + 1), 1000);

      // Auto-stop after one loop. Use timeupdate to detect wrap-around as a backup.
      const durationMs = (vid.duration / (vid.playbackRate || 1)) * 1000;
      const startedAt = performance.now();
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        vid.removeEventListener("timeupdate", onTimeUpdate);
        if (recorder.state !== "inactive") recorder.stop();
      };
      const onTimeUpdate = () => {
        // Detect loop: currentTime jumps back near 0 after playing for a bit
        if (performance.now() - startedAt > 500 && vid.currentTime < 0.1) {
          stop();
        }
      };
      vid.addEventListener("timeupdate", onTimeUpdate);
      window.setTimeout(stop, durationMs + 200);
    };

    // Pause, rewind to t=0, wait for seek + canvas to catch up, then play & record
    const wasPaused = vid.paused;
    vid.pause();
    const onSeeked = () => {
      vid.removeEventListener("seeked", onSeeked);
      // Give the filter pipeline a couple of rAF ticks to render the new frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          startRecording();
          vid.play().catch(() => {});
        });
      });
    };
    vid.addEventListener("seeked", onSeeked);
    if (vid.currentTime === 0) {
      // Already at start — fire onSeeked manually since setting currentTime=0 won't trigger seeked
      onSeeked();
    } else {
      vid.currentTime = 0;
    }
    // Suppress unused-var warning
    void wasPaused;
  }, [state.video, state.videoVolume, capturing, outputCanvasRef, activeRecFormat, bitrate, autoBitrate, autoRecordFps, recordFps]);

  // -- GIF export --

  const handleExportGif = useCallback(async () => {
    const source = outputCanvasRef.current;
    if (!source) return;

    setExporting(true);
    const delay = Math.round(1000 / gifFps);
    const capturedFrames: { data: Uint8ClampedArray; width: number; height: number }[] = [];

    for (let i = 0; i < frames; i++) {
      setProgress(`Capturing frame ${i + 1}/${frames}`);
      await new Promise(r => requestAnimationFrame(r));
      const scaled = getScaledCanvas()!;
      const ctx = scaled.getContext("2d")!;
      const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
      capturedFrames.push({ data: imageData.data, width: scaled.width, height: scaled.height });
    }

    setProgress("Encoding GIF...");
    try {
      const { encode } = await import("modern-gif");
      const output = await encode({
        width: capturedFrames[0].width,
        height: capturedFrames[0].height,
        frames: capturedFrames.map(f => ({
          // Copy into a fresh ArrayBuffer-backed view so TS narrows away
          // ArrayBufferLike (which would otherwise allow SharedArrayBuffer).
          data: new Uint8ClampedArray(f.data),
          delay,
        })),
      });
      download(new Blob([output], { type: "image/gif" }), makeFilename("gif"));
    } catch (err) {
      console.error("GIF export failed:", err);
    }

    setExporting(false);
    setProgress(null);
  }, [outputCanvasRef, getScaledCanvas, frames, gifFps]);

  // Record exactly one source-video loop. Output format: "gif" or "sequence".
  // If loopAutoFps is on, use requestVideoFrameCallback for native source framerate.
  const handleExportLoop = useCallback(async (mode: "gif" | "sequence") => {
    const vid = state.video as HTMLVideoElement | null;
    if (!vid) return;
    const source = outputCanvasRef.current;
    if (!source) return;

    setExporting(true);
    setProgress("Rewinding...");

    // Pause + seek to start
    vid.pause();
    if (vid.currentTime !== 0) {
      await new Promise<void>(resolve => {
        const onSeeked = () => { vid.removeEventListener("seeked", onSeeked); resolve(); };
        vid.addEventListener("seeked", onSeeked);
        vid.currentTime = 0;
      });
    }
    // Wait a couple of rAF ticks for the filter pipeline to render the t=0 frame
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    const capturedFrames: { data: Uint8ClampedArray; width: number; height: number; delay: number }[] = [];
    const duration = vid.duration;
    const useVFC = loopAutoFps && "requestVideoFrameCallback" in vid;

    const captureFrame = (delayMs: number) => {
      const scaled = getScaledCanvas();
      if (!scaled) return;
      const ctx = scaled.getContext("2d")!;
      const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
      capturedFrames.push({
        data: imageData.data,
        width: scaled.width,
        height: scaled.height,
        delay: delayMs,
      });
    };

    await new Promise<void>(resolve => {
      let lastMediaTime = 0;
      let stopped = false;
      const stop = () => { if (!stopped) { stopped = true; vid.pause(); resolve(); } };

      if (useVFC) {
        // Native framerate path: requestVideoFrameCallback fires per decoded frame
        const onFrame = (_now: number, metadata: any) => {
          if (stopped) return;
          const t = metadata.mediaTime;
          if (t < lastMediaTime - 0.05) {
            // Wrapped around — done
            stop();
            return;
          }
          const delayMs = lastMediaTime > 0 ? Math.max(10, Math.round((t - lastMediaTime) * 1000)) : 33;
          lastMediaTime = t;
          setProgress(`Capturing ${capturedFrames.length + 1} (${t.toFixed(2)}s / ${duration.toFixed(2)}s)`);
          captureFrame(delayMs);
          if (!stopped) (vid as any).requestVideoFrameCallback(onFrame);
        };
        (vid as any).requestVideoFrameCallback(onFrame);
      } else {
        // Fixed-FPS path: poll on a setInterval
        const fps = gifFps;
        const intervalMs = Math.round(1000 / fps);
        let lastTime = vid.currentTime;
        const handle = window.setInterval(() => {
          if (stopped) return;
          if (vid.currentTime < lastTime - 0.05 || vid.currentTime >= duration - 0.01) {
            window.clearInterval(handle);
            stop();
            return;
          }
          lastTime = vid.currentTime;
          setProgress(`Capturing ${capturedFrames.length + 1} (${vid.currentTime.toFixed(2)}s / ${duration.toFixed(2)}s)`);
          captureFrame(intervalMs);
        }, intervalMs);
      }

      vid.play().catch(() => {});
      // Safety stop
      window.setTimeout(stop, (duration / (vid.playbackRate || 1)) * 1000 + 500);
    });

    if (capturedFrames.length === 0) {
      setExporting(false);
      setProgress(null);
      return;
    }

    if (mode === "gif") {
      setProgress(`Encoding GIF (${capturedFrames.length} frames)...`);
      try {
        const { encode } = await import("modern-gif");
        const output = await encode({
          width: capturedFrames[0].width,
          height: capturedFrames[0].height,
          frames: capturedFrames.map(f => ({
            data: new Uint8ClampedArray(f.data),
            delay: f.delay,
          })),
        });
        download(new Blob([output], { type: "image/gif" }), makeFilename("gif"));
      } catch (err) {
        console.error("GIF loop export failed:", err);
      }
    } else {
      // Sequence: encode each frame as PNG and bundle into a zip
      const zipFiles: Record<string, Uint8Array> = {};
      for (let i = 0; i < capturedFrames.length; i++) {
        setProgress(`Encoding frame ${i + 1}/${capturedFrames.length}`);
        const f = capturedFrames[i];
        const canvas = document.createElement("canvas");
        canvas.width = f.width;
        canvas.height = f.height;
        const ctx = canvas.getContext("2d")!;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), 0, 0);
        const blob = await new Promise<Blob | null>(resolve => {
          canvas.toBlob(b => resolve(b), "image/png");
        });
        if (blob) {
          zipFiles[`ditherer-seq-${String(i).padStart(4, "0")}.png`] = new Uint8Array(await blob.arrayBuffer());
        }
      }
      setProgress(`Zipping ${Object.keys(zipFiles).length} frames...`);
      try {
        const { zipSync } = await import("fflate");
        const zipped = zipSync(zipFiles, { level: 0 });
        download(new Blob([new Uint8Array(zipped)], { type: "application/zip" }), makeFilename("zip"));
      } catch (err) {
        console.error("Sequence zip failed:", err);
      }
    }

    setExporting(false);
    setProgress(null);
  }, [state.video, outputCanvasRef, getScaledCanvas, loopAutoFps, gifFps]);

  // -- Sequence export --

  const handleExportSequence = useCallback(async () => {
    const source = outputCanvasRef.current;
    if (!source) return;

    setExporting(true);

    const zipFiles: Record<string, Uint8Array> = {};

    for (let i = 0; i < frames; i++) {
      setProgress(`Capturing frame ${i + 1}/${frames}`);
      await new Promise(r => requestAnimationFrame(r));
      const scaled = getScaledCanvas()!;
      const blob = await new Promise<Blob | null>(resolve => {
        scaled.toBlob(b => resolve(b), "image/png");
      });
      if (blob) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        zipFiles[`ditherer-seq-${String(i).padStart(4, "0")}.png`] = buf;
      }
    }

    setProgress(`Zipping ${Object.keys(zipFiles).length} frames...`);
    try {
      const { zipSync } = await import("fflate");
      // Store mode (level 0) — PNGs are already compressed, no point recompressing
      const zipped = zipSync(zipFiles, { level: 0 });
      // Copy into a fresh Uint8Array so the buffer is a plain ArrayBuffer (not SharedArrayBuffer)
      download(new Blob([new Uint8Array(zipped)], { type: "application/zip" }), makeFilename("zip"));
    } catch (err) {
      console.error("Sequence zip failed:", err);
    }

    setExporting(false);
    setProgress(null);
  }, [outputCanvasRef, getScaledCanvas, frames]);

  // -- Video tab export dispatch --

  const handleVideoExport = useCallback(() => {
    if (videoFormat === "gif") handleExportGif();
    else if (videoFormat === "sequence") handleExportSequence();
  }, [videoFormat, handleExportGif, handleExportSequence]);

  const videoFormatOptions = {
    options: [
      ...(recordingFormats.length > 0 ? [{ value: "recording" }] : []),
      { value: "gif" },
      { value: "sequence" },
    ],
  };

  const recFormatOptions = {
    options: recordingFormats.map(f => ({ value: f.label })),
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const ss = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  };

  return (
      <div className={[controls.window, s.dialog].join(" ")}>
        <div className={["handle", controls.titleBar, s.titleBar].join(" ")}>
          <span>Save As</span>
          <button
            className={s.closeBtn}
            onMouseDown={e => e.stopPropagation()}
            onClick={!capturing && !exporting ? onClose : undefined}
            title="Close"
          >
            &#10005;
          </button>
        </div>

        {/* Tabs */}
        <div className={s.tabs}>
          <div
            className={[s.tab, activeTab === "image" ? s.tabActive : ""].join(" ")}
            onClick={() => setActiveTab("image")}
          >
            Image
          </div>
          {showVideoTab && (
            <div
              className={[s.tab, activeTab === "video" ? s.tabActive : ""].join(" ")}
              onClick={() => setActiveTab("video")}
            >
              Video
            </div>
          )}
        </div>

        <div className={s.tabContent}>
          {/* ---- Image Tab ---- */}
          {activeTab === "image" && (
            <>
              <div className={s.row}>
                <span className={s.rowLabel}>Format</span>
                <Enum
                  name="Format"
                  types={IMAGE_FORMAT_OPTIONS}
                  value={format}
                  onSetFilterOption={(_, v) => setFormat(v)}
                />
              </div>

              {format !== "png" && (
                <Range
                  name="Quality"
                  types={{ range: [0.01, 1] }}
                  step={0.01}
                  value={quality}
                  onSetFilterOption={(_, v) => setQuality(v)}
                />
              )}

              <div className={s.row}>
                <span className={s.rowLabel}>Resolution</span>
                <div className={s.radioGroup}>
                  {["1", "2", "4"].map(v => (
                    <label key={v}>
                      <input
                        type="radio"
                        name="resolution"
                        value={v}
                        checked={resolution === v}
                        onChange={() => setResolution(v)}
                      />
                      {v}x
                    </label>
                  ))}
                  <label>
                    <input
                      type="radio"
                      name="resolution"
                      value="custom"
                      checked={resolution === "custom"}
                      onChange={() => setResolution("custom")}
                    />
                    Custom
                  </label>
                  {resolution === "custom" && (
                    <input
                      type="number"
                      className={s.customInput}
                      min={1}
                      max={8}
                      step={1}
                      value={customMultiplier}
                      onChange={e => setCustomMultiplier(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
                    />
                  )}
                </div>
              </div>

              <div className={s.dims}>
                {canvas?.width ?? 0} x {canvas?.height ?? 0} → {exportW} x {exportH}
              </div>

              {largeExport && (
                <div className={s.warning}>
                  Large export dimensions may fail or use excessive memory.
                </div>
              )}

              <div className={s.buttons}>
                <button className={s.btn} disabled={!canvasReady} onClick={handleSave}>
                  Save
                </button>
                {navigator.clipboard?.write && (
                  <button className={s.btn} disabled={!canvasReady} onClick={handleCopy}>
                    Copy to Clipboard
                    {copySuccess && <span className={s.copyFlash}> Copied!</span>}
                  </button>
                )}
              </div>
            </>
          )}

          {/* ---- Video Tab ---- */}
          {activeTab === "video" && (
            <>
              <div className={s.row}>
                <span className={s.rowLabel}>Format</span>
                <Enum
                  name="Format"
                  types={videoFormatOptions}
                  value={videoFormat}
                  onSetFilterOption={(_, v) => setVideoFormat(v)}
                />
              </div>

              {videoFormat === "recording" && (
                <>
                  {recordingFormats.length > 0 && (
                    <div className={s.row}>
                      <span className={s.rowLabel}>Codec</span>
                      <Enum
                        name="Codec"
                        types={recFormatOptions}
                        value={activeRecFormat?.label || ""}
                        onSetFilterOption={(_, v) => {
                          const idx = recordingFormats.findIndex(f => f.label === v);
                          if (idx >= 0) setSelectedRecFormat(idx);
                        }}
                      />
                    </div>
                  )}

                  <div className={s.row}>
                    <span className={s.rowLabel}>FPS</span>
                    <label className={s.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={autoRecordFps}
                        onChange={e => setAutoRecordFps(e.target.checked)}
                      />
                      Auto
                    </label>
                  </div>
                  {!autoRecordFps && (
                    <Range
                      name="fps"
                      types={{ range: [1, 60] }}
                      step={1}
                      value={recordFps}
                      onSetFilterOption={(_, v) => setRecordFps(v)}
                    />
                  )}

                  <div className={s.row}>
                    <span className={s.rowLabel}>Bitrate</span>
                    <label className={s.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={autoBitrate}
                        onChange={e => setAutoBitrate(e.target.checked)}
                      />
                      Auto
                    </label>
                  </div>
                  {!autoBitrate && (
                    <Range
                      name="Mbps"
                      types={{ range: [0.5, 20] }}
                      step={0.5}
                      value={bitrate}
                      onSetFilterOption={(_, v) => setBitrate(v)}
                    />
                  )}
                  <div className={s.helperText}>
                    Higher bitrate = better quality, larger file. Auto lets the browser choose a sensible default.
                  </div>

                  <div className={s.buttons}>
                    <button className={s.btn} onClick={handleRecord}>
                      {capturing ? "\u25A0 Stop" : "\u25CF Record"}
                    </button>
                    {state.video && (
                      <button
                        className={s.btn}
                        disabled={capturing}
                        onClick={handleRecordLoop}
                        title="Seek to start and record one full loop"
                      >
                        ⟲ Record loop
                      </button>
                    )}
                  </div>
                  <div className={s.buttons}>
                    <button className={s.btn} disabled={!recordedBlob} onClick={handleSaveVideo}>
                      Save
                    </button>
                    {navigator.clipboard?.write && (
                      <button className={s.btn} disabled={!recordedBlob} onClick={handleCopyVideo}>
                        Copy
                        {copySuccess && <span className={s.copyFlash}> Copied!</span>}
                      </button>
                    )}
                  </div>

                  {capturing && (
                    <>
                      <div className={s.rec}>
                        ● REC {formatTime(recordingTime)}
                        {state.video && sourceDuration > 0 && (
                          <span className={s.sourceTimecode}>
                            {" "}· source {formatTime(Math.floor(sourceTime))} / {formatTime(Math.floor(sourceDuration))}
                          </span>
                        )}
                      </div>
                      {state.video && sourceDuration > 0 && (
                        <div className={s.seekbar}>
                          <div
                            className={s.seekbarFill}
                            style={{ width: `${Math.min(100, (sourceTime / sourceDuration) * 100)}%` }}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {(capturing || recordedUrl) && (
                    <video
                      ref={videoRef}
                      className={s.videoPreview}
                      controls={!capturing}
                      autoPlay
                      loop
                      playsInline
                    />
                  )}
                </>
              )}

              {(videoFormat === "gif" || videoFormat === "sequence") && (
                <>
                  <Range
                    name="Frames"
                    types={{ range: [1, 120] }}
                    step={1}
                    value={frames}
                    onSetFilterOption={(_, v) => setFrames(v)}
                  />

                  <div className={s.row}>
                    <span className={s.rowLabel}>FPS</span>
                    <label className={s.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={loopAutoFps}
                        onChange={e => setLoopAutoFps(e.target.checked)}
                      />
                      Match source
                    </label>
                  </div>
                  {!loopAutoFps && (
                    <Range
                      name="FPS"
                      types={{ range: [1, 60] }}
                      step={1}
                      value={gifFps}
                      onSetFilterOption={(_, v) => setGifFps(v)}
                    />
                  )}
                  {loopAutoFps && (
                    <div className={s.helperText}>
                      Match source: capture each decoded source frame (uses requestVideoFrameCallback if available).
                    </div>
                  )}

                  <div className={s.buttons}>
                    <button className={s.btn} disabled={exporting} onClick={handleVideoExport}>
                      {exporting ? "Exporting..." : "Export"}
                    </button>
                    {state.video && (
                      <button
                        className={s.btn}
                        disabled={exporting}
                        onClick={() => handleExportLoop(videoFormat as "gif" | "sequence")}
                        title="Rewind source video and capture one full loop"
                      >
                        ⟲ Record loop
                      </button>
                    )}
                  </div>

                  {progress && <div className={s.progress}>{progress}</div>}
                </>
              )}
            </>
          )}
        </div>
      </div>
  );
};

export default SaveAs;
