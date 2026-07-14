import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChunkFixture = {
  timestamp: number;
  frames?: Array<{ timestamp: number; duration?: number }>;
  error?: unknown;
};

const demuxState = vi.hoisted(() => ({
  chunksByRead: [] as ChunkFixture[][],
  config: { codec: "vp09.00.10.08", codedWidth: 640, codedHeight: 360 },
  streamInfo: { width: 320, height: 180 },
  loadError: null as unknown,
  destroyed: 0,
  readCalls: [] as Array<[number, number]>,
}));

vi.mock("web-demuxer", () => ({
  AVSeekFlag: { AVSEEK_FLAG_BACKWARD: 1 },
  WebDemuxer: class {
    async load() {
      if (demuxState.loadError) throw demuxState.loadError;
    }
    async getDecoderConfig() { return demuxState.config; }
    async getMediaStream() { return demuxState.streamInfo; }
    read(_kind: string, start: number, end: number) {
      demuxState.readCalls.push([start, end]);
      const chunks = [...(demuxState.chunksByRead.shift() ?? [])];
      return {
        getReader: () => ({
          read: vi.fn(async () => chunks.length > 0
            ? { done: false, value: chunks.shift() }
            : { done: true, value: undefined }),
          releaseLock: vi.fn(),
        }),
      };
    }
    destroy() { demuxState.destroyed += 1; }
  },
}));
vi.mock("web-demuxer/wasm?url", () => ({ default: "/web-demuxer.wasm" }));

import {
  buildDecodedTimeline,
  decodeSourceFramesWithWebCodecs,
  decodeTimelineFramesWithWebCodecs,
  selectFramesForTimeline,
} from "components/SaveAs/export/offlineWebCodecsDecode";

const originalVideoDecoder = Object.getOwnPropertyDescriptor(globalThis, "VideoDecoder");

const installDecoder = (supported = true, supportConfig = demuxState.config) => {
  const closedFrames: number[] = [];
  class FakeVideoDecoder {
    static isConfigSupported = vi.fn().mockResolvedValue({
      supported,
      config: supported ? supportConfig : undefined,
    });
    private init: { output: (frame: VideoFrame) => void; error: (error: unknown) => void };
    configure = vi.fn();
    close = vi.fn();
    flush = vi.fn().mockResolvedValue(undefined);
    constructor(init: { output: (frame: VideoFrame) => void; error: (error: unknown) => void }) {
      this.init = init;
    }
    decode(chunk: ChunkFixture) {
      if (chunk.error !== undefined) this.init.error(chunk.error);
      for (const fixture of chunk.frames ?? []) {
        this.init.output({
          timestamp: fixture.timestamp,
          duration: fixture.duration,
          close: () => closedFrames.push(fixture.timestamp),
        } as unknown as VideoFrame);
      }
    }
  }
  Object.defineProperty(globalThis, "VideoDecoder", { configurable: true, value: FakeVideoDecoder });
  return { FakeVideoDecoder, closedFrames };
};

beforeEach(() => {
  demuxState.chunksByRead = [];
  demuxState.config = { codec: "vp09.00.10.08", codedWidth: 640, codedHeight: 360 };
  demuxState.streamInfo = { width: 320, height: 180 };
  demuxState.loadError = null;
  demuxState.destroyed = 0;
  demuxState.readCalls = [];
});

afterEach(() => {
  if (originalVideoDecoder) Object.defineProperty(globalThis, "VideoDecoder", originalVideoDecoder);
  else delete (globalThis as Record<string, unknown>).VideoDecoder;
  vi.restoreAllMocks();
});

describe("offline WebCodecs decoding", () => {
  it("fails clearly when WebCodecs is unavailable", async () => {
    delete (globalThis as Record<string, unknown>).VideoDecoder;
    await expect(decodeSourceFramesWithWebCodecs({ source: "/clip.webm", startTimeSec: 0, endTimeSec: 1 }))
      .rejects.toThrow("VideoDecoder is unavailable");
    await expect(decodeTimelineFramesWithWebCodecs({ source: "/clip.webm", timeline: [] }))
      .rejects.toThrow("VideoDecoder is unavailable");
  });

  it("demuxes, sorts, and reports a source range", async () => {
    installDecoder();
    demuxState.chunksByRead = [[
      { timestamp: 500_000, frames: [{ timestamp: 500_000, duration: 40_000 }] },
      { timestamp: 0, frames: [{ timestamp: 0 }] },
    ]];
    const progress: string[] = [];

    const result = await decodeSourceFramesWithWebCodecs({
      source: "/clip.webm",
      startTimeSec: 0,
      endTimeSec: 1,
      onProgress: ({ message }) => progress.push(message),
    });

    expect(result.frames.map((frame) => frame.timestampUs)).toEqual([0, 500_000]);
    expect(result).toMatchObject({ width: 320, height: 180, codec: "vp09.00.10.08" });
    expect(result.metrics.decodedChunks).toBe(2);
    expect(progress.some((message) => message.includes("Demuxing source packets"))).toBe(true);
    expect(demuxState.destroyed).toBe(1);
  });

  it("rejects unsupported configs, aborts, and decoder errors while cleaning up", async () => {
    installDecoder(false);
    await expect(decodeSourceFramesWithWebCodecs({ source: "/clip.webm", startTimeSec: 0, endTimeSec: 1 }))
      .rejects.toThrow("Browser rejected WebCodecs config");

    installDecoder();
    await expect(decodeSourceFramesWithWebCodecs({
      source: "/clip.webm",
      startTimeSec: 0,
      endTimeSec: 1,
      isAborted: () => true,
    })).rejects.toThrow("Decode aborted");

    demuxState.chunksByRead = [[{ timestamp: 0, frames: [{ timestamp: 0 }], error: "decode failed" }]];
    const { closedFrames } = installDecoder();
    await expect(decodeSourceFramesWithWebCodecs({ source: "/clip.webm", startTimeSec: 0, endTimeSec: 1 }))
      .rejects.toThrow("decode failed");
    expect(closedFrames).toEqual([0]);
    expect(demuxState.destroyed).toBe(3);
  });

  it("seeks each requested timeline frame and keeps the closest eligible decode", async () => {
    const { closedFrames } = installDecoder();
    demuxState.chunksByRead = [
      [{ timestamp: 0, frames: [{ timestamp: 50_000 }, { timestamp: 110_000 }, { timestamp: 90_000 }] }],
      [{ timestamp: 1_000_000, frames: [{ timestamp: 950_000 }, { timestamp: 1_010_000 }] }],
    ];
    const timeline = [
      { index: 0, timeSec: 0.1, timestampUs: 100_000, durationUs: 40_000 },
      { index: 1, timeSec: 1, timestampUs: 1_000_000, durationUs: 40_000 },
    ];

    const result = await decodeTimelineFramesWithWebCodecs({ source: "/clip.webm", timeline });

    expect(result.frames.map((frame) => frame.timestampUs)).toEqual([110_000, 1_010_000]);
    expect(closedFrames).toEqual(expect.arrayContaining([50_000, 90_000, 950_000]));
    expect(demuxState.readCalls).toEqual([[0, 0.15000000000000002], [0, 1.05]]);
    expect(result.metrics.decodedChunks).toBe(2);
  });

  it("rejects an empty decode window and closes a best frame on decoder failure", async () => {
    installDecoder();
    demuxState.chunksByRead = [[]];
    const timeline = [{ index: 0, timeSec: 2, timestampUs: 2_000_000, durationUs: 40_000 }];
    await expect(decodeTimelineFramesWithWebCodecs({ source: "/clip.webm", timeline }))
      .rejects.toThrow("No decoded frame was produced");

    const { closedFrames } = installDecoder();
    demuxState.chunksByRead = [[{ timestamp: 0, frames: [{ timestamp: 2_000_000 }], error: new Error("bad frame") }]];
    await expect(decodeTimelineFramesWithWebCodecs({ source: "/clip.webm", timeline }))
      .rejects.toThrow("bad frame");
    expect(closedFrames).toContain(2_000_000);
  });
});

describe("decoded timeline selection", () => {
  it("maps each output timestamp to the latest decoded frame not after it", () => {
    const frame = (timestampUs: number) => ({ timestampUs, durationUs: 40_000, frame: {} as VideoFrame });
    const decoded = [frame(0), frame(500_000), frame(1_000_000)];
    const timeline = buildDecodedTimeline(1.5, 2);
    const selected = selectFramesForTimeline(decoded, timeline);
    expect(selected.map((entry) => entry.decodedFrame.timestampUs)).toEqual([0, 500_000, 1_000_000]);
  });

  it("rejects selection without decoded source frames", () => {
    expect(() => selectFramesForTimeline([], buildDecodedTimeline(1, 1))).toThrow("No decoded source frames");
  });
});
