import { describe, expect, it } from "vitest";
import { buildRecorderOptions, getLoopStopDelayMs } from "components/SaveAs/export/realtimeVideoRecording";

describe("buildRecorderOptions", () => {
  it("uses the recording format mime type when present", () => {
    expect(buildRecorderOptions({
      label: "webm",
      container: "webm",
      mimeType: "video/webm; codecs=vp9",
      ext: "webm",
    }, true, 2.5)).toEqual({
      mimeType: "video/webm; codecs=vp9",
    });
  });

  it("includes bitrate when auto bitrate is disabled", () => {
    expect(buildRecorderOptions(null, false, 3.25)).toEqual({
      mimeType: "video/webm",
      videoBitsPerSecond: 3_250_000,
    });
  });
});

describe("getLoopStopDelayMs", () => {
  it("accounts for playback rate and adds a small buffer", () => {
    expect(getLoopStopDelayMs(12, 2)).toBe(6200);
  });

  it("falls back to playback rate 1 when the input is zero", () => {
    expect(getLoopStopDelayMs(3, 0)).toBe(3200);
  });
});
