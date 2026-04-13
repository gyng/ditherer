import { formatEta, type GifFrame } from "../helpers";

type CaptureFrame = Pick<GifFrame, "data" | "width" | "height">;

interface CaptureCurrentOutputFramesOptions {
  frameCount: number;
  getScaledCanvas: () => HTMLCanvasElement | null;
  isAborted: () => boolean;
  onProgress: (message: string, progress: number) => void;
}

const nextAnimationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const captureCurrentOutputFrames = async ({
  frameCount,
  getScaledCanvas,
  isAborted,
  onProgress,
}: CaptureCurrentOutputFramesOptions) => {
  const capturedFrames: CaptureFrame[] = [];
  const captureStartedAt = performance.now();
  let aborted = false;

  for (let i = 0; i < frameCount; i += 1) {
    if (isAborted()) {
      aborted = true;
      break;
    }
    const elapsedMs = performance.now() - captureStartedAt;
    const avgMs = i > 0 ? elapsedMs / i : 0;
    const etaMs = i > 0 ? avgMs * (frameCount - i) : 0;
    onProgress(
      `Capturing frame ${i + 1}/${frameCount}${i > 0 ? ` · ETA ${formatEta(etaMs)}` : ""}`,
      ((i + 1) / Math.max(1, frameCount)) * 0.86,
    );
    await nextAnimationFrame();
    const scaled = getScaledCanvas();
    if (!scaled) {
      throw new Error("Export frame capture requires a rendered output canvas.");
    }
    const ctx = scaled.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to initialize export frame capture canvas.");
    }
    const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
    capturedFrames.push({
      data: imageData.data,
      width: scaled.width,
      height: scaled.height,
    });
  }

  return { capturedFrames, aborted };
};

export const addFrameDelay = (frame: CaptureFrame, delay: number): GifFrame => ({
  ...frame,
  delay,
});

