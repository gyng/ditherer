export const IMAGE_FORMAT_OPTIONS = {
  options: [{ value: "png" }, { value: "jpeg" }, { value: "webp" }],
};

export const LOOP_CAPTURE_MODE_OPTIONS = {
  options: [
    { name: "Realtime (Fastest)", value: "realtime" },
    { name: "Offline Render (Browser, Slower)", value: "offline" },
    { name: "Offline Render (WebCodecs, Speed Varies)", value: "webcodecs" },
  ],
};

export const VIDEO_LOOP_MODE_OPTIONS = {
  options: [
    { name: "Realtime (Fastest)", value: "realtime" },
    { name: "Offline Render (Browser, Slower)", value: "offline" },
    { name: "Offline Render (WebCodecs, Speed Varies)", value: "webcodecs" },
  ],
};

export const RELIABLE_SCOPE_OPTIONS = {
  options: [
    { name: "Whole video", value: "loop" },
    { name: "Timestamp range", value: "range" },
  ],
};

export const GIF_PALETTE_SOURCE_OPTIONS = {
  options: [
    { name: "Auto from frames", value: "auto" },
    { name: "Current filter palette", value: "filter" },
  ],
};

export const DEFAULT_RELIABLE_MAX_FPS = 12;
export const DEFAULT_RELIABLE_SETTLE_FRAMES = 1;
export const GIF_PALETTE_PREVIEW_LIMIT = 24;
