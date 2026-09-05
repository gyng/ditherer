import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOfflineVideoEncoder,
  getReliableVideoSupport,
} from "components/SaveAs/export/offlineVideoEncode";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getReliableVideoSupport", () => {
  it.each([false, true])(
    "probes silent video support without audio APIs (codec supported: %s)",
    async (supported) => {
      const isConfigSupported = vi.fn(async () => ({ supported }));
      vi.stubGlobal("VideoEncoder", { isConfigSupported });
      vi.stubGlobal("VideoFrame", class {});
      vi.stubGlobal("AudioContext", undefined);
      vi.stubGlobal("webkitAudioContext", undefined);
      vi.stubGlobal("OfflineAudioContext", undefined);
      const result = await getReliableVideoSupport(16, 16, 30, false);
      expect(result.supported).toBe(supported);
      expect(result.audio).toBe(false);
      expect(isConfigSupported).toHaveBeenCalled();
      if (!supported) expect(result.reason).toContain("video encoder configuration");
    },
  );
});

const muxerMocks = vi.hoisted(() => ({ output: vi.fn(), finalize: vi.fn() }));
vi.mock("webm-muxer", () => ({
  ArrayBufferTarget: class {
    buffer = new ArrayBuffer(8);
  },
  Muxer: class {
    addVideoChunk = muxerMocks.output;
    finalize = muxerMocks.finalize;
  },
}));

class FakeEncoder extends EventTarget {
  static instances: FakeEncoder[] = [];
  static isConfigSupported = async () => ({ supported: true });
  static configureError: Error | null = null;
  encodeQueueSize = 0;
  constructor(readonly callbacks: VideoEncoderInit) {
    super();
    FakeEncoder.instances.push(this);
  }
  configure = vi.fn(() => {
    if (FakeEncoder.configureError) throw FakeEncoder.configureError;
  });
  encode = vi.fn(() => {
    this.encodeQueueSize += 1;
  });
  flush = vi.fn(async () => {});
  close = vi.fn();
}
const sample = {
  width: 1,
  height: 1,
  pixels: new Uint8ClampedArray([0, 0, 0, 255]),
  timestampUs: 0,
  durationUs: 33333,
};
const createEncoder = (isAborted = () => false) =>
  createOfflineVideoEncoder({
    width: 1,
    height: 1,
    fps: 30,
    durationUs: 1000000,
    sourceVideo: null,
    includeAudio: false,
    isAborted,
  });

describe("offline video encoder lifecycle", () => {
  beforeEach(() => {
    FakeEncoder.instances = [];
    FakeEncoder.configureError = null;
    muxerMocks.output.mockReset();
    muxerMocks.finalize.mockReset();
    vi.stubGlobal("VideoEncoder", FakeEncoder);
    vi.stubGlobal(
      "VideoFrame",
      class {
        close = vi.fn();
      },
    );
  });

  it("waits for queued frames to drain before accepting more pixels", async () => {
    const encoder = await createEncoder();
    const native = FakeEncoder.instances[0];
    for (let i = 0; i < 4; i++) await encoder.addFrame(sample);
    let completed = false;
    const pending = encoder.addFrame(sample).then(() => {
      completed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);
    expect(native.encode).toHaveBeenCalledTimes(4);
    native.encodeQueueSize = 0;
    native.dispatchEvent(new Event("dequeue"));
    await pending;
    expect(native.encode).toHaveBeenCalledTimes(5);
    encoder.dispose();
  });

  it("stops accepting frames when cancellation arrives during queue backpressure", async () => {
    let aborted = false;
    const encoder = await createEncoder(() => aborted);
    for (let i = 0; i < 4; i++) await encoder.addFrame(sample);
    const pending = encoder.addFrame(sample);
    aborted = true;
    await expect(pending).resolves.toBe(false);
    expect(FakeEncoder.instances[0].encode).toHaveBeenCalledTimes(4);
    encoder.dispose();
  });

  it("reports asynchronous codec errors through the export promise", async () => {
    const encoder = await createEncoder();
    const error = new DOMException("codec failed");
    expect(() => FakeEncoder.instances[0].callbacks.error(error)).not.toThrow();
    await expect(encoder.addFrame(sample)).rejects.toThrow("codec failed");
    expect(FakeEncoder.instances[0].close).toHaveBeenCalledOnce();
  });

  it("rejects a pending flush on asynchronous failure", async () => {
    const encoder = await createEncoder();
    const native = FakeEncoder.instances[0];
    native.flush.mockImplementation(() => new Promise(() => {}));
    const pending = expect(encoder.finalize()).rejects.toThrow("flush failed");
    expect(() => native.callbacks.error(new DOMException("flush failed"))).not.toThrow();
    await pending;
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("reports muxer output errors through the export promise", async () => {
    const encoder = await createEncoder();
    muxerMocks.output.mockImplementation(() => {
      throw new Error("mux failed");
    });
    expect(() => FakeEncoder.instances[0].callbacks.output({} as EncodedVideoChunk)).not.toThrow();
    await expect(encoder.finalize()).rejects.toThrow("mux failed");
    expect(FakeEncoder.instances[0].close).toHaveBeenCalledOnce();
  });

  it("closes the encoder after failed configuration", async () => {
    FakeEncoder.configureError = new Error("configure failed");
    await expect(createEncoder()).rejects.toThrow("configure failed");
    expect(FakeEncoder.instances[0].close).toHaveBeenCalledOnce();
  });

  it("closes the encoder after failed finalization", async () => {
    const encoder = await createEncoder();
    FakeEncoder.instances[0].flush.mockRejectedValue(new Error("flush rejected"));
    await expect(encoder.finalize()).rejects.toThrow("flush rejected");
    expect(FakeEncoder.instances[0].close).toHaveBeenCalledOnce();
  });

  it("releases a pending queue wait when disposed", async () => {
    const encoder = await createEncoder();
    const native = FakeEncoder.instances[0];
    for (let i = 0; i < 4; i++) await encoder.addFrame(sample);
    const removeListener = vi.spyOn(native, "removeEventListener");
    const pending = expect(encoder.addFrame(sample)).rejects.toThrow("disposed");
    encoder.dispose();
    await pending;
    expect(native.encode).toHaveBeenCalledTimes(4);
    expect(removeListener).toHaveBeenCalledWith("dequeue", expect.any(Function));
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("finalizes a video and closes its encoder exactly once", async () => {
    const encoder = await createEncoder();
    await encoder.addFrame(sample);
    const result = await encoder.finalize();
    expect(result.blob.type).toBe("video/webm");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(muxerMocks.finalize).toHaveBeenCalledOnce();
    encoder.dispose();
    expect(FakeEncoder.instances[0].close).toHaveBeenCalledOnce();
  });

  it("does not allocate an encoder when the staging canvas is unavailable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValueOnce(null);
    await expect(createEncoder()).rejects.toThrow("staging canvas");
    expect(FakeEncoder.instances).toHaveLength(0);
  });

  it("rejects further frames after disposal", async () => {
    const encoder = await createEncoder();
    encoder.dispose();
    await expect(encoder.addFrame(sample)).rejects.toThrow("disposed");
    expect(FakeEncoder.instances[0].encode).not.toHaveBeenCalled();
  });
});
