import { canvasToBlob } from "./exportArtifacts";
import type { GifFrame } from "../helpers";

export type ContactSheetLayout = {
  columns: number;
  rows: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  gap: number;
  padding: number;
};

const DEFAULT_GAP = 10;
const DEFAULT_PADDING = 12;
const DEFAULT_BACKGROUND = "#d4d0c8";

export const calculateContactSheetLayout = (
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
  preferredColumns: number,
  gap = DEFAULT_GAP,
  padding = DEFAULT_PADDING,
): ContactSheetLayout => {
  const safeFrameCount = Math.max(1, frameCount);
  const columns = Math.max(1, Math.min(safeFrameCount, Math.round(preferredColumns || 1)));
  const rows = Math.max(1, Math.ceil(safeFrameCount / columns));
  return {
    columns,
    rows,
    width: padding * 2 + columns * frameWidth + Math.max(0, columns - 1) * gap,
    height: padding * 2 + rows * frameHeight + Math.max(0, rows - 1) * gap,
    frameWidth,
    frameHeight,
    gap,
    padding,
  };
};

export const composeContactSheetBlob = async (
  frames: GifFrame[],
  preferredColumns: number,
  onProgress?: (progress: { frameIndex: number; frameCount: number; etaMs: number | null }) => void,
) => {
  if (frames.length === 0) {
    throw new Error("Contact sheet export requires at least one frame.");
  }

  const firstFrame = frames[0];
  const layout = calculateContactSheetLayout(
    frames.length,
    firstFrame.width,
    firstFrame.height,
    preferredColumns,
  );

  const sheetCanvas = document.createElement("canvas");
  sheetCanvas.width = layout.width;
  sheetCanvas.height = layout.height;
  const sheetCtx = sheetCanvas.getContext("2d");
  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = layout.frameWidth;
  frameCanvas.height = layout.frameHeight;
  const frameCtx = frameCanvas.getContext("2d");
  if (!sheetCtx || !frameCtx) {
    throw new Error("Failed to initialize contact sheet canvases.");
  }

  sheetCtx.fillStyle = DEFAULT_BACKGROUND;
  sheetCtx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);

  const composeStartedAt = performance.now();
  for (let index = 0; index < frames.length; index += 1) {
    const elapsedMs = performance.now() - composeStartedAt;
    const avgMs = index > 0 ? elapsedMs / index : 0;
    const etaMs = index > 0 ? avgMs * (frames.length - index) : null;
    onProgress?.({
      frameIndex: index,
      frameCount: frames.length,
      etaMs,
    });
    const frame = frames[index];
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const dx = layout.padding + column * (layout.frameWidth + layout.gap);
    const dy = layout.padding + row * (layout.frameHeight + layout.gap);
    frameCtx.putImageData(
      new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height),
      0,
      0,
    );
    sheetCtx.drawImage(frameCanvas, dx, dy, layout.frameWidth, layout.frameHeight);
  }

  const blob = await canvasToBlob(sheetCanvas, "image/png");
  if (!blob) {
    throw new Error("Failed to encode contact sheet.");
  }

  return {
    blob,
    layout,
    frameCount: frames.length,
  };
};
