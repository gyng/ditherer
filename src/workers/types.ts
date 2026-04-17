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
