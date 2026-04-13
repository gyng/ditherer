import { zipSync } from "fflate";
import { normalizeGifFrames, toGifBuffer, type GifFrame } from "../helpers";

export const revokeObjectUrl = (url: string | null) => {
  if (url) {
    URL.revokeObjectURL(url);
  }
};

export const replaceObjectUrl = (
  previousUrl: string | null,
  blob: Blob | null,
) => {
  revokeObjectUrl(previousUrl);
  return blob ? URL.createObjectURL(blob) : null;
};

export const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

export const encodeGifBlob = async (
  frames: GifFrame[],
  colorTable?: number[][] | null,
) => {
  const normalizedFrames = normalizeGifFrames(frames);
  const { encode } = await import("modern-gif");
  const output = await encode({
    width: normalizedFrames[0].width,
    height: normalizedFrames[0].height,
    frames: normalizedFrames.map((frame) => ({
      data: toGifBuffer(frame.data),
      delay: frame.delay,
    })),
    ...(colorTable ? { colorTable } : {}),
  });

  return {
    blob: new Blob([output], { type: "image/gif" }),
    normalizedFrames,
  };
};

export const encodePngSequenceZip = async (
  frames: GifFrame[],
  onFrame?: (frameIndex: number, frameCount: number) => void,
) => {
  const zipFiles: Record<string, Uint8Array> = {};

  for (let i = 0; i < frames.length; i += 1) {
    onFrame?.(i, frames.length);
    const frame = frames[i];
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to initialize PNG sequence canvas.");
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
    const blob = await canvasToBlob(canvas, "image/png");
    if (blob) {
      zipFiles[`ditherer-seq-${String(i).padStart(4, "0")}.png`] = new Uint8Array(await blob.arrayBuffer());
    }
  }

  const zipped = zipSync(zipFiles, { level: 0 });
  return {
    blob: new Blob([new Uint8Array(zipped)], { type: "application/zip" }),
    fileCount: Object.keys(zipFiles).length,
  };
};
