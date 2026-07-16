import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSaveAsRenderSync } from "components/SaveAs/hooks/useSaveAsRenderSync";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useSaveAsRenderSync>;
let source: HTMLCanvasElement;
let refs: {
  outputCanvasRef: { current: HTMLCanvasElement | null };
  scaledCanvasRef: { current: HTMLCanvasElement | null };
  latestStateRef: { current: Record<string, unknown> };
  renderVersionRef: { current: number };
  exportAbortRef: { current: boolean };
};

const Harness = ({
  mult = 2,
  gifFps = 10,
  canvasWidth = 8,
  canvasHeight = 6,
}: {
  mult?: number;
  gifFps?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}) => {
  latest = useSaveAsRenderSync({
    ...refs,
    mult,
    gifFps,
    canvasWidth,
    canvasHeight,
  } as never);
  return null;
};

const render = (mult = 2, gifFps = 10, canvasWidth = 8, canvasHeight = 6) => {
  act(() => root.render(
    <Harness
      mult={mult}
      gifFps={gifFps}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
    />,
  ));
};

const immediateRaf = (onFrame?: () => void) => vi
  .spyOn(window, "requestAnimationFrame")
  .mockImplementation((callback: FrameRequestCallback) => {
    onFrame?.();
    callback(performance.now());
    return 1;
  });

const seekableVideo = (initialTime = 0) => {
  const video = document.createElement("video");
  let currentTime = initialTime;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
      queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
    },
  });
  return video;
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  source = document.createElement("canvas");
  source.width = 8;
  source.height = 6;
  source.getContext("2d")!.fillRect(0, 0, 8, 6);
  refs = {
    outputCanvasRef: { current: source },
    scaledCanvasRef: { current: null },
    latestStateRef: { current: {} },
    renderVersionRef: { current: 1 },
    exportAbortRef: { current: false },
  };
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useSaveAsRenderSync", () => {
  it("creates, resizes, clears, and reuses a nearest-neighbor export canvas", () => {
    const scaled = latest.getScaledCanvas()!;
    expect(scaled.width).toBe(16);
    expect(scaled.height).toBe(12);
    expect(refs.scaledCanvasRef.current).toBe(scaled);
    expect(scaled.getContext("2d")!.imageSmoothingEnabled).toBe(false);
    expect(latest.getScaledCanvas()).toBe(scaled);

    render(3);
    expect(latest.getScaledCanvas()).toBe(scaled);
    expect(scaled.width).toBe(24);
    expect(scaled.height).toBe(18);
    refs.outputCanvasRef.current = null;
    expect(latest.getScaledCanvas()).toBeNull();
  });

  it("uses the advertised output size while the mounted canvas is still stale", () => {
    render(2, 10, 10, 7);

    const scaled = latest.getScaledCanvas()!;
    expect(source.width).toBe(8);
    expect(source.height).toBe(6);
    expect(scaled.width).toBe(20);
    expect(scaled.height).toBe(14);
  });

  it("estimates frame rates from standardized and legacy counters with clamping", () => {
    expect(latest.estimateVideoFps({
      duration: 2,
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 48 }),
    } as never, 30)).toBe(24);
    expect(latest.estimateVideoFps({ duration: 1, webkitDecodedFrameCount: 120 } as never, 30)).toBe(60);
    expect(latest.estimateVideoFps({ duration: 10, mozPresentedFrames: 5 } as never, 30)).toBe(1);
    expect(latest.estimateVideoFps({ duration: 0 } as never, 25)).toBe(25);
  });

  it("waits for decoded, input, and output state to converge after a strict seek", async () => {
    const video = seekableVideo(0);
    const cancel = vi.fn();
    Object.assign(video, {
      requestVideoFrameCallback: (callback: (now: number, metadata: { mediaTime: number }) => void) => {
        callback(0, { mediaTime: 1.5 });
        return 7;
      },
      cancelVideoFrameCallback: cancel,
    });
    refs.latestStateRef.current = {
      inputFrameToken: 1,
      outputFrameToken: 1,
      time: 1,
      outputTime: 1,
      outputImage: source,
    };
    let frames = 0;
    immediateRaf(() => {
      frames += 1;
      if (frames === 1) {
        refs.latestStateRef.current = {
          inputFrameToken: 2,
          outputFrameToken: 2,
          time: 1.5,
          outputTime: 1.5,
          outputImage: source,
        };
        refs.renderVersionRef.current = 2;
      }
    });
    await latest.waitForRenderedSeek(video, 1.5, 40, true, 2);
    expect(video.currentTime).toBe(1.5);
    expect(frames).toBeGreaterThanOrEqual(3);
  });

  it("returns early on abort and returns a fallback playback status after its deadline", async () => {
    immediateRaf();
    refs.exportAbortRef.current = true;
    await expect(latest.waitForRenderedSeek(seekableVideo(2), 2)).resolves.toBeUndefined();
    await expect(latest.waitForRenderedPlaybackFrame(2, 1)).resolves.toBeUndefined();

    refs.exportAbortRef.current = false;
    refs.latestStateRef.current = { outputTime: 3.25, outputFrameToken: 9 };
    refs.renderVersionRef.current = 4;
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      clock += 1000;
      return clock;
    });
    await expect(latest.waitForRenderedPlaybackFrame(3, 3, 10)).resolves.toEqual({
      renderedTime: 3.25,
      renderVersion: 4,
      frameToken: 9,
    });
  });

  it("returns synchronized playback metadata when a rendered frame advances", async () => {
    refs.latestStateRef.current = {
      inputFrameToken: 4,
      outputFrameToken: 4,
      time: 0,
      outputTime: 0,
      outputImage: source,
    };
    immediateRaf(() => {
      refs.latestStateRef.current = {
        inputFrameToken: 5,
        outputFrameToken: 5,
        time: 2,
        outputTime: 2,
        outputImage: source,
      };
      refs.renderVersionRef.current = 8;
    });
    await expect(latest.waitForRenderedPlaybackFrame(2, 7, 40)).resolves.toEqual({
      renderedTime: 2,
      renderVersion: 8,
      frameToken: 5,
    });
  });

  it("settles video seeks and initializes hidden export videos", async () => {
    const video = seekableVideo(0);
    Object.assign(video, {
      requestVideoFrameCallback: (callback: () => void) => {
        callback();
        return 3;
      },
      cancelVideoFrameCallback: vi.fn(),
    });
    immediateRaf();
    await latest.waitForVideoSeekSettled(video, 4, 20);
    expect(video.currentTime).toBe(4);

    await expect(latest.createHiddenExportVideo({ currentSrc: "", src: "" } as never))
      .rejects.toThrow("No source video URL");

    const originalCreate = document.createElement.bind(document);
    const clone = originalCreate("video");
    Object.defineProperty(clone, "load", {
      configurable: true,
      value: () => clone.dispatchEvent(new Event("loadedmetadata")),
    });
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "video" ? clone : originalCreate(tag)) as typeof document.createElement);
    const created = await latest.createHiddenExportVideo({
      __objectUrl: "blob:source",
      currentSrc: "",
      src: "",
    } as never);
    expect(created).toBe(clone);
    expect(clone.src).toContain("blob:source");
    expect(clone.muted).toBe(true);
    expect(clone.crossOrigin).toBe("anonymous");
  });
});
