import { AVSeekFlag, WebDemuxer } from "web-demuxer";
import webDemuxerWasmUrl from "web-demuxer/wasm?url";
import { buildOfflineTimeline, type OfflineTimelineFrame } from "./offlineRender";

type DecodedFrame = {
  timestampUs: number;
  durationUs: number;
  frame: VideoFrame;
};

type DecodeArgs = {
  source: string;
  startTimeSec: number;
  endTimeSec: number;
  isAborted?: () => boolean;
  onProgress?: (progress: { message: string; fraction?: number }) => void;
};

type DecodeTimelineArgs = {
  source: string;
  timeline: OfflineTimelineFrame[];
  isAborted?: () => boolean;
  onProgress?: (progress: { message: string; fraction?: number }) => void;
};

export type OfflineWebCodecsDecodeResult = {
  frames: DecodedFrame[];
  width: number;
  height: number;
  codec: string;
  metrics: {
    loadMs: number;
    configMs: number;
    demuxMs: number;
    decodeMs: number;
    decodedChunks: number;
  };
};

const FLUSH_TIMEOUT_MS = 4000;
const TIMELINE_PREROLL_SEC = 1.5;
const TIMELINE_POSTROLL_SEC = 0.05;
const FRAME_TIME_EPSILON_US = 50_000;

const flushDecoderWithTimeout = async (decoder: VideoDecoder, framesDecoded: number, chunksDecoded: number) => {
  await Promise.race([
    decoder.flush(),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(
          `VideoDecoder.flush() timed out after ${FLUSH_TIMEOUT_MS}ms with ${framesDecoded} frame${framesDecoded === 1 ? "" : "s"} decoded from ${chunksDecoded} chunk${chunksDecoded === 1 ? "" : "s"}.`,
        ));
      }, FLUSH_TIMEOUT_MS);
    }),
  ]);
};

export const decodeSourceFramesWithWebCodecs = async ({
  source,
  startTimeSec,
  endTimeSec,
  isAborted,
  onProgress,
}: DecodeArgs): Promise<OfflineWebCodecsDecodeResult> => {
  if (typeof VideoDecoder === "undefined") {
    throw new Error("WebCodecs VideoDecoder is unavailable in this browser.");
  }

  const metrics = {
    loadMs: 0,
    configMs: 0,
    demuxMs: 0,
    decodeMs: 0,
    decodedChunks: 0,
  };
  const requestedDurationUs = Math.max(1, Math.round((endTimeSec - startTimeSec) * 1_000_000));
  const requestedStartUs = Math.round(startTimeSec * 1_000_000);
  let lastReportedFraction = 0;

  const wasmFilePath = new URL(webDemuxerWasmUrl, window.location.href).href;
  const demuxer = new WebDemuxer({ wasmFilePath });
  try {
    onProgress?.({ message: "Loading source for WebCodecs decode...", fraction: 0 });
    const loadStartedAt = performance.now();
    await demuxer.load(source);
    metrics.loadMs = performance.now() - loadStartedAt;

    if (isAborted?.()) {
      throw new Error("Decode aborted.");
    }

    onProgress?.({ message: "Configuring WebCodecs decoder...", fraction: 0.03 });
    const configStartedAt = performance.now();
    const [decoderConfig, streamInfo] = await Promise.all([
      demuxer.getDecoderConfig("video"),
      demuxer.getMediaStream("video"),
    ]);
    const support = await VideoDecoder.isConfigSupported(decoderConfig);
    const supportConfig = support.config;
    metrics.configMs = performance.now() - configStartedAt;
    if (!support.supported || !supportConfig) {
      throw new Error(`Browser rejected WebCodecs config for ${decoderConfig.codec}.`);
    }

    const frames: DecodedFrame[] = [];
    let decodeError: Error | null = null;
    const decoder = new VideoDecoder({
      output: (frame) => {
        frames.push({
          timestampUs: frame.timestamp,
          durationUs: frame.duration ?? 0,
          frame,
        });
        const relativeUs = Math.max(0, frame.timestamp - requestedStartUs);
        const decodeFraction = Math.min(1, relativeUs / requestedDurationUs);
        const stageFraction = 0.08 + decodeFraction * 0.22;
        if (stageFraction >= lastReportedFraction + 0.005 || frames.length <= 3 || decodeFraction >= 0.995) {
          lastReportedFraction = stageFraction;
          onProgress?.({
            message: `Decoding source frames (${Math.round(decodeFraction * 100)}% · ${frames.length} frame${frames.length === 1 ? "" : "s"})...`,
            fraction: stageFraction,
          });
        }
      },
      error: (error) => {
        decodeError = error instanceof Error ? error : new Error(String(error));
      },
    });

    decoder.configure(supportConfig);

    onProgress?.({ message: "Demuxing + decoding source frames...", fraction: 0.08 });
    const demuxStartedAt = performance.now();
    const decodeStartedAt = performance.now();
    lastReportedFraction = 0.08;
    const chunkStream = demuxer.read("video", startTimeSec, endTimeSec, AVSeekFlag.AVSEEK_FLAG_BACKWARD);
    const reader = chunkStream.getReader();
    try {
      for (;;) {
        if (isAborted?.()) {
          throw new Error("Decode aborted.");
        }
        const { done, value } = await reader.read();
        if (done) break;
        metrics.decodedChunks += 1;
        decoder.decode(value);
        const relativeUs = Math.max(0, value.timestamp - requestedStartUs);
        const decodeFraction = Math.min(1, relativeUs / requestedDurationUs);
        const stageFraction = 0.08 + decodeFraction * 0.22;
        if (stageFraction >= lastReportedFraction + 0.01 || metrics.decodedChunks <= 3) {
          lastReportedFraction = stageFraction;
          onProgress?.({
            message: `Demuxing source packets (${Math.round(decodeFraction * 100)}% · ${metrics.decodedChunks} chunk${metrics.decodedChunks === 1 ? "" : "s"})...`,
            fraction: stageFraction,
          });
        }
      }
    } finally {
      reader.releaseLock();
    }
    metrics.demuxMs = performance.now() - demuxStartedAt;
    onProgress?.({
      message: `Flushing decoded source frames (${frames.length} frame${frames.length === 1 ? "" : "s"} ready)...`,
      fraction: Math.max(lastReportedFraction, 0.31),
    });
    await Promise.race([
      decoder.flush(),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          reject(new Error(
            `VideoDecoder.flush() timed out after ${FLUSH_TIMEOUT_MS}ms with ${frames.length} frame${frames.length === 1 ? "" : "s"} decoded from ${metrics.decodedChunks} chunk${metrics.decodedChunks === 1 ? "" : "s"}.`,
          ));
        }, FLUSH_TIMEOUT_MS);
      }),
    ]);
    metrics.decodeMs = performance.now() - decodeStartedAt;
    decoder.close();

    if (decodeError) {
      frames.forEach(({ frame }) => frame.close());
      throw decodeError;
    }

    frames.sort((a, b) => a.timestampUs - b.timestampUs);
    return {
      frames,
      width: streamInfo.width || supportConfig.codedWidth || 0,
      height: streamInfo.height || supportConfig.codedHeight || 0,
      codec: supportConfig.codec,
      metrics,
    };
  } finally {
    demuxer.destroy();
  }
};

export const decodeTimelineFramesWithWebCodecs = async ({
  source,
  timeline,
  isAborted,
  onProgress,
}: DecodeTimelineArgs): Promise<OfflineWebCodecsDecodeResult> => {
  if (typeof VideoDecoder === "undefined") {
    throw new Error("WebCodecs VideoDecoder is unavailable in this browser.");
  }

  const metrics = {
    loadMs: 0,
    configMs: 0,
    demuxMs: 0,
    decodeMs: 0,
    decodedChunks: 0,
  };

  const wasmFilePath = new URL(webDemuxerWasmUrl, window.location.href).href;
  const demuxer = new WebDemuxer({ wasmFilePath });
  try {
    onProgress?.({ message: "Loading source for WebCodecs decode...", fraction: 0 });
    const loadStartedAt = performance.now();
    await demuxer.load(source);
    metrics.loadMs = performance.now() - loadStartedAt;

    if (isAborted?.()) {
      throw new Error("Decode aborted.");
    }

    onProgress?.({ message: "Configuring WebCodecs decoder...", fraction: 0.03 });
    const configStartedAt = performance.now();
    const [decoderConfig, streamInfo] = await Promise.all([
      demuxer.getDecoderConfig("video"),
      demuxer.getMediaStream("video"),
    ]);
    const support = await VideoDecoder.isConfigSupported(decoderConfig);
    const supportConfig = support.config;
    metrics.configMs = performance.now() - configStartedAt;
    if (!support.supported || !supportConfig) {
      throw new Error(`Browser rejected WebCodecs config for ${decoderConfig.codec}.`);
    }

    const frames: DecodedFrame[] = [];
    const seekStartedAt = performance.now();
    const decodeStartedAt = performance.now();

    for (let i = 0; i < timeline.length; i += 1) {
      if (isAborted?.()) {
        throw new Error("Decode aborted.");
      }

      const timelineFrame = timeline[i];
      const progressFraction = 0.08 + (i / Math.max(1, timeline.length)) * 0.22;
      onProgress?.({
        message: `Seeking + decoding source frame ${i + 1}/${timeline.length} (${timelineFrame.timeSec.toFixed(2)}s)...`,
        fraction: progressFraction,
      });

      const windowStartSec = Math.max(0, timelineFrame.timeSec - TIMELINE_PREROLL_SEC);
      const windowEndSec = timelineFrame.timeSec + TIMELINE_POSTROLL_SEC;
      const targetUs = Math.round(timelineFrame.timestampUs);
      let bestFrame: DecodedFrame | null = null;
      let decodeError: Error | null = null;
      const decoder = new VideoDecoder({
        output: (frame) => {
          const candidate: DecodedFrame = {
            timestampUs: frame.timestamp,
            durationUs: frame.duration ?? timelineFrame.durationUs,
            frame,
          };
          if (!bestFrame) {
            bestFrame = candidate;
            return;
          }
          const bestDelta = Math.abs(bestFrame.timestampUs - targetUs);
          const candidateDelta = Math.abs(candidate.timestampUs - targetUs);
          const preferCandidate =
            candidate.timestampUs <= targetUs + FRAME_TIME_EPSILON_US &&
            (
              bestFrame.timestampUs > targetUs + FRAME_TIME_EPSILON_US ||
              candidateDelta < bestDelta ||
              (candidateDelta === bestDelta && candidate.timestampUs > bestFrame.timestampUs)
            );
          if (preferCandidate) {
            bestFrame.frame.close();
            bestFrame = candidate;
            return;
          }
          candidate.frame.close();
        },
        error: (error) => {
          decodeError = error instanceof Error ? error : new Error(String(error));
        },
      });

      try {
        decoder.configure(supportConfig);
        const chunkStream = demuxer.read("video", windowStartSec, windowEndSec, AVSeekFlag.AVSEEK_FLAG_BACKWARD);
        const reader = chunkStream.getReader();
        let localChunks = 0;
        try {
          for (;;) {
            if (isAborted?.()) {
              throw new Error("Decode aborted.");
            }
            const { done, value } = await reader.read();
            if (done) break;
            localChunks += 1;
            metrics.decodedChunks += 1;
            decoder.decode(value);
          }
        } finally {
          reader.releaseLock();
        }
        await flushDecoderWithTimeout(decoder, bestFrame ? 1 : 0, localChunks);
      } finally {
        decoder.close();
      }

      const currentBestFrame = bestFrame as DecodedFrame | null;
      if (decodeError) {
        if (currentBestFrame != null) {
          currentBestFrame.frame.close();
        }
        throw decodeError;
      }

      if (!currentBestFrame) {
        throw new Error(`No decoded frame was produced for ${timelineFrame.timeSec.toFixed(3)}s.`);
      }

      const resolvedBestFrame: DecodedFrame = currentBestFrame;
      frames.push(resolvedBestFrame);
      const completedFraction = 0.08 + ((i + 1) / Math.max(1, timeline.length)) * 0.22;
      onProgress?.({
        message: `Decoded source frame ${i + 1}/${timeline.length} (${(resolvedBestFrame.timestampUs / 1_000_000).toFixed(2)}s)...`,
        fraction: completedFraction,
      });
    }

    metrics.demuxMs = performance.now() - seekStartedAt;
    metrics.decodeMs = performance.now() - decodeStartedAt;

    return {
      frames,
      width: streamInfo.width || supportConfig.codedWidth || 0,
      height: streamInfo.height || supportConfig.codedHeight || 0,
      codec: supportConfig.codec,
      metrics,
    };
  } finally {
    demuxer.destroy();
  }
};

export const selectFramesForTimeline = (decodedFrames: DecodedFrame[], timeline: OfflineTimelineFrame[]) => {
  if (!decodedFrames.length) {
    throw new Error("No decoded source frames are available.");
  }

  let pointer = 0;
  return timeline.map((frame) => {
    while (
      pointer + 1 < decodedFrames.length &&
      decodedFrames[pointer + 1].timestampUs <= frame.timestampUs
    ) {
      pointer += 1;
    }

    return {
      timelineFrame: frame,
      decodedFrame: decodedFrames[pointer],
    };
  });
};

export const buildDecodedTimeline = (durationSec: number, fps: number, startTimeSec = 0, endTimeSec = durationSec) =>
  buildOfflineTimeline(durationSec, fps, startTimeSec, endTimeSec);
