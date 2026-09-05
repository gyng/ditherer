import { ArrayBufferTarget, Muxer } from "webm-muxer";
import { prepareOfflineAudioTrack } from "./offlineAudioEncode";
import type { OfflineFrameSample } from "./offlineRender";

type SupportedVideoCodec = {
  webCodec: string;
  webmCodec: "V_VP9" | "V_VP8" | "V_AV1";
};

export type ReliableVideoSupport = {
  supported: boolean;
  reason: string | null;
  audio: boolean;
};

type CreateOfflineVideoEncoderArgs = {
  width: number;
  height: number;
  fps: number;
  durationUs: number;
  startTimeSec?: number;
  sourceVideo: HTMLVideoElement | null;
  includeAudio: boolean;
  isAborted?: () => boolean;
  onProgress?: (message: string) => void;
};

export type OfflineVideoEncodeMetrics = {
  audioPrepareMs: number;
  finalizeMs: number;
};

const SUPPORTED_VIDEO_CODECS: SupportedVideoCodec[] = [
  { webCodec: "vp09.00.10.08", webmCodec: "V_VP9" },
  { webCodec: "vp8", webmCodec: "V_VP8" },
  { webCodec: "av01.0.08M.08", webmCodec: "V_AV1" },
];

const probeVideoCodec = async (width: number, height: number, fps: number) => {
  for (const codec of SUPPORTED_VIDEO_CODECS) {
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec: codec.webCodec,
        width,
        height,
        framerate: fps,
        bitrate: Math.max(1_500_000, Math.round(width * height * fps * 0.18)),
      });
      if (result.supported) {
        return codec;
      }
    } catch {
      // Keep trying candidates.
    }
  }
  return null;
};

export const getReliableVideoSupport = async (
  width: number,
  height: number,
  fps: number,
  needsAudio: boolean,
): Promise<ReliableVideoSupport> => {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    return {
      supported: false,
      reason: "WebCodecs video encoding is unavailable in this browser.",
      audio: false,
    };
  }

  const videoCodec = await probeVideoCodec(width, height, fps);
  if (!videoCodec) {
    return {
      supported: false,
      reason: "No supported WebCodecs video encoder configuration was found.",
      audio: false,
    };
  }

  if (!needsAudio) {
    return { supported: true, reason: null, audio: false };
  }

  const hasAudioDecodeContext =
    typeof AudioContext !== "undefined" ||
    typeof (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext !==
      "undefined";
  if (!hasAudioDecodeContext || typeof OfflineAudioContext === "undefined") {
    return {
      supported: false,
      reason: "Reliable export audio requires browser audio decoding support.",
      audio: false,
    };
  }

  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    return {
      supported: false,
      reason: "Reliable export audio encoding is unavailable in this browser.",
      audio: false,
    };
  }

  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: "opus",
      numberOfChannels: 2,
      sampleRate: 48_000,
      bitrate: 128_000,
    });
    if (!support.supported) {
      return {
        supported: false,
        reason: "This browser cannot encode Opus audio for reliable export.",
        audio: false,
      };
    }
  } catch {
    return {
      supported: false,
      reason: "Reliable export audio encoding could not be verified.",
      audio: false,
    };
  }

  return { supported: true, reason: null, audio: true };
};

export const createOfflineVideoEncoder = async ({
  width,
  height,
  fps,
  durationUs,
  startTimeSec = 0,
  sourceVideo,
  includeAudio,
  isAborted,
  onProgress,
}: CreateOfflineVideoEncoderArgs) => {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("This browser does not support WebCodecs video encoding.");
  }

  const selectedCodec = await probeVideoCodec(width, height, fps);
  if (!selectedCodec) {
    throw new Error("No supported WebCodecs video encoder configuration was found.");
  }

  const videoBitrate = Math.max(1_500_000, Math.round(width * height * fps * 0.18));
  const target = new ArrayBufferTarget();
  const audioPrepareStartedAt = performance.now();
  const audioTrack =
    includeAudio && sourceVideo
      ? await prepareOfflineAudioTrack(sourceVideo, durationUs, startTimeSec)
      : null;
  const audioPrepareMs = performance.now() - audioPrepareStartedAt;
  const audioUnavailableReason =
    includeAudio && sourceVideo && !audioTrack
      ? "Reliable export could not decode an audio track from the source video, so the output was saved without audio."
      : null;

  const muxer = new Muxer({
    target,
    type: "webm",
    firstTimestampBehavior: "offset",
    video: {
      codec: selectedCodec.webmCodec,
      width,
      height,
      frameRate: fps,
    },
    ...(audioTrack
      ? {
          audio: {
            codec: "A_OPUS",
            numberOfChannels: audioTrack.numberOfChannels,
            sampleRate: audioTrack.sampleRate,
          },
        }
      : {}),
  });

  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = width;
  frameCanvas.height = height;
  const frameContext = frameCanvas.getContext("2d");
  if (!frameContext) {
    throw new Error("Reliable export could not create a frame staging canvas.");
  }

  let encodedFrames = 0;
  let disposed = false;
  let finalizing = false;
  let closed = false;
  let failure: Error | null = null;
  const queueWaiters = new Set<() => void>();
  let rejectFailure!: (error: Error) => void;
  const failureSignal = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  // A codec may fail between calls; retain the error until the caller next awaits us.
  void failureSignal.catch(() => {});
  const recordFailure = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error));
    rejectFailure(failure);
    queueWaiters.forEach((wake) => wake());
  };
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (disposed || failure) return;
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (error) {
        recordFailure(error);
      }
    },
    error: recordFailure,
  });
  const closeEncoder = () => {
    if (closed) return;
    closed = true;
    try {
      videoEncoder.close();
    } catch {
      /* Already closed by the codec. */
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    closeEncoder();
    frameCanvas.width = 0;
    frameCanvas.height = 0;
    rejectFailure(new Error("Offline video encoder has been disposed."));
    queueWaiters.forEach((wake) => wake());
  };
  const assertActive = () => {
    if (failure) throw failure;
    if (disposed) throw new Error("Offline video encoder has been disposed.");
    if (finalizing) throw new Error("Offline video encoder is already finalizing.");
  };

  try {
    videoEncoder.configure({
      codec: selectedCodec.webCodec,
      width,
      height,
      framerate: fps,
      bitrate: videoBitrate,
      latencyMode: "quality",
    });
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    audioIncluded: !!audioTrack,
    audioUnavailableReason,
    metrics: {
      audioPrepareMs,
      finalizeMs: 0,
    } satisfies OfflineVideoEncodeMetrics,
    addFrame: async (frame: OfflineFrameSample) => {
      try {
        assertActive();
        // Bound retained input frames even when filtering outruns the native codec.
        while (videoEncoder.encodeQueueSize >= 4) {
          if (isAborted?.()) return false;
          await new Promise<void>((resolve) => {
            const wake = () => {
              clearTimeout(timer);
              videoEncoder.removeEventListener("dequeue", wake);
              queueWaiters.delete(wake);
              resolve();
            };
            // Cancellation is a callback, so periodically check it while the codec is busy.
            const timer = setTimeout(wake, 25);
            queueWaiters.add(wake);
            videoEncoder.addEventListener("dequeue", wake, { once: true });
          });
          assertActive();
        }
        if (isAborted?.()) return false;
        if (frameCanvas.width !== frame.width || frameCanvas.height !== frame.height) {
          frameCanvas.width = frame.width;
          frameCanvas.height = frame.height;
        }
        frameContext.putImageData(
          new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height),
          0,
          0,
        );
        const videoFrame = new VideoFrame(frameCanvas, {
          timestamp: frame.timestampUs,
          duration: frame.durationUs,
        });
        try {
          videoEncoder.encode(videoFrame, {
            keyFrame: encodedFrames % Math.max(1, fps) === 0,
          });
          assertActive();
          encodedFrames += 1;
          return true;
        } finally {
          videoFrame.close();
        }
      } catch (error) {
        dispose();
        throw error;
      }
    },
    finalize: async () => {
      const finalizeStartedAt = performance.now();
      try {
        assertActive();
        finalizing = true;
        onProgress?.("Encoding video");
        await Promise.race([videoEncoder.flush(), failureSignal]);
        if (failure) throw failure;
        closeEncoder();

        if (audioTrack && !isAborted?.()) {
          await audioTrack.encodeInto(muxer, onProgress, isAborted);
        }
        if (failure) throw failure;
        if (disposed) throw new Error("Offline video encoder has been disposed.");
        muxer.finalize();
        const finalizeMs = performance.now() - finalizeStartedAt;
        return {
          blob: new Blob([target.buffer], { type: "video/webm" }),
          metrics: { audioPrepareMs, finalizeMs } satisfies OfflineVideoEncodeMetrics,
        };
      } finally {
        dispose();
      }
    },
    dispose,
  };
};
