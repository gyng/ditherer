import { describe, expect, it, vi } from "vitest";
import { buildOfflineTimeline, renderOfflineFrames } from "components/SaveAs/export/offlineRender";

const makeVideo = (duration = 1, initialTime = 0) => {
  let currentTime = initialTime;
  let seeked: (() => void) | null = null;
  return {
    duration,
    pause: vi.fn(),
    addEventListener: vi.fn((_name: string, callback: () => void) => {
      seeked = callback;
    }),
    removeEventListener: vi.fn(),
    get currentTime() {
      return currentTime;
    },
    set currentTime(value: number) {
      currentTime = value;
      queueMicrotask(() => seeked?.());
    },
  } as unknown as HTMLVideoElement;
};

const makeCanvas = () => {
  const pixels = new Uint8ClampedArray([10, 20, 30, 255]);
  return {
    width: 1,
    height: 1,
    getContext: vi.fn(() => ({
      getImageData: vi.fn(() => ({ data: pixels })),
    })),
  } as unknown as HTMLCanvasElement;
};

describe("buildOfflineTimeline", () => {
  it("builds exact-cadence timestamps for a loop duration", () => {
    const frames = buildOfflineTimeline(1, 4);

    expect(frames).toHaveLength(4);
    expect(frames.map((frame) => frame.timestampUs)).toEqual([0, 250000, 500000, 750000]);
    expect(frames[3].timeSec).toBeCloseTo(0.75, 3);
    expect(frames[3].durationUs).toBe(250000);
  });

  it("keeps a final sample inside the source duration", () => {
    const frames = buildOfflineTimeline(1.1, 2);

    expect(frames).toHaveLength(3);
    expect(frames[2].timeSec).toBeLessThan(1.1);
    expect(frames[2].durationUs).toBe(100000);
  });

  it("rejects invalid source durations instead of producing a corrupt timeline", () => {
    expect(() => buildOfflineTimeline(0, 30)).toThrow("finite positive duration");
    expect(() => buildOfflineTimeline(Number.NaN, 30)).toThrow("finite positive duration");
  });
});

describe("renderOfflineFrames", () => {
  it("seeks, captures, encodes, and reports each deterministic timeline phase", async () => {
    const video = makeVideo(1, 0.5);
    const waitForFrame = vi.fn(async () => undefined);
    const onFrame = vi.fn(async () => undefined);
    const onProgress = vi.fn();
    const canvas = makeCanvas();

    const result = await renderOfflineFrames({
      video,
      fps: 2,
      startTimeSec: 0,
      endTimeSec: 1,
      getFrameCanvas: vi.fn(() => canvas),
      waitForFrame,
      onFrame,
      onProgress,
      isAborted: () => false,
    });

    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.addEventListener).toHaveBeenCalledWith("seeked", expect.any(Function));
    expect(waitForFrame).toHaveBeenNthCalledWith(1, video, 0, 500);
    expect(waitForFrame).toHaveBeenNthCalledWith(2, video, 0.5, 500);
    expect(onFrame).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        index: 0,
        timestampUs: 0,
        durationUs: 500000,
        width: 1,
        height: 1,
        pixels: new Uint8ClampedArray([10, 20, 30, 255]),
      }),
    );
    expect(onProgress.mock.calls.map(([progress]) => progress.phase)).toEqual([
      "rewind",
      "seek",
      "capture",
      "seek",
      "capture",
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        frameCount: 2,
        durationSec: 1,
        aborted: false,
      }),
    );
    expect(result.metrics.seekMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.captureMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.encodeMs).toBeGreaterThanOrEqual(0);
  });

  it("stops before seeking when cancellation is already requested", async () => {
    const waitForFrame = vi.fn();
    const onFrame = vi.fn();

    const result = await renderOfflineFrames({
      video: makeVideo(),
      fps: 4,
      getFrameCanvas: vi.fn(),
      waitForFrame,
      onFrame,
      isAborted: () => true,
    });

    expect(result).toEqual(expect.objectContaining({ frameCount: 0, aborted: true }));
    expect(waitForFrame).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("stops after an in-flight seek when cancellation arrives", async () => {
    let aborted = false;
    const onFrame = vi.fn();

    const result = await renderOfflineFrames({
      video: makeVideo(),
      fps: 2,
      getFrameCanvas: vi.fn(),
      waitForFrame: vi.fn(async () => {
        aborted = true;
      }),
      onFrame,
      isAborted: () => aborted,
    });

    expect(result).toEqual(expect.objectContaining({ frameCount: 0, aborted: true }));
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("surfaces missing output canvases and unreadable pixel contexts", async () => {
    const common = {
      video: makeVideo(),
      fps: 1,
      waitForFrame: vi.fn(async () => undefined),
      onFrame: vi.fn(),
    };

    await expect(
      renderOfflineFrames({
        ...common,
        getFrameCanvas: () => null,
      }),
    ).rejects.toThrow("Failed to capture export frame canvas");

    await expect(
      renderOfflineFrames({
        ...common,
        getFrameCanvas: () =>
          ({
            width: 1,
            height: 1,
            getContext: () => null,
          }) as unknown as HTMLCanvasElement,
      }),
    ).rejects.toThrow("Failed to read export frame pixels");
  });
});
