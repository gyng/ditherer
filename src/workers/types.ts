import type { SerializedOptionMap } from "context/shareStateTypes";

export interface WorkerChainEntry {
  id: string;
  filterName: string;
  displayName: string;
  options: SerializedOptionMap | undefined;
}

export interface WorkerFilterRequest {
  imageData: ArrayBuffer;
  width: number;
  height: number;
  chain: WorkerChainEntry[];
  frameIndex: number;
  isAnimating: boolean;
  linearize: boolean;
  wasmAcceleration: boolean;
  webglAcceleration: boolean;
  convertGrayscale: boolean;
  prevOutputs: Record<string, ArrayBuffer>;
  // Previous-frame *input* (pre-filter) bytes, keyed by chain-entry id.
  // Used by filters that compare the current frame to its predecessor
  // (motion vectors, error-diffusion temporal bleed, temporal-edge).
  prevInputs: Record<string, ArrayBuffer>;
  // Per-entry EMA (exponential moving average of input across frames),
  // stored as the underlying Float32 ArrayBuffer so structured-clone can
  // pass it across the worker boundary without copying into JSON.
  emaMaps: Record<string, ArrayBuffer>;
  // Frame index of the most recent degauss trigger, propagated to
  // filters that consume it (rgbStripe). -Infinity is the "never
  // triggered" sentinel; wire format uses a finite small number so it
  // survives JSON/structured-clone.
  degaussFrame: number;
}

export interface WorkerPrevOutputFrame {
  imageData: ArrayBuffer;
  width: number;
  height: number;
}

export interface WorkerStepTime {
  // User-visible label for the chain entry (may differ from the canonical
  // filter name when a chain entry has been renamed).
  name: string;
  // Canonical filter name from the FilterDefinition — used by the slow-
  // filter registry so runtime throttling is consistent regardless of
  // the user's display-label choices.
  filterName?: string;
  ms: number;
  backend?: string;
}

export interface WorkerFilterResult {
  imageData: ArrayBuffer;
  width: number;
  height: number;
  stepTimes: WorkerStepTime[];
  prevOutputs: Record<string, WorkerPrevOutputFrame>;
  // Snapshot of per-entry previous-input buffers after the chain ran,
  // for the main thread to forward into the next frame's request.
  prevInputs: Record<string, ArrayBuffer>;
  // Updated EMA buffers keyed by entry id.
  emaMaps: Record<string, ArrayBuffer>;
}

export interface WorkerRequestMessage extends WorkerFilterRequest {
  id: number;
}

export interface WorkerSuccessMessage {
  id: number;
  result: WorkerFilterResult;
}

export interface WorkerErrorMessage {
  id: number;
  error: string;
}

export type WorkerResponseMessage = WorkerSuccessMessage | WorkerErrorMessage;
