export type ReliableVideoMode = "realtime" | "offline" | "webcodecs";
export type LoopCaptureMode = "realtime" | "offline" | "webcodecs";

export type ReliableSourcePath = "browser-seek" | "webcodecs";
export type LoopSourcePath = "realtime-playback" | "hidden-video-fallback" | "webcodecs-demux";

type ReliableVideoRoutingArgs = {
  preferredMode: ReliableVideoMode;
  sourceUrl: string | null;
  hasVideoDecoder: boolean;
};

type LoopCaptureRoutingArgs = {
  captureMode: LoopCaptureMode;
  sourceUrl: string | null;
  hasVideoDecoder: boolean;
};

export type ReliableVideoRoutingPlan = {
  sourcePath: ReliableSourcePath;
  shouldAttemptWebCodecs: boolean;
  fallbackReason: string | null;
};

export type LoopCaptureRoutingPlan = {
  path: LoopSourcePath;
  usesPlaybackCapture: boolean;
  shouldAttemptWebCodecs: boolean;
  fallbackReason: string | null;
};

export const planReliableVideoRouting = ({
  preferredMode,
  sourceUrl,
  hasVideoDecoder,
}: ReliableVideoRoutingArgs): ReliableVideoRoutingPlan => {
  if (preferredMode !== "webcodecs") {
    return {
      sourcePath: "browser-seek",
      shouldAttemptWebCodecs: false,
      fallbackReason: null,
    };
  }

  if (!sourceUrl) {
    return {
      sourcePath: "browser-seek",
      shouldAttemptWebCodecs: false,
      fallbackReason: "No source URL available for WebCodecs decode.",
    };
  }

  if (!hasVideoDecoder) {
    return {
      sourcePath: "browser-seek",
      shouldAttemptWebCodecs: false,
      fallbackReason: "WebCodecs VideoDecoder is unavailable in this browser.",
    };
  }

  return {
    sourcePath: "webcodecs",
    shouldAttemptWebCodecs: true,
    fallbackReason: null,
  };
};

export const planLoopCaptureRouting = ({
  captureMode,
  sourceUrl,
  hasVideoDecoder,
}: LoopCaptureRoutingArgs): LoopCaptureRoutingPlan => {
  if (captureMode === "realtime") {
    return {
      path: "realtime-playback",
      usesPlaybackCapture: true,
      shouldAttemptWebCodecs: false,
      fallbackReason: null,
    };
  }

  if (captureMode === "webcodecs") {
    const reliablePlan = planReliableVideoRouting({
      preferredMode: captureMode,
      sourceUrl,
      hasVideoDecoder,
    });
    return {
      path: reliablePlan.shouldAttemptWebCodecs ? "webcodecs-demux" : "hidden-video-fallback",
      usesPlaybackCapture: false,
      shouldAttemptWebCodecs: reliablePlan.shouldAttemptWebCodecs,
      fallbackReason: reliablePlan.fallbackReason,
    };
  }

  return {
    path: "hidden-video-fallback",
    usesPlaybackCapture: false,
    shouldAttemptWebCodecs: false,
    fallbackReason: null,
  };
};
