import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ChainList from "components/ChainList";
import { FilterContext } from "context/filterContextValue";

vi.mock("components/FilterCombobox", () => ({
  default: () => <div data-testid="filter-combobox">combobox</div>,
}));

vi.mock("components/ModalInput", () => ({
  default: () => null,
}));

vi.mock("components/ChainList/LibraryBrowser", () => ({
  default: () => null,
}));

describe("ChainList hover preview", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Tell React this test uses act() so state updates flush correctly.
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("clears the hover preview when the pointer leaves all preview anchors", async () => {
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = 8;
    previewCanvas.height = 8;

    const contextValue = {
      state: {
        chain: [{
          id: "entry-1",
          displayName: "Test Filter",
          enabled: true,
          filter: { optionTypes: {}, defaults: {}, options: {} },
        }],
        activeIndex: 0,
        stepTimes: [],
        inputCanvas: null,
        inputImage: null,
        video: null,
      },
      actions: {
        chainSetActive: vi.fn(),
        chainReorder: vi.fn(),
        chainToggle: vi.fn(),
        chainRemove: vi.fn(),
        chainReplace: vi.fn(),
        chainDuplicate: vi.fn(),
        chainAdd: vi.fn(),
        selectFilter: vi.fn(),
        getExportUrl: vi.fn(() => ""),
        getIntermediatePreview: vi.fn(() => previewCanvas),
        isAnimating: vi.fn(() => false),
      },
      filterList: [{
        displayName: "Test Filter",
        description: "preview text",
        filter: { optionTypes: {}, defaults: {}, options: {} },
      }],
    };

    act(() => {
      root.render(
        <FilterContext.Provider value={contextValue}>
          <ChainList />
        </FilterContext.Provider>
      );
    });

    const row = Array.from(container.querySelectorAll('[role="option"]')).find((node) =>
      node.textContent?.includes("Test Filter")
    );

    expect(row).toBeTruthy();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(160);
    });

    expect(container.textContent).toContain("Step 1");

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });

    expect(container.textContent).toContain("Step 1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(container.textContent).not.toContain("Step 1");
  });
});
