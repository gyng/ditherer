/**
 * Generate a static gallery using the same registries as the in-app browser:
 * - Filters from `filterList`
 * - Presets from `CHAIN_PRESETS`
 * Outputs PNG thumbnails + docs/GALLERY.md.
 *
 * Usage: npm run gallery   (runs via vite-node)
 */

// -- Polyfill browser globals BEFORE any filter/util imports --
import { createCanvas, loadImage, ImageData as NodeImageData } from "canvas";

(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return createCanvas(1, 1);
    throw new Error(`Unsupported element: ${tag}`);
  },
};
(globalThis as any).ImageData = NodeImageData;

// Now safe to import filters/presets (they use document.createElement via cloneCanvas)
import { filterList } from "filters";
import { CHAIN_PRESETS, PRESET_CATEGORIES } from "../src/components/ChainList/presets";
import { cloneCanvas } from "utils";
import path from "path";
import fs from "fs";
import os from "os";

const THUMB_WIDTH = 256;
const PREVIEW_FRAMES = 8;
const EMA_ALPHA = 0.1;
const CPU_DEFAULT_CONCURRENCY = Math.min(32, Math.max(8, os.cpus().length * 2));
const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number(process.env.GALLERY_CONCURRENCY || String(CPU_DEFAULT_CONCURRENCY))
);
const PROGRESS_EVERY = Math.max(1, Number(process.env.GALLERY_PROGRESS_EVERY || "25"));

type GalleryItem = {
  displayName: string;
  category: string;
  filename: string | null;
  description: string;
  status: "ok" | "unavailable";
};

type FilterListEntry = (typeof filterList)[number];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/, "");

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

const hasAnimatedOption = (entry: FilterListEntry) =>
  Boolean((entry.filter.optionTypes as any)?.animate);

const hasTemporalBehavior = (entry: FilterListEntry) =>
  (entry.filter as any).mainThread === true;

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
    for (let j = 0; j < ema.length; j++) {
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
  let result: HTMLCanvasElement = cloneCanvas(sourceCanvas, true) as any;

  for (let frame = 0; frame < PREVIEW_FRAMES; frame++) {
    const inputFrame = cloneCanvas(sourceCanvas, true) as any;
    const inCtx = inputFrame.getContext("2d");
    const inPixels = inCtx ? inCtx.getImageData(0, 0, inputFrame.width, inputFrame.height).data : null;
    const opts = {
      ...resolveFilterOptions(entry.filter),
      _frameIndex: frame,
      _isAnimating: isAnimatingPreview,
      _hasVideoInput: isAnimatingPreview,
      _prevInput: prevInputByKey.get(key) || null,
      _prevOutput: prevOutputByKey.get(key) || null,
      _ema: emaByKey.get(key) || null,
    };
    const maybe = (entry.filter.func as any)(inputFrame, opts, undefined);
    if (!(maybe instanceof Object) || typeof (maybe as any).getContext !== "function") {
      // async/sentinel unsupported in static gallery render
      return null;
    }
    result = maybe as HTMLCanvasElement;
    if (needsTemporal && inPixels) {
      updateTemporalState(
        key,
        inPixels,
        result,
        prevInputByKey,
        prevOutputByKey,
        emaByKey
      );
    }
  }

  return result;
};

const runPresetPreview = (
  sourceCanvas: HTMLCanvasElement,
  preset: (typeof CHAIN_PRESETS)[number],
  filterByName: Map<string, FilterListEntry>
): HTMLCanvasElement | null => {
  const prevInputByKey = new Map<string, Uint8ClampedArray>();
  const prevOutputByKey = new Map<string, Uint8ClampedArray>();
  const emaByKey = new Map<string, Float32Array>();
  let result: HTMLCanvasElement = cloneCanvas(sourceCanvas, true) as any;

  for (let frame = 0; frame < PREVIEW_FRAMES; frame++) {
    let pipeline = cloneCanvas(sourceCanvas, true) as any;
    for (let idx = 0; idx < preset.filters.length; idx++) {
      const presetEntry = preset.filters[idx];
      const match = filterByName.get(presetEntry.name);
      if (!match) continue;
      const key = `preset:${preset.name}:${idx}:${presetEntry.name}`;
      const needsTemporal = hasTemporalBehavior(match);
      const isAnimatingPreview = needsTemporal || hasAnimatedOption(match);
      const inCtx = pipeline.getContext("2d");
      const inPixels = inCtx ? inCtx.getImageData(0, 0, pipeline.width, pipeline.height).data : null;
      const opts = {
        ...resolveFilterOptions(match.filter, presetEntry.options),
        _frameIndex: frame,
        _isAnimating: isAnimatingPreview,
        _hasVideoInput: isAnimatingPreview,
        _prevInput: prevInputByKey.get(key) || null,
        _prevOutput: prevOutputByKey.get(key) || null,
        _ema: emaByKey.get(key) || null,
      };
      const maybe = (match.filter.func as any)(pipeline, opts, undefined);
      if (!(maybe instanceof Object) || typeof (maybe as any).getContext !== "function") {
        return null;
      }
      pipeline = maybe as HTMLCanvasElement;
      if (needsTemporal && inPixels) {
        updateTemporalState(
          key,
          inPixels,
          pipeline,
          prevInputByKey,
          prevOutputByKey,
          emaByKey
        );
      }
    }
    result = pipeline;
  }

  return result;
};

const buildGridSection = (items: GalleryItem[]) => {
  let md = "| | | |\n|---|---|---|\n";
  for (let i = 0; i < items.length; i += 3) {
    const row = items.slice(i, i + 3);
    const cells = row.map((item) => {
      const imagePart = item.filename
        ? `![${item.displayName}](gallery/${item.filename})`
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
    (canvas as any).toBuffer((err: Error | null, buf: Buffer) => {
      if (err) reject(err);
      else resolve(buf);
    }, "image/png");
  });

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

async function main() {
  // Load source image
  const sourceCandidates = [
    path.resolve("public/pepper.png"),
    path.resolve("public/test-assets/image/pepper.png"),
  ];
  const sourcePath = sourceCandidates.find((p) => fs.existsSync(p));
  if (!sourcePath) {
    throw new Error(`Could not find source image. Tried:\n${sourceCandidates.join("\n")}`);
  }
  const img = await loadImage(sourcePath);
  console.log(`Source image: ${path.relative(process.cwd(), sourcePath)} | concurrency=${DEFAULT_CONCURRENCY}`);
  const scale = THUMB_WIDTH / img.width;
  const thumbH = Math.round(img.height * scale);
  const sourceCanvas = createCanvas(THUMB_WIDTH, thumbH);
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.drawImage(img, 0, 0, THUMB_WIDTH, thumbH);

  const outputDir = path.resolve("docs/gallery");
  fs.mkdirSync(outputDir, { recursive: true });
  for (const file of fs.readdirSync(outputDir)) {
    if (file.endsWith(".png")) {
      fs.rmSync(path.join(outputDir, file), { force: true });
    }
  }

  const filterByName = new Map((filterList.filter(Boolean) as FilterListEntry[]).map((entry) => [entry.displayName, entry] as const));

  const allFilters = filterList.filter(Boolean) as FilterListEntry[];
  let filterDone = 0;
  const filterResults = await runWithConcurrency(allFilters, DEFAULT_CONCURRENCY, async (entry) => {
    try {
      const result = runFilterPreview(entry, sourceCanvas as any);
      if (!result) {
        filterDone += 1;
        if (filterDone % PROGRESS_EVERY === 0 || filterDone === allFilters.length) {
          console.log(`Filters: ${filterDone}/${allFilters.length}`);
        }
        return {
          displayName: entry.displayName,
          category: entry.category,
          filename: null,
          description: entry.description,
          status: "unavailable",
        } satisfies GalleryItem;
      }
      const filename = `filter-${slugify(entry.displayName)}.png`;
      const png = await toPngBufferAsync(result);
      await fs.promises.writeFile(path.join(outputDir, filename), png);
      filterDone += 1;
      if (filterDone % PROGRESS_EVERY === 0 || filterDone === allFilters.length) {
        console.log(`Filters: ${filterDone}/${allFilters.length}`);
      }
      return {
        displayName: entry.displayName,
        category: entry.category,
        filename,
        description: entry.description,
        status: "ok",
      } satisfies GalleryItem;
    } catch (err: any) {
      filterDone += 1;
      if (filterDone % PROGRESS_EVERY === 0 || filterDone === allFilters.length) {
        console.log(`Filters: ${filterDone}/${allFilters.length}`);
      }
      console.error(`FAIL: filter ${entry.displayName}: ${err.message}`);
      return {
        displayName: entry.displayName,
        category: entry.category,
        filename: null,
        description: entry.description,
        status: "unavailable",
      } satisfies GalleryItem;
    }
  });

  let presetDone = 0;
  const presetResults = await runWithConcurrency(CHAIN_PRESETS, DEFAULT_CONCURRENCY, async (preset) => {
    try {
      const result = runPresetPreview(sourceCanvas as any, preset, filterByName);
      if (!result) {
        presetDone += 1;
        if (presetDone % PROGRESS_EVERY === 0 || presetDone === CHAIN_PRESETS.length) {
          console.log(`Presets: ${presetDone}/${CHAIN_PRESETS.length}`);
        }
        return {
          displayName: preset.name,
          category: preset.category,
          filename: null,
          description: preset.desc,
          status: "unavailable",
        } satisfies GalleryItem;
      }
      const filename = `preset-${slugify(preset.name)}.png`;
      const png = await toPngBufferAsync(result);
      await fs.promises.writeFile(path.join(outputDir, filename), png);
      presetDone += 1;
      if (presetDone % PROGRESS_EVERY === 0 || presetDone === CHAIN_PRESETS.length) {
        console.log(`Presets: ${presetDone}/${CHAIN_PRESETS.length}`);
      }
      return {
        displayName: preset.name,
        category: preset.category,
        filename,
        description: preset.desc,
        status: "ok",
      } satisfies GalleryItem;
    } catch (err: any) {
      presetDone += 1;
      if (presetDone % PROGRESS_EVERY === 0 || presetDone === CHAIN_PRESETS.length) {
        console.log(`Presets: ${presetDone}/${CHAIN_PRESETS.length}`);
      }
      console.error(`FAIL: preset ${preset.name}: ${err.message}`);
      return {
        displayName: preset.name,
        category: preset.category,
        filename: null,
        description: preset.desc,
        status: "unavailable",
      } satisfies GalleryItem;
    }
  });

  // Generate markdown
  let md = "# Filter Gallery\n\n";
  md += "> Generated from `filterList` and `CHAIN_PRESETS` (browser-registry source of truth).\n\n";
  md += `> Source image: \`pepper.png\` · Simulated preview frames per item: ${PREVIEW_FRAMES}.\n\n`;
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

  fs.writeFileSync(path.resolve("docs/GALLERY.md"), md);
  console.log(
    `\nDone: ${filterResults.length} filters + ${presetResults.length} presets -> docs/gallery/ + docs/GALLERY.md`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
