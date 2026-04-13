type PaletteOptionWithColors = {
  options?: {
    colors?: unknown;
  };
};

export type RecordingFormat = {
  label: string;
  container: string;
  mimeType: string;
  ext: string;
};

export type ManagedVideoElement = HTMLVideoElement & { __manualPause?: boolean };
export type SourceVideoWithObjectUrl = HTMLVideoElement & { __objectUrl?: string };
export type VideoFrameMetadata = { mediaTime?: number };
export type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadata) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  captureStream?: (fps?: number) => MediaStream;
};

export type GifFrame = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  delay: number;
};

export type RgbColor = [number, number, number];

const getPaletteOptions = (palette: unknown): PaletteOptionWithColors | null =>
  typeof palette === "object" && palette !== null ? (palette as PaletteOptionWithColors) : null;

const normalizeColor = (color: unknown): RgbColor | null => {
  if (!Array.isArray(color) || color.length < 3) {
    return null;
  }

  const normalized = color.slice(0, 3).map((channel) => {
    const n = Number(channel);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, Math.round(n)));
  });

  return [normalized[0], normalized[1], normalized[2]];
};

export const makeFilename = (ext: string) => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `ditherer-${stamp}.${ext}`;
};

export const canWriteClipboard = () => typeof navigator !== "undefined" && navigator.clipboard != null;

export const rgbToCss = (color: number[]) => `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

export const quantizeGifDelay = (delayMs: number) =>
  Math.max(10, Math.round(Math.max(10, delayMs) / 10) * 10);

export const areFrameBuffersEqual = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const toGifBuffer = (data: Uint8ClampedArray) => new Uint8Array(data);

export const detectRecordingFormats = (): RecordingFormat[] => {
  const codecCandidates: { container: string; codec: string; mime: string; ext: string }[] = [
    { container: "webm", codec: "vp9", mime: "video/webm; codecs=vp9", ext: "webm" },
    { container: "webm", codec: "vp8", mime: "video/webm; codecs=vp8", ext: "webm" },
    { container: "webm", codec: "av1", mime: "video/webm; codecs=av01", ext: "webm" },
    { container: "mp4", codec: "h264", mime: "video/mp4; codecs=avc1", ext: "mp4" },
    { container: "mp4", codec: "h265", mime: "video/mp4; codecs=hvc1", ext: "mp4" },
  ];
  const fallbacks: { container: string; mime: string; ext: string }[] = [
    { container: "webm", mime: "video/webm", ext: "webm" },
    { container: "mp4", mime: "video/mp4", ext: "mp4" },
  ];

  const formats: RecordingFormat[] = [];
  const containersWithCodec = new Set<string>();

  for (const candidate of codecCandidates) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) {
      formats.push({
        label: `${candidate.container} (${candidate.codec})`,
        container: candidate.container,
        mimeType: candidate.mime,
        ext: candidate.ext,
      });
      containersWithCodec.add(candidate.container);
    }
  }

  for (const fallback of fallbacks) {
    if (!containersWithCodec.has(fallback.container) && MediaRecorder.isTypeSupported(fallback.mime)) {
      formats.push({
        label: fallback.container,
        container: fallback.container,
        mimeType: fallback.mime,
        ext: fallback.ext,
      });
    }
  }

  return formats;
};

export const getGifPaletteColorTable = (paletteCandidates: unknown[]): RgbColor[] | null => {
  for (const palette of paletteCandidates) {
    const rawColors = getPaletteOptions(palette)?.options?.colors;
    if (!Array.isArray(rawColors) || rawColors.length === 0) continue;

    const deduped = rawColors
      .map(normalizeColor)
      .filter((color): color is RgbColor => color != null)
      .filter((color, index, all) => (
        all.findIndex((candidate) => (
          candidate[0] === color[0] &&
          candidate[1] === color[1] &&
          candidate[2] === color[2]
        )) === index
      ))
      .slice(0, 256);

    if (deduped.length >= 2) {
      return deduped;
    }
  }

  return null;
};

export const normalizeGifFrames = (framesToNormalize: GifFrame[]) => {
  const normalized: GifFrame[] = [];

  for (const frame of framesToNormalize) {
    const normalizedDelay = quantizeGifDelay(frame.delay);
    const previous = normalized[normalized.length - 1];
    if (
      previous &&
      previous.width === frame.width &&
      previous.height === frame.height &&
      areFrameBuffersEqual(previous.data, frame.data)
    ) {
      previous.delay = quantizeGifDelay(previous.delay + normalizedDelay);
      continue;
    }
    normalized.push({
      data: new Uint8ClampedArray(frame.data),
      width: frame.width,
      height: frame.height,
      delay: normalizedDelay,
    });
  }

  return normalized;
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const copyBlobToClipboard = async (blob: Blob) => {
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
};

export const formatTime = (secs: number) => {
  const m = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};

export const formatEta = (ms: number) => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins > 0 ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
};
