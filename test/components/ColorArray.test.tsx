import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ColorArray, { TOP } from "components/controls/ColorArray";

const bridge = vi.hoisted(() => ({
  modalValues: new Map<string, string>(),
  medianCutPalette: vi.fn(() => [[11, 12, 13, 255]]),
  uniqueColors: vi.fn(() => [[21, 22, 23, 255]]),
}));

vi.mock("@gyng/ditherer-filters", async (importOriginal) => {
  const original = await importOriginal<typeof import("utils")>();
  return {
    ...original,
    medianCutPalette: bridge.medianCutPalette,
    uniqueColors: bridge.uniqueColors,
  };
});
vi.mock("react-colorful", () => ({
  RgbaColorPicker: ({ onChange }: { onChange: (color: { r: number; g: number; b: number; a: number }) => void }) => (
    <button type="button" onClick={() => onChange({ r: 10, g: 20, b: 30, a: 0.5 })}>
      choose rgba
    </button>
  ),
  HexColorPicker: () => null,
}));
vi.mock("components/ModalInput", () => ({
  default: ({ title, defaultValue, multiline, onConfirm, onCancel }: {
    title: string;
    defaultValue: string;
    multiline?: boolean;
    onConfirm: (value: string) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="modal" data-multiline={String(Boolean(multiline))}>
      <span>{title}</span>
      <span>{defaultValue}</span>
      <button type="button" onClick={() => onConfirm(bridge.modalValues.get(title) ?? defaultValue)}>confirm modal</button>
      <button type="button" onClick={onCancel}>cancel modal</button>
    </div>
  ),
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
let canvas: HTMLCanvasElement;
let callbacks: {
  onAddPaletteColor: ReturnType<typeof vi.fn>;
  onSetPaletteOption: ReturnType<typeof vi.fn>;
  onSetFilterOption: ReturnType<typeof vi.fn>;
  onSaveColorPalette: ReturnType<typeof vi.fn>;
  onDeleteColorPalette: ReturnType<typeof vi.fn>;
};

const customColors = [[1, 2, 3, 255], [4, 5, 6, 128]];

const render = (value: unknown = customColors) => {
  act(() => root.render(
    <ColorArray
      name="colors"
      inputCanvas={canvas}
      value={value as number[][]}
      {...callbacks}
    />,
  ));
};

const findByText = (selector: string, text: string) => Array.from(container.querySelectorAll(selector))
  .find((element) => element.textContent?.includes(text)) ?? null;

const click = (element: Element | null) => {
  expect(element).not.toBeNull();
  act(() => element!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

const changeSelect = (select: HTMLSelectElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  bridge.modalValues.clear();
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(2, 1);
  image.data.set([1, 2, 3, 255, 4, 5, 6, 255]);
  ctx.putImageData(image, 0, 0);
  callbacks = {
    onAddPaletteColor: vi.fn(),
    onSetPaletteOption: vi.fn(),
    onSetFilterOption: vi.fn(),
    onSaveColorPalette: vi.fn(),
    onDeleteColorPalette: vi.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("ColorArray palette editor", () => {
  it("handles invalid values, theme selection, and mouse/keyboard color removal", () => {
    render(null);
    expect(container.textContent).toBe("No colors");

    render();
    const theme = container.querySelector<HTMLSelectElement>("select")!;
    expect(theme.value).toBe("Custom");
    const builtIn = Array.from(theme.options).find((option) => option.value !== "Custom")!;
    changeSelect(theme, builtIn.value);
    expect(callbacks.onSetPaletteOption).toHaveBeenCalledWith("colors", expect.any(Array));

    const swatches = container.querySelectorAll<HTMLElement>('[role="button"][data-idx]');
    expect(Array.from(swatches, (swatch) => swatch.dataset.idx)).toEqual(["0", "1"]);
    const callsBeforeDelete = callbacks.onSetPaletteOption.mock.calls.length;
    click(swatches[0]);
    expect(callbacks.onSetPaletteOption).toHaveBeenCalledTimes(callsBeforeDelete + 1);
    expect(callbacks.onSetPaletteOption).toHaveBeenLastCalledWith("colors", [customColors[1]]);
    act(() => swatches[1].dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    })));
    expect(callbacks.onSetPaletteOption).toHaveBeenLastCalledWith("colors", [customColors[0]]);
  });

  it("extracts palettes through median-cut and top-frequency modes", () => {
    render();
    click(findByText("button", "Extract from input"));
    const algorithm = Array.from(container.querySelectorAll("select"))[1];

    bridge.modalValues.set("Number of colors to extract", "5");
    click(findByText("button", "🖼️ Extract"));
    expect(container.querySelector('[data-testid="modal"]')?.textContent).toContain("16");
    click(findByText("button", "confirm modal"));
    expect(bridge.medianCutPalette).toHaveBeenCalledWith(
      expect.any(Uint8ClampedArray),
      3,
      true,
      "AVERAGE",
      "LAB",
    );
    expect(callbacks.onSetPaletteOption).toHaveBeenCalledWith("colors", [[11, 12, 13, 255]]);

    changeSelect(algorithm, TOP);
    bridge.modalValues.set("Number of colors to extract", "2");
    click(findByText("button", "🖼️ Extract"));
    click(findByText("button", "confirm modal"));
    expect(bridge.uniqueColors).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 2);
    expect(callbacks.onSetPaletteOption).toHaveBeenLastCalledWith("colors", [[21, 22, 23, 255]]);

    bridge.modalValues.set("Number of colors to extract", "0");
    click(findByText("button", "🖼️ Extract"));
    click(findByText("button", "confirm modal"));
    expect(bridge.uniqueColors).toHaveBeenCalledTimes(1);
  });

  it("adds picker colors and imports valid JSON while ignoring invalid JSON", () => {
    render();
    click(findByText("button", "Add color"));
    click(findByText("button", "choose rgba"));
    click(findByText("button", "Add to palette"));
    expect(callbacks.onAddPaletteColor).toHaveBeenCalledWith([10, 20, 30, 128]);
    click(findByText("button", "Close picker"));

    bridge.modalValues.set("Paste theme JSON", "[[9,8,7,255]]");
    click(findByText("button", "Import palette"));
    expect(container.querySelector('[data-testid="modal"]')?.getAttribute("data-multiline")).toBe("true");
    click(findByText("button", "confirm modal"));
    expect(callbacks.onSetPaletteOption).toHaveBeenLastCalledWith("colors", [[9, 8, 7, 255]]);

    bridge.modalValues.set("Paste theme JSON", "not-json");
    click(findByText("button", "Import palette"));
    click(findByText("button", "confirm modal"));
    expect(callbacks.onSetPaletteOption).toHaveBeenCalledTimes(1);
  });

  it("validates local names and supports save, cancel, and JSON export", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => "blob:palette");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render();

    bridge.modalValues.set("Save current palette as", "");
    click(findByText("button", "Save locally"));
    click(findByText("button", "confirm modal"));
    expect(alert).toHaveBeenCalled();

    bridge.modalValues.set("Save current palette as", "My Palette");
    click(findByText("button", "Save locally"));
    click(findByText("button", "confirm modal"));
    expect(callbacks.onSaveColorPalette).toHaveBeenCalledWith("🎨 My Palette", customColors);

    click(findByText("button", "Save locally"));
    click(findByText("button", "cancel modal"));
    expect(container.querySelector('[data-testid="modal"]')).toBeNull();

    click(findByText("button", "Export"));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:palette");
  });
});
