import { createFilterSession, wasmReady } from "@gyng/ditherer-filters";
import { disposeFilterWorker, workerRPC } from "@gyng/ditherer-filters/client";
import { filterCatalog } from "@gyng/ditherer-filters/catalog";
import grayscale from "@gyng/ditherer-filters/filters/grayscale";
import { loadFilter } from "@gyng/ditherer-filters/lazy";

type SmokeResult = {
  status: "ok" | "failed";
  catalogSize?: number;
  directFilter?: string;
  lazyFilter?: string;
  steps?: string[];
  frameIndex?: number;
  pixels?: number[];
  workerSteps?: string[];
  workerPixels?: number[];
  wasmInitialized?: boolean;
  disposed?: boolean;
  error?: string;
};

declare global {
  interface Window {
    __librarySmoke?: SmokeResult;
  }
}

const status = document.querySelector<HTMLElement>('[data-testid="status"]');
const output = document.querySelector<HTMLCanvasElement>('[data-testid="output"]');

const input = document.createElement("canvas");
input.width = 2;
input.height = 1;
const inputContext = input.getContext("2d", { willReadFrequently: true });
inputContext?.putImageData(
  new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1),
  0,
  0,
);

try {
  const lazyGrayscale = await loadFilter("Grayscale");
  const session = createFilterSession([{ id: "grayscale", filter: lazyGrayscale }], {
    wasmAcceleration: false,
    webglAcceleration: false,
  });
  const result = await session.process(input);
  const outputContext = output?.getContext("2d", { willReadFrequently: true });
  outputContext?.drawImage(result.canvas, 0, 0);
  const pixels = outputContext?.getImageData(0, 0, 2, 1).data ?? new Uint8ClampedArray();
  const isGray =
    pixels[0] === pixels[1] &&
    pixels[1] === pixels[2] &&
    pixels[4] === pixels[5] &&
    pixels[5] === pixels[6];

  const workerInput = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  const workerResult = await workerRPC(
    {
      imageData: workerInput.buffer,
      width: 2,
      height: 1,
      chain: [
        {
          id: "worker-grayscale",
          filterName: "Grayscale",
          displayName: "Grayscale",
          options: undefined,
        },
      ],
      frameIndex: 0,
      isAnimating: false,
      linearize: false,
      wasmAcceleration: false,
      webglAcceleration: false,
      convertGrayscale: false,
      prevOutputs: {},
      prevInputs: {},
      emaMaps: {},
      degaussFrame: -1_000_000,
    },
    [workerInput.buffer],
  );
  const workerPixels = new Uint8ClampedArray(workerResult.imageData);
  const workerIsGray =
    workerPixels[0] === workerPixels[1] &&
    workerPixels[1] === workerPixels[2] &&
    workerPixels[4] === workerPixels[5] &&
    workerPixels[5] === workerPixels[6];

  session.dispose();
  disposeFilterWorker();
  let disposed = false;
  try {
    await session.process(input);
  } catch {
    disposed = true;
  }

  const smokeResult: SmokeResult = {
    status: isGray && workerIsGray && disposed ? "ok" : "failed",
    catalogSize: filterCatalog.length,
    directFilter: grayscale.name,
    lazyFilter: lazyGrayscale.name,
    steps: result.steps.map((step) => step.filterName),
    frameIndex: session.state.frameIndex,
    pixels: Array.from(pixels),
    workerSteps: workerResult.stepTimes.map((step) => step.filterName ?? step.name),
    workerPixels: Array.from(workerPixels),
    wasmInitialized: await wasmReady,
    disposed,
  };
  window.__librarySmoke = smokeResult;
  if (status) status.textContent = smokeResult.status;
} catch (error) {
  disposeFilterWorker();
  window.__librarySmoke = { status: "failed", error: String(error) };
  if (status) status.textContent = "failed";
}
