import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import ChainPreview from "components/ChainList/ChainPreview";
import useMediaQuery from "@src/hooks/useMediaQuery";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const MediaHarness = ({ query }: { query: string }) => {
  const matches = useMediaQuery(query);
  return <output>{matches ? "yes" : "no"}</output>;
};

describe("useMediaQuery", () => {
  it("returns false when matchMedia is unavailable", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
    act(() => root.render(<MediaHarness query="(wide)" />));
    expect(container.textContent).toBe("no");
  });

  it("subscribes, updates, and replaces listeners when the query changes", () => {
    let matches = true;
    const listeners = new Set<() => void>();
    const addEventListener = vi.fn((_name: string, listener: () => void) =>
      listeners.add(listener),
    );
    const removeEventListener = vi.fn((_name: string, listener: () => void) =>
      listeners.delete(listener),
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        get matches() {
          return matches;
        },
        addEventListener,
        removeEventListener,
      })),
    });

    act(() => root.render(<MediaHarness query="(wide)" />));
    expect(container.textContent).toBe("yes");
    matches = false;
    act(() => [...listeners].forEach((listener) => listener()));
    expect(container.textContent).toBe("no");
    act(() => root.render(<MediaHarness query="(narrow)" />));
    expect(removeEventListener).toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledTimes(2);
  });
});

describe("ChainPreview", () => {
  it("sizes both aspect ratios and only drags pinned previews", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const source = document.createElement("canvas");
    source.width = 400;
    source.height = 200;

    act(() =>
      root.render(<ChainPreview sourceCanvas={source} top={10} left={20} stepNumber={2} />),
    );
    const preview = container.firstElementChild as HTMLElement;
    const canvas = container.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    expect(preview.style.pointerEvents).toBe("none");
    act(() =>
      preview.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 5, clientY: 5 })),
    );
    expect(preview.style.left).toBe("20px");

    act(() =>
      root.render(<ChainPreview sourceCanvas={source} top={10} left={20} stepNumber={2} pinned />),
    );
    act(() =>
      preview.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }),
      ),
    );
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 25, clientY: 36 })));
    expect(preview.style.left).toBe("40px");
    expect(preview.style.top).toBe("40px");
    act(() => document.dispatchEvent(new MouseEvent("mouseup")));
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 50 })));
    expect(preview.style.left).toBe("40px");

    source.width = 100;
    source.height = 200;
    act(() =>
      root.render(<ChainPreview sourceCanvas={source} top={10} left={20} stepNumber={3} pinned />),
    );
    expect([canvas.width, canvas.height]).toEqual([100, 200]);

    act(() => callbacks[0]?.(0));
    expect(callbacks.length).toBeGreaterThan(1);
  });

  it("stops the draw loop safely when a 2D context is unavailable", () => {
    let callback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const source = document.createElement("canvas");
    source.width = source.height = 10;
    act(() => root.render(<ChainPreview sourceCanvas={source} top={0} left={0} stepNumber={1} />));
    act(() => callback?.(0));
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
