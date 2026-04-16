import { useEffect, useRef, useState } from "react";
import type { FilterDefinition, FilterOptionValues } from "filters/types";
import type { ChainPreset } from "./presets";
import s from "./libraryBrowser.module.css";

type FilterEntry = { displayName: string; filter: FilterDefinition; category: string };
type FilterFunc = (
  input: HTMLCanvasElement,
  options?: Record<string, unknown>,
  dispatch?: unknown,
) => HTMLCanvasElement | OffscreenCanvas | undefined;

const THUMB_W = 64;
const THUMB_H = 40;

// Lazy in-memory cache: WeakMap keyed by source so a new image swap
// automatically invalidates its thumbnails. Inner Map key is the preset
// name — identical options produce identical output, so the name alone
// is a sound identity when preset defaults are what we always render.
const thumbCache = new WeakMap<object, Map<string, HTMLCanvasElement>>();

const resolveFilterOptions = (
  filter: Pick<FilterDefinition, "defaults" | "options">,
  overrideOptions?: FilterOptionValues,
): Record<string, unknown> => ({
  ...(filter.defaults || {}),
  ...(filter.options || {}),
  ...(overrideOptions || {}),
});

// Render a preset's chain at thumbnail scale. Runs synchronously — each
// filter pass tops out at 64×40 so this is cheap even for multi-step
// presets. Temporal filters skip their prev/ema state (single frame).
const renderThumbnail = (
  preset: ChainPreset,
  filterByName: Map<string, FilterEntry>,
  source: HTMLImageElement | HTMLCanvasElement,
): HTMLCanvasElement | null => {
  const work = document.createElement("canvas");
  work.width = THUMB_W;
  work.height = THUMB_H;
  const ctx = work.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, THUMB_W, THUMB_H);

  let pipeline: HTMLCanvasElement = work;
  for (let i = 0; i < preset.filters.length; i++) {
    const entry = preset.filters[i];
    const match = filterByName.get(entry.name);
    if (!match) continue;
    try {
      const opts = {
        ...resolveFilterOptions(match.filter, entry.options as FilterOptionValues | undefined),
        _frameIndex: 0,
        _isAnimating: false,
        _hasVideoInput: false,
        _prevInput: null,
        _prevOutput: null,
        _ema: null,
      };
      const out = (match.filter.func as FilterFunc)(pipeline, opts, undefined);
      if (out instanceof HTMLCanvasElement) pipeline = out;
    } catch (err) {
      console.warn(`Thumbnail render failed for preset "${preset.name}":`, err);
      return null;
    }
  }

  // Paint onto a final fixed-size canvas so downstream CSS can rely on
  // constant dimensions regardless of what the chain produced.
  const out = document.createElement("canvas");
  out.width = THUMB_W;
  out.height = THUMB_H;
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  outCtx.imageSmoothingEnabled = true;
  outCtx.drawImage(pipeline, 0, 0, THUMB_W, THUMB_H);
  return out;
};

type Props = {
  preset: ChainPreset;
  filterByName: Map<string, FilterEntry>;
  source: HTMLImageElement | HTMLCanvasElement | null;
};

// One thumbnail per preset button. Uses IntersectionObserver so only
// visible thumbnails render; the cache keeps results around between
// scrolls and tab-switches.
export const PresetThumbnail = ({ preset, filterByName, source }: Props) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!source) { setRendered(null); return; }
    // Cache hit? Use the prior canvas immediately.
    const cache = thumbCache.get(source) || new Map<string, HTMLCanvasElement>();
    const cached = cache.get(preset.name);
    if (cached) { setRendered(cached); return; }

    if (!wrapperRef.current) return;
    let cancelled = false;

    const doRender = () => {
      if (cancelled) return;
      const canvas = renderThumbnail(preset, filterByName, source);
      if (!canvas) return;
      const existing = thumbCache.get(source) || new Map<string, HTMLCanvasElement>();
      existing.set(preset.name, canvas);
      thumbCache.set(source, existing);
      if (!cancelled) setRendered(canvas);
    };

    // Defer until visible — IntersectionObserver + requestIdleCallback
    // shift the work away from the initial tab paint.
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      const schedule = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
        || ((cb: () => void) => window.setTimeout(cb, 0));
      schedule(doRender);
    }, { rootMargin: "100px" });
    obs.observe(wrapperRef.current);

    return () => { cancelled = true; obs.disconnect(); };
  }, [preset, filterByName, source]);

  return (
    <div
      ref={wrapperRef}
      className={s.thumbnail}
      style={{ width: THUMB_W, height: THUMB_H }}
    >
      {rendered ? (
        <img
          src={rendered.toDataURL()}
          width={THUMB_W}
          height={THUMB_H}
          alt=""
          draggable={false}
        />
      ) : null}
    </div>
  );
};

export default PresetThumbnail;
