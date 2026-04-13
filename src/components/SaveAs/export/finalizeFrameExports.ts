import { encodeGifBlob, encodePngSequenceZip } from "./exportArtifacts";
import { normalizeGifFrames, type GifFrame } from "../helpers";

type UpdateProgress = (message: string, value?: number | null) => void;

interface FinalizeGifExportOptions {
  frames: GifFrame[];
  aborted: boolean;
  colorTable?: number[][] | null;
  capturedFrameCount: number;
  updateProgress: UpdateProgress;
  setGifResult: (blob: Blob, label: string) => void;
  onEncoded?: (stats: { normalizedFrameCount: number; encodeMs: number }) => void;
}

interface FinalizeSequenceExportOptions {
  frames: GifFrame[];
  updateProgress: UpdateProgress;
  setSequenceResult: (blob: Blob) => void;
  progressBase?: number;
  progressSpan?: number;
}

export const finalizeGifExport = async ({
  frames,
  aborted,
  colorTable,
  capturedFrameCount,
  updateProgress,
  setGifResult,
  onEncoded,
}: FinalizeGifExportOptions) => {
  const normalizedFrames = normalizeGifFrames(frames);
  updateProgress(
    `Encoding GIF (${normalizedFrames.length} frame${normalizedFrames.length === 1 ? "" : "s"}${aborted ? ", partial" : ""})...`,
    0.9,
  );
  const encodeStartedAt = performance.now();
  const { blob } = await encodeGifBlob(normalizedFrames, colorTable);
  setGifResult(
    blob,
    aborted ? `Partial GIF preview ready (${capturedFrameCount} captured).` : "GIF ready to save or copy.",
  );
  onEncoded?.({
    normalizedFrameCount: normalizedFrames.length,
    encodeMs: Math.round(performance.now() - encodeStartedAt),
  });
};

export const finalizeSequenceExport = async ({
  frames,
  updateProgress,
  setSequenceResult,
  progressBase = 0.82,
  progressSpan = 0.12,
}: FinalizeSequenceExportOptions) => {
  const { blob, fileCount } = await encodePngSequenceZip(frames, (frameIndex, frameCount) => {
    updateProgress(
      `Encoding frame ${frameIndex + 1}/${frameCount}`,
      progressBase + ((frameIndex + 1) / Math.max(1, frameCount)) * progressSpan,
    );
  });
  updateProgress(`Zipping ${fileCount} frames...`, 0.96);
  setSequenceResult(blob);
};
