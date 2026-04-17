import { filterIndex } from "filters";
import type { FilterCanvas, FilterDefinition, FilterOptionValues } from "filters/types";
import { deserializePalette } from "palettes";
import type { SerializedPalette } from "palettes";
import { grayscale } from "filters";
import { logFilterDispatched, getFilterWasmStatuses, releasePooledCanvas, logFilterBackend } from "utils";
import { glAvailable, glUnavailableStub } from "gl";
import type { WorkerFilterRequest, WorkerFilterResult, WorkerPrevOutputFrame, WorkerRequestMessage } from "./types";
import type { SerializedOptionMap } from "context/shareStateTypes";

type SerializedPaletteOption = Partial<SerializedPalette> & {
  _serialized?: boolean;
} & SerializedOptionMap;

type WorkerFilterOptions = FilterOptionValues & {
  palette?: SerializedPaletteOption;
};
type WorkerMessageTarget = {
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};
type WorkerCanvasLike = FilterCanvas & {
  width: number;
  height: number;
  getContext: (
    contextId: "2d",
  ) => OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
};
type WorkerCanvasFactory = (width: number, height: number) => WorkerCanvasLike;

const isRecord = (value: unknown): value is SerializedOptionMap =>
  typeof value === "object" && value !== null;

const getOptionObject = (value: unknown): SerializedOptionMap =>
  isRecord(value) ? value : {};

const deserializeOptions = (options: SerializedOptionMap | undefined): WorkerFilterOptions => {
  const opts: WorkerFilterOptions = isRecord(options) ? { ...options } : {};
  if (opts.palette && opts.palette._serialized) {
    opts.palette = deserializePalette(opts.palette);
  }
  return opts;
};

const defaultCanvasFactory: WorkerCanvasFactory = (width, height) =>
  new OffscreenCanvas(width, height) as unknown as WorkerCanvasLike;

const has2dContext = (canvas: unknown): canvas is WorkerCanvasLike =>
  typeof canvas === "object"
  && canvas !== null
  && "width" in canvas
  && "height" in canvas
  && typeof (canvas as WorkerCanvasLike).getContext === "function";

export const runWorkerFilterRequest = async (
  {
    imageData,
    width,
    height,
    chain,
    frameIndex,
    isAnimating,
    linearize,
    wasmAcceleration,
    webglAcceleration,
    convertGrayscale,
    prevOutputs,
    prevInputs,
    emaMaps,
    degaussFrame,
  }: WorkerFilterRequest,
  createCanvas: WorkerCanvasFactory = defaultCanvasFactory,
): Promise<WorkerFilterResult> => {
  let canvas = createCanvas(width, height);
  const initCtx = canvas.getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!initCtx) throw new Error("Failed to get 2d context");
  initCtx.putImageData(
    new ImageData(new Uint8ClampedArray(imageData), width, height), 0, 0
  );

  if (convertGrayscale) {
    const grayscaleCanvas = grayscale.func(canvas);
    if (has2dContext(grayscaleCanvas)) {
      canvas = grayscaleCanvas;
    }
  }

  const stepTimes: { name: string; filterName?: string; ms: number; backend?: string }[] = [];
  const newPrevOutputs: Record<string, WorkerPrevOutputFrame> = {};
  const newPrevInputs: Record<string, ArrayBuffer> = {};
  const newEmaMaps: Record<string, ArrayBuffer> = {};
  // Matches FilterContext's main-thread EMA alpha — ~10-frame window.
  const EMA_ALPHA = 0.1;

  for (const entry of chain) {
    const filter: FilterDefinition | undefined = filterIndex[entry.filterName];
    if (!filter || typeof filter.func !== "function") continue;

    const opts = deserializeOptions(entry.options);
    opts._frameIndex = frameIndex;
    opts._isAnimating = isAnimating;
    opts._linearize = linearize;
    opts._wasmAcceleration = wasmAcceleration;
    opts._webglAcceleration = webglAcceleration;
    opts._prevOutput = prevOutputs?.[entry.id]
      ? new Uint8ClampedArray(prevOutputs[entry.id])
      : null;
    opts._prevInput = prevInputs?.[entry.id]
      ? new Uint8ClampedArray(prevInputs[entry.id])
      : null;
    opts._ema = emaMaps?.[entry.id]
      ? new Float32Array(emaMaps[entry.id])
      : null;
    opts._degaussFrame = degaussFrame;

    // Capture input BEFORE the filter runs — same semantics as the main-
    // thread path: this frame's input becomes next frame's prev-input,
    // and feeds the EMA update after the filter finishes.
    let inputSnapshot: Uint8ClampedArray | null = null;
    const inCtx = canvas.getContext("2d", { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (inCtx) {
      inputSnapshot = new Uint8ClampedArray(
        inCtx.getImageData(0, 0, canvas.width, canvas.height).data,
      );
    }

    if (opts.palette?.options) {
      opts.palette = {
        ...opts.palette,
        options: {
          ...getOptionObject(opts.palette.options),
          _wasmAcceleration: wasmAcceleration,
        },
      };
    }

    const t0 = performance.now();
    let output: FilterCanvas | undefined;
    if (filter.requiresGL && !glAvailable()) {
      output = glUnavailableStub(canvas.width, canvas.height) as FilterCanvas;
      logFilterBackend(filter.name, "GL-unavailable", "WebGL2 required but unavailable");
    } else {
      try {
        const raw = filter.func(canvas, opts) as FilterCanvas | Promise<FilterCanvas> | undefined;
        // Filters may return a Promise for async work (e.g. glitchblob
        // round-trips the canvas through Blob+ImageBitmap). The sync
        // return shape stays untouched; the promise branch just gives
        // us a uniform contract for both.
        output = (raw && typeof (raw as { then?: unknown }).then === "function")
          ? await (raw as Promise<FilterCanvas>)
          : (raw as FilterCanvas | undefined);
      } catch (err) {
        console.error(`Worker: filter "${entry.displayName}" threw:`, err);
        continue;
      }
    }
    logFilterDispatched(filter.name, { noGL: filter.noGL, noWASM: filter.noWASM });
    const stepMs = performance.now() - t0;
    const backend = getFilterWasmStatuses().get(filter.name)?.label;
    stepTimes.push(backend
      ? { name: entry.displayName, filterName: filter.name, ms: stepMs, backend }
      : { name: entry.displayName, filterName: filter.name, ms: stepMs });

    if (has2dContext(output)) {
      const outCtx = output.getContext("2d") as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
      if (outCtx) {
        const outData = outCtx.getImageData(0, 0, output.width, output.height).data;
        newPrevOutputs[entry.id] = {
          imageData: outData.buffer,
          width: output.width,
          height: output.height,
        };
      }
      // The worker has no step cache, so the previous canvas becomes
      // garbage the moment `canvas = output` lands. Return it to the
      // pool first; the next filter's `cloneCanvas` picks it up.
      if (canvas !== output) releasePooledCanvas(canvas);
      canvas = output;
    }

    // Update per-entry temporal state after the filter finishes — this
    // frame's captured input becomes next frame's _prevInput, and feeds
    // the EMA blend. Mirrors FilterContext.filterOnMainThread so both
    // dispatch paths write to state the same way.
    if (inputSnapshot) {
      newPrevInputs[entry.id] = inputSnapshot.buffer as ArrayBuffer;
      const prevEmaBuf = emaMaps?.[entry.id];
      let ema: Float32Array;
      if (prevEmaBuf && prevEmaBuf.byteLength === inputSnapshot.length * 4) {
        ema = new Float32Array(prevEmaBuf);
        const oneMinusAlpha = 1 - EMA_ALPHA;
        for (let j = 0; j < ema.length; j++) {
          ema[j] = ema[j] * oneMinusAlpha + inputSnapshot[j] * EMA_ALPHA;
        }
      } else {
        ema = new Float32Array(inputSnapshot);
      }
      newEmaMaps[entry.id] = ema.buffer as ArrayBuffer;
    }
  }

  const resultCtx = canvas.getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!resultCtx) throw new Error("Failed to get result context");
  const resultData = resultCtx.getImageData(0, 0, canvas.width, canvas.height).data;

  return {
    imageData: resultData.buffer as ArrayBuffer,
    width: canvas.width,
    height: canvas.height,
    stepTimes,
    prevOutputs: newPrevOutputs,
    prevInputs: newPrevInputs,
    emaMaps: newEmaMaps,
  };
};

if (typeof self !== "undefined") {
  self.onmessage = async (e: MessageEvent<WorkerRequestMessage>) => {
    const workerScope = self as unknown as WorkerMessageTarget;
    const { id, ...request } = e.data;

    try {
      const result = await runWorkerFilterRequest(request);

      const transfers: ArrayBuffer[] = [result.imageData];
      for (const frame of Object.values(result.prevOutputs)) {
        transfers.push(frame.imageData);
      }

      workerScope.postMessage({ id, result }, transfers);
    } catch (err: unknown) {
      workerScope.postMessage({
        id,
        error: err instanceof Error ? err.message : String(err),
      }, []);
    }
  };
}
