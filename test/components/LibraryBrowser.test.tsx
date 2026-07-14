import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import LibraryBrowser from "components/ChainList/LibraryBrowser";

const fixture = vi.hoisted(() => {
  const passthrough = vi.fn((input: HTMLCanvasElement) => input);
  const throws = vi.fn(() => {
    throw new Error("preview exploded");
  });
  const filters = [
    {
      displayName: "Alpha Lab",
      category: "Color",
      description: "Representative option controls",
      filter: {
        name: "Alpha Lab",
        func: passthrough,
        defaults: {
          amount: 2,
          enabled: false,
          mode: "ONE",
          grouped: "PLAIN",
          title: "hello",
          notes: "world",
          tint: [1, 2, 3],
          palette: { levels: 4 },
          nullable: null,
        },
        options: { amount: 3 },
        optionTypes: {
          amount: { type: "RANGE", range: [0, 10], step: 1, default: 2, desc: "Amount" },
          enabled: { type: "BOOL", default: false, desc: "Enabled" },
          mode: {
            type: "ENUM",
            default: "ONE",
            desc: "Mode",
            options: [{ name: "One", value: "ONE" }, { name: "Two", value: "TWO" }],
          },
          grouped: {
            type: "ENUM",
            default: "PLAIN",
            desc: "Grouped enum",
            options: [
              { label: "Group", options: [{ name: "Nested", value: "NESTED" }] },
              { name: "Plain", value: "PLAIN" },
            ],
          },
          title: { type: "STRING", default: "hello", desc: "Title" },
          notes: { type: "TEXT", default: "world", desc: "Notes" },
          tint: { type: "COLOR", default: [1, 2, 3], desc: "Tint" },
          palette: { type: "PALETTE", default: { levels: 4 }, desc: "Palette" },
          nullable: { type: "CUSTOM", default: null },
          _internal: { type: "STRING", default: "hidden" },
        },
      },
    },
    {
      displayName: "Temporal Echo",
      category: "Motion",
      description: "Uses prior frames",
      filter: {
        name: "Temporal Echo",
        func: passthrough,
        defaults: {},
        optionTypes: {},
        temporal: true,
      },
    },
    {
      displayName: "Animated Noise",
      category: "Noise",
      description: "Moves over time",
      filter: {
        name: "Animated Noise",
        func: passthrough,
        defaults: {},
        optionTypes: {
          animate: { type: "ACTION", action: vi.fn(), label: "Play" },
        },
      },
    },
    {
      displayName: "Broken Preview",
      category: "Utility",
      description: "Exercises preview recovery",
      filter: {
        name: "Broken Preview",
        func: throws,
        defaults: {},
        optionTypes: {},
      },
    },
  ];
  const presets = [
    {
      name: "Starter Look",
      category: "Looks",
      desc: "A useful starting chain",
      filters: [
        { name: "Alpha Lab", options: { amount: 7 } },
        { name: "Missing Filter", options: { mystery: true } },
      ],
    },
    {
      name: "Moving Echo",
      category: "Motion",
      desc: "A temporal chain",
      filters: [{ name: "Temporal Echo" }],
    },
  ];
  return { filters, passthrough, presets, throws };
});

vi.mock("filters", () => ({
  filterList: fixture.filters,
  hasTemporalBehavior: (entry: { filter?: { temporal?: boolean } }) => entry.filter?.temporal === true,
}));
vi.mock("gl", () => ({ glAvailable: () => true }));
vi.mock("components/ChainList/presets", () => ({
  CHAIN_PRESETS: fixture.presets,
  PRESET_CATEGORIES: ["Looks", "Motion"],
}));
vi.mock("components/ChainList/FilterThumbnail", () => ({
  default: ({ filter }: { filter: { displayName: string } }) => <span data-thumb={filter.displayName} />,
}));
vi.mock("components/ChainList/PresetThumbnail", () => ({
  default: ({ preset }: { preset: { name: string } }) => <span data-preset-thumb={preset.name} />,
}));
vi.mock("components/ChainList/BackendTags", () => ({
  default: ({ filterNames }: { filterNames: string[] }) => <span data-backends={filterNames.join(",")} />,
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

let container: HTMLDivElement;
let root: Root;
let source: HTMLCanvasElement;
let onAddFilter: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let onLoadPreset: ReturnType<typeof vi.fn>;
let onDialogMouseDown: ReturnType<typeof vi.fn>;

const render = (props: Record<string, unknown> = {}) => {
  act(() => root.render(
    <LibraryBrowser
      open
      onClose={onClose}
      onAddFilter={onAddFilter}
      onLoadPreset={onLoadPreset}
      onDialogMouseDown={onDialogMouseDown}
      previewSource={source}
      {...props}
    />,
  ));
};

const button = (label: string) => Array.from(container.querySelectorAll("button"))
  .find((element) => element.textContent?.trim() === label) ?? null;

const buttonContaining = (label: string) => Array.from(container.querySelectorAll("button"))
  .find((element) => element.textContent?.includes(label)) ?? null;

const click = (element: Element | null, type = "click") => {
  expect(element).not.toBeNull();
  act(() => element!.dispatchEvent(new MouseEvent(type, { bubbles: true })));
};

const change = (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    );
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const optionRow = (name: string): HTMLElement => {
  const label = Array.from(container.querySelectorAll("div"))
    .find((node) => node.textContent === name);
  expect(label).toBeTruthy();
  return label!.parentElement!;
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  source = document.createElement("canvas");
  source.width = 16;
  source.height = 12;
  source.getContext("2d")!.fillRect(0, 0, 16, 12);
  onAddFilter = vi.fn();
  onClose = vi.fn();
  onLoadPreset = vi.fn();
  onDialogMouseDown = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LibraryBrowser integration", () => {
  it("renders nothing while closed and restores the requested tab/query when opened", () => {
    render({ open: false });
    expect(container.textContent).toBe("");

    render({ open: true, initialTab: "presets", initialQuery: "moving" });
    expect(container.textContent).toContain("Moving Echo");
    expect(container.textContent).not.toContain("Starter Look");

    const search = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(search.value).toBe("moving");
    render({ open: false });
    render({ open: true, initialTab: "filters", initialQuery: "" });
    expect(search.isConnected).toBe(false);
    expect(container.textContent).toContain("Alpha Lab");
  });

  it("searches metadata/tags, applies categories, and reports empty results", () => {
    render();
    const search = container.querySelector<HTMLInputElement>('input[type="text"]')!;

    change(search, "temporal");
    expect(container.textContent).toContain("Temporal Echo");
    expect(container.textContent).not.toContain("Alpha Lab");

    change(search, "animated");
    expect(container.textContent).toContain("Animated Noise");

    change(search, "no-such-effect");
    expect(container.textContent).toContain("No filters match your search.");

    change(search, "");
    click(button("Color"));
    expect(container.textContent).toContain("Alpha Lab");
    expect(container.textContent).not.toContain("Temporal Echo");
  });

  it("edits every supported preview option and routes add/close/dialog contracts", () => {
    render();
    expect(container.textContent).toContain("Representative option controls");
    expect(container.textContent).toContain("Used In Presets");
    expect(container.textContent).not.toContain("_internal");

    change(optionRow("amount").querySelector("input")!, "8");
    const enabled = optionRow("enabled").querySelector<HTMLInputElement>("input")!;
    click(enabled);
    change(optionRow("mode").querySelector("select")!, "TWO");
    change(optionRow("grouped").querySelector("select")!, "PLAIN");
    change(optionRow("title").querySelector("input")!, "changed");
    change(optionRow("notes").querySelector("textarea")!, "changed notes");
    change(optionRow("tint").querySelector("input")!, "#a0b1c2");

    expect(optionRow("amount").textContent).toContain("8");
    expect(optionRow("enabled").textContent).toContain("true");
    expect(optionRow("palette").textContent).toContain('{"levels":4}');
    expect(optionRow("nullable").textContent).toContain("null");

    click(button("Add to Chain"));
    expect(onAddFilter).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Alpha Lab" }));
    click(button("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);

    const dialog = container.firstElementChild!;
    click(dialog, "mousedown");
    expect(onDialogMouseDown).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);

    click(buttonContaining("Alpha Lab"), "dblclick");
    expect(onAddFilter).toHaveBeenCalledTimes(2);
  });

  it("navigates, filters, and loads presets while preserving preset overrides", () => {
    render({ initialTab: "presets" });
    expect(container.textContent).toContain("Starter Look");
    expect(container.textContent).toContain("amount = 7");
    expect(container.textContent).toContain("Filter not found in current build.");

    click(button("Motion"));
    expect(container.textContent).toContain("Moving Echo");
    expect(container.textContent).not.toContain("Starter Look");

    click(button("All"));
    click(buttonContaining("Starter Look"));
    click(button("Alpha Lab"));
    expect(container.textContent).toContain("Representative option controls");

    click(button("Starter Look"));
    expect(container.textContent).toContain("Preset Options");
    click(button("Load Preset"));
    expect(onLoadPreset).toHaveBeenCalledWith(expect.objectContaining({ name: "Starter Look" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    click(buttonContaining("Starter Look"), "dblclick");
    expect(onLoadPreset).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("recovers from preview failures without breaking selection or add behavior", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render({ initialQuery: "Broken Preview" });
    expect(fixture.throws).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Filter preview failed:", expect.any(Error));

    click(button("Add to Chain"));
    expect(onAddFilter).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Broken Preview" }));
    warn.mockRestore();
  });
});
