import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const filterEntries = vi.hoisted(() => Array.from({ length: 55 }, (_, index) => {
  const displayName = index === 0 ? "Alpha Glow" : index === 1 ? "Beta Motion" : `Filter ${index}`;
  return {
    displayName,
    category: index % 2 === 0 ? "Stylize" : "Motion",
    description: index === 0 ? "Bright alpha bloom" : `Description ${index}`,
    filter: {
      optionTypes: index === 2 ? { animate: { type: "ACTION" }, amount: { type: "RANGE", label: "Power" } } : {},
      requiresGL: index === 0,
      temporal: index === 1,
      autoAnimate: index === 3,
      noGL: index === 4 ? "sequential" : undefined,
      noWASM: index === 5 ? "canvas" : undefined,
    },
  };
}));

vi.mock("filters", () => ({ filterList: filterEntries }));

import FilterCombobox from "components/FilterCombobox";

const setInput = (input: HTMLInputElement, value: string) => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const key = (element: Element, value: string) => {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
};

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("PointerEvent", MouseEvent);
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: (value: string) => value.replace(/[^a-z0-9_-]/gi, "\\$&") },
  });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll("[data-radix-popper-content-wrapper]").forEach((element) => element.remove());
});

describe("FilterCombobox", () => {
  it("searches, reports bounded matches, clears, shows empty state, and selects a result", async () => {
    localStorage.setItem("ditherer-filter-recents", "not-json");
    const onSelect = vi.fn();
    const onClose = vi.fn();
    await act(async () => root.render(
      <FilterCombobox onSelect={onSelect} onClose={onClose} autoFocus placeholder="Add stage" />,
    ));

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search filters"]')!;
    expect(input).toBeTruthy();
    expect(document.body.textContent).toContain("filters to explore");

    setInput(input, "filter");
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("48 of 53 matches");

    const clear = document.querySelector<HTMLButtonElement>('button[aria-label="Clear filter search"]')!;
    act(() => clear.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    act(() => clear.click());
    expect(input.value).toBe("");

    setInput(input, "does-not-exist");
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("No matching filters");
    expect(document.body.textContent).toContain("No matches");

    setInput(input, "alpha");
    await act(async () => Promise.resolve());
    const item = document.querySelector<HTMLElement>('[data-value="Alpha Glow"]')!;
    expect(item.textContent).toContain("Alpha Glow");
    expect(item.textContent).toContain("GL");
    act(() => item.click());

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Alpha Glow" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("ditherer-filter-recents")!)[0]).toBe("Alpha Glow");
  });

  it("deduplicates current/recent suggestions and previews adjacent filters with arrow keys", async () => {
    localStorage.setItem("ditherer-filter-recents", JSON.stringify(["Alpha Glow", "Alpha Glow", 4, "missing", "Beta Motion"]));
    const onSelect = vi.fn();
    const onChange = vi.fn();
    await act(async () => root.render(
      <FilterCombobox
        onSelect={onSelect}
        onChange={onChange}
        currentValue="Alpha Glow"
        inline
        placeholder="Alpha Glow"
      />,
    ));

    const trigger = container.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
    key(trigger, "ArrowDown");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Beta Motion" }));
    key(trigger, "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: "Alpha Glow" }));
    key(trigger, "Enter");
    expect(onSelect).not.toHaveBeenCalled();

    act(() => trigger.click());
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("recent and suggested");
    expect(document.querySelectorAll('[data-value="Alpha Glow"]')).toHaveLength(1);
  });

  it("falls back to selection callbacks and clamps unknown/boundary keyboard navigation", async () => {
    const onSelect = vi.fn();
    await act(async () => root.render(
      <FilterCombobox onSelect={onSelect} currentValue="Unknown" placeholder="Unknown" />,
    ));
    const trigger = container.querySelector<HTMLButtonElement>('button[role="combobox"]')!;

    key(trigger, "ArrowUp");
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: "Filter 54" }));
    key(trigger, "ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: "Alpha Glow" }));
  });
});
