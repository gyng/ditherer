import { useEffect, useMemo, useRef, useState } from "react";
import { BOOL, COLOR, ENUM, RANGE, STRING, TEXT } from "constants/controlTypes";
import { filterList, hasTemporalBehavior } from "filters";
import type {
  ActionOptionDefinition,
  EnumOption,
  EnumOptionDefinition,
  EnumOptionGroup,
  FilterDefinition,
  FilterFunction,
  FilterOptionDefinition,
  FilterOptionDefinitions,
  FilterOptionValues,
  RangeOptionDefinition,
} from "filters/types";
import { CHAIN_PRESETS, PRESET_CATEGORIES, type ChainPreset } from "./presets";
import s from "./libraryBrowser.module.css";

type FilterEntry = (typeof filterList)[number];
const ALL_FILTERS = filterList.filter((f) => f) as FilterEntry[];
const FILTER_CATEGORIES = ["All", ...new Set(ALL_FILTERS.map((f) => f.category))];
const testAssetUrl = (kind: "image" | "video", file: string) =>
  `${import.meta.env.BASE_URL}test-assets/${kind}/${file}`;
const FALLBACK_IMAGE_SRC = testAssetUrl("image", "pepper.png");
const FALLBACK_VIDEO_SRC = testAssetUrl("video", "akiyo.mp4");

interface Props {
  open: boolean;
  onClose: () => void;
  onAddFilter: (entry: FilterEntry) => void;
  onLoadPreset: (preset: ChainPreset) => void;
  onDialogMouseDown?: (event: React.MouseEvent) => void;
  initialTab?: "filters" | "presets";
  initialQuery?: string;
  previewSource?: HTMLImageElement | HTMLCanvasElement | null;
  previewVideo?: HTMLVideoElement | null;
}

const includesNeedle = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase());

const hasAnimatedOption = (entry: FilterEntry) =>
  Boolean(
    (entry.filter.optionTypes as FilterOptionDefinitions | undefined)?.["animate"] &&
    isActionOption((entry.filter.optionTypes as FilterOptionDefinitions)["animate"])
  );

const isActionOption = (option: FilterOptionDefinition): option is ActionOptionDefinition =>
  option.type === "ACTION" && typeof (option as ActionOptionDefinition).action === "function";

const isEnumOption = (option: FilterOptionDefinition): option is EnumOptionDefinition =>
  option.type === ENUM && Array.isArray((option as EnumOptionDefinition).options);

const isEnumOptionGroup = (option: EnumOption | EnumOptionGroup): option is EnumOptionGroup =>
  Array.isArray((option as EnumOptionGroup).options);

const isRangeOption = (option: FilterOptionDefinition): option is RangeOptionDefinition =>
  option.type === RANGE && Array.isArray((option as RangeOptionDefinition).range);

const getPreviewSourceSize = (source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement) => {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth || 0, height: source.videoHeight || 0 };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth || source.width || 0, height: source.naturalHeight || source.height || 0 };
  }
  return { width: source.width || 0, height: source.height || 0 };
};

const formatOptionValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => formatOptionValue(v)).join(", ")}]`;
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value == null) return "null";
  return String(value);
};

const resolveFilterOptions = (
  filter: Pick<FilterDefinition, "defaults" | "options">,
  overrideOptions?: FilterOptionValues
) => ({
  ...(filter.defaults || {}),
  ...(filter.options || {}),
  ...(overrideOptions || {}),
});

const rgbToHex = (rgb: number[]) =>
  `#${rgb.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((c) => `${c}${c}`).join("")
    : clean;
  const n = Number.parseInt(value, 16);
  return [
    Number.isFinite(n) ? (n >> 16) & 255 : 0,
    Number.isFinite(n) ? (n >> 8) & 255 : 0,
    Number.isFinite(n) ? n & 255 : 0,
  ];
};

const getFilterOptionRows = (
  entry: FilterEntry,
  overrideOptions?: FilterOptionValues
) => {
  const optionTypes: FilterOptionDefinitions = entry.filter.optionTypes || {};
  const resolvedOptions = resolveFilterOptions(entry.filter, overrideOptions);

  return Object.entries(optionTypes)
    .filter(([name]) => !name.startsWith("_"))
    .map(([name, spec]) => {
      return {
        name,
        rawValue: resolvedOptions[name],
        value: formatOptionValue(resolvedOptions[name]),
        type: spec.type,
        optionSpec: spec,
        desc: spec.desc || "No help text.",
      };
    });
};

const LibraryBrowser = ({
  open,
  onClose,
  onAddFilter,
  onLoadPreset,
  onDialogMouseDown,
  initialTab = "filters",
  initialQuery = "",
  previewSource = null,
  previewVideo = null,
}: Props) => {
  const filterByName = useMemo(
    () => new Map(ALL_FILTERS.map((entry) => [entry.displayName, entry] as const)),
    []
  );
  const [tab, setTab] = useState<"filters" | "presets">("filters");
  const [query, setQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [presetCategory, setPresetCategory] = useState("All");
  const [selectedFilterName, setSelectedFilterName] = useState<string | null>(null);
  const [selectedPresetName, setSelectedPresetName] = useState<string | null>(null);
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, FilterOptionValues>>({});
  const [fallbackImage, setFallbackImage] = useState<HTMLImageElement | null>(null);
  const [fallbackVideo, setFallbackVideo] = useState<HTMLVideoElement | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  const filteredFilters = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ALL_FILTERS.filter((entry) => {
      if (!needle && filterCategory !== "All" && entry.category !== filterCategory) return false;
      if (!needle) return true;
      const anim = hasAnimatedOption(entry);
      const temp = hasTemporalBehavior(entry);
      const tagSearch = `${anim ? "animated anim" : ""} ${temp ? "temporal temp" : ""}`;
      return (
        includesNeedle(entry.displayName, needle) ||
        includesNeedle(entry.category, needle) ||
        includesNeedle(entry.description || "", needle) ||
        includesNeedle(tagSearch, needle)
      );
    });
  }, [filterCategory, query]);

  const filteredPresets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CHAIN_PRESETS.filter((preset) => {
      if (!needle && presetCategory !== "All" && preset.category !== presetCategory) return false;
      if (!needle) return true;
      const presetFlags = preset.filters.reduce(
        (acc, presetFilter) => {
          const match = filterByName.get(presetFilter.name);
          if (!match) return acc;
          return {
            anim: acc.anim || hasAnimatedOption(match),
            temp: acc.temp || hasTemporalBehavior(match),
          };
        },
        { anim: false, temp: false }
      );
      const tagSearch = `${presetFlags.anim ? "animated anim" : ""} ${presetFlags.temp ? "temporal temp" : ""}`;
      return (
        includesNeedle(preset.name, needle) ||
        includesNeedle(preset.category, needle) ||
        includesNeedle(preset.desc, needle) ||
        preset.filters.some((f) => includesNeedle(f.name, needle)) ||
        includesNeedle(tagSearch, needle)
      );
    });
  }, [filterByName, presetCategory, query]);

  const selectedFilter =
    filteredFilters.find((entry) => entry.displayName === selectedFilterName) || filteredFilters[0] || null;
  const selectedPreset =
    filteredPresets.find((preset) => preset.name === selectedPresetName) || filteredPresets[0] || null;
  const selectedFilterOverride = selectedFilter ? previewOverrides[selectedFilter.displayName] : undefined;
  const selectedFilterResolvedOptions = selectedFilter
    ? resolveFilterOptions(selectedFilter.filter, selectedFilterOverride)
    : undefined;
  const selectedFilterOptions = selectedFilter
    ? getFilterOptionRows(selectedFilter, selectedFilterOverride)
    : [];
  const presetsUsingSelectedFilter = useMemo(() => {
    if (!selectedFilter) return [];
    return CHAIN_PRESETS.filter((preset) =>
      preset.filters.some((entry) => entry.name === selectedFilter.displayName)
    );
  }, [selectedFilter]);

  const setPreviewOption = (filterName: string, optionName: string, value: unknown) => {
    setPreviewOverrides((prev) => ({
      ...prev,
      [filterName]: {
        ...(prev[filterName] || {}),
        [optionName]: value,
      },
    }));
  };

  const queryFilteredFilterCount = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ALL_FILTERS.length;
    return ALL_FILTERS.filter((entry) =>
      includesNeedle(entry.displayName, needle) ||
      includesNeedle(entry.category, needle) ||
      includesNeedle(entry.description || "", needle) ||
      includesNeedle(
        `${hasAnimatedOption(entry) ? "animated anim" : ""} ${hasTemporalBehavior(entry) ? "temporal temp" : ""}`,
        needle
      )
    ).length;
  }, [query]);

  const queryFilteredPresetCount = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return CHAIN_PRESETS.length;
    return CHAIN_PRESETS.filter((preset) => {
      const presetFlags = preset.filters.reduce(
        (acc, presetFilter) => {
          const match = filterByName.get(presetFilter.name);
          if (!match) return acc;
          return {
            anim: acc.anim || hasAnimatedOption(match),
            temp: acc.temp || hasTemporalBehavior(match),
          };
        },
        { anim: false, temp: false }
      );
      const tagSearch = `${presetFlags.anim ? "animated anim" : ""} ${presetFlags.temp ? "temporal temp" : ""}`;
      return (
        includesNeedle(preset.name, needle) ||
        includesNeedle(preset.category, needle) ||
        includesNeedle(preset.desc, needle) ||
        preset.filters.some((f) => includesNeedle(f.name, needle)) ||
        includesNeedle(tagSearch, needle)
      );
    }).length;
  }, [filterByName, query]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setQuery(initialQuery);
    if (initialTab === "presets") {
      setPresetCategory("All");
    } else {
      setFilterCategory("All");
    }
  }, [open, initialTab, initialQuery]);

  useEffect(() => {
    if (!open) return;
    queryRef.current?.focus();
  }, [open, tab]);

  useEffect(() => {
    if (open) return;
    setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "filters") return;
    if (!selectedFilter && filteredFilters.length > 0) {
      setSelectedFilterName(filteredFilters[0].displayName);
    }
  }, [open, tab, selectedFilter, filteredFilters]);

  useEffect(() => {
    if (!open || tab !== "presets") return;
    if (!selectedPreset && filteredPresets.length > 0) {
      setSelectedPresetName(filteredPresets[0].name);
    }
  }, [open, tab, selectedPreset, filteredPresets]);

  useEffect(() => {
    if (!open) return;
    detailsRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [open, tab, selectedFilterName, selectedPresetName]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || fallbackImage) return;
    const img = new Image();
    img.onload = () => setFallbackImage(img);
    img.src = FALLBACK_IMAGE_SRC;
  }, [open, fallbackImage]);

  useEffect(() => {
    if (!open || fallbackVideo) return;
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.src = FALLBACK_VIDEO_SRC;
    video.oncanplay = () => {
      video.play().catch(() => {});
      setFallbackVideo(video);
    };
  }, [open, fallbackVideo]);

  useEffect(() => {
    if (!open) return;
    const outputCanvas = previewCanvasRef.current;
    if (!outputCanvas) return;
    const outCtx = outputCanvas.getContext("2d");
    if (!outCtx) return;

    const drawFallback = (message = "Load an image/video to preview filters") => {
      outCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      outCtx.fillStyle = "#efefef";
      outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
      outCtx.fillStyle = "#222";
      outCtx.font = "11px sans-serif";
      outCtx.textAlign = "center";
      outCtx.fillText(message, outputCanvas.width / 2, outputCanvas.height / 2);
    };

    const selectedFilterNeedsVideo = tab === "filters" && !!selectedFilter && (
      hasAnimatedOption(selectedFilter) || hasTemporalBehavior(selectedFilter)
    );
    const selectedPresetNeedsVideo = tab === "presets" && !!selectedPreset && selectedPreset.filters.some((presetFilter) => {
      const match = filterByName.get(presetFilter.name);
      return !!match && (hasAnimatedOption(match) || hasTemporalBehavior(match));
    });
    const activeVideo = previewVideo || ((selectedFilterNeedsVideo || selectedPresetNeedsVideo) ? fallbackVideo : null);
    const activeSource = previewSource || fallbackImage;

    if (!activeVideo && !activeSource) {
      drawFallback();
      return;
    }

    let rafId = 0;
    let lastTs = 0;
    const targetInterval = 1000 / 15;
    let previewFrameIndex = 0;
    const prevInputByKey = new Map<string, Uint8ClampedArray>();
    const prevOutputByKey = new Map<string, Uint8ClampedArray>();
    const emaByKey = new Map<string, Float32Array>();
    const EMA_ALPHA = 0.1;

    const updateTemporalState = (
      key: string,
      inputPixels: Uint8ClampedArray,
      outputCanvas: HTMLCanvasElement
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

    const drawFromSource = (source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement) => {
      if (source instanceof HTMLVideoElement && source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        drawFallback("Video preview not ready");
        return;
      }

      const { width: sourceWidth, height: sourceHeight } = getPreviewSourceSize(source);
      if (!sourceWidth || !sourceHeight) {
        drawFallback("Preview unavailable");
        return;
      }

      const work = document.createElement("canvas");
      const maxWork = 300;
      const scale = Math.min(1, maxWork / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      work.width = width;
      work.height = height;
      const workCtx = work.getContext("2d");
      if (!workCtx) {
        drawFallback("Preview unavailable");
        return;
      }
      workCtx.drawImage(source, 0, 0, width, height);

      let result = work;
      const isAnimatingPreview = Boolean(activeVideo);
      const hasVideoInput = Boolean(activeVideo);
      if (tab === "filters") {
        if (!selectedFilter) {
          drawFallback("Select a filter to preview");
          return;
        }
        try {
          const key = `filter:${selectedFilter.displayName}`;
          const opts = {
            ...(selectedFilterResolvedOptions || resolveFilterOptions(selectedFilter.filter)),
            _frameIndex: previewFrameIndex,
            _isAnimating: isAnimatingPreview,
            _hasVideoInput: hasVideoInput,
            _prevInput: prevInputByKey.get(key) || null,
            _prevOutput: prevOutputByKey.get(key) || null,
            _ema: emaByKey.get(key) || null,
          };
          const inCtxStep = work.getContext("2d");
          const inPixels = inCtxStep ? inCtxStep.getImageData(0, 0, work.width, work.height).data : null;
          const maybe = (selectedFilter.filter.func as FilterFunction)(work, opts, undefined);
          if (maybe instanceof HTMLCanvasElement) {
            result = maybe;
            if (inPixels && hasTemporalBehavior(selectedFilter)) {
              updateTemporalState(key, inPixels, maybe);
            }
          }
        } catch (error) {
          console.warn("Filter preview failed:", error);
        }
      } else if (tab === "presets") {
        if (!selectedPreset) {
          drawFallback("Select a preset to preview");
          return;
        }
        try {
          let pipeline = work;
          for (let idx = 0; idx < selectedPreset.filters.length; idx++) {
            const presetEntry = selectedPreset.filters[idx];
            const match = ALL_FILTERS.find((entry) => entry.displayName === presetEntry.name);
            if (!match) continue;
            const key = `preset:${selectedPreset.name}:${idx}:${presetEntry.name}`;
            const inCtxStep = pipeline.getContext("2d");
            const inPixels = inCtxStep ? inCtxStep.getImageData(0, 0, pipeline.width, pipeline.height).data : null;
            const opts = {
              ...resolveFilterOptions(match.filter, presetEntry.options),
              _frameIndex: previewFrameIndex,
              _isAnimating: isAnimatingPreview,
              _hasVideoInput: hasVideoInput,
              _prevInput: prevInputByKey.get(key) || null,
              _prevOutput: prevOutputByKey.get(key) || null,
              _ema: emaByKey.get(key) || null,
            };
            const maybe = (match.filter.func as FilterFunction)(pipeline, opts, undefined);
            if (maybe instanceof HTMLCanvasElement) {
              pipeline = maybe;
              if (inPixels && hasTemporalBehavior(match)) {
                updateTemporalState(key, inPixels, maybe);
              }
            }
          }
          result = pipeline;
        } catch (error) {
          console.warn("Preset preview failed:", error);
        }
      }

      outCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      outCtx.fillStyle = "#111";
      outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

      const fit = Math.min(
        outputCanvas.width / result.width,
        outputCanvas.height / result.height
      );
      const drawW = Math.max(1, Math.round(result.width * fit));
      const drawH = Math.max(1, Math.round(result.height * fit));
      const dx = Math.floor((outputCanvas.width - drawW) / 2);
      const dy = Math.floor((outputCanvas.height - drawH) / 2);
      outCtx.imageSmoothingEnabled = false;
      outCtx.drawImage(result, dx, dy, drawW, drawH);
      previewFrameIndex += 1;
    };

    const tick = (ts: number) => {
      const source = activeVideo || activeSource;
      if (!source) return;
      if (activeVideo && ts - lastTs < targetInterval) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastTs = ts;
      drawFromSource(source);
      if (activeVideo) {
        rafId = requestAnimationFrame(tick);
      }
    };

    if (activeVideo) {
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }

    tick(0);
  }, [filterByName, open, tab, selectedFilter, selectedFilterResolvedOptions, selectedPreset, previewSource, previewVideo, fallbackImage, fallbackVideo]);

  if (!open) return null;

  return (
    <div className={s.dialog} onMouseDown={onDialogMouseDown}>
      <div className={s.titleBar}>
        <span className={s.titleText}>ditherer.exe - Filter Library</span>
        <button className={s.closeBtn} onClick={onClose} title="Close">
          &#10005;
        </button>
      </div>

      <div className={s.tabs}>
        <button
          className={`${s.tab} ${tab === "filters" ? s.tabActive : ""}`}
          onClick={() => setTab("filters")}
        >
          Filters ({queryFilteredFilterCount})
        </button>
        <button
          className={`${s.tab} ${tab === "presets" ? s.tabActive : ""}`}
          onClick={() => setTab("presets")}
        >
          Presets ({queryFilteredPresetCount})
        </button>
      </div>

      <div className={s.searchRow}>
        <input
          ref={queryRef}
          className={s.searchInput}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tab === "filters" ? "Search filters..." : "Search presets..."}
        />
      </div>

      {tab === "filters" ? (
        <div className={s.content}>
          <div className={s.categories}>
            {FILTER_CATEGORIES.map((category) => (
              <button
                key={category}
                className={`${s.categoryBtn} ${filterCategory === category ? s.categoryActive : ""}`}
                onClick={() => setFilterCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <div className={s.listPane}>
            {filteredFilters.map((entry) => (
              (() => {
                const anim = hasAnimatedOption(entry);
                const temp = hasTemporalBehavior(entry);
                return (
              <button
                key={entry.displayName}
                className={`${s.listItem} ${selectedFilter?.displayName === entry.displayName ? s.listItemActive : ""}`}
                onClick={() => setSelectedFilterName(entry.displayName)}
                onDoubleClick={() => onAddFilter(entry)}
              >
                <div className={s.itemName}>{entry.displayName}</div>
                <div className={s.itemMeta}>
                  {entry.category}
                  {anim ? <span className={`${s.tag} ${s.tagAnim}`}>ANIM</span> : null}
                  {temp ? <span className={`${s.tag} ${s.tagTemp}`}>TEMP</span> : null}
                </div>
              </button>
                );
              })()
            ))}
            {filteredFilters.length === 0 && (
              <div className={s.empty}>No filters match your search.</div>
            )}
          </div>

          <div ref={detailsRef} className={s.details} data-no-drag="true">
            {selectedFilter ? (
              <>
                <div className={s.detailTitle}>{selectedFilter.displayName}</div>
                <div className={s.detailMeta}>{selectedFilter.category}</div>
                <div className={s.detailMeta}>
                  {hasAnimatedOption(selectedFilter) ? <span className={`${s.tag} ${s.tagAnim}`}>Animated Option</span> : null}
                  {hasTemporalBehavior(selectedFilter) ? <span className={`${s.tag} ${s.tagTemp}`}>Temporal</span> : null}
                </div>
                <div className={s.previewWrap}>
                  <canvas ref={previewCanvasRef} className={s.previewCanvas} width={280} height={180} />
                </div>
                <div className={s.detailBody}>{selectedFilter.description || "No description."}</div>
                {presetsUsingSelectedFilter.length > 0 ? (
                  <div className={s.presetFilters}>
                    <div className={s.optionsTitle}>Used In Presets</div>
                    {presetsUsingSelectedFilter.map((preset, index) => (
                      <span key={`preset-link:${preset.name}`}>
                        <button
                          className={s.inlineFilterLink}
                          onClick={() => {
                            setTab("presets");
                            setPresetCategory("All");
                            setQuery("");
                            setSelectedPresetName(preset.name);
                          }}
                          title={`Jump to preset: ${preset.name}`}
                        >
                          {preset.name}
                        </button>
                        {index < presetsUsingSelectedFilter.length - 1 ? <span className={s.inlineArrow}> {"·"} </span> : null}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className={s.optionsList}>
                  <div className={s.optionsTitle}>Options</div>
                  {selectedFilterOptions.length > 0 ? (
                    selectedFilterOptions.map((option) => (
                      <div key={option.name} className={s.optionRow}>
                        <div className={s.optionName}>{option.name}</div>
                        {option.type === RANGE && isRangeOption(option.optionSpec) ? (
                          <div>
                            <input
                              type="range"
                              min={option.optionSpec.range[0]}
                              max={option.optionSpec.range[1]}
                              step={option.optionSpec.step ?? 1}
                              value={Number(option.rawValue)}
                              onChange={(e) => setPreviewOption(
                                selectedFilter.displayName,
                                option.name,
                                Number(e.target.value)
                              )}
                            />
                            <span className={s.optionValue}> {option.value}</span>
                          </div>
                        ) : null}
                        {option.type === BOOL ? (
                          <label>
                            <input
                              type="checkbox"
                              checked={Boolean(option.rawValue)}
                              onChange={(e) => setPreviewOption(
                                selectedFilter.displayName,
                                option.name,
                                e.target.checked
                              )}
                            />
                            <span className={s.optionValue}> {option.value}</span>
                          </label>
                        ) : null}
                        {option.type === ENUM && isEnumOption(option.optionSpec) ? (
                          <select
                            value={String(option.rawValue)}
                            onChange={(e) => setPreviewOption(
                              selectedFilter.displayName,
                              option.name,
                              e.target.value
                            )}
                          >
                            {(option.optionSpec as EnumOptionDefinition).options
                              .filter((opt): opt is EnumOption => !isEnumOptionGroup(opt))
                              .map((opt) => (
                                <option key={String(opt.value)} value={String(opt.value)}>
                                  {opt.name ?? opt.value}
                                </option>
                              ))}
                          </select>
                        ) : null}
                        {option.type === STRING ? (
                          <input
                            type="text"
                            value={String(option.rawValue ?? "")}
                            onChange={(e) => setPreviewOption(
                              selectedFilter.displayName,
                              option.name,
                              e.target.value
                            )}
                          />
                        ) : null}
                        {option.type === TEXT ? (
                          <textarea
                            rows={2}
                            value={String(option.rawValue ?? "")}
                            onChange={(e) => setPreviewOption(
                              selectedFilter.displayName,
                              option.name,
                              e.target.value
                            )}
                          />
                        ) : null}
                        {option.type === COLOR && Array.isArray(option.rawValue) ? (
                          <input
                            type="color"
                            value={rgbToHex(option.rawValue as number[])}
                            onChange={(e) => setPreviewOption(
                              selectedFilter.displayName,
                              option.name,
                              hexToRgb(e.target.value)
                            )}
                          />
                        ) : null}
                        {[RANGE, BOOL, ENUM, STRING, TEXT, COLOR].includes(option.type) ? null : (
                          <div className={s.optionValue}>= {option.value}</div>
                        )}
                        <div className={s.optionDesc}>{option.desc}</div>
                      </div>
                    ))
                  ) : (
                    <div className={s.empty}>No options for this filter.</div>
                  )}
                </div>
                <div className={s.detailActions}>
                  <button onClick={() => onAddFilter(selectedFilter)}>Add to Chain</button>
                  <button onClick={onClose}>Close</button>
                </div>
              </>
            ) : (
              <div className={s.empty}>Select a filter to view details.</div>
            )}
          </div>
        </div>
      ) : (
        <div className={s.content}>
          <div className={s.categories}>
            <button
              className={`${s.categoryBtn} ${presetCategory === "All" ? s.categoryActive : ""}`}
              onClick={() => setPresetCategory("All")}
            >
              All
            </button>
            {PRESET_CATEGORIES.map((category) => (
              <button
                key={category}
                className={`${s.categoryBtn} ${presetCategory === category ? s.categoryActive : ""}`}
                onClick={() => setPresetCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <div className={s.listPane}>
            {filteredPresets.map((preset) => (
              (() => {
                const flags = preset.filters.reduce(
                  (acc, presetFilter) => {
                    const match = filterByName.get(presetFilter.name);
                    if (!match) return acc;
                    return {
                      anim: acc.anim || hasAnimatedOption(match),
                      temp: acc.temp || hasTemporalBehavior(match),
                    };
                  },
                  { anim: false, temp: false }
                );
                return (
              <button
                key={preset.name}
                className={`${s.listItem} ${selectedPreset?.name === preset.name ? s.listItemActive : ""}`}
                onClick={() => setSelectedPresetName(preset.name)}
                onDoubleClick={() => {
                  onLoadPreset(preset);
                  onClose();
                }}
              >
                <div className={s.itemName}>{preset.name}</div>
                <div className={s.itemMeta}>
                  {preset.category}
                  {flags.anim ? <span className={`${s.tag} ${s.tagAnim}`}>ANIM</span> : null}
                  {flags.temp ? <span className={`${s.tag} ${s.tagTemp}`}>TEMP</span> : null}
                </div>
              </button>
                );
              })()
            ))}
            {filteredPresets.length === 0 && (
              <div className={s.empty}>No presets match your search.</div>
            )}
          </div>

          <div ref={detailsRef} className={s.details} data-no-drag="true">
            {selectedPreset ? (
              <>
                <div className={s.detailTitle}>{selectedPreset.name}</div>
                <div className={s.detailMeta}>{selectedPreset.category}</div>
                <div className={s.previewWrap}>
                  <canvas ref={previewCanvasRef} className={s.previewCanvas} width={280} height={180} />
                </div>
                <div className={s.detailBody}>{selectedPreset.desc}</div>
                <div className={s.presetFilters}>
                  {selectedPreset.filters.map((filter, index) => (
                    <span key={`${selectedPreset.name}:${filter.name}:${index}`}>
                      <button
                        className={s.inlineFilterLink}
                        onClick={() => {
                          setTab("filters");
                          setFilterCategory("All");
                          setSelectedFilterName(filter.name);
                        }}
                        title={`Jump to filter: ${filter.name}`}
                      >
                        {filter.name}
                      </button>
                      {index < selectedPreset.filters.length - 1 ? <span className={s.inlineArrow}> {"->"} </span> : null}
                    </span>
                  ))}
                </div>
                <div className={s.optionsList}>
                  <div className={s.optionsTitle}>Preset Options</div>
                  {selectedPreset.filters.map((presetEntry) => {
                    const match = ALL_FILTERS.find((entry) => entry.displayName === presetEntry.name);
                    if (!match) {
                      return (
                        <div key={presetEntry.name} className={s.optionRow}>
                          <div className={s.optionName}>{presetEntry.name}</div>
                          <div className={s.optionDesc}>Filter not found in current build.</div>
                        </div>
                      );
                    }
                    const rows = getFilterOptionRows(match, presetEntry.options);
                    return (
                      <div key={presetEntry.name} className={s.presetOptionGroup}>
                        <div className={s.presetOptionTitle}>{presetEntry.name}</div>
                        {rows.length > 0 ? rows.map((option) => (
                          <div key={`${presetEntry.name}:${option.name}`} className={s.optionRow}>
                            <div className={s.optionName}>
                              {option.name}
                              <span className={s.optionValue}> = {option.value}</span>
                            </div>
                            <div className={s.optionDesc}>{option.desc}</div>
                          </div>
                        )) : (
                          <div className={s.optionDesc}>No options for this filter.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className={s.detailActions}>
                  <button
                    onClick={() => {
                      onLoadPreset(selectedPreset);
                      onClose();
                    }}
                  >
                    Load Preset
                  </button>
                  <button onClick={onClose}>Close</button>
                </div>
              </>
            ) : (
              <div className={s.empty}>Select a preset to view details.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryBrowser;
