import { describe, expect, it } from "vitest";
import {
  planLoopCaptureRouting,
  planReliableVideoRouting,
} from "components/SaveAs/exportRouting";

describe("planReliableVideoRouting", () => {
  it("attempts WebCodecs decode when requested and available", () => {
    expect(
      planReliableVideoRouting({
        preferredMode: "webcodecs",
        sourceUrl: "blob:video",
        hasVideoDecoder: true,
      }),
    ).toEqual({
      sourcePath: "webcodecs",
      shouldAttemptWebCodecs: true,
      fallbackReason: null,
    });
  });

  it("falls back to browser seek when the source URL is unavailable", () => {
    expect(
      planReliableVideoRouting({
        preferredMode: "webcodecs",
        sourceUrl: null,
        hasVideoDecoder: true,
      }),
    ).toEqual({
      sourcePath: "browser-seek",
      shouldAttemptWebCodecs: false,
      fallbackReason: "No source URL available for WebCodecs decode.",
    });
  });

  it("falls back to browser seek when VideoDecoder is unavailable", () => {
    expect(
      planReliableVideoRouting({
        preferredMode: "webcodecs",
        sourceUrl: "blob:video",
        hasVideoDecoder: false,
      }),
    ).toEqual({
      sourcePath: "browser-seek",
      shouldAttemptWebCodecs: false,
      fallbackReason: "WebCodecs VideoDecoder is unavailable in this browser.",
    });
  });
});

describe("planLoopCaptureRouting", () => {
  it("keeps realtime loop capture on the playback path", () => {
    expect(
      planLoopCaptureRouting({
        captureMode: "realtime",
        sourceUrl: "blob:video",
        hasVideoDecoder: true,
      }),
    ).toEqual({
      path: "realtime-playback",
      usesPlaybackCapture: true,
      shouldAttemptWebCodecs: false,
      fallbackReason: null,
    });
  });

  it("uses hidden-video fallback for offline capture", () => {
    expect(
      planLoopCaptureRouting({
        captureMode: "offline",
        sourceUrl: "blob:video",
        hasVideoDecoder: true,
      }),
    ).toEqual({
      path: "hidden-video-fallback",
      usesPlaybackCapture: false,
      shouldAttemptWebCodecs: false,
      fallbackReason: null,
    });
  });

  it("routes WebCodecs loop capture through demux when available", () => {
    expect(
      planLoopCaptureRouting({
        captureMode: "webcodecs",
        sourceUrl: "blob:video",
        hasVideoDecoder: true,
      }),
    ).toEqual({
      path: "webcodecs-demux",
      usesPlaybackCapture: false,
      shouldAttemptWebCodecs: true,
      fallbackReason: null,
    });
  });

  it("returns the hidden-video fallback reason when WebCodecs cannot be attempted", () => {
    expect(
      planLoopCaptureRouting({
        captureMode: "webcodecs",
        sourceUrl: null,
        hasVideoDecoder: true,
      }),
    ).toEqual({
      path: "hidden-video-fallback",
      usesPlaybackCapture: false,
      shouldAttemptWebCodecs: false,
      fallbackReason: "No source URL available for WebCodecs decode.",
    });
  });
});
