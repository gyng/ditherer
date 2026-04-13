import { useCallback, type RefObject } from "react";
import type { FilterState } from "context/filterContextValue";
import type { SourceVideoWithObjectUrl, VideoFrameCallbackVideo, VideoFrameMetadata } from "../helpers";

interface UseSaveAsRenderSyncOptions {
  outputCanvasRef: RefObject<HTMLCanvasElement | null>;
  scaledCanvasRef: RefObject<HTMLCanvasElement | null>;
  latestStateRef: RefObject<FilterState>;
  renderVersionRef: RefObject<number>;
  exportAbortRef: RefObject<boolean>;
  mult: number;
  gifFps: number;
}

type PlaybackFrameStatus = {
  renderedTime: number | null;
  renderVersion: number;
  frameToken: number;
};

export const useSaveAsRenderSync = ({
  outputCanvasRef,
  scaledCanvasRef,
  latestStateRef,
  renderVersionRef,
  exportAbortRef,
  mult,
  gifFps,
}: UseSaveAsRenderSyncOptions) => {
  const getScaledCanvas = useCallback((): HTMLCanvasElement | null => {
    const source = outputCanvasRef.current;
    if (!source) return null;
    let scaled = scaledCanvasRef.current;
    if (!scaled) {
      scaled = document.createElement("canvas");
      scaledCanvasRef.current = scaled;
    }
    const targetWidth = source.width * mult;
    const targetHeight = source.height * mult;
    if (scaled.width !== targetWidth) scaled.width = targetWidth;
    if (scaled.height !== targetHeight) scaled.height = targetHeight;
    const ctx = scaled.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, scaled.width, scaled.height);
    ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
    return scaled;
  }, [outputCanvasRef, scaledCanvasRef, mult]);

  const estimateVideoFps = useCallback((vid: HTMLVideoElement, fallback: number) => {
    const duration = vid.duration || 0;
    const anyVid = vid as HTMLVideoElement & {
      webkitDecodedFrameCount?: number;
      mozPresentedFrames?: number;
      getVideoPlaybackQuality?: () => { totalVideoFrames?: number };
    };
    const qualityFrames = anyVid.getVideoPlaybackQuality?.().totalVideoFrames;
    if (qualityFrames && duration > 0) return Math.max(1, Math.min(60, Math.round(qualityFrames / duration)));
    if (anyVid.webkitDecodedFrameCount && duration > 0) return Math.max(1, Math.min(60, Math.round(anyVid.webkitDecodedFrameCount / duration)));
    if (anyVid.mozPresentedFrames && duration > 0) return Math.max(1, Math.min(60, Math.round(anyVid.mozPresentedFrames / duration)));
    return fallback;
  }, []);

  const waitForRenderedSeek = useCallback(async (
    vid: HTMLVideoElement,
    targetTime: number,
    expectedFrameMs = 1000 / Math.max(1, gifFps),
    strictValidation = false,
    settleFrames = 1,
  ) => {
    const previousInputFrameToken = latestStateRef.current.inputFrameToken ?? 0;
    const previousRenderVersion = renderVersionRef.current;
    const targetTolerance = strictValidation
      ? Math.max(0.003, Math.min(0.012, (expectedFrameMs / 1000) * 0.35))
      : Math.max(0.008, Math.min(0.03, (expectedFrameMs / 1000) * 0.9));
    if (Math.abs((vid.currentTime || 0) - targetTime) > 0.0005) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          vid.removeEventListener("seeked", onSeeked);
          resolve();
        };
        vid.addEventListener("seeked", onSeeked);
        vid.currentTime = targetTime;
      });
    }

    const settleCount = strictValidation ? Math.max(1, settleFrames) : Math.max(1, Math.min(2, settleFrames));
    for (let i = 0; i < settleCount; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    let decodedMediaTime: number | null = null;
    if (strictValidation && "requestVideoFrameCallback" in vid) {
      await Promise.race([
        new Promise<void>((resolve) => {
          const callbackId = (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.((_now: number, metadata: VideoFrameMetadata) => {
            decodedMediaTime = metadata?.mediaTime ?? null;
            resolve();
          });
          window.setTimeout(() => {
            if (typeof (vid as VideoFrameCallbackVideo).cancelVideoFrameCallback === "function" && callbackId != null) {
              try {
                (vid as VideoFrameCallbackVideo).cancelVideoFrameCallback?.(callbackId);
              } catch {
                // ignore cancel races
              }
            }
            resolve();
          }, Math.max(32, Math.round(expectedFrameMs * 2)));
        }),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, Math.max(32, Math.round(expectedFrameMs * 2)));
        }),
      ]);
    }

    const deadline = performance.now() + 1500;
    let warned = false;
    while (performance.now() < deadline) {
      if (exportAbortRef.current) {
        return;
      }
      const latestState = latestStateRef.current;
      const decodedMatches = decodedMediaTime == null || Math.abs(decodedMediaTime - targetTime) <= targetTolerance;
      const videoMatches = Math.abs((vid.currentTime || 0) - targetTime) <= targetTolerance;
      const inputTimeMatches = latestState.time != null && Math.abs(latestState.time - targetTime) <= targetTolerance;
      const outputTimeMatches = latestState.outputTime != null && Math.abs(latestState.outputTime - targetTime) <= targetTolerance;
      const inputFrameToken = latestState.inputFrameToken ?? 0;
      const outputFrameToken = latestState.outputFrameToken ?? 0;
      const inputCaughtUp = inputFrameToken > previousInputFrameToken;
      const outputTokenCaughtUp = outputFrameToken === inputFrameToken && outputFrameToken > previousInputFrameToken;
      const hasOutput = !!latestState.outputImage;
      const renderCaughtUp = outputTokenCaughtUp || (renderVersionRef.current > previousRenderVersion && hasOutput);
      if (decodedMatches && videoMatches && inputTimeMatches && outputTimeMatches && inputCaughtUp && renderCaughtUp) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return;
      }
      if (!warned && performance.now() + 250 >= deadline) {
        warned = true;
        console.warn("[reliable-export] frame-ready timeout fallback", {
          targetTime,
          videoTime: vid.currentTime || 0,
          stateTime: latestState.time,
          outputTime: latestState.outputTime,
          previousInputFrameToken,
          inputFrameToken,
          outputFrameToken,
          decodedMediaTime,
          previousRenderVersion,
          currentRenderVersion: renderVersionRef.current,
        });
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
  }, [gifFps, latestStateRef, renderVersionRef, exportAbortRef]);

  const waitForRenderedPlaybackFrame = useCallback(async (
    targetTime: number,
    previousRenderVersion: number,
    expectedFrameMs = 1000 / Math.max(1, gifFps),
  ): Promise<PlaybackFrameStatus | undefined> => {
    const previousInputFrameToken = latestStateRef.current.inputFrameToken ?? 0;
    const targetTolerance = Math.max(0.01, Math.min(0.04, (expectedFrameMs / 1000) * 0.9));
    const deadline = performance.now() + Math.max(120, Math.round(expectedFrameMs * 8));

    while (performance.now() < deadline) {
      if (exportAbortRef.current) return;
      const latestState = latestStateRef.current;
      const stateTime = latestState.time;
      const outputTime = latestState.outputTime;
      const inputFrameToken = latestState.inputFrameToken ?? 0;
      const outputFrameToken = latestState.outputFrameToken ?? 0;
      const renderAdvanced = renderVersionRef.current > previousRenderVersion || outputFrameToken > previousInputFrameToken;
      const hasOutput = !!latestState.outputImage;
      const inputTimeMatches = stateTime != null && Math.abs(stateTime - targetTime) <= targetTolerance;
      const outputTimeMatches = outputTime != null && Math.abs(outputTime - targetTime) <= targetTolerance;
      const outputMatchesInput = outputFrameToken === inputFrameToken && outputFrameToken > previousInputFrameToken;
      if (renderAdvanced && hasOutput && inputTimeMatches && outputTimeMatches && outputMatchesInput) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          renderedTime: outputTime,
          renderVersion: renderVersionRef.current,
          frameToken: outputFrameToken,
        };
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const latestState = latestStateRef.current;
    return {
      renderedTime: latestState.outputTime ?? null,
      renderVersion: renderVersionRef.current,
      frameToken: latestState.outputFrameToken ?? 0,
    };
  }, [gifFps, latestStateRef, renderVersionRef, exportAbortRef]);

  const waitForVideoSeekSettled = useCallback(async (
    vid: HTMLVideoElement,
    targetTime: number,
    expectedFrameMs = 1000 / Math.max(1, gifFps),
  ) => {
    if (Math.abs((vid.currentTime || 0) - targetTime) > 0.0005) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          vid.removeEventListener("seeked", onSeeked);
          resolve();
        };
        vid.addEventListener("seeked", onSeeked);
        vid.currentTime = targetTime;
      });
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    if ("requestVideoFrameCallback" in vid) {
      await Promise.race([
        new Promise<void>((resolve) => {
          const callbackId = (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.(() => resolve());
          window.setTimeout(() => {
            if (typeof (vid as VideoFrameCallbackVideo).cancelVideoFrameCallback === "function" && callbackId != null) {
              try {
                (vid as VideoFrameCallbackVideo).cancelVideoFrameCallback?.(callbackId);
              } catch {
                // ignore cancel races
              }
            }
            resolve();
          }, Math.max(32, Math.round(expectedFrameMs * 2)));
        }),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, Math.max(32, Math.round(expectedFrameMs * 2)));
        }),
      ]);
    }
  }, [gifFps]);

  const createHiddenExportVideo = useCallback(async (video: HTMLVideoElement) => {
    const source = (video as SourceVideoWithObjectUrl).__objectUrl || video.currentSrc || video.src;
    if (!source) {
      throw new Error("No source video URL is available for export.");
    }

    const clone = document.createElement("video");
    clone.muted = true;
    clone.playsInline = true;
    clone.preload = "auto";
    clone.crossOrigin = "anonymous";
    clone.src = source;

    await new Promise<void>((resolve, reject) => {
      const onLoadedMetadata = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Failed to initialize export video source."));
      };
      const cleanup = () => {
        clone.removeEventListener("loadedmetadata", onLoadedMetadata);
        clone.removeEventListener("error", onError);
      };
      clone.addEventListener("loadedmetadata", onLoadedMetadata);
      clone.addEventListener("error", onError);
      clone.load();
    });

    return clone;
  }, []);

  return {
    getScaledCanvas,
    estimateVideoFps,
    waitForRenderedSeek,
    waitForRenderedPlaybackFrame,
    waitForVideoSeekSettled,
    createHiddenExportVideo,
  };
};
