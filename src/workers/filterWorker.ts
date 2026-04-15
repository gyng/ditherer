import { filterIndex } from "filters";
import type { FilterCanvas, FilterDefinition, FilterOptionValues } from "filters/types";
import { deserializePalette } from "palettes";
import type { SerializedPalette } from "palettes";
import { grayscale } from "filters";
import { logFilterDispatched } from "utils";
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

export const runWorkerFilterRequest = (
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
  }: WorkerFilterRequest,
  createCanvas: WorkerCanvasFactory = defaultCanvasFactory,
): WorkerFilterResult => {
  let canvas = createCanvas(width, height);
  const initCtx = canvas.getContext("2d") as
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

  const stepTimes: { name: string; ms: number }[] = [];
  const newPrevOutputs: Record<string, WorkerPrevOutputFrame> = {};

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
    try {
      output = filter.func(canvas, opts);
    } catch (err) {
      console.error(`Worker: filter "${entry.displayName}" threw:`, err);
      continue;
    }
    logFilterDispatched(filter.name);
    stepTimes.push({ name: entry.displayName, ms: performance.now() - t0 });

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
      canvas = output;
    }
  }

  const resultCtx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!resultCtx) throw new Error("Failed to get result context");
  const resultData = resultCtx.getImageData(0, 0, canvas.width, canvas.height).data;

  return {
    imageData: resultData.buffer,
    width: canvas.width,
    height: canvas.height,
    stepTimes,
    prevOutputs: newPrevOutputs,
  };
};

if (typeof self !== "undefined") {
  self.onmessage = (e: MessageEvent<WorkerRequestMessage>) => {
    const workerScope = self as unknown as WorkerMessageTarget;
    const { id, ...request } = e.data;

    try {
      const result = runWorkerFilterRequest(request);

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
