import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareOfflineAudioTrack,
  reconcileAudioFrameCount,
} from "components/SaveAs/export/offlineAudioEncode";

type BufferShape = Pick<
  AudioBuffer,
  "duration" | "length" | "numberOfChannels" | "sampleRate" | "getChannelData"
>;

const makeBuffer = (overrides: Partial<BufferShape> = {}): AudioBuffer =>
  ({
    duration: 0.03,
    length: 1440,
    numberOfChannels: 2,
    sampleRate: 48_000,
    getChannelData: (channel: number) =>
      Float32Array.from({ length: 1440 }, (_, index) => channel + index / 10_000),
    ...overrides,
  }) as AudioBuffer;

class AudioDataStub {
  static instances: AudioDataStub[] = [];
  readonly init: AudioDataInit;
  readonly close = vi.fn();
  constructor(init: AudioDataInit) {
    this.init = init;
    AudioDataStub.instances.push(this);
  }
}

class AudioEncoderStub {
  static supported = true;
  static instances: AudioEncoderStub[] = [];
  static isConfigSupported = vi.fn(async () => ({ supported: AudioEncoderStub.supported }));
  readonly output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void;
  readonly error: (error: DOMException) => void;
  readonly configure = vi.fn();
  readonly encode = vi.fn((data: AudioData) => {
    this.output({} as EncodedAudioChunk, { decoderConfig: {} } as EncodedAudioChunkMetadata);
    return data;
  });
  readonly flush = vi.fn(async () => {});
  readonly close = vi.fn();
  constructor(init: AudioEncoderInit) {
    this.output = init.output;
    this.error = init.error;
    AudioEncoderStub.instances.push(this);
  }
}

const stubDecodeContext = (decode: () => Promise<AudioBuffer>) => {
  const close = vi.fn(async () => {});
  const AudioContextStub = class {
    decodeAudioData = vi.fn(decode);
    close = close;
  };
  vi.stubGlobal("AudioContext", AudioContextStub);
  Object.defineProperty(window, "AudioContext", { configurable: true, value: AudioContextStub });
  return close;
};

const makeVideo = (source = "blob:input") => {
  const video = document.createElement("video") as HTMLVideoElement & { __objectUrl?: string };
  video.__objectUrl = source;
  return video;
};

beforeEach(() => {
  AudioDataStub.instances = [];
  AudioEncoderStub.instances = [];
  AudioEncoderStub.supported = true;
  AudioEncoderStub.isConfigSupported.mockClear();
  vi.stubGlobal("AudioData", AudioDataStub);
  vi.stubGlobal("AudioEncoder", AudioEncoderStub);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
  Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
});

describe("offline audio preparation", () => {
  it("reconciles finite and invalid source lengths to the requested duration", () => {
    expect(reconcileAudioFrameCount(10, 20)).toBe(20);
    expect(reconcileAudioFrameCount(Number.NaN, 20)).toBe(20);
    expect(reconcileAudioFrameCount(-1, -20)).toBe(0);
  });

  it("reports unreadable sources, failed fetches, and missing decode support", async () => {
    await expect(
      prepareOfflineAudioTrack(document.createElement("video"), 1_000_000),
    ).rejects.toThrow("readable video source");

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    await expect(prepareOfflineAudioTrack(makeVideo(), 1_000_000)).rejects.toThrow("(403)");

    await expect(prepareOfflineAudioTrack(makeVideo(), 1_000_000)).rejects.toThrow(
      "does not support AudioContext",
    );
  });

  it("uses the WebKit decode fallback and returns null for decode or empty-audio failures", async () => {
    const close = vi.fn(async () => {
      throw new Error("already closed");
    });
    const WebkitContext = class {
      decodeAudioData = vi.fn(async () => {
        throw new Error("no audio track");
      });
      close = close;
    };
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: WebkitContext,
    });
    await expect(prepareOfflineAudioTrack(makeVideo(), 1_000_000)).resolves.toBeNull();
    expect(close).toHaveBeenCalledOnce();

    stubDecodeContext(async () => makeBuffer({ numberOfChannels: 0, length: 0, duration: 0 }));
    await expect(prepareOfflineAudioTrack(makeVideo(), 1_000_000)).resolves.toBeNull();
  });

  it("rejects a browser without Opus encoding support", async () => {
    stubDecodeContext(async () => makeBuffer());
    AudioEncoderStub.supported = false;
    await expect(prepareOfflineAudioTrack(makeVideo(), 30_000)).rejects.toThrow(
      "cannot encode Opus audio",
    );
  });

  it("encodes bounded stereo chunks, progress, mux output, and cleanup", async () => {
    const closeDecode = stubDecodeContext(async () => makeBuffer());
    const track = await prepareOfflineAudioTrack(makeVideo("blob:preferred"), 30_000);
    expect(track).toMatchObject({ numberOfChannels: 2, sampleRate: 48_000, totalFrames: 1440 });
    expect(fetch).toHaveBeenCalledWith("blob:preferred");
    expect(closeDecode).toHaveBeenCalledOnce();

    const muxer = { addAudioChunk: vi.fn() };
    const progress = vi.fn();
    await track!.encodeInto(muxer as never, progress, () => false);

    const encoder = AudioEncoderStub.instances[0];
    expect(encoder.configure).toHaveBeenCalledWith(expect.objectContaining({ bitrate: 128_000 }));
    expect(encoder.encode).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenNthCalledWith(1, "Encoding audio 1/2");
    expect(progress).toHaveBeenNthCalledWith(2, "Encoding audio 2/2");
    expect(muxer.addAudioChunk).toHaveBeenCalledTimes(2);
    expect(AudioDataStub.instances.map((data) => data.init.numberOfFrames)).toEqual([960, 480]);
    expect(AudioDataStub.instances.every((data) => data.close.mock.calls.length === 1)).toBe(true);
    expect(encoder.flush).toHaveBeenCalledOnce();
    expect(encoder.close).toHaveBeenCalledOnce();
  });

  it("resamples mono input and honors aborts without requiring a progress callback", async () => {
    const decoded = makeBuffer({ sampleRate: 44_100, numberOfChannels: 1 });
    const resampled = makeBuffer({
      sampleRate: 48_000,
      numberOfChannels: 1,
      length: 960,
      duration: 0.02,
    });
    stubDecodeContext(async () => decoded);
    const source = { buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn() };
    const OfflineContext = class {
      destination = {};
      createBufferSource = vi.fn(() => source);
      startRendering = vi.fn(async () => resampled);
    };
    vi.stubGlobal("OfflineAudioContext", OfflineContext);

    const track = await prepareOfflineAudioTrack(makeVideo(), 20_000);
    expect(source.buffer).toBe(decoded);
    expect(source.connect).toHaveBeenCalled();
    expect(source.start).toHaveBeenCalledWith(0);
    expect(track?.numberOfChannels).toBe(1);

    await track!.encodeInto({ addAudioChunk: vi.fn() } as never, undefined, () => true);
    const encoder = AudioEncoderStub.instances[0];
    expect(encoder.configure).toHaveBeenCalledWith(expect.objectContaining({ bitrate: 96_000 }));
    expect(encoder.encode).not.toHaveBeenCalled();
    expect(encoder.flush).toHaveBeenCalledOnce();
    expect(encoder.close).toHaveBeenCalledOnce();
  });
});
