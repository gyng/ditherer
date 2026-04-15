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
}

export interface WorkerPrevOutputFrame {
  imageData: ArrayBuffer;
  width: number;
  height: number;
}

export interface WorkerStepTime {
  name: string;
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
