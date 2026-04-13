import { finalizeContactSheetExport, finalizeGifExport, finalizeSequenceExport } from "./finalizeFrameExports";
import { addFrameDelay, captureCurrentOutputFrames } from "./liveFrameExport";
import { quantizeGifDelay } from "../helpers";

interface RunCurrentFrameGifExportOptions {
  frameCount: number;
  gifFps: number;
  getScaledCanvas: () => HTMLCanvasElement | null;
  updateProgress: (message: string, value?: number | null) => void;
  clearProgress: () => void;
  isAborted: () => boolean;
  clearGifResult: () => void;
  setGifResult: (blob: Blob, label: string) => void;
  gifPaletteSource: "auto" | "filter";
  gifFilterPalette: number[][] | null;
}

interface RunCurrentFrameSequenceExportOptions {
  frameCount: number;
  getScaledCanvas: () => HTMLCanvasElement | null;
  updateProgress: (message: string, value?: number | null) => void;
  clearProgress: () => void;
  isAborted: () => boolean;
  clearSequenceResult: () => void;
  setSequenceResult: (blob: Blob) => void;
}

interface RunCurrentFrameContactSheetExportOptions {
  frameCount: number;
  columns: number;
  getScaledCanvas: () => HTMLCanvasElement | null;
  updateProgress: (message: string, value?: number | null) => void;
  clearProgress: () => void;
  isAborted: () => boolean;
  clearContactSheetResult: () => void;
  setContactSheetResult: (blob: Blob) => void;
}

const captureCurrentFrames = async (
  frameCount: number,
  getScaledCanvas: () => HTMLCanvasElement | null,
  updateProgress: (message: string, value?: number | null) => void,
  isAborted: () => boolean,
) => captureCurrentOutputFrames({
  frameCount,
  getScaledCanvas,
  isAborted,
  onProgress: updateProgress,
});

export const runCurrentFrameGifExport = async ({
  frameCount,
  gifFps,
  getScaledCanvas,
  updateProgress,
  clearProgress,
  isAborted,
  clearGifResult,
  setGifResult,
  gifPaletteSource,
  gifFilterPalette,
}: RunCurrentFrameGifExportOptions) => {
  clearGifResult();
  const delay = quantizeGifDelay(1000 / gifFps);
  const { capturedFrames, aborted } = await captureCurrentFrames(frameCount, getScaledCanvas, updateProgress, isAborted);

  if (capturedFrames.length === 0) {
    clearProgress();
    return;
  }

  const colorTable = gifPaletteSource === "filter" ? gifFilterPalette : null;
  await finalizeGifExport({
    frames: capturedFrames.map((frame) => addFrameDelay(frame, delay)),
    aborted,
    colorTable,
    capturedFrameCount: capturedFrames.length,
    updateProgress,
    setGifResult,
  });
  clearProgress();
};

export const runCurrentFrameSequenceExport = async ({
  frameCount,
  getScaledCanvas,
  updateProgress,
  clearProgress,
  isAborted,
  clearSequenceResult,
  setSequenceResult,
}: RunCurrentFrameSequenceExportOptions) => {
  clearSequenceResult();
  const { capturedFrames, aborted } = await captureCurrentFrames(frameCount, getScaledCanvas, updateProgress, isAborted);

  if (aborted) {
    clearProgress();
    return;
  }

  await finalizeSequenceExport({
    frames: capturedFrames.map((frame) => addFrameDelay(frame, 0)),
    updateProgress,
    setSequenceResult,
    progressBase: 0.86,
    progressSpan: 0.08,
  });
  clearProgress();
};

export const runCurrentFrameContactSheetExport = async ({
  frameCount,
  columns,
  getScaledCanvas,
  updateProgress,
  clearProgress,
  isAborted,
  clearContactSheetResult,
  setContactSheetResult,
}: RunCurrentFrameContactSheetExportOptions) => {
  clearContactSheetResult();
  const { capturedFrames, aborted } = await captureCurrentFrames(frameCount, getScaledCanvas, updateProgress, isAborted);

  if (aborted || capturedFrames.length === 0) {
    clearProgress();
    return;
  }

  await finalizeContactSheetExport({
    frames: capturedFrames.map((frame) => addFrameDelay(frame, 0)),
    columns,
    updateProgress,
    setContactSheetResult,
  });
  clearProgress();
};
