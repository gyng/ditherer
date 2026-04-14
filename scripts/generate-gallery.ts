/**
 * Generate a static gallery using the same registries as the in-app browser:
 * - Filters from `filterList`
 * - Presets from `CHAIN_PRESETS`
 * Outputs preview assets + docs/gallery/GALLERY.md.
 *
 * Usage: npm run gallery   (runs via vite-node)
 */

import { createCanvas, loadImage, ImageData as NodeImageData } from "canvas";
import { filterList } from "filters";
import { CHAIN_PRESETS, PRESET_CATEGORIES } from "../src/components/ChainList/presets";
import {
  cloneCanvas,
  wasmReady,
  initWasmFromBinary,
  getFilterWasmStatuses,
  resetFilterWasmStatus,
} from "utils";
import path from "path";
import fs from "fs";
import os from "os";
import { execFileSync, spawn } from "child_process";
import { encode } from "modern-gif";

type CanvasFactoryDocument = {
  createElement: (tag: string) => HTMLCanvasElement;
};

type BufferCanvas = HTMLCanvasElement & {
  toBuffer: (callback: (err: Error | null, buf: Buffer) => void, mimeType: string) => void;
};

type PaletteOptionValue = {
  palette?: {
    options?: {
      colors?: unknown;
    };
  };
};

type FilterDefinition = {
  defaults?: Record<string, unknown>;
  options?: Record<string, unknown>;
  optionTypes?: Record<string, unknown>;
  func: (input: HTMLCanvasElement, options?: Record<string, unknown>, dispatch?: unknown) => unknown;
  mainThread?: boolean;
};

(globalThis as unknown as { document: CanvasFactoryDocument }).document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return createCanvas(1, 1) as unknown as HTMLCanvasElement;
    throw new Error(`Unsupported element: ${tag}`);
  },
} as unknown as CanvasFactoryDocument;
(globalThis as unknown as { ImageData: typeof globalThis.ImageData }).ImageData =
  NodeImageData as unknown as typeof globalThis.ImageData;

const THUMB_WIDTH = 256;
const PREVIEW_FRAMES = 8;
const ANIMATED_PREVIEW_SECONDS = 3;
const ANIMATED_PREVIEW_FPS = 10;
const EMA_ALPHA = 0.1;
const CPU_COUNT = os.cpus().length;
const DEFAULT_WORKER_COUNT = Math.max(
  1,
  Math.min(30, Number(process.env.GALLERY_WORKERS || String(Math.max(1, CPU_COUNT - 2))))
);
const DEFAULT_WORKER_ITEM_CONCURRENCY = Math.max(
  1,
  Number(process.env.GALLERY_WORKER_ITEM_CONCURRENCY || "1")
);
const PROGRESS_EVERY = Math.max(1, Number(process.env.GALLERY_PROGRESS_EVERY || "25"));
const WORKER_MODE = process.env.GALLERY_WORKER_MODE === "1";
const WORKER_INDEX = Number(process.env.GALLERY_WORKER_INDEX || "0");
// Bench-only mode: run the per-filter benchmark but don't touch the preview
// assets or GALLERY.md. PERF.md is always regenerated, but it's gitignored so
// running `npm run bench` doesn't leave anything git-visible behind.
const BENCH_ONLY = process.env.GALLERY_BENCH_ONLY === "1";

type GalleryKind = "filters" | "presets";

type VariantPerf = {
  name: string;
  didWasm: boolean;
  reason: string;
  jsMs: number;
  wasmMs: number;
};

type FilterPerf = {
  jsMs: number;
  wasmMs: number;
  didWasm: boolean;
  reason: string;
  variants: VariantPerf[];
};

type GalleryItem = {
  displayName: string;
  category: string;
  assetPath: string | null;
  description: string;
  previewSource: "image" | "video";
  status: "ok" | "unavailable";
  perf?: FilterPerf;
};

type GifColorTable = number[][];

type AnimatedPreviewResult = {
  frames: HTMLCanvasElement[];
  colorTable: GifColorTable | null;
};

type FilterListEntry = (typeof filterList)[number];

type GalleryTask = {
  kind: GalleryKind;
  index: number;
};

type GalleryTaskResult = {
  kind: GalleryKind;
  index: number;
  item: GalleryItem;
};

type WorkerPayload = {
  tasks: GalleryTask[];
  items: GalleryTaskResult[];
};

const isCanvasElementLike = (value: unknown): value is HTMLCanvasElement =>
  typeof value === "object" &&
  value !== null &&
  "getContext" in value &&
  typeof value.getContext === "function";

const getErrorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/, "");

const getAssetRelativePath = (
  kind: GalleryKind,
  previewSource: "image" | "video",
  basename: string
) => path.posix.join(kind, previewSource === "video" ? "animated" : "static", basename);

const getCategories = (items: Array<{ category: string }>) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item.category)) continue;
    seen.add(item.category);
    out.push(item.category);
  }
  return out;
};

const resolveFilterOptions = (
  filter: { defaults?: Record<string, unknown>; options?: Record<string, unknown> },
  overrideOptions?: Record<string, unknown>
) => ({
  ...(filter.defaults || {}),
  ...(filter.options || {}),
  ...(overrideOptions || {}),
});

const getGifPaletteColorTable = (
  optionCandidates: Array<Record<string, unknown> | undefined>
): GifColorTable | null => {
  const paletteCandidates = optionCandidates.map((options) => (options as PaletteOptionValue | undefined)?.palette);

  for (const palette of paletteCandidates) {
    const rawColors = palette?.options?.colors;
    if (!Array.isArray(rawColors) || rawColors.length === 0) continue;
    const deduped = rawColors
      .map((color: number[]) => [color[0], color[1], color[2]].map((channel) => {
        const n = Number(channel);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(255, Math.round(n)));
      }))
      .filter((color: number[]) => color.length === 3)
      .filter((color: number[], index: number, all: number[][]) =>
        all.findIndex((candidate) => (
          candidate[0] === color[0] &&
          candidate[1] === color[1] &&
          candidate[2] === color[2]
        )) === index
      )
      .slice(0, 256);

    if (deduped.length >= 2) {
      return deduped;
    }
  }

  return null;
};

const hasAnimatedOption = (entry: FilterListEntry) =>
  Boolean((entry.filter.optionTypes as Record<string, unknown> | undefined)?.animate);

const hasTemporalBehavior = (entry: FilterListEntry) =>
  (entry.filter as FilterDefinition).mainThread === true;

const isAnimatedFilterEntry = (entry: FilterListEntry) =>
  hasTemporalBehavior(entry) || hasAnimatedOption(entry);

const isAnimatedPreset = (
  preset: (typeof CHAIN_PRESETS)[number],
  filterByName: Map<string, FilterListEntry>
) =>
  preset.filters.some((presetEntry) => {
    const match = filterByName.get(presetEntry.name);
    return match ? isAnimatedFilterEntry(match) : false;
  });

const updateTemporalState = (
  key: string,
  inputPixels: Uint8ClampedArray,
  outputCanvas: HTMLCanvasElement,
  prevInputByKey: Map<string, Uint8ClampedArray>,
  prevOutputByKey: Map<string, Uint8ClampedArray>,
  emaByKey: Map<string, Float32Array>,
) => {
  prevInputByKey.set(key, new Uint8ClampedArray(inputPixels));
  let ema = emaByKey.get(key);
  if (!ema || ema.length !== inputPixels.length) {
    ema = new Float32Array(inputPixels);
  } else {
    const oneMinus = 1 - EMA_ALPHA;
    for (let j = 0; j < ema.length; j += 1) {
      ema[j] = ema[j] * oneMinus + inputPixels[j] * EMA_ALPHA;
    }
  }
  emaByKey.set(key, ema);

  const outCtxStep = outputCanvas.getContext("2d");
  if (!outCtxStep) return;
  const outPixels = outCtxStep.getImageData(0, 0, outputCanvas.width, outputCanvas.height).data;
  prevOutputByKey.set(key, new Uint8ClampedArray(outPixels));
};

const runFilterPreview = (
  entry: FilterListEntry,
  sourceCanvas: HTMLCanvasElement
): HTMLCanvasElement | null => {
  const prevInputByKey = new Map<string, Uint8ClampedArray>();
  const prevOutputByKey = new Map<string, Uint8ClampedArray>();
  const emaByKey = new Map<string, Float32Array>();
  const key = `filter:${entry.displayName}`;
  const needsTemporal = hasTemporalBehavior(entry);
  const isAnimatingPreview = needsTemporal || hasAnimatedOption(entry);
  let result = cloneCanvas(sourceCanvas, true) as HTMLCanvasElement;

  for (let frame = 0; frame < PREVIEW_FRAMES; frame += 1) {
    const inputFrame = cloneCanvas(sourceCanvas, true) as HTMLCanvasElement;
    const inCtx = inputFrame.getContext("2d");
    const inPixels = inCtx ? inCtx.getImageData(0, 0, inputFrame.width, inputFrame.height).data : null;
    const opts = {
      ...resolveFilterOptions(entry.filter as FilterDefinition),
      _frameIndex: frame,
      _isAnimating: isAnimatingPreview,
      _hasVideoInput: isAnimatingPreview,
      _prevInput: prevInputByKey.get(key) || null,
      _prevOutput: prevOutputByKey.get(key) || null,
      _ema: emaByKey.get(key) || null,
    };
    const maybe = (entry.filter as FilterDefinition).func(inputFrame, opts, undefined);
    if (!isCanvasElementLike(maybe)) {
      return null;
    }
    result = maybe;
    if (needsTemporal && inPixels) {
      updateTemporalState(key, inPixels, result, prevInputByKey, prevOutputByKey, emaByKey);
    }
  }

  return result;
};

const runAnimatedFilterPreview = (
  entry: FilterListEntry,
  sourceFrames: HTMLCanvasElement[]
): AnimatedPreviewResult | null => {
  const prevInputByKey = new Map<string, Uint8ClampedArray>();
  const prevOutputByKey = new Map<string, Uint8ClampedArray>();
  const emaByKey = new Map<string, Float32Array>();
  const key = `filter:${entry.displayName}`;
  const needsTemporal = hasTemporalBehavior(entry);
  const resolvedOptions = resolveFilterOptions(entry.filter as FilterDefinition);
  const colorTable = getGifPaletteColorTable([resolvedOptions]);
  const resultFrames: HTMLCanvasElement[] = [];

  for (let frame = 0; frame < sourceFrames.length; frame += 1) {
    const inputFrame = cloneCanvas(sourceFrames[frame], true) as HTMLCanvasElement;
    const inCtx = inputFrame.getContext("2d");
    const inPixels = inCtx ? inCtx.getImageData(0, 0, inputFrame.width, inputFrame.height).data : null;
    const opts = {
      ...resolvedOptions,
      _frameIndex: frame,
      _isAnimating: true,
      _hasVideoInput: true,
      _prevInput: prevInputByKey.get(key) || null,
      _prevOutput: prevOutputByKey.get(key) || null,
      _ema: emaByKey.get(key) || null,
    };
    const maybe = (entry.filter as FilterDefinition).func(inputFrame, opts, undefined);
    if (!isCanvasElementLike(maybe)) {
      return null;
    }
    const output = maybe;
    if (needsTemporal && inPixels) {
      updateTemporalState(key, inPixels, output, prevInputByKey, prevOutputByKey, emaByKey);
    }
    resultFrames.push(cloneCanvas(output, true) as HTMLCanvasElement);
  }

  return { frames: resultFrames, colorTable };
};

const runPresetPreview = (
  sourceCanvas: HTMLCanvasElement,
  preset: (typeof CHAIN_PRESETS)[number],
  filterByName: Map<string, FilterListEntry>
): HTMLCanvasElement | null => {
  const prevInputByKey = new Map<string, Uint8ClampedArray>();
  const prevOutputByKey = new Map<string, Uint8ClampedArray>();
  const emaByKey = new Map<string, Float32Array>();
  let result = cloneCanvas(sourceCanvas, true) as HTMLCanvasElement;

  for (let frame = 0; frame < PREVIEW_FRAMES; frame += 1) {
    let pipeline = cloneCanvas(sourceCanvas, true) as HTMLCanvasElement;
    for (let idx = 0; idx < preset.filters.length; idx += 1) {
      const presetEntry = preset.filters[idx];
      const match = filterByName.get(presetEntry.name);
      if (!match) continue;
      const key = `preset:${preset.name}:${idx}:${presetEntry.name}`;
      const needsTemporal = hasTemporalBehavior(match);
      const isAnimatingPreview = needsTemporal || hasAnimatedOption(match);
      const inCtx = pipeline.getContext("2d");
      const inPixels = inCtx ? inCtx.getImageData(0, 0, pipeline.width, pipeline.height).data : null;
      const opts = {
        ...resolveFilterOptions(match.filter as FilterDefinition, presetEntry.options),
        _frameIndex: frame,
        _isAnimating: isAnimatingPreview,
        _hasVideoInput: isAnimatingPreview,
        _prevInput: prevInputByKey.get(key) || null,
        _prevOutput: prevOutputByKey.get(key) || null,
        _ema: emaByKey.get(key) || null,
      };
      const maybe = (match.filter as FilterDefinition).func(pipeline, opts, undefined);
      if (!isCanvasElementLike(maybe)) {
        return null;
      }
      pipeline = maybe;
      if (needsTemporal && inPixels) {
        updateTemporalState(key, inPixels, pipeline, prevInputByKey, prevOutputByKey, emaByKey);
      }
    }
    result = pipeline;
  }

  return result;
};

const runAnimatedPresetPreview = (
  sourceFrames: HTMLCanvasElement[],
  preset: (typeof CHAIN_PRESETS)[number],
  filterByName: Map<string, FilterListEntry>
): AnimatedPreviewResult | null => {
  const prevInputByKey = new Map<string, Uint8ClampedArray>();
  const prevOutputByKey = new Map<string, Uint8ClampedArray>();
  const emaByKey = new Map<string, Float32Array>();
  const resolvedOptionStack = preset.filters
    .map((presetEntry) => {
      const match = filterByName.get(presetEntry.name);
      return match ? resolveFilterOptions(match.filter as FilterDefinition, presetEntry.options) : undefined;
    })
    .filter(Boolean)
    .reverse() as Record<string, unknown>[];
  const colorTable = getGifPaletteColorTable(resolvedOptionStack);
  const resultFrames: HTMLCanvasElement[] = [];

  for (let frame = 0; frame < sourceFrames.length; frame += 1) {
    let pipeline = cloneCanvas(sourceFrames[frame], true) as HTMLCanvasElement;
    for (let idx = 0; idx < preset.filters.length; idx += 1) {
      const presetEntry = preset.filters[idx];
      const match = filterByName.get(presetEntry.name);
      if (!match) continue;
      const key = `preset:${preset.name}:${idx}:${presetEntry.name}`;
      const needsTemporal = hasTemporalBehavior(match);
      const isAnimatingPreview = isAnimatedFilterEntry(match);
      const inCtx = pipeline.getContext("2d");
      const inPixels = inCtx ? inCtx.getImageData(0, 0, pipeline.width, pipeline.height).data : null;
      const opts = {
        ...resolveFilterOptions(match.filter as FilterDefinition, presetEntry.options),
        _frameIndex: frame,
        _isAnimating: isAnimatingPreview,
        _hasVideoInput: true,
        _prevInput: prevInputByKey.get(key) || null,
        _prevOutput: prevOutputByKey.get(key) || null,
        _ema: emaByKey.get(key) || null,
      };
      const maybe = (match.filter as FilterDefinition).func(pipeline, opts, undefined);
      if (!isCanvasElementLike(maybe)) {
        return null;
      }
      pipeline = maybe;
      if (needsTemporal && inPixels) {
        updateTemporalState(key, inPixels, pipeline, prevInputByKey, prevOutputByKey, emaByKey);
      }
    }
    resultFrames.push(cloneCanvas(pipeline, true) as HTMLCanvasElement);
  }

  return { frames: resultFrames, colorTable };
};

const buildGridSection = (items: GalleryItem[]) => {
  let md = "| | | |\n|---|---|---|\n";
  for (let i = 0; i < items.length; i += 3) {
    const row = items.slice(i, i + 3);
    const cells = row.map((item) => {
      const imagePart = item.assetPath
        ? `![${item.displayName}](${item.assetPath})`
        : "_Preview unavailable_";
      return `**${item.displayName}**<br>${item.description}<br>${imagePart}`;
    });
    while (cells.length < 3) cells.push("");
    md += `| ${cells.join(" | ")} |\n`;
  }
  md += "\n";
  return md;
};

const toPngBufferAsync = (canvas: HTMLCanvasElement): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    (canvas as BufferCanvas).toBuffer((err: Error | null, buf: Buffer) => {
      if (err) reject(err);
      else resolve(buf);
    }, "image/png");
  });

const encodeGifBuffer = async (
  frames: HTMLCanvasElement[],
  colorTable?: GifColorTable | null
): Promise<Buffer> => {
  if (frames.length === 0) {
    throw new Error("Cannot encode animated preview without frames.");
  }
  const width = frames[0].width;
  const height = frames[0].height;
  const delay = Math.max(10, Math.round(1000 / ANIMATED_PREVIEW_FPS / 10) * 10);
  const output = await encode({
    width,
    height,
    frames: frames.map((frame) => {
      const ctx = frame.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to read animated preview frame.");
      }
      return {
        data: new Uint8Array(ctx.getImageData(0, 0, width, height).data),
        delay,
      };
    }),
    ...(colorTable ? { colorTable } : {}),
  });
  return Buffer.from(output);
};

const loadAnimatedSourceFrames = async (): Promise<HTMLCanvasElement[]> => {
  const videoCandidates = [
    path.resolve("public/test-assets/video/akiyo.mp4"),
    path.resolve("public/akiyo.mp4"),
  ];
  const videoPath = videoCandidates.find((p) => fs.existsSync(p));
  if (!videoPath) {
    throw new Error(`Could not find animated source video. Tried:\n${videoCandidates.join("\n")}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ditherer-gallery-"));
  try {
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "0",
      "-t",
      String(ANIMATED_PREVIEW_SECONDS),
      "-i",
      videoPath,
      "-vf",
      `fps=${ANIMATED_PREVIEW_FPS},scale=${THUMB_WIDTH}:-1:flags=lanczos`,
      path.join(tempDir, "frame-%03d.png"),
    ]);

    const files = fs.readdirSync(tempDir)
      .filter((file) => file.endsWith(".png"))
      .sort();
    const frames: HTMLCanvasElement[] = [];
    for (const file of files) {
      const img = await loadImage(path.join(tempDir, file));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, img.width, img.height);
      frames.push(canvas as unknown as HTMLCanvasElement);
    }
    if (frames.length === 0) {
      throw new Error(`ffmpeg did not produce any frames from ${path.relative(process.cwd(), videoPath)}`);
    }
    return frames;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runOne = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(workers);
  return results;
};

const loadStaticSourceCanvas = async (): Promise<HTMLCanvasElement> => {
  const sourceCandidates = [
    path.resolve("public/pepper.png"),
    path.resolve("public/test-assets/image/pepper.png"),
  ];
  const sourcePath = sourceCandidates.find((p) => fs.existsSync(p));
  if (!sourcePath) {
    throw new Error(`Could not find source image. Tried:\n${sourceCandidates.join("\n")}`);
  }
  const img = await loadImage(sourcePath);
  const scale = THUMB_WIDTH / img.width;
  const thumbH = Math.round(img.height * scale);
  const sourceCanvas = createCanvas(THUMB_WIDTH, thumbH);
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.drawImage(img, 0, 0, THUMB_WIDTH, thumbH);
  return sourceCanvas as unknown as HTMLCanvasElement;
};

const ensureOutputDirectories = (outputDir: string) => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputDir, "filters", "static"), { recursive: true });
  fs.mkdirSync(path.join(outputDir, "filters", "animated"), { recursive: true });
  fs.mkdirSync(path.join(outputDir, "presets", "static"), { recursive: true });
  fs.mkdirSync(path.join(outputDir, "presets", "animated"), { recursive: true });
};

const readWorkerPayload = (filePath: string): WorkerPayload =>
  JSON.parse(fs.readFileSync(filePath, "utf8")) as WorkerPayload;

const writeWorkerPayload = (filePath: string, payload: WorkerPayload) => {
  fs.writeFileSync(filePath, JSON.stringify(payload));
};

const getNpxCommand = () => (process.platform === "win32" ? "npx.cmd" : "npx");

// === Benchmark helpers ===

const BENCH_WARMUP = 1;
const BENCH_RUNS = 3;
// Per-filter bench is capped so a slow pathological filter can't blow up
// gallery runtime. If a single run exceeds this, we keep the samples we have.
const BENCH_MAX_TOTAL_MS = 2000;

// Returns `null` if the filter blew up — callers should treat that as a bench failure.
const timeFilterRuns = (
  filter: FilterDefinition,
  sourceCanvas: HTMLCanvasElement,
  options: Record<string, unknown>
): number | null => {
  try {
    // Warmup — discount JIT compile and wasm module warm-up.
    for (let i = 0; i < BENCH_WARMUP; i += 1) {
      const input = cloneCanvas(sourceCanvas, true) as HTMLCanvasElement;
      filter.func(input, { ...options, _frameIndex: i }, undefined);
    }
    const samples: number[] = [];
    const startAll = performance.now();
    for (let i = 0; i < BENCH_RUNS; i += 1) {
      const input = cloneCanvas(sourceCanvas, true) as HTMLCanvasElement;
      const t0 = performance.now();
      filter.func(input, { ...options, _frameIndex: i + BENCH_WARMUP }, undefined);
      samples.push(performance.now() - t0);
      if (performance.now() - startAll > BENCH_MAX_TOTAL_MS) break;
    }
    if (samples.length === 0) return null;
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)]; // median
  } catch {
    return null;
  }
};

const captureWasmStatus = (filterName: string, fallbackReason: string): { didWasm: boolean; reason: string } => {
  const status = getFilterWasmStatuses().get(filterName);
  if (status) return status;
  return { didWasm: false, reason: fallbackReason };
};

// Variant matrix for filters with multiple fast paths. Each entry describes a
// configuration to benchmark and what it's meant to exercise. Filters not
// listed here just get the default bench.
type VariantSpec = { name: string; overrides: Record<string, unknown> };

const getFilterVariants = (filterName: string, defaults: Record<string, unknown>): VariantSpec[] => {
  const ed = new Set([
    "Floyd-Steinberg", "False Floyd-Steinberg", "Atkinson", "Sierra",
    "Sierra 2-row", "Sierra lite", "Jarvis", "Stucki", "Burkes",
    "Stripe (Horizontal)", "Stripe (Vertical)",
  ]);
  if (ed.has(filterName)) {
    return [
      { name: "linearize", overrides: { _linearize: true } },
      { name: "scanOrder=VERTICAL", overrides: { scanOrder: "VERTICAL" } },
      { name: "scanOrder=HILBERT", overrides: { scanOrder: "HILBERT" } },
      { name: "scanOrder=RANDOM_PIXEL", overrides: { scanOrder: "RANDOM_PIXEL" } },
      { name: "rowAlt=RANDOM", overrides: { rowAlternation: "RANDOM" } },
      { name: "temporalMode=VOTE", overrides: { temporalMode: "VOTE" } },
    ];
  }
  if (filterName === "Ordered") {
    return [
      { name: "linearize", overrides: { _linearize: true } },
    ];
  }
  // No known variants for other filters.
  return defaults ? [] : [];
};

const benchFilter = (
  entry: FilterListEntry,
  sourceCanvas: HTMLCanvasElement
): FilterPerf | undefined => {
  const filter = entry.filter as FilterDefinition;
  const defaults = resolveFilterOptions(filter);
  // Status lookups use the underlying filter.name (what logFilterWasmStatus logs
  // under), not the gallery's displayName — the gallery may wrap the same base
  // filter under multiple display names (e.g. presets).
  const statusKey = (entry.filter as unknown as { name?: string }).name ?? entry.displayName;
  const variantsForThisFilter = getFilterVariants(statusKey, defaults);

  resetFilterWasmStatus(statusKey);
  const wasmOpts = { ...defaults, _wasmAcceleration: true };
  const wasmMs = timeFilterRuns(filter, sourceCanvas, wasmOpts);
  const wasmStatus = captureWasmStatus(statusKey, "no wasm path");

  resetFilterWasmStatus(statusKey);
  const jsOpts = { ...defaults, _wasmAcceleration: false };
  const jsMs = timeFilterRuns(filter, sourceCanvas, jsOpts);

  if (jsMs == null || wasmMs == null) return undefined;

  const variants: VariantPerf[] = [];
  for (const v of variantsForThisFilter) {
    resetFilterWasmStatus(statusKey);
    const vWasm = timeFilterRuns(filter, sourceCanvas, { ...defaults, ...v.overrides, _wasmAcceleration: true });
    const vStatus = captureWasmStatus(statusKey, "no wasm path");
    resetFilterWasmStatus(statusKey);
    const vJs = timeFilterRuns(filter, sourceCanvas, { ...defaults, ...v.overrides, _wasmAcceleration: false });
    if (vWasm != null && vJs != null) {
      variants.push({ name: v.name, didWasm: vStatus.didWasm, reason: vStatus.reason, jsMs: vJs, wasmMs: vWasm });
    }
  }

  return { jsMs, wasmMs, didWasm: wasmStatus.didWasm, reason: wasmStatus.reason, variants };
};

const renderFilterItem = async (
  entry: FilterListEntry,
  sourceCanvas: HTMLCanvasElement,
  animatedSourceFrames: HTMLCanvasElement[],
  outputDir: string
): Promise<GalleryItem> => {
  const perf = benchFilter(entry, sourceCanvas);
  if (BENCH_ONLY) {
    // Skip asset generation + preview rendering entirely; the bench already
    // exercised the filter so we know whether it's ok.
    return {
      displayName: entry.displayName,
      category: entry.category,
      assetPath: null,
      description: entry.description,
      previewSource: isAnimatedFilterEntry(entry) ? "video" : "image",
      status: perf ? "ok" : "unavailable",
      ...(perf ? { perf } : {}),
    };
  }
  const animatedPreview = isAnimatedFilterEntry(entry);
  if (animatedPreview) {
    const result = runAnimatedFilterPreview(entry, animatedSourceFrames);
    if (!result) {
      return {
        displayName: entry.displayName,
        category: entry.category,
        assetPath: null,
        description: entry.description,
        previewSource: "video",
        status: "unavailable",
        ...(perf ? { perf } : {}),
      };
    }
    const filename = `filter-${slugify(entry.displayName)}.gif`;
    const assetPath = getAssetRelativePath("filters", "video", filename);
    const gif = await encodeGifBuffer(result.frames, result.colorTable);
    await fs.promises.writeFile(path.join(outputDir, assetPath), gif);
    return {
      displayName: entry.displayName,
      category: entry.category,
      assetPath,
      description: entry.description,
      previewSource: "video",
      status: "ok",
      ...(perf ? { perf } : {}),
    };
  }

  const result = runFilterPreview(entry, sourceCanvas);
  if (!result) {
    return {
      displayName: entry.displayName,
      category: entry.category,
      assetPath: null,
      description: entry.description,
      previewSource: "image",
      status: "unavailable",
      ...(perf ? { perf } : {}),
    };
  }
  const filename = `filter-${slugify(entry.displayName)}.png`;
  const assetPath = getAssetRelativePath("filters", "image", filename);
  const png = await toPngBufferAsync(result);
  await fs.promises.writeFile(path.join(outputDir, assetPath), png);
  return {
    displayName: entry.displayName,
    category: entry.category,
    assetPath,
    description: entry.description,
    previewSource: "image",
    status: "ok",
    ...(perf ? { perf } : {}),
  };
};

const renderPresetItem = async (
  preset: (typeof CHAIN_PRESETS)[number],
  filterByName: Map<string, FilterListEntry>,
  sourceCanvas: HTMLCanvasElement,
  animatedSourceFrames: HTMLCanvasElement[],
  outputDir: string
): Promise<GalleryItem> => {
  const animatedPreview = isAnimatedPreset(preset, filterByName);
  if (animatedPreview) {
    const result = runAnimatedPresetPreview(animatedSourceFrames, preset, filterByName);
    if (!result) {
      return {
        displayName: preset.name,
        category: preset.category,
        assetPath: null,
        description: preset.desc,
        previewSource: "video",
        status: "unavailable",
      };
    }
    const filename = `preset-${slugify(preset.name)}.gif`;
    const assetPath = getAssetRelativePath("presets", "video", filename);
    const gif = await encodeGifBuffer(result.frames, result.colorTable);
    await fs.promises.writeFile(path.join(outputDir, assetPath), gif);
    return {
      displayName: preset.name,
      category: preset.category,
      assetPath,
      description: preset.desc,
      previewSource: "video",
      status: "ok",
    };
  }

  const result = runPresetPreview(sourceCanvas, preset, filterByName);
  if (!result) {
    return {
      displayName: preset.name,
      category: preset.category,
      assetPath: null,
      description: preset.desc,
      previewSource: "image",
      status: "unavailable",
    };
  }
  const filename = `preset-${slugify(preset.name)}.png`;
  const assetPath = getAssetRelativePath("presets", "image", filename);
  const png = await toPngBufferAsync(result);
  await fs.promises.writeFile(path.join(outputDir, assetPath), png);
  return {
    displayName: preset.name,
    category: preset.category,
    assetPath,
    description: preset.desc,
    previewSource: "image",
    status: "ok",
  };
};

const chunkTasksRoundRobin = (tasks: GalleryTask[], workerCount: number) => {
  const groups = Array.from({ length: workerCount }, () => [] as GalleryTask[]);
  for (let index = 0; index < tasks.length; index += 1) {
    groups[index % workerCount].push(tasks[index]);
  }
  return groups.filter((group) => group.length > 0);
};

const runWorkerPool = async (
  tasks: GalleryTask[],
  outputDir: string
): Promise<GalleryTaskResult[]> => {
  if (tasks.length === 0) return [];
  const workerCount = Math.min(DEFAULT_WORKER_COUNT, tasks.length);
  const taskGroups = chunkTasksRoundRobin(tasks, workerCount);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ditherer-gallery-workers-"));

  try {
    const batches = await Promise.all(taskGroups.map((group, workerIndex) => (
      new Promise<GalleryTaskResult[]>((resolve, reject) => {
        const taskFile = path.join(tempDir, `tasks-${workerIndex}.json`);
        const resultFile = path.join(tempDir, `results-${workerIndex}.json`);
        writeWorkerPayload(taskFile, { tasks: group, items: [] });
        const child = spawn(
          getNpxCommand(),
          ["vite-node", "scripts/generate-gallery.ts"],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              GALLERY_WORKER_MODE: "1",
              GALLERY_WORKER_INDEX: String(workerIndex + 1),
              GALLERY_TASK_FILE: taskFile,
              GALLERY_RESULT_FILE: resultFile,
              GALLERY_OUTPUT_DIR: outputDir,
              GALLERY_WORKER_ITEM_CONCURRENCY: String(DEFAULT_WORKER_ITEM_CONCURRENCY),
            },
            stdio: "inherit",
          }
        );
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code !== 0) {
            reject(new Error(`Gallery worker ${workerIndex + 1} exited with code ${code}`));
            return;
          }
          if (!fs.existsSync(resultFile)) {
            reject(new Error(`Gallery worker ${workerIndex + 1} did not write ${resultFile}`));
            return;
          }
          resolve(readWorkerPayload(resultFile).items);
        });
      })
    )));
    return batches.flat();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const buildFallbackItem = (
  task: GalleryTask,
  allFilters: FilterListEntry[],
  filterByName: Map<string, FilterListEntry>
): GalleryItem => {
  if (task.kind === "filters") {
    const entry = allFilters[task.index];
    return {
      displayName: entry?.displayName || `Filter ${task.index}`,
      category: entry?.category || "Unknown",
      assetPath: null,
      description: entry?.description || "",
      previewSource: entry && isAnimatedFilterEntry(entry) ? "video" : "image",
      status: "unavailable",
    };
  }
  const preset = CHAIN_PRESETS[task.index];
  return {
    displayName: preset?.name || `Preset ${task.index}`,
    category: preset?.category || "Unknown",
    assetPath: null,
    description: preset?.desc || "",
    previewSource: preset && isAnimatedPreset(preset, filterByName) ? "video" : "image",
    status: "unavailable",
  };
};

const runWorkerMain = async () => {
  const taskFile = process.env.GALLERY_TASK_FILE;
  const resultFile = process.env.GALLERY_RESULT_FILE;
  const outputDir = process.env.GALLERY_OUTPUT_DIR;
  if (!taskFile || !resultFile || !outputDir) {
    throw new Error("Worker mode requires GALLERY_TASK_FILE, GALLERY_RESULT_FILE, and GALLERY_OUTPUT_DIR.");
  }

  // Wait for the WASM module to load so per-filter benches can exercise the
  // WASM path. The default wasmReady path uses fetch() which doesn't work in
  // Node, so we also feed the .wasm bytes in directly from disk as a fallback.
  try { await wasmReady; } catch (err) { console.error("wasmReady failed:", err); }
  try {
    const wasmPath = path.resolve("src/wasm/rgba2laba/wasm/rgba2laba_bg.wasm");
    if (fs.existsSync(wasmPath)) {
      const wasmBytes = fs.readFileSync(wasmPath);
      await initWasmFromBinary(wasmBytes);
    }
  } catch (err) {
    console.error("initWasmFromBinary failed:", err);
  }

  const payload = readWorkerPayload(taskFile);
  const allFilters = filterList.filter(Boolean) as FilterListEntry[];
  const filterByName = new Map(allFilters.map((entry) => [entry.displayName, entry] as const));
  const sourceCanvas = await loadStaticSourceCanvas();
  const animatedSourceFrames = await loadAnimatedSourceFrames();
  let done = 0;

  const items = await runWithConcurrency(
    payload.tasks,
    DEFAULT_WORKER_ITEM_CONCURRENCY,
    async (task) => {
      try {
        const item = task.kind === "filters"
          ? await renderFilterItem(allFilters[task.index], sourceCanvas, animatedSourceFrames, outputDir)
          : await renderPresetItem(CHAIN_PRESETS[task.index], filterByName, sourceCanvas, animatedSourceFrames, outputDir);
        done += 1;
        if (done % PROGRESS_EVERY === 0 || done === payload.tasks.length) {
          console.log(`Worker ${WORKER_INDEX}: ${done}/${payload.tasks.length}`);
        }
        return { kind: task.kind, index: task.index, item } satisfies GalleryTaskResult;
      } catch (err: unknown) {
        done += 1;
        if (done % PROGRESS_EVERY === 0 || done === payload.tasks.length) {
          console.log(`Worker ${WORKER_INDEX}: ${done}/${payload.tasks.length}`);
        }
        const item = buildFallbackItem(task, allFilters, filterByName);
        console.error(`FAIL: ${task.kind.slice(0, -1)} ${item.displayName}: ${getErrorMessage(err)}`);
        return { kind: task.kind, index: task.index, item } satisfies GalleryTaskResult;
      }
    }
  );

  writeWorkerPayload(resultFile, { tasks: payload.tasks, items });
};

const formatMs = (ms: number) => ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
const formatSpeedup = (jsMs: number, wasmMs: number) =>
  wasmMs <= 0 ? "—" : `${(jsMs / wasmMs).toFixed(2)}×`;

const buildPerfMarkdown = (filterResults: GalleryItem[]) => {
  const withPerf = filterResults.filter((r): r is GalleryItem & { perf: FilterPerf } => r.perf !== undefined);
  const wasmCount = withPerf.filter((r) => r.perf.didWasm).length;
  const jsCount = withPerf.length - wasmCount;
  const totalFilters = filterResults.length;

  let md = "# Filter Performance Report\n\n";
  md += "> Generated by `npm run gallery` (or `npm run bench` for bench-only). ";
  md += "All numbers are median wall-clock ms over 3 post-warmup runs at preview size ";
  md += "(same `pepper.png` the gallery uses).\n\n";
  md += `> Filters benched: **${withPerf.length} / ${totalFilters}** · `;
  md += `WASM-accelerated (default config): **${wasmCount}** · `;
  md += `JS-only (default config): **${jsCount}**\n\n`;

  // Coverage summary — what's on the WASM path and what falls through.
  const reasonsCounter = new Map<string, number>();
  for (const r of withPerf) {
    if (r.perf.didWasm) continue;
    const key = r.perf.reason || "unknown";
    reasonsCounter.set(key, (reasonsCounter.get(key) ?? 0) + 1);
  }
  if (reasonsCounter.size > 0) {
    md += "## JS fall-through reasons (default config)\n\n";
    md += "| reason | filters |\n|---|---:|\n";
    const sorted = [...reasonsCounter.entries()].sort((a, b) => b[1] - a[1]);
    for (const [reason, n] of sorted) md += `| ${reason} | ${n} |\n`;
    md += "\n";
  }

  // Variant coverage for filters that have multi-path bench coverage.
  const withVariants = withPerf.filter((r) => r.perf.variants.length > 0);
  if (withVariants.length > 0) {
    md += "## Variant coverage\n\n";
    md += "Each row shows whether the WASM fast path was taken for that variant ";
    md += "(✅ WASM, ⚠️ JS) and the JS→WASM speedup.\n\n";
    for (const r of withVariants) {
      md += `### ${r.displayName}\n\n`;
      md += "| variant | path | js ms | wasm ms | speedup | reason |\n";
      md += "|---|---|---:|---:|---:|---|\n";
      md += `| _default_ | ${r.perf.didWasm ? "✅ WASM" : "⚠️ JS"} | ${formatMs(r.perf.jsMs)} | ${formatMs(r.perf.wasmMs)} | ${formatSpeedup(r.perf.jsMs, r.perf.wasmMs)} | ${r.perf.reason} |\n`;
      for (const v of r.perf.variants) {
        md += `| ${v.name} | ${v.didWasm ? "✅ WASM" : "⚠️ JS"} | ${formatMs(v.jsMs)} | ${formatMs(v.wasmMs)} | ${formatSpeedup(v.jsMs, v.wasmMs)} | ${v.reason} |\n`;
      }
      md += "\n";
    }
  }

  // Candidates for porting: JS-only filters sorted by JS cost (biggest wins first).
  const candidates = withPerf.filter((r) => !r.perf.didWasm).sort((a, b) => b.perf.jsMs - a.perf.jsMs);
  if (candidates.length > 0) {
    md += "## Candidates for Rust/WASM porting (JS-only, slowest first)\n\n";
    md += "| filter | category | js ms | reason |\n|---|---|---:|---|\n";
    for (const r of candidates.slice(0, 40)) {
      md += `| ${r.displayName} | ${r.category} | ${formatMs(r.perf.jsMs)} | ${r.perf.reason} |\n`;
    }
    if (candidates.length > 40) md += `\n…and ${candidates.length - 40} more.\n`;
    md += "\n";
  }

  // Full per-filter table, sorted by WASM speedup (biggest first among the WASM ones).
  md += "## All filters (default config)\n\n";
  md += "| filter | category | path | js ms | wasm ms | speedup |\n";
  md += "|---|---|---|---:|---:|---:|\n";
  const sortedAll = [...withPerf].sort((a, b) => {
    // WASM-accelerated first (by speedup desc), then JS-only (by js ms desc).
    if (a.perf.didWasm !== b.perf.didWasm) return a.perf.didWasm ? -1 : 1;
    if (a.perf.didWasm) return (b.perf.jsMs / b.perf.wasmMs) - (a.perf.jsMs / a.perf.wasmMs);
    return b.perf.jsMs - a.perf.jsMs;
  });
  for (const r of sortedAll) {
    md += `| ${r.displayName} | ${r.category} | ${r.perf.didWasm ? "✅ WASM" : "⚠️ JS"} | ${formatMs(r.perf.jsMs)} | ${formatMs(r.perf.wasmMs)} | ${formatSpeedup(r.perf.jsMs, r.perf.wasmMs)} |\n`;
  }
  md += "\n";

  const missing = filterResults.filter((r) => !r.perf);
  if (missing.length > 0) {
    md += "## No perf data\n\n";
    md += "These filters threw during the bench and have no numbers:\n\n";
    for (const r of missing) md += `- ${r.displayName} (${r.category})\n`;
    md += "\n";
  }

  return md;
};

const buildGalleryMarkdown = (filterResults: GalleryItem[], presetResults: GalleryItem[]) => {
  let md = "# Filter Gallery\n\n";
  md += "> Generated from `filterList` and `CHAIN_PRESETS` (browser-registry source of truth).\n\n";
  md += `> Static previews use \`pepper.png\`. Animated/temporal previews use a ${ANIMATED_PREVIEW_SECONDS}s sample from \`akiyo.mp4\` at ${ANIMATED_PREVIEW_FPS} FPS.\n\n`;
  md += `> Static simulation frames per item: ${PREVIEW_FRAMES}.\n\n`;
  md += `> Filter previews: ${filterResults.filter((r) => r.status === "ok").length}/${filterResults.length} available · `;
  md += `Preset previews: ${presetResults.filter((r) => r.status === "ok").length}/${presetResults.length} available.\n\n`;

  md += "## Filters\n\n";
  for (const category of getCategories(filterResults)) {
    const catFilters = filterResults.filter((r) => r.category === category);
    if (catFilters.length === 0) continue;
    md += `## ${category}\n\n`;
    md += buildGridSection(catFilters);
  }

  md += "## Presets\n\n";
  for (const category of PRESET_CATEGORIES) {
    const catPresets = presetResults.filter((r) => r.category === category);
    if (catPresets.length === 0) continue;
    md += `## ${category}\n\n`;
    md += buildGridSection(catPresets);
  }

  return md;
};

async function main() {
  if (WORKER_MODE) {
    await runWorkerMain();
    return;
  }

  const sourceCandidates = [
    path.resolve("public/pepper.png"),
    path.resolve("public/test-assets/image/pepper.png"),
  ];
  const sourcePath = sourceCandidates.find((p) => fs.existsSync(p));
  if (!sourcePath) {
    throw new Error(`Could not find source image. Tried:\n${sourceCandidates.join("\n")}`);
  }
  console.log(
    `Source image: ${path.relative(process.cwd(), sourcePath)} | workers=${DEFAULT_WORKER_COUNT} | per-worker concurrency=${DEFAULT_WORKER_ITEM_CONCURRENCY}`
  );

  const outputDir = path.resolve("docs/gallery");
  if (!BENCH_ONLY) {
    ensureOutputDirectories(outputDir);
  } else {
    // Bench-only: ensure the output dir exists but don't wipe the existing gallery.
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const allFilters = filterList.filter(Boolean) as FilterListEntry[];
  const tasks: GalleryTask[] = BENCH_ONLY
    ? allFilters.map((_, index) => ({ kind: "filters", index }) satisfies GalleryTask)
    : [
      ...allFilters.map((_, index) => ({ kind: "filters", index }) satisfies GalleryTask),
      ...CHAIN_PRESETS.map((_, index) => ({ kind: "presets", index }) satisfies GalleryTask),
    ];
  const workerResults = await runWorkerPool(tasks, outputDir);

  const filterResults = new Array<GalleryItem>(allFilters.length);
  const presetResults = new Array<GalleryItem>(CHAIN_PRESETS.length);
  for (const result of workerResults) {
    if (result.kind === "filters") filterResults[result.index] = result.item;
    else presetResults[result.index] = result.item;
  }

  // PERF.md is always written (bench runs in both modes). It's gitignored by
  // default so running this doesn't pollute git.
  const perfMd = buildPerfMarkdown(filterResults);
  fs.writeFileSync(path.resolve("docs/gallery/PERF.md"), perfMd);

  if (BENCH_ONLY) {
    const benched = filterResults.filter((r) => r?.perf).length;
    console.log(
      `\nBench-only: ${benched}/${filterResults.length} filters measured -> docs/gallery/PERF.md`
    );
    return;
  }

  const md = buildGalleryMarkdown(filterResults, presetResults);
  fs.writeFileSync(path.resolve("docs/gallery/GALLERY.md"), md);
  console.log(
    `\nDone: ${filterResults.length} filters + ${presetResults.length} presets -> docs/gallery/ + docs/gallery/GALLERY.md + docs/gallery/PERF.md`
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
