import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const filterEntries = vi.hoisted(() =>
  Array.from({ length: 55 }, (_, index) => {
    const displayName =
      index === 0 ? "Alpha Glow" : index === 1 ? "Beta Motion" : `Filter ${index}`;
    return {
      displayName,
      category: index % 2 === 0 ? "Stylize" : "Motion",
      description: index === 0 ? "Bright alpha bloom" : `Description ${index}`,
      filter: {
        optionTypes:
          index === 2
            ? { animate: { type: "ACTION" }, amount: { type: "RANGE", label: "Power" } }
            : {},
        requiresGL: index === 0,
        temporal: index === 1,
        autoAnimate: index === 3,
        noGL: index === 4 ? "sequential" : undefined,
        noWASM: index === 5 ? "canvas" : undefined,
      },
    };
  }),
);

vi.mock("@gyng/ditherer-filters", () => ({ filterList: filterEntries }));

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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((element) => element.remove());
});

describe("FilterCombobox", () => {
  it("searches, reports bounded matches, clears, shows empty state, and selects a result", async () => {
    localStorage.setItem("ditherer-filter-recents", "not-json");
    const onSelect = vi.fn();
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <FilterCombobox onSelect={onSelect} onClose={onClose} autoFocus placeholder="Add stage" />,
      ),
    );

    const input = () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Search filters"]')!;
    expect(input()).toBeTruthy();
    const tab = (name: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
        (element) => element.dataset.tab === name,
      )!;
    // Without recents the finder opens on All; categories are tabs.
    expect(document.querySelector('[role="tablist"]')).toBeTruthy();
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
    expect(tab("Recent")).toBeUndefined();
    expect(tab("Stylize").textContent).toContain("28");
    expect(tab("Motion").textContent).toContain("27");

    act(() => tab("Motion").click());
    expect(tab("Motion").getAttribute("aria-selected")).toBe("true");
    expect(document.body.textContent).toContain("Motion filters");
    expect(document.querySelectorAll('[data-testid="filter-typeahead-item"]')).toHaveLength(27);

    // Arrow keys move between tabs and wrap.
    key(tab("Motion"), "ArrowRight");
    expect(tab("Stylize").getAttribute("aria-selected")).toBe("true");
    key(tab("Stylize"), "ArrowRight");
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
    key(tab("All"), "End");
    expect(tab("Stylize").getAttribute("aria-selected")).toBe("true");

    // Starting a search ranks across everything, from the All tab.
    setInput(input(), "artistic");
    await act(async () => Promise.resolve());
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
    expect(document.body.textContent).toContain("28 matches");
    expect(document.querySelector<HTMLElement>('[data-value="Alpha Glow"]')).toBeTruthy();

    setInput(input(), "filter");
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("48 of 53 matches");

    // A tab narrows the current matches to its category.
    act(() => tab("Motion").click());
    expect(document.body.textContent).toContain("26 matches in Motion");
    expect(document.body.textContent).toContain("Best matches in Motion");
    act(() => tab("All").click());

    const clear = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear filter search"]',
    )!;
    act(() =>
      clear.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })),
    );
    act(() => clear.click());
    expect(input().value).toBe("");

    setInput(input(), "does-not-exist");
    await act(async () => Promise.resolve());
    expect(document.body.textContent).toContain("No matching filters");
    expect(document.body.textContent).toContain("No matches");

    setInput(input(), "alpha");
    await act(async () => Promise.resolve());
    const item = document.querySelector<HTMLElement>('[data-value="Alpha Glow"]')!;
    expect(item.textContent).toContain("Alpha Glow");
    expect(item.textContent).toContain("WebGL2");
    expect(document.body.textContent).toContain("Bright alpha bloom");
    expect(document.body.textContent).toContain("Add this filter");
    act(() => item.click());

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Alpha Glow" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("ditherer-filter-recents")!)[0]).toBe("Alpha Glow");
  });

  it("deduplicates current/recent suggestions without mutating from closed arrow keys", async () => {
    const onSelect = vi.fn();
    await act(async () =>
      root.render(
        <FilterCombobox
          onSelect={onSelect}
          currentValue="Alpha Glow"
          inline
          placeholder="Alpha Glow"
        />,
      ),
    );

    // A different picker can update the shared recents after this instance
    // mounted. Keyboard-open must refresh exactly like pointer-open does.
    localStorage.setItem(
      "ditherer-filter-recents",
      JSON.stringify(["Alpha Glow", "Alpha Glow", 4, "missing", "Beta Motion"]),
    );

    const trigger = container.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
    key(trigger, "ArrowDown");
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => Promise.resolve());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const popupId = trigger.getAttribute("aria-controls");
    expect(popupId).toBeTruthy();
    expect(document.getElementById(popupId!)).toBe(
      document.querySelector('[data-testid="filter-typeahead"]'),
    );

    // Replacing opens on the current filter's category; the Recent tab holds
    // the refreshed, deduped recents.
    expect(document.body.textContent).toContain("Stylize filters");
    const recentTab = document.querySelector<HTMLButtonElement>('[role="tab"][data-tab="Recent"]')!;
    expect(recentTab.textContent).toContain("2");
    act(() => recentTab.click());
    expect(document.body.textContent).toContain("Recently used");
    expect(document.querySelectorAll('[data-value="Alpha Glow"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-value="Beta Motion"]')).toHaveLength(1);
  });

  it("opens safely from navigation keys even with an unknown current value", async () => {
    const onSelect = vi.fn();
    await act(async () =>
      root.render(
        <FilterCombobox onSelect={onSelect} currentValue="Unknown" placeholder="Unknown" />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('button[role="combobox"]')!;

    key(trigger, "ArrowUp");
    await act(async () => Promise.resolve());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Replace Unknown");
  });
});
