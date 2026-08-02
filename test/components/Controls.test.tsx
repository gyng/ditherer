import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Controls from "components/controls";
import nearest from "palettes/nearest";
import { optionTypes as orderedOptionTypes } from "filters/ordered";

const context = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("context/useFilter", () => ({ useFilter: () => context.current }));
vi.mock("react-colorful", () => ({
  HexColorPicker: ({ onChange }: { onChange: (color: string) => void }) => (
    <button type="button" onClick={() => onChange("#102030")}>
      pick hex
    </button>
  ),
  RgbaColorPicker: () => null,
}));
vi.mock("components/ModalInput", () => ({ default: () => null }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
let actions: Record<string, ReturnType<typeof vi.fn>>;
let inputCanvas: HTMLCanvasElement;

const optionTypes = {
  run: { type: "ACTION", label: "Run effect", desc: "Action help", action: vi.fn() },
  amount: {
    type: "RANGE",
    range: [0, 10],
    step: 0.5,
    default: 4,
    label: "Amount",
    desc: "Range help",
  },
  enabled: { type: "BOOL", default: true, label: "Enabled", desc: "Boolean help" },
  mode: {
    type: "ENUM",
    default: "A",
    desc: "Mode help",
    options: [
      { label: "Modes", options: [{ name: "Alpha", value: "A" }] },
      { name: "Beta", value: "B" },
    ],
  },
  title: { type: "STRING", default: "fallback" },
  notes: { type: "TEXT", default: "notes" },
  tint: { type: "COLOR", default: [1, 2, 3] },
  curve: { type: "CURVE", default: "[[0,0],[255,255]]", desc: "Curve help" },
  colors: { type: "COLOR_ARRAY", default: [] },
  palette: { type: "PALETTE", default: nearest, desc: "Palette help" },
  thresholdPreview: orderedOptionTypes.thresholdPreview,
  hidden: { type: "STRING", default: "secret", visibleWhen: () => false },
  shown: { type: "STRING", default: "visible", visibleWhen: () => true },
  mystery: { type: "NOT_REAL", default: 1 },
};

const options = {
  enabled: false,
  mode: "A",
  title: 42,
  notes: null,
  tint: [4, 5, 6],
  curve: "[[0,10],[255,240]]",
  colors: [[1, 2, 3, 255]],
  palette: nearest,
  thresholdMap: orderedOptionTypes.thresholdMap.default,
  thresholdPolarity: orderedOptionTypes.thresholdPolarity.default,
};

const render = (props: Record<string, unknown> = {}) => {
  act(() =>
    root.render(
      <Controls
        optionTypes={optionTypes as never}
        options={options as never}
        inputCanvas={inputCanvas}
        {...props}
      />,
    ),
  );
};

const setValue = (
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) => {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const clickText = (selector: string, label: string) => {
  const target = Array.from(container.querySelectorAll(selector)).find(
    (element) => element.textContent?.trim() === label,
  );
  expect(target).toBeTruthy();
  act(() => target!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  inputCanvas = document.createElement("canvas");
  actions = {
    setFilterOption: vi.fn(),
    setFilterPaletteOption: vi.fn(),
    addPaletteColor: vi.fn(),
    saveCurrentColorPalette: vi.fn(),
    deleteCurrentColorPalette: vi.fn(),
  };
  context.current = {
    state: { selected: { filter: { func: vi.fn(), optionTypes, options } } },
    actions,
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Controls dispatcher and atoms", () => {
  it("routes every declared control type and respects visibility/defaults", () => {
    render();
    expect(container.textContent).not.toContain("secret");
    expect(container.textContent).toContain("shown");
    expect(container.textContent).toContain("Unknown setting type");
    expect(container.querySelector('[title="Range help"]')).not.toBeNull();
    expect(container.querySelector('[title="Boolean help"]')).not.toBeNull();
    expect(container.querySelector('canvas[aria-label*="levels"]')).not.toBeNull();

    const actionButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Run effect",
    )!;
    const actionDescription = actionButton.getAttribute("aria-describedby");
    expect(actionButton.title).toBe("Action help");
    expect(actionDescription).toBeTruthy();
    expect(document.getElementById(actionDescription!)?.textContent).toBe("Action help");
    expect(
      container.querySelector('[aria-label="Help for Run effect"][title="Action help"]'),
    ).not.toBeNull();

    clickText("button", "Run effect");
    expect(optionTypes.run.action).toHaveBeenCalledWith(
      actions,
      inputCanvas,
      expect.any(Function),
      options,
    );

    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.value).toBe("4");
    const sliderDescription = slider.getAttribute("aria-describedby");
    expect(sliderDescription).toBeTruthy();
    expect(document.getElementById(sliderDescription!)?.textContent).toBe("Range help");
    setValue(slider, "6.5");
    expect(actions.setFilterOption).toHaveBeenCalledWith("amount", 6.5);

    const boolInfo = container.querySelector('[title="Boolean help"]')!;
    const enabledLabel = boolInfo.parentElement!;
    const checkbox =
      enabledLabel.parentElement!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox).toBeTruthy();
    act(() => checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(actions.setFilterOption).toHaveBeenCalledWith("enabled", true);
    expect(enabledLabel).toBeTruthy();
    act(() => enabledLabel!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(actions.setFilterOption).toHaveBeenCalledWith("enabled", true);
    const resetEnabled = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset Enabled to default"]',
    )!;
    expect(resetEnabled.disabled).toBe(false);
    act(() => resetEnabled.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(actions.setFilterOption).toHaveBeenCalledWith("enabled", true);

    const mode = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((entry) => entry.value === "B"),
    )!;
    setValue(mode, "B");
    expect(actions.setFilterOption).toHaveBeenCalledWith("mode", "B");

    const palette = Array.from(container.querySelectorAll("select")).find(
      (select) => select.value === nearest.name,
    )!;
    const paletteDescription = palette.getAttribute("aria-describedby");
    expect(paletteDescription).toBeTruthy();
    expect(document.getElementById(paletteDescription!)?.textContent).toBe("Palette help");
    setValue(palette, "User/Adaptive");
    expect(actions.setFilterOption).toHaveBeenCalledWith(
      "palette",
      expect.objectContaining({ name: "User/Adaptive" }),
    );

    const stringInputs = container.querySelectorAll<HTMLInputElement>('input[type="text"]');
    setValue(stringInputs[0], "new title");
    expect(actions.setFilterOption).toHaveBeenCalledWith("title", "new title");
    const notes = container.querySelector<HTMLTextAreaElement>("textarea")!;
    setValue(notes, "new notes");
    expect(actions.setFilterOption).toHaveBeenCalledWith("notes", "new notes");
  });

  it("supports editable range values, keyboard entry, color picking, and curve actions", () => {
    render({ options: { ...options, amount: 7 } });
    const number = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(number).toBeTruthy();
    expect(number.min).toBe("0");
    expect(number.max).toBe("10");
    expect(number.step).toBe("0.5");

    setValue(number, "12");
    act(() => number.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(actions.setFilterOption).toHaveBeenCalledWith("amount", 10);

    const resetAmount = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset Amount to default"]',
    )!;
    expect(resetAmount).toBeTruthy();
    expect(resetAmount.disabled).toBe(false);
    act(() => resetAmount.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(actions.setFilterOption).toHaveBeenCalledWith("amount", 4);

    setValue(number, "invalid");
    act(() => number.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(number.value).toBe("7");

    const swatch = container.querySelector<HTMLElement>('[title="#040506"]')!;
    act(() => swatch.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    clickText("button", "pick hex");
    expect(actions.setFilterOption).toHaveBeenCalledWith("tint", [16, 32, 48]);

    clickText("button", "Invert");
    expect(actions.setFilterOption).toHaveBeenCalledWith("curve", "[[0,245],[255,15]]");
    clickText("button", "Reset");
    expect(actions.setFilterOption).toHaveBeenCalledWith("curve", "[[0,0],[255,255]]");
  });

  it("uses explicit nested callbacks instead of the context defaults", () => {
    const set = vi.fn();
    const setPalette = vi.fn();
    render({
      optionTypes: { enabled: optionTypes.enabled },
      options: { enabled: true },
      onSetFilterOption: set,
      onSetPaletteOption: setPalette,
    });
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(set).toHaveBeenCalledWith("enabled", false);
    expect(actions.setFilterOption).not.toHaveBeenCalled();
  });

  it("falls back safely when filter state, option values, and optional metadata are absent", () => {
    context.current = { state: { selected: null }, actions };
    act(() => root.render(<Controls />));
    expect(container.textContent).toBe("");

    const minimalAction = vi.fn();
    const sparseTypes = {
      runFallback: { type: "ACTION", action: minimalAction },
      amountFallback: { type: "RANGE", range: [-1, 1], default: null },
      paletteFallback: { type: "PALETTE", default: nearest },
      colorFallback: { type: "COLOR", default: null },
      stringFallback: { type: "STRING", default: null },
      textFallback: { type: "TEXT", default: null },
      curveFallback: { type: "CURVE", default: null },
      boolFallback: { type: "BOOL", default: null },
      enumFallback: {
        type: "ENUM",
        default: null,
        options: [{ name: "Empty", value: "" }],
      },
    };
    const sparseOptions = {
      amountFallback: "0.25",
      paletteFallback: nearest,
      colorFallback: { invalid: true },
      stringFallback: null,
      textFallback: null,
      curveFallback: 123,
      boolFallback: 0,
      enumFallback: null,
    };
    act(() =>
      root.render(<Controls optionTypes={sparseTypes as never} options={sparseOptions as never} />),
    );
    const sparseAction = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "runFallback",
    )!;
    expect(sparseAction.hasAttribute("aria-describedby")).toBe(false);
    expect(sparseAction.hasAttribute("title")).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe("0.25");
    expect(container.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe("");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    clickText("button", "runFallback");
    expect(minimalAction).toHaveBeenCalledWith(actions, null, undefined, sparseOptions);
  });

  it("filters controls by normalized label and description queries and reports no matches", () => {
    const searchableTypes = {
      edgeAmount: {
        type: "RANGE",
        range: [0, 1],
        default: 0.5,
        label: "Tape Edge",
        desc: "Soft horizontal wave",
      },
      hiddenMatch: {
        type: "STRING",
        default: "hidden",
        desc: "secret needle",
        visibleWhen: () => false,
      },
    };

    act(() =>
      root.render(
        <Controls
          optionTypes={searchableTypes as never}
          options={{ edgeAmount: 0.5, hiddenMatch: "hidden" }}
          query="  HORIZONTAL  "
        />,
      ),
    );
    expect(container.textContent).toContain("Tape Edge");
    expect(container.textContent).not.toContain("hidden");

    act(() =>
      root.render(
        <Controls
          optionTypes={searchableTypes as never}
          options={{ edgeAmount: 0.5, hiddenMatch: "hidden" }}
          query="not-present"
        />,
      ),
    );
    expect(container.textContent).toContain("No settings match “not-present”");
  });
});
