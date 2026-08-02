import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ChainList from "components/ChainList";

const bridge = vi.hoisted(() => ({
  dispatch: vi.fn(),
  notifyScreensaverSwap: vi.fn(),
}));
const filterContext = vi.hoisted(() => ({
  current: null as unknown,
}));

vi.mock("context/useFilter", () => ({
  useFilter: () => filterContext.current,
}));
vi.mock("components/App/useDraggable", () => ({
  default: () => ({
    onMouseDown: vi.fn(),
    ensureInitializedPosition: vi.fn(),
  }),
}));
vi.mock("utils/randomCycleBridge", () => ({
  dispatchRandomCycleSeconds: bridge.dispatch,
  getLastRandomCycleSeconds: () => 2,
  setRememberedRandomCycleSeconds: vi.fn(),
  getCurrentScreensaverCycleSeconds: () => null,
  subscribeRandomCycleSeconds: () => () => undefined,
  subscribeScreensaverCycleSeconds: () => () => undefined,
  notifyScreensaverChainSwap: bridge.notifyScreensaverSwap,
}));
vi.mock("components/FilterCombobox", () => ({
  default: ({
    placeholder,
    onSelect,
    onClose,
  }: {
    placeholder?: string;
    onSelect?: (entry: { displayName: string; filter: Record<string, unknown> }) => void;
    onClose?: () => void;
  }) => (
    <button
      type="button"
      data-testid={`combobox-${placeholder ?? "filter"}`}
      onClick={() => {
        onSelect?.({
          displayName: "Invert",
          filter: { name: "Invert", func: () => document.createElement("canvas"), defaults: {} },
        });
        onClose?.();
      }}
    >
      {placeholder}
    </button>
  ),
}));
vi.mock("components/ChainList/LibraryBrowser", () => ({
  default: ({
    onClose,
    onAddFilter,
    initialTab,
    initialQuery,
  }: {
    onClose: () => void;
    onAddFilter: (entry: { displayName: string; filter: Record<string, unknown> }) => void;
    initialTab?: string;
    initialQuery?: string;
  }) => (
    <div data-testid="library-browser">
      <span>
        {initialTab}:{initialQuery}
      </span>
      <button
        type="button"
        onClick={() =>
          onAddFilter({
            displayName: "Invert",
            filter: { name: "Invert", func: () => document.createElement("canvas"), defaults: {} },
          })
        }
      >
        Add mocked filter
      </button>
      <button type="button" onClick={onClose}>
        Close mocked library
      </button>
    </div>
  ),
}));
vi.mock("components/ChainList/ChainPreview", () => ({
  default: ({ stepNumber }: { stepNumber: number }) => <div>Preview {stepNumber}</div>,
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;

const filter = {
  name: "Invert",
  func: () => document.createElement("canvas"),
  defaults: {},
  options: {},
  optionTypes: {},
};

const actions = {
  chainAdd: vi.fn(),
  chainDuplicate: vi.fn(),
  chainRemove: vi.fn(),
  chainReorder: vi.fn(),
  chainReplace: vi.fn(),
  chainSetActive: vi.fn(),
  chainToggle: vi.fn(),
  getIntermediatePreview: vi.fn(() => null),
  importState: vi.fn(),
  isAnimating: vi.fn(() => false),
  selectFilter: vi.fn(),
  setRandomCycleSeconds: vi.fn(),
};

const callbacks = {
  onEditAudioMod: vi.fn(),
  onEditChainAudioMod: vi.fn(),
};

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  state: {
    chain: [
      { id: "first", displayName: "Invert", filter, enabled: true },
      { id: "second", displayName: "Invert", filter, enabled: false },
    ],
    activeIndex: 0,
    randomCycleSeconds: null,
    inputCanvas: document.createElement("canvas"),
    inputImage: document.createElement("canvas"),
    video: null,
    stepTimes: [{ name: "Invert", ms: 3.7, backend: "WebGL2" }],
    ...overrides,
  },
  actions,
});

const render = (context = makeContext(), props: Record<string, unknown> = {}) => {
  filterContext.current = context;
  act(() =>
    root.render(
      <ChainList
        onEditAudioMod={callbacks.onEditAudioMod}
        onEditChainAudioMod={callbacks.onEditChainAudioMod}
        {...props}
      />,
    ),
  );
};

const click = (element: Element | null) => {
  expect(element).not.toBeNull();
  act(() => element!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChainList integration", () => {
  it("routes entry selection, toggling, reset, duplicate, removal, and add actions", () => {
    render();

    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(container.textContent).toContain("4ms");

    click(container.querySelector('[role="option"]'));
    expect(actions.chainSetActive).toHaveBeenCalledWith(0);

    click(container.querySelector('input[type="checkbox"]'));
    expect(actions.chainToggle).toHaveBeenCalledWith("first");

    click(container.querySelector('[title="Reset to defaults"]'));
    expect(actions.chainReplace).toHaveBeenCalledWith(
      "first",
      "Invert",
      expect.objectContaining({ name: "Invert" }),
    );

    click(container.querySelector('[title="Duplicate"]'));
    expect(actions.chainDuplicate).toHaveBeenCalledWith("first");

    click(container.querySelector('[title="Remove"]'));
    expect(actions.chainRemove).toHaveBeenCalledWith("first");

    click(container.querySelector('[data-testid="combobox-Add filter..."]'));
    expect(actions.chainAdd).toHaveBeenCalledWith(
      "Invert",
      expect.objectContaining({ name: "Invert" }),
    );
  });

  it("supports keyboard selection, reordering, toggling, and deletion contracts", () => {
    render();
    const list = container.querySelector('[role="listbox"]')!;
    const key = (value: string, altKey = false) =>
      act(() => {
        list.dispatchEvent(new KeyboardEvent("keydown", { key: value, altKey, bubbles: true }));
      });

    key("ArrowDown");
    expect(actions.chainSetActive).toHaveBeenCalledWith(1);
    key("ArrowDown", true);
    expect(actions.chainReorder).toHaveBeenCalledWith(0, 1);
    key(" ");
    expect(actions.chainToggle).toHaveBeenCalledWith("first");
    key("Delete");
    expect(actions.chainRemove).toHaveBeenCalledWith("first");

    render(
      makeContext({
        chain: [{ id: "only", displayName: "Invert", filter, enabled: true }],
        activeIndex: 0,
      }),
    );
    key("Backspace");
    expect(actions.selectFilter).toHaveBeenCalledWith(
      "None",
      expect.objectContaining({ name: "None" }),
    );
  });

  it("opens and confirms clear, library, and random-cycle dialogs", () => {
    render();

    click(container.querySelector('[title="Clear filter chain"]'));
    expect(container.textContent).toContain("Clear the filter chain?");
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Cancel",
      ) ?? null,
    );
    expect(container.textContent).not.toContain("Clear the filter chain?");

    click(container.querySelector('[title="Clear filter chain"]'));
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "OK",
      ) ?? null,
    );
    expect(actions.selectFilter).toHaveBeenCalledWith(
      "None",
      expect.objectContaining({ name: "None" }),
    );

    click(container.querySelector('[title="Open full filter/preset browser"]'));
    expect(container.querySelector('[data-testid="library-browser"]')).not.toBeNull();
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Add mocked filter",
      ) ?? null,
    );
    expect(actions.chainAdd).toHaveBeenCalledWith("Invert", expect.any(Object));
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Close mocked library",
      ) ?? null,
    );

    click(container.querySelector('[aria-label="Set random cycle interval"]'));
    expect(container.textContent).toContain("Random Chain Swap");
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "OK",
      ) ?? null,
    );
    expect(bridge.dispatch).toHaveBeenCalledWith(2);
  });

  it("loads and deletes saved chains through the persisted-state contract", () => {
    localStorage.setItem(
      "_chain_My setup",
      JSON.stringify({
        name: "My setup",
        desc: "Saved description",
        filters: ["Invert"],
        stateJson: '{"chain":[]}',
      }),
    );
    render();

    const select = container.querySelector<HTMLSelectElement>('[title="Load a saved chain"]')!;
    act(() => {
      select.value = "My setup";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(actions.importState).toHaveBeenCalledWith('{"chain":[]}');
    expect(container.textContent).toContain("Saved description");

    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.title === 'Delete "My setup"',
      ) ?? null,
    );
    expect(localStorage.getItem("_chain_My setup")).toBeNull();
  });

  it("routes extended stage actions, inline replacement, previews, presets, and drag reorder", () => {
    actions.getIntermediatePreview.mockReturnValue(document.createElement("canvas"));
    render();

    click(container.querySelector('[title="Open chain audio visualizer mapping"]'));
    expect(callbacks.onEditChainAudioMod).toHaveBeenCalledWith(
      expect.objectContaining({ left: 0, top: 0 }),
    );

    const first = container.querySelectorAll<HTMLElement>('[role="option"]')[0];
    click(first.querySelector('[aria-label^="More actions for"]'));
    expect(
      first.querySelector('[aria-label^="More actions for"]')?.getAttribute("aria-expanded"),
    ).toBe("true");
    click(first.querySelector('[aria-label^="Map audio visualizer to"]'));
    expect(callbacks.onEditAudioMod).toHaveBeenCalledWith(
      "first",
      expect.objectContaining({ left: 0, top: 0 }),
    );

    click(first.querySelector('[title="Re-roll options"]'));
    expect(actions.chainReplace).toHaveBeenCalledWith(
      "first",
      "Invert",
      expect.objectContaining({ options: expect.any(Object) }),
    );

    click(first.querySelector('[title^="Open preset browser"]'));
    expect(container.textContent).toContain("presets:Invert");
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Close mocked library",
      ) ?? null,
    );

    click(first.querySelector('[title="Pin preview"]'));
    expect(container.textContent).toContain("Preview 1");
    click(first.querySelector('[title="Unpin preview"]'));

    click(first.querySelector('[title="Click to search and replace filter"]'));
    click(container.querySelector('[data-testid="combobox-Invert"]'));
    expect(actions.chainReplace).toHaveBeenCalledWith("first", "Invert", expect.any(Object));

    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    act(() =>
      first.dispatchEvent(
        Object.assign(new Event("dragstart", { bubbles: true }), { dataTransfer }),
      ),
    );
    const second = container.querySelectorAll<HTMLElement>('[role="option"]')[1];
    act(() =>
      second.dispatchEvent(
        Object.assign(new Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer }),
      ),
    );
    act(() =>
      second.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), { dataTransfer }),
      ),
    );
    expect(actions.chainReorder).toHaveBeenCalledWith(0, 1);

    click(container.querySelector('[aria-label="Add a random filter"]'));
    expect(actions.chainAdd).toHaveBeenCalled();
    click(container.querySelector('[aria-label="Load a random curated preset"]'));
    expect(actions.selectFilter).toHaveBeenCalled();
  });

  it("validates cycle input, responds to external library requests, and invokes animation metadata", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const animate = vi.fn();
    const animatedFilter = {
      ...filter,
      optionTypes: { animate: { type: "ACTION", action: animate } },
    };
    render(
      makeContext({
        chain: [{ id: "animated", displayName: "Invert", filter: animatedFilter, enabled: true }],
        activeIndex: 0,
      }),
      { openPresetLibraryRequest: 1, chainAudioActive: true },
    );
    expect(container.textContent).toContain("presets:");
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Close mocked library",
      ) ?? null,
    );

    click(container.querySelector('[title="Play animation"]'));
    expect(animate).toHaveBeenCalledWith(
      actions,
      expect.any(HTMLCanvasElement),
      animatedFilter.func,
      animatedFilter.options,
    );

    click(container.querySelector('[aria-label="Set random cycle interval"]'));
    const fields = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    const setInputValue = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    act(() => {
      setInputValue(fields[0], "invalid");
    });
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "OK",
      ) ?? null,
    );
    expect(alert).toHaveBeenCalled();

    act(() => {
      setInputValue(fields[0], "0");
    });
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "OK",
      ) ?? null,
    );
    expect(bridge.dispatch).toHaveBeenCalledWith(null);
  });
});
