import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterDefinition, FilterOptionValues } from "filters/types";
import s from "./libraryBrowser.module.css";

type FilterEntry = { displayName: string; filter: FilterDefinition; category: string };
type FilterFunc = (
  input: HTMLCanvasElement,
  options?: Record<string, unknown>,
  dispatch?: unknown,
) => HTMLCanvasElement | OffscreenCanvas | undefined;

export type ThumbChainStep = { name: string; options?: Record<string, unknown> | undefined };

const THUMB_W = 64;
const THUMB_H = 40;

// Cache: Source → cacheKey → canvas. Invalidated automatically when the
// source is garbage-collected (WeakMap key).
const thumbCache = new WeakMap<object, Map<string, HTMLCanvasElement>>();

// Shared render queue: render one thumbnail at a time, yielding to the
// browser between each so the live preview and paint stay responsive.
type Task = { run: () => void; cancelled: boolean };
const queue: Task[] = [];
let processing = false;

const scheduleNext = () => {
  const rIC = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (rIC) rIC(processNext, { timeout: 200 });
  else window.setTimeout(processNext, 0);
};

const processNext = () => {
  const task = queue.shift();
  if (!task) { processing = false; return; }
  if (task.cancelled) { scheduleNext(); return; }
  try { task.run(); }
  catch (err) { console.warn("Thumbnail render task threw:", err); }
  if (queue.length > 0) scheduleNext();
  else processing = false;
};

const enqueue = (run: () => void) => {
  const task: Task = { run, cancelled: false };
  queue.push(task);
  if (!processing) { processing = true; scheduleNext(); }
  return () => { task.cancelled = true; };
};

const resolveFilterOptions = (
  filter: Pick<FilterDefinition, "defaults" | "options">,
  overrideOptions?: FilterOptionValues,
): Record<string, unknown> => ({
  ...(filter.defaults || {}),
  ...(filter.options || {}),
  ...(overrideOptions || {}),
});

const renderThumbnail = (
  chain: ThumbChainStep[],
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
  for (const step of chain) {
    const match = filterByName.get(step.name);
    if (!match) continue;
    try {
      const opts = {
        ...resolveFilterOptions(match.filter, step.options as FilterOptionValues | undefined),
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
      console.warn(`Thumbnail render failed at step "${step.name}":`, err);
      return null;
    }
  }

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
  cacheKey: string;
  chain: ThumbChainStep[];
  filterByName: Map<string, FilterEntry>;
  source: HTMLImageElement | HTMLCanvasElement | null;
};

// Shared visual thumbnail — used for both preset chains and single
// filters. Lazy via IntersectionObserver, enqueued on the shared render
// queue, cached by (source, cacheKey).
export const Thumbnail = ({ cacheKey, chain, filterByName, source }: Props) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!source) { setRendered(null); return; }
    const cache = thumbCache.get(source) || new Map<string, HTMLCanvasElement>();
    const cached = cache.get(cacheKey);
    if (cached) { setRendered(cached); return; }

    if (!wrapperRef.current) return;
    let cancelled = false;
    let dequeue: (() => void) | null = null;

    const doRender = () => {
      if (cancelled) return;
      const canvas = renderThumbnail(chain, filterByName, source);
      if (!canvas) return;
      const existing = thumbCache.get(source) || new Map<string, HTMLCanvasElement>();
      existing.set(cacheKey, canvas);
      thumbCache.set(source, existing);
      if (!cancelled) setRendered(canvas);
    };

    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      dequeue = enqueue(doRender);
    }, { rootMargin: "100px" });
    obs.observe(wrapperRef.current);

    return () => {
      cancelled = true;
      obs.disconnect();
      dequeue?.();
    };
  }, [cacheKey, chain, filterByName, source]);

  const dataUrl = useMemo(() => rendered?.toDataURL() ?? "", [rendered]);

  return (
    <div
      ref={wrapperRef}
      className={s.thumbnail}
      data-loaded={rendered ? "true" : "false"}
      style={{ width: THUMB_W, height: THUMB_H }}
    >
      {rendered ? (
        <img
          src={dataUrl}
          width={THUMB_W}
          height={THUMB_H}
          alt=""
          draggable={false}
        />
      ) : null}
    </div>
  );
};

export default Thumbnail;
