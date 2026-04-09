import { filterIndex } from "filters";
import { deserializePalette } from "palettes";
import { grayscale } from "filters";

interface ChainEntry {
  id: string;
  filterName: string;
  displayName: string;
  options: any;
}

interface WorkerMessage {
  id: number;
  imageData: ArrayBuffer;
  width: number;
  height: number;
  chain: ChainEntry[];
  frameIndex: number;
  isAnimating: boolean;
  linearize: boolean;
  wasmAcceleration: boolean;
  convertGrayscale: boolean;
  prevOutputs: Record<string, ArrayBuffer>;
}

const deserializeOptions = (options: any): any => {
  const opts = { ...options };
  if (opts.palette && opts.palette._serialized) {
    opts.palette = deserializePalette(opts.palette);
  }
  return opts;
};

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const {
    id, imageData, width, height, chain, frameIndex,
    isAnimating, linearize, wasmAcceleration, convertGrayscale, prevOutputs
  } = e.data;

  try {
    let canvas = new OffscreenCanvas(width, height);
    const initCtx = canvas.getContext("2d");
    if (!initCtx) throw new Error("Failed to get 2d context");
    initCtx.putImageData(
      new ImageData(new Uint8ClampedArray(imageData), width, height), 0, 0
    );

    // Apply grayscale pre-processing if needed
    if (convertGrayscale) {
      canvas = grayscale.func(canvas);
    }

    const stepTimes: { name: string; ms: number }[] = [];
    const newPrevOutputs: Record<string, ArrayBuffer> = {};

    for (const entry of chain) {
      const filter = (filterIndex as any)[entry.filterName];
      if (!filter || typeof filter.func !== "function") continue;

      const opts = deserializeOptions(entry.options);
      opts._frameIndex = frameIndex;
      opts._isAnimating = isAnimating;
      opts._linearize = linearize;
      opts._wasmAcceleration = wasmAcceleration;
      opts._prevOutput = prevOutputs?.[entry.id]
        ? new Uint8ClampedArray(prevOutputs[entry.id])
        : null;

      if (opts.palette?.options) {
        opts.palette = {
          ...opts.palette,
          options: { ...opts.palette.options, _wasmAcceleration: wasmAcceleration },
        };
      }

      const t0 = performance.now();
      let output;
      try {
        output = filter.func(canvas, opts);
      } catch (err) {
        console.error(`Worker: filter "${entry.displayName}" threw:`, err);
        continue;
      }
      stepTimes.push({ name: entry.displayName, ms: performance.now() - t0 });

      if (output instanceof OffscreenCanvas) {
        const outCtx = output.getContext("2d");
        if (outCtx) {
          const outData = outCtx.getImageData(0, 0, output.width, output.height).data;
          newPrevOutputs[entry.id] = outData.buffer;
        }
        canvas = output;
      }
    }

    const resultCtx = canvas.getContext("2d");
    if (!resultCtx) throw new Error("Failed to get result context");
    const resultData = resultCtx.getImageData(0, 0, canvas.width, canvas.height).data;

    // Collect transferable buffers
    const transfers: ArrayBuffer[] = [resultData.buffer];
    for (const buf of Object.values(newPrevOutputs)) {
      transfers.push(buf);
    }

    (self as any).postMessage(
      {
        id,
        result: {
          imageData: resultData.buffer,
          width: canvas.width,
          height: canvas.height,
          stepTimes,
          prevOutputs: newPrevOutputs,
        },
      },
      transfers
    );
  } catch (err: any) {
    (self as any).postMessage({ id, error: err?.message || String(err) });
  }
};
