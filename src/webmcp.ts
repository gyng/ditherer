import { CHAIN_PRESETS, type PresetFilterEntry } from "components/ChainList/presets";

type FilterListEntry = {
  displayName: string;
  category: string;
  description?: string;
  filter: {
    defaults?: Record<string, unknown>;
    options?: Record<string, unknown>;
  };
};

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args?: unknown) => unknown | Promise<unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

type ModelContextLike = {
  registerTool: (tool: WebMCPTool) => void;
  unregisterTool: (toolName: string) => void;
};

declare global {
  interface Navigator {
    modelContext?: ModelContextLike;
  }
}

export type WebMCPBindings = {
  getState: () => any;
  getActions: () => any;
  getFilterList: () => FilterListEntry[];
  getOutputCanvas: () => HTMLCanvasElement | null;
};

const TOOL_PREFIX = "ditherer.";

const getModelContext = (): ModelContextLike | null => {
  if (typeof window === "undefined") return null;
  return navigator.modelContext || null;
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });

const dataUrlToFile = (dataUrl: string, filename: string, mimeType?: string): File => {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) throw new Error("Invalid dataUrl");
  const detectedMime = match[1] || mimeType || "application/octet-stream";
  const payload = match[2] || "";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mimeType || detectedMime });
};

const resolvePresetFilter = (filterList: FilterListEntry[], entry: PresetFilterEntry) => {
  const found = filterList.find((f) => f.displayName === entry.name);
  if (!found) return null;
  return {
    displayName: entry.name,
    filter: {
      ...found.filter,
      options: {
        ...(found.filter.defaults || found.filter.options || {}),
        ...(entry.options || {}),
      },
    },
  };
};

const pickRecorderMimeType = (requested?: string) => {
  const candidates = [
    requested,
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].filter(Boolean) as string[];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
};

const recordCanvas = async (
  canvas: HTMLCanvasElement,
  durationSeconds: number,
  fps: number,
  mimeType?: string,
): Promise<Blob> => {
  const stream = canvas.captureStream(Math.max(1, fps));
  const chosenMime = pickRecorderMimeType(mimeType);
  const recorder = new MediaRecorder(stream, { mimeType: chosenMime });
  const chunks: BlobPart[] = [];

  await new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error("MediaRecorder failed"));
    recorder.onstop = () => resolve();
    recorder.start(100);
    window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    }, Math.max(200, durationSeconds * 1000));
  });

  return new Blob(chunks, { type: chosenMime });
};

const tools = (bindings: WebMCPBindings): WebMCPTool[] => [
  {
    name: `${TOOL_PREFIX}listFilters`,
    description: "List available filters and optional category/query matching.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        query: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async (rawArgs) => {
      const args = (rawArgs || {}) as { category?: string; query?: string };
      const category = args.category?.trim().toLowerCase();
      const query = args.query?.trim().toLowerCase();
      const list = bindings.getFilterList().filter((f) => {
        if (category && f.category.toLowerCase() !== category) return false;
        if (query) {
          const haystack = `${f.displayName} ${f.category} ${f.description || ""}`.toLowerCase();
          return haystack.includes(query);
        }
        return true;
      });
      return {
        count: list.length,
        filters: list.map((f) => ({
          name: f.displayName,
          category: f.category,
          description: f.description || "",
        })),
      };
    },
  },
  {
    name: `${TOOL_PREFIX}listPresets`,
    description: "List available chain presets and optional query/category matching.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        query: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async (rawArgs) => {
      const args = (rawArgs || {}) as { category?: string; query?: string };
      const category = args.category?.trim().toLowerCase();
      const query = args.query?.trim().toLowerCase();
      const presets = CHAIN_PRESETS.filter((p) => {
        if (category && p.category.toLowerCase() !== category) return false;
        if (!query) return true;
        const haystack = `${p.name} ${p.category} ${p.desc}`.toLowerCase();
        return haystack.includes(query);
      });
      return {
        count: presets.length,
        presets: presets.map((p) => ({
          name: p.name,
          category: p.category,
          description: p.desc,
          filters: p.filters.map((f) => f.name),
        })),
      };
    },
  },
  {
    name: `${TOOL_PREFIX}getCurrentChain`,
    description: "Get the currently active filter chain and selected index.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const state = bindings.getState();
      return {
        activeIndex: state.activeIndex,
        chain: (state.chain || []).map((entry: any, index: number) => ({
          index,
          id: entry.id,
          enabled: entry.enabled !== false,
          displayName: entry.displayName,
          options: entry.filter?.options || {},
        })),
      };
    },
  },
  {
    name: `${TOOL_PREFIX}applyPreset`,
    description: "Apply a named chain preset by replacing the current chain.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Preset name from listPresets." },
      },
    },
    execute: async (rawArgs) => {
      const args = (rawArgs || {}) as { name?: string };
      const name = (args.name || "").trim();
      if (!name) throw new Error("Preset name is required");
      const preset = CHAIN_PRESETS.find((p) => p.name === name);
      if (!preset) throw new Error(`Preset not found: ${name}`);
      if (preset.filters.length === 0) throw new Error(`Preset has no filters: ${name}`);

      const actions = bindings.getActions();
      const filterList = bindings.getFilterList();
      const first = resolvePresetFilter(filterList, preset.filters[0]);
      if (!first) throw new Error(`Missing filter "${preset.filters[0].name}" for preset "${name}"`);
      actions.selectFilter(first.displayName, first.filter);
      for (let i = 1; i < preset.filters.length; i++) {
        const resolved = resolvePresetFilter(filterList, preset.filters[i]);
        if (resolved) actions.chainAdd(resolved.displayName, resolved.filter);
      }
      return { ok: true, preset: name, filtersApplied: preset.filters.length };
    },
  },
  {
    name: `${TOOL_PREFIX}setFilterOption`,
    description: "Set a filter option by chain index and option name.",
    inputSchema: {
      type: "object",
      required: ["index", "optionName", "value"],
      properties: {
        index: { type: "number", description: "0-based chain index." },
        optionName: { type: "string" },
        value: { description: "New option value." },
      },
    },
    execute: async (rawArgs) => {
      const args = (rawArgs || {}) as { index?: number; optionName?: string; value?: unknown };
      const index = Number(args.index);
      const optionName = String(args.optionName || "");
      if (!Number.isInteger(index) || index < 0) throw new Error("index must be a non-negative integer");
      if (!optionName) throw new Error("optionName is required");

      const state = bindings.getState();
      const entry = state.chain?.[index];
      if (!entry) throw new Error(`No chain entry at index ${index}`);
      bindings.getActions().setFilterOption(optionName, args.value, index);
      return { ok: true, index, optionName, value: args.value };
    },
  },
  {
    name: `${TOOL_PREFIX}loadMedia`,
    description: "Load an image/video into the app from URL or data URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Remote or relative URL to media." },
        dataUrl: { type: "string", description: "data:* base64 string for media." },
        filename: { type: "string" },
        mimeType: { type: "string" },
        volume: { type: "number" },
        playbackRate: { type: "number" },
      },
    },
    execute: async (rawArgs) => {
      const args = (rawArgs || {}) as {
        url?: string;
        dataUrl?: string;
        filename?: string;
        mimeType?: string;
        volume?: number;
        playbackRate?: number;
      };
      const actions = bindings.getActions();
      const state = bindings.getState();
      const volume = typeof args.volume === "number" ? args.volume : state.videoVolume;
      const playbackRate = typeof args.playbackRate === "number" ? args.playbackRate : state.videoPlaybackRate;

      let file: File;
      if (args.url) {
        const res = await fetch(args.url);
        if (!res.ok) throw new Error(`Failed to fetch media: ${res.status}`);
        const blob = await res.blob();
        const inferredName = args.filename || args.url.split("/").pop() || "media";
        file = new File([blob], inferredName, { type: args.mimeType || blob.type || "application/octet-stream" });
      } else if (args.dataUrl) {
        file = dataUrlToFile(args.dataUrl, args.filename || "uploaded-media", args.mimeType);
      } else {
        throw new Error("Provide either url or dataUrl");
      }

      await actions.loadMediaAsync(file, volume, playbackRate);
      return {
        ok: true,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      };
    },
  },
  {
    name: `${TOOL_PREFIX}exportImage`,
    description: "Export current filtered output frame as an image.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["png", "jpeg", "webp"] },
        quality: { type: "number" },
        filename: { type: "string" },
        download: { type: "boolean" },
        returnDataUrl: { type: "boolean" },
      },
    },
    execute: async (rawArgs) => {
      const args = (rawArgs || {}) as {
        format?: "png" | "jpeg" | "webp";
        quality?: number;
        filename?: string;
        download?: boolean;
        returnDataUrl?: boolean;
      };
      const canvas = bindings.getOutputCanvas();
      if (!canvas || canvas.width === 0 || canvas.height === 0) throw new Error("No output canvas to export");
      const format = args.format || "png";
      const mimeType = `image/${format}`;
      const quality = typeof args.quality === "number" ? args.quality : 0.92;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to export image"))), mimeType, format === "png" ? undefined : quality);
      });

      if (args.download) {
        triggerDownload(blob, args.filename || `ditherer-export.${format}`);
      }
      return {
        ok: true,
        mimeType,
        width: canvas.width,
        height: canvas.height,
        sizeBytes: blob.size,
        dataUrl: args.returnDataUrl ? await blobToDataUrl(blob) : undefined,
      };
    },
  },
  {
    name: `${TOOL_PREFIX}exportVideo`,
    description: "Record current filtered output canvas as a short video clip.",
    inputSchema: {
      type: "object",
      properties: {
        durationSeconds: { type: "number", description: "Clip duration in seconds." },
        fps: { type: "number", description: "Recording FPS." },
        mimeType: { type: "string", description: "Optional preferred MIME type." },
        filename: { type: "string" },
        download: { type: "boolean" },
        returnDataUrl: { type: "boolean" },
      },
    },
    execute: async (rawArgs) => {
      const args = (rawArgs || {}) as {
        durationSeconds?: number;
        fps?: number;
        mimeType?: string;
        filename?: string;
        download?: boolean;
        returnDataUrl?: boolean;
      };
      const canvas = bindings.getOutputCanvas();
      if (!canvas || canvas.width === 0 || canvas.height === 0) throw new Error("No output canvas to export");

      const state = bindings.getState();
      const fallbackDuration = state.video && Number.isFinite(state.video.duration) && state.video.duration > 0
        ? Math.min(15, state.video.duration)
        : 5;
      const durationSeconds = Math.max(0.25, Number(args.durationSeconds || fallbackDuration));
      const fps = Math.max(1, Math.round(args.fps || 30));
      const blob = await recordCanvas(canvas, durationSeconds, fps, args.mimeType);

      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      if (args.download) {
        triggerDownload(blob, args.filename || `ditherer-export.${ext}`);
      }
      return {
        ok: true,
        mimeType: blob.type || pickRecorderMimeType(args.mimeType),
        durationSeconds,
        fps,
        width: canvas.width,
        height: canvas.height,
        sizeBytes: blob.size,
        dataUrl: args.returnDataUrl ? await blobToDataUrl(blob) : undefined,
      };
    },
  },
];

export const setupWebMCP = (bindings: WebMCPBindings): (() => void) => {
  const modelContext = getModelContext();
  if (!modelContext) return () => {};

  const registeredNames: string[] = [];
  for (const tool of tools(bindings)) {
    try {
      modelContext.registerTool(tool);
      registeredNames.push(tool.name);
    } catch (error) {
      console.warn(`[webmcp] Failed to register tool "${tool.name}"`, error);
    }
  }

  return () => {
    for (const name of registeredNames) {
      try {
        modelContext.unregisterTool(name);
      } catch {
        // ignore teardown errors
      }
    }
  };
};

