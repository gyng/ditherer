import { filterIndex, getFilterHistory } from "./filters/index";
import type { FilterCanvas, FilterDefinition, FilterOptionValues } from "./filters/types";
import { releasePooledTextures, glAvailable, glUnavailableStub } from "./gl/index";
import { releaseFloatTextures } from "./gl/fft2d";
import {
  clearCanvasPool,
  getFilterWasmStatuses,
  logFilterBackend,
  logFilterDispatched,
  releasePooledCanvas,
} from "./utils/index";
import { clearMotionVectorsState } from "./filters/motionVectors";
import { releaseJpegArtifactFloatTextures } from "./filters/jpegArtifactGL";

export interface FilterChainEntry {
  id: string;
  filter: string | FilterDefinition;
  displayName?: string;
  options?: FilterOptionValues;
  enabled?: boolean;
}

export interface TemporalFilterState {
  prevOutputs: Map<string, Uint8ClampedArray>;
  prevInputs: Map<string, Uint8ClampedArray>;
  ema: Map<string, Float32Array>;
  frameIndex: number;
}

export interface FilterRuntimeOptions {
  linearize?: boolean;
  wasmAcceleration?: boolean;
  webglAcceleration?: boolean;
  emaAlpha?: number;
  onError?: (error: Error, entry: FilterChainEntry) => void;
}

export interface FilterStepResult {
  id: string;
  name: string;
  filterName: string;
  canvas: FilterCanvas;
  ms: number;
  backend?: string;
  error?: string;
}

export interface ProcessFrameOptions {
  frameIndex?: number;
  isAnimating?: boolean;
  linearize?: boolean;
  wasmAcceleration?: boolean;
  webglAcceleration?: boolean;
  hasVideoInput?: boolean;
  degaussFrame?: number;
  startIndex?: number;
  dispatch?: unknown;
  temporalState?: TemporalFilterState;
  resolveOptions?: (
    entry: FilterChainEntry,
    index: number,
    defaults: FilterOptionValues,
  ) => FilterOptionValues | undefined;
  onStep?: (step: FilterStepResult, index: number) => void;
  shouldAbort?: () => boolean;
  /**
   * Keep every step canvas checked out for preview/result consumers. Defaults
   * to true for API compatibility. When false, superseded step canvases are
   * ephemeral and must not be read from `result.steps` after processing.
   */
  retainStepCanvases?: boolean;
}

export interface FilterChainResult {
  canvas: FilterCanvas;
  steps: FilterStepResult[];
  totalTime: number;
  frameIndex: number;
}

export interface FilterSession {
  readonly state: TemporalFilterState;
  getChain(): readonly FilterChainEntry[];
  setChain(chain: readonly FilterChainEntry[]): void;
  process(input: FilterCanvas, options?: ProcessFrameOptions): Promise<FilterChainResult>;
  reset(): void;
  dispose(): void;
}

const createTemporalState = (): TemporalFilterState => ({
  prevOutputs: new Map(),
  prevInputs: new Map(),
  ema: new Map(),
  frameIndex: 0,
});

const isCanvas = (value: unknown): value is FilterCanvas =>
  typeof value === "object" &&
  value !== null &&
  "width" in value &&
  "height" in value &&
  "getContext" in value &&
  typeof (value as { getContext?: unknown }).getContext === "function";

const get2dContext = (canvas: FilterCanvas) =>
  canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;

const clonePaletteOption = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) return value;
  const palette = value as Record<string, unknown>;
  const paletteOptions =
    typeof palette.options === "object" && palette.options !== null
      ? { ...(palette.options as Record<string, unknown>) }
      : palette.options;
  return { ...palette, options: paletteOptions };
};

const resolveEntry = (entry: FilterChainEntry): FilterDefinition | undefined =>
  typeof entry.filter === "string" ? filterIndex[entry.filter] : entry.filter;

const resolveEntryOptions = (
  entry: FilterChainEntry,
  filter: FilterDefinition,
): FilterOptionValues => {
  const base = filter.options ?? filter.defaults ?? {};
  const options: FilterOptionValues = { ...base, ...entry.options };
  if ("palette" in options) options.palette = clonePaletteOption(options.palette);
  return options;
};

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const runFilterChain = async (
  input: FilterCanvas,
  chain: readonly FilterChainEntry[],
  runtime: FilterRuntimeOptions = {},
  frame: ProcessFrameOptions = {},
): Promise<FilterChainResult> => {
  const temporal = frame.temporalState ?? createTemporalState();
  const frameIndex = frame.frameIndex ?? temporal.frameIndex;
  const enabled = chain.filter((entry) => entry.enabled !== false);
  const startIndex = Math.max(0, frame.startIndex ?? 0);
  const emaAlpha = Math.min(1, Math.max(0, runtime.emaAlpha ?? 0.1));
  const linearize = frame.linearize ?? runtime.linearize ?? true;
  const wasmAcceleration = frame.wasmAcceleration ?? runtime.wasmAcceleration ?? true;
  const webglAcceleration = frame.webglAcceleration ?? runtime.webglAcceleration ?? true;
  const isAnimating = frame.isAnimating ?? false;
  const retainStepCanvases = frame.retainStepCanvases ?? true;
  let canvas = input;
  let totalTime = 0;
  const steps: FilterStepResult[] = [];
  let aborted = false;
  let uncommittedOutput: FilterCanvas | null = null;

  try {
    for (let index = startIndex; index < enabled.length; index += 1) {
      if (frame.shouldAbort?.()) {
        aborted = true;
        break;
      }
      const entry = enabled[index];
      const filter = resolveEntry(entry);
      if (!filter) {
        const error = new Error(`Unknown filter: ${String(entry.filter)}`);
        runtime.onError?.(error, entry);
        steps.push({
          id: entry.id,
          name: entry.displayName ?? String(entry.filter),
          filterName: String(entry.filter),
          canvas,
          ms: 0,
          error: error.message,
        });
        continue;
      }

      const history = getFilterHistory(filter);
      if (!history.prevInput) temporal.prevInputs.delete(entry.id);
      if (!history.prevOutput) temporal.prevOutputs.delete(entry.id);
      if (!history.ema) temporal.ema.delete(entry.id);
      const inputContext = history.prevInput || history.ema ? get2dContext(canvas) : null;
      const inputSnapshot = inputContext
        ? inputContext.getImageData(0, 0, canvas.width, canvas.height).data
        : null;
      const defaults = resolveEntryOptions(entry, filter);
      const resolved = frame.resolveOptions?.(entry, index, defaults) ?? defaults;
      const options: FilterOptionValues & {
        palette?: Record<string, unknown>;
      } = {
        ...resolved,
        _chainIndex: index,
        _linearize: linearize,
        _wasmAcceleration: wasmAcceleration,
        _webglAcceleration: webglAcceleration,
        _hasVideoInput: frame.hasVideoInput ?? false,
        _prevOutput: temporal.prevOutputs.get(entry.id) ?? null,
        _prevInput: temporal.prevInputs.get(entry.id) ?? null,
        _ema: temporal.ema.get(entry.id) ?? null,
        _frameIndex: frameIndex,
        _degaussFrame: frame.degaussFrame ?? -2147483648,
        _isAnimating: isAnimating,
      };
      if (options.palette?.options && typeof options.palette.options === "object") {
        options.palette = {
          ...options.palette,
          options: {
            ...(options.palette.options as Record<string, unknown>),
            _wasmAcceleration: wasmAcceleration,
          },
        };
      }

      const started = now();
      let errorMessage: string | undefined;
      let caughtError: Error | undefined;
      let output: FilterCanvas = canvas;
      try {
        if (filter.requiresGL && !glAvailable()) {
          output = glUnavailableStub(canvas.width, canvas.height);
          logFilterBackend(filter.name, "GL-unavailable", "WebGL2 required but unavailable");
        } else {
          const candidate = await filter.func(canvas, options, frame.dispatch);
          if (isCanvas(candidate)) {
            output = candidate;
          }
        }
      } catch (cause) {
        caughtError = cause instanceof Error ? cause : new Error(String(cause));
        errorMessage = caughtError.message;
      }
      if (output !== canvas) uncommittedOutput = output;
      if (frame.shouldAbort?.()) {
        if (uncommittedOutput) {
          releasePooledCanvas(uncommittedOutput);
          uncommittedOutput = null;
        }
        aborted = true;
        break;
      }
      if (caughtError) runtime.onError?.(caughtError, entry);
      logFilterDispatched(filter.name, {
        noGL: filter.noGL,
        noWASM: filter.noWASM,
      });
      const elapsed = now() - started;
      totalTime += elapsed;

      if (inputSnapshot && history.prevInput) temporal.prevInputs.set(entry.id, inputSnapshot);
      if (inputSnapshot && history.ema) {
        const previousEma = temporal.ema.get(entry.id);
        if (!previousEma || previousEma.length !== inputSnapshot.length) {
          temporal.ema.set(entry.id, new Float32Array(inputSnapshot));
        } else {
          const inverseAlpha = 1 - emaAlpha;
          for (let pixel = 0; pixel < previousEma.length; pixel += 1) {
            previousEma[pixel] =
              previousEma[pixel] * inverseAlpha + inputSnapshot[pixel] * emaAlpha;
          }
        }
      }

      const outputContext = history.prevOutput ? get2dContext(output) : null;
      if (outputContext) {
        temporal.prevOutputs.set(
          entry.id,
          outputContext.getImageData(0, 0, output.width, output.height).data,
        );
      }
      const previousCanvas = canvas;
      canvas = output;
      uncommittedOutput = null;

      const backend = getFilterWasmStatuses().get(filter.name)?.label;
      const step: FilterStepResult = {
        id: entry.id,
        name: entry.displayName ?? filter.name,
        filterName: filter.name,
        canvas,
        ms: elapsed,
        ...(backend ? { backend } : {}),
        ...(errorMessage ? { error: errorMessage } : {}),
      };
      steps.push(step);
      if (!retainStepCanvases && previousCanvas !== input && previousCanvas !== canvas) {
        releasePooledCanvas(previousCanvas);
      }
      frame.onStep?.(step, index);
    }

    if (aborted && !retainStepCanvases && canvas !== input) {
      releasePooledCanvas(canvas);
      canvas = input;
    }
    if (!aborted) temporal.frameIndex = frameIndex + 1;
    return { canvas, steps, totalTime, frameIndex };
  } catch (cause) {
    if (uncommittedOutput && uncommittedOutput !== input) {
      releasePooledCanvas(uncommittedOutput);
    }
    if (!retainStepCanvases && canvas !== input) releasePooledCanvas(canvas);
    throw cause;
  }
};

export const createFilterSession = (
  initialChain: readonly FilterChainEntry[] = [],
  runtime: FilterRuntimeOptions = {},
): FilterSession => {
  const state = createTemporalState();
  let chain = [...initialChain];
  let disposed = false;
  let processing = false;
  let generation = 0;

  return {
    state,
    getChain: () => chain,
    setChain: (next) => {
      if (disposed) throw new Error("FilterSession has been disposed");
      generation += 1;
      chain = [...next];
      const activeIds = new Set(chain.map((entry) => entry.id));
      for (const id of state.prevOutputs.keys())
        if (!activeIds.has(id)) state.prevOutputs.delete(id);
      for (const id of state.prevInputs.keys()) if (!activeIds.has(id)) state.prevInputs.delete(id);
      for (const id of state.ema.keys()) if (!activeIds.has(id)) state.ema.delete(id);
    },
    process: async (input, options = {}) => {
      if (disposed) throw new Error("FilterSession has been disposed");
      if (processing) throw new Error("FilterSession is already processing a frame");
      const frameGeneration = generation;
      processing = true;
      try {
        // Keep writes private until the frame still belongs to this lifecycle.
        // Snapshots are replaced, so only the mutable EMA arrays need copying.
        const frameState: TemporalFilterState = {
          prevOutputs: new Map(state.prevOutputs),
          prevInputs: new Map(state.prevInputs),
          ema: new Map(Array.from(state.ema, ([id, values]) => [id, new Float32Array(values)])),
          frameIndex: state.frameIndex,
        };
        const result = await runFilterChain(input, chain, runtime, {
          ...options,
          temporalState: frameState,
          shouldAbort: () =>
            disposed || generation !== frameGeneration || !!options.shouldAbort?.(),
        });
        if (!disposed && generation === frameGeneration) Object.assign(state, frameState);
        return result;
      } finally {
        processing = false;
      }
    },
    reset: () => {
      generation += 1;
      state.prevOutputs.clear();
      state.prevInputs.clear();
      state.ema.clear();
      state.frameIndex = 0;
      clearMotionVectorsState();
    },
    dispose: () => {
      generation += 1;
      state.prevOutputs.clear();
      state.prevInputs.clear();
      state.ema.clear();
      chain = [];
      disposed = true;
    },
  };
};

export const disposeSharedFilterResources = (): void => {
  clearCanvasPool();
  clearMotionVectorsState();
  releasePooledTextures();
  releaseFloatTextures();
  releaseJpegArtifactFloatTextures();
};
