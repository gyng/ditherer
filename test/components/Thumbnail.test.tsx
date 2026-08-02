import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { Thumbnail } from "components/ChainList/Thumbnail";

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

let container: HTMLDivElement;
let root: Root;
let observerCallbacks: ObserverCallback[];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  observerCallbacks = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: ObserverCallback) {
        observerCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  container.remove();
});

const sourceCanvas = () => {
  const source = document.createElement("canvas");
  source.width = 8;
  source.height = 8;
  return source;
};

describe("Thumbnail", () => {
  it("renders visible chains, skips unknown steps, and reuses source-keyed cache entries", () => {
    const source = sourceCanvas();
    const filtered = sourceCanvas();
    const filter = {
      name: "Good",
      defaults: { amount: 1 },
      options: { amount: 2 },
      optionTypes: {},
      func: vi.fn(() => filtered),
    };
    const filterByName = new Map([
      ["Good", { displayName: "Good", category: "Test", filter }],
      [
        "No canvas",
        {
          displayName: "No canvas",
          category: "Test",
          filter: { ...filter, name: "No canvas", func: vi.fn(() => undefined) },
        },
      ],
    ]) as never;
    const chain = [
      { name: "Missing" },
      { name: "Good", options: { amount: 3 } },
      { name: "No canvas" },
    ];

    act(() =>
      root.render(
        <Thumbnail
          cacheKey="chain:good"
          chain={chain}
          filterByName={filterByName}
          source={source}
        />,
      ),
    );
    expect(container.firstElementChild?.getAttribute("data-loaded")).toBe("false");
    act(() => observerCallbacks[0]([{ isIntersecting: false } as IntersectionObserverEntry]));
    expect(filter.func).not.toHaveBeenCalled();
    act(() => observerCallbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry]));
    act(() => vi.runAllTimers());
    expect(filter.func).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ amount: 3, _frameIndex: 0, _prevOutput: null }),
      undefined,
    );
    expect(container.firstElementChild?.getAttribute("data-loaded")).toBe("true");
    expect(container.querySelector("img")?.draggable).toBe(false);

    act(() =>
      root.render(
        <Thumbnail cacheKey="chain:good" chain={[]} filterByName={new Map()} source={source} />,
      ),
    );
    expect(container.firstElementChild?.getAttribute("data-loaded")).toBe("true");
  });

  it("contains filter failures and cancels queued work when the source disappears", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = sourceCanvas();
    const broken = {
      name: "Broken",
      defaults: {},
      options: {},
      optionTypes: {},
      func: () => {
        throw new Error("broken thumbnail filter");
      },
    };
    const filterByName = new Map([
      ["Broken", { displayName: "Broken", category: "Test", filter: broken }],
    ]) as never;

    act(() =>
      root.render(
        <Thumbnail
          cacheKey="chain:broken"
          chain={[{ name: "Broken" }]}
          filterByName={filterByName}
          source={source}
        />,
      ),
    );
    act(() => observerCallbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry]));
    act(() => vi.runAllTimers());
    expect(container.querySelector("img")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Broken"), expect.any(Error));

    act(() =>
      root.render(
        <Thumbnail cacheKey="chain:cancel" chain={[]} filterByName={new Map()} source={source} />,
      ),
    );
    act(() => observerCallbacks.at(-1)?.([{ isIntersecting: true } as IntersectionObserverEntry]));
    act(() =>
      root.render(
        <Thumbnail cacheKey="chain:cancel" chain={[]} filterByName={new Map()} source={null} />,
      ),
    );
    act(() => vi.runAllTimers());
    expect(container.firstElementChild?.getAttribute("data-loaded")).toBe("false");
  });

  it("uses requestIdleCallback when the browser provides it", () => {
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => callback()),
    );
    const source = sourceCanvas();
    act(() =>
      root.render(
        <Thumbnail cacheKey="chain:idle" chain={[]} filterByName={new Map()} source={source} />,
      ),
    );
    act(() => observerCallbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry]));
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 200 });
    expect(container.firstElementChild?.getAttribute("data-loaded")).toBe("true");
  });
});
