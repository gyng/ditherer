import type { RecordingFormat, VideoFrameCallbackVideo } from "../helpers";

type RefLike<T> = {
  current: T;
};

interface StartCanvasRecordingOptions {
  sourceCanvas: HTMLCanvasElement;
  sourceVideo: VideoFrameCallbackVideo | null;
  includeVideoAudio: boolean;
  fps: number | undefined;
  recordingFormat: RecordingFormat | null;
  autoBitrate: boolean;
  bitrateMbps: number;
  mediaRecorderRef: RefLike<MediaRecorder | null>;
  streamRef: RefLike<MediaStream | null>;
  chunksRef: RefLike<BlobPart[]>;
  onBlobReady: (blob: Blob) => void;
  onStart?: () => void;
  onStop?: () => void;
}

interface StartRealtimeLoopRecordingOptions extends Omit<StartCanvasRecordingOptions, "sourceVideo"> {
  video: HTMLVideoElement;
  sourceVideo: VideoFrameCallbackVideo | null;
  timerRef: RefLike<number | null>;
  setCapturing: (value: boolean) => void;
  setRecordingTime: (value: number | ((previous: number) => number)) => void;
  clearRecordedResult: () => void;
}

export const buildRecorderOptions = (
  recordingFormat: RecordingFormat | null,
  autoBitrate: boolean,
  bitrateMbps: number,
): MediaRecorderOptions => {
  const recorderOpts: MediaRecorderOptions = {
    mimeType: recordingFormat?.mimeType || "video/webm",
  };
  if (!autoBitrate) {
    recorderOpts.videoBitsPerSecond = bitrateMbps * 1_000_000;
  }
  return recorderOpts;
};

export const getLoopStopDelayMs = (durationSec: number, playbackRate: number) =>
  (durationSec / (playbackRate || 1)) * 1000 + 200;

const nextAnimationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const startCanvasRecording = ({
  sourceCanvas,
  sourceVideo,
  includeVideoAudio,
  fps,
  recordingFormat,
  autoBitrate,
  bitrateMbps,
  mediaRecorderRef,
  streamRef,
  chunksRef,
  onBlobReady,
  onStart,
  onStop,
}: StartCanvasRecordingOptions) => {
  const stream = fps != null ? sourceCanvas.captureStream(fps) : sourceCanvas.captureStream();
  streamRef.current = stream;

  if (includeVideoAudio && sourceVideo?.captureStream) {
    const videoStream = fps != null
      ? sourceVideo.captureStream?.(fps)
      : sourceVideo.captureStream?.();
    if (videoStream) {
      videoStream.getAudioTracks().forEach((track) => stream.addTrack(track.clone()));
    }
  }

  const recorder = new MediaRecorder(stream, buildRecorderOptions(recordingFormat, autoBitrate, bitrateMbps));
  mediaRecorderRef.current = recorder;
  chunksRef.current = [];

  recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
  recorder.onstop = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    onBlobReady(new Blob(chunksRef.current, { type: recordingFormat?.mimeType || "video/webm" }));
    onStop?.();
  };

  recorder.start(100);
  onStart?.();
  return recorder;
};

export const startRealtimeLoopRecording = ({
  video,
  sourceCanvas,
  sourceVideo,
  includeVideoAudio,
  fps,
  recordingFormat,
  autoBitrate,
  bitrateMbps,
  mediaRecorderRef,
  streamRef,
  chunksRef,
  timerRef,
  setCapturing,
  setRecordingTime,
  clearRecordedResult,
  onBlobReady,
}: StartRealtimeLoopRecordingOptions) => {
  const startRecording = () => {
    const recorder = startCanvasRecording({
      sourceCanvas,
      sourceVideo,
      includeVideoAudio,
      fps,
      recordingFormat,
      autoBitrate,
      bitrateMbps,
      mediaRecorderRef,
      streamRef,
      chunksRef,
      onBlobReady,
      onStart: () => {
        setCapturing(true);
        setRecordingTime(0);
        clearRecordedResult();
        timerRef.current = window.setInterval(() => setRecordingTime((time) => time + 1), 1000);
      },
      onStop: () => {
        if (timerRef.current != null) {
          clearInterval(timerRef.current);
        }
        timerRef.current = null;
        setCapturing(false);
      },
    });

    const startedAt = performance.now();
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      video.removeEventListener("timeupdate", onTimeUpdate);
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    };
    const onTimeUpdate = () => {
      if (performance.now() - startedAt > 500 && video.currentTime < 0.1) {
        stop();
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    window.setTimeout(stop, getLoopStopDelayMs(video.duration, video.playbackRate || 1));
  };

  const onSeeked = () => {
    video.removeEventListener("seeked", onSeeked);
    nextAnimationFrame()
      .then(nextAnimationFrame)
      .then(() => {
        startRecording();
        video.play().catch(() => {});
      });
  };

  video.pause();
  video.addEventListener("seeked", onSeeked);
  if (video.currentTime === 0) {
    onSeeked();
  } else {
    video.currentTime = 0;
  }
};
