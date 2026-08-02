import React, { act, createRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

const backendMocks = vi.hoisted(() => ({
  backends: new Map<string, Set<string>>(),
  subscriber: null as (() => void) | null,
}));

const filterMocks = vi.hoisted(() => ({
  state: { chain: [] } as Record<string, unknown>,
  exportState: vi.fn(() => '{"chain":[]}'),
  importState: vi.fn(),
}));

vi.mock("@gyng/ditherer-filters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gyng/ditherer-filters")>()),
  getFilterBackends: () => backendMocks.backends,
  subscribeFilterBackends: (subscriber: () => void) => {
    backendMocks.subscriber = subscriber;
    return () => {
      if (backendMocks.subscriber === subscriber) backendMocks.subscriber = null;
    };
  },
}));

vi.mock("context/useFilter", () => ({
  useFilter: () => ({
    state: filterMocks.state,
    actions: {
      exportState: filterMocks.exportState,
      importState: filterMocks.importState,
    },
  }),
}));

import { BackendTags } from "components/ChainList/BackendTags";
import CollapsibleSection from "components/CollapsibleSection";
import Exporter from "components/App/Exporter";
import WebMCPBadge from "components/App/WebMCPBadge";
import ModalInput from "components/ModalInput";
import WindowDialog from "components/WindowDialog";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
let mediaMatches = false;
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null;

const render = (element: React.ReactElement) => {
  act(() => root.render(element));
};

const click = (element: Element) => {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

const keyDown = (element: Element, key: string, shiftKey = false) => {
  act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    ),
  );
};

const changeValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  act(() => element.dispatchEvent(new Event("input", { bubbles: true })));
};

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mediaMatches = false;
  mediaListener = null;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: mediaMatches,
      media: "(max-width: 960px)",
      onchange: null,
      addEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => {
        mediaListener = listener;
      },
      removeEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => {
        if (mediaListener === listener) mediaListener = null;
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  backendMocks.backends.clear();
  backendMocks.subscriber = null;
  filterMocks.exportState.mockClear();
  filterMocks.importState.mockReset();
  filterMocks.exportState.mockReturnValue('{"chain":[]}');
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
  container.remove();
  vi.restoreAllMocks();
});

describe("CollapsibleSection", () => {
  it("keeps static desktop sections open and non-interactive", () => {
    render(
      <CollapsibleSection title="Static">
        <span>body</span>
      </CollapsibleSection>,
    );
    const header = container.querySelector("h2")!.parentElement!;
    expect(header.getAttribute("role")).toBeNull();
    expect(container.querySelector<HTMLElement>("[class*='content']")!.style.maxHeight).toBe(
      "none",
    );
    click(header);
    keyDown(header, "Enter");
    expect(container.textContent).toContain("[-]");
  });

  it("supports click, keyboard, force-open, and responsive expansion", () => {
    mediaMatches = true;
    render(
      <CollapsibleSection title="Compact">
        <span>body</span>
      </CollapsibleSection>,
    );
    const header = container.querySelector("h2")!.parentElement!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    keyDown(header, " ");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    keyDown(header, "x");
    expect(header.getAttribute("aria-expanded")).toBe("false");

    render(
      <CollapsibleSection title="Compact" forceOpen>
        <span>body</span>
      </CollapsibleSection>,
    );
    expect(header.getAttribute("aria-expanded")).toBe("true");
    act(() => mediaListener?.({ matches: false } as MediaQueryListEvent));
    expect(header.getAttribute("role")).toBeNull();
    expect(container.textContent).toContain("[-]");
  });

  it("honors explicit collapsible defaults independently of viewport", () => {
    render(
      <CollapsibleSection title="Manual" collapsible defaultOpen>
        <span>body</span>
      </CollapsibleSection>,
    );
    const header = container.querySelector("h2")!.parentElement!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    act(() => mediaListener?.({ matches: false } as MediaQueryListEvent));
    click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("WindowDialog", () => {
  it("focuses the preferred control, traps tab navigation, and restores focus", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const preferred = createRef<HTMLButtonElement>();
    const onClose = vi.fn();
    render(
      <WindowDialog
        title="Focus test"
        onClose={onClose}
        initialFocusRef={preferred}
        className="custom"
      >
        <button>first</button>
        <button ref={preferred}>last</button>
      </WindowDialog>,
    );
    act(() => vi.runAllTimers());
    const buttons = [...container.querySelectorAll("button")];
    expect(document.activeElement).toBe(buttons[1]);
    keyDown(buttons[1], "Tab");
    expect(document.activeElement).toBe(buttons[0]);
    keyDown(buttons[0], "Tab");
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].focus();
    keyDown(buttons[0], "Tab", true);
    expect(document.activeElement).toBe(buttons[1]);
    const dialog = container.querySelector<HTMLElement>("[role='dialog']")!;
    dialog.focus();
    keyDown(dialog, "Tab", true);
    expect(document.activeElement).toBe(buttons[1]);
    keyDown(container.querySelector("[role='dialog']")!, "Escape");
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.unmount());
    act(() => vi.runAllTimers());
    expect(document.activeElement).toBe(opener);
    opener.remove();
    root = createRoot(container);
  });

  it("falls back to marked, first, and root focus targets and handles empty traps", () => {
    const onClose = vi.fn();
    render(
      <WindowDialog title="Marked" onClose={onClose}>
        <button data-dialog-initial-focus="true">marked</button>
      </WindowDialog>,
    );
    act(() => vi.runAllTimers());
    expect(document.activeElement?.textContent).toBe("marked");

    render(
      <WindowDialog title="Empty" onClose={onClose} restoreFocus={false}>
        <span>none</span>
      </WindowDialog>,
    );
    act(() => vi.runAllTimers());
    const dialog = container.querySelector<HTMLElement>("[role='dialog']")!;
    keyDown(dialog, "Tab");
    expect(document.activeElement).toBe(dialog);
    keyDown(dialog, "ArrowDown");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("respects a consumer key handler that prevents the dialog contract", () => {
    const onClose = vi.fn();
    render(
      <WindowDialog
        title="Prevented"
        onClose={onClose}
        onKeyDown={(event) => event.preventDefault()}
      >
        <button>only</button>
      </WindowDialog>,
    );
    keyDown(container.querySelector("[role='dialog']")!, "Escape");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ModalInput and Exporter", () => {
  it("confirms single-line input with Enter and supports copy/cancel controls", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <ModalInput title="Name" defaultValue="before" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const input = container.querySelector("input")!;
    changeValue(input, "after");
    keyDown(input, "Enter");
    expect(onConfirm).toHaveBeenCalledWith("after");
    click(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Copy")!,
    );
    expect(writeText).toHaveBeenCalledWith("after");
    click(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!,
    );
    expect(onCancel).toHaveBeenCalled();
  });

  it("keeps Enter available in multiline input and isolates dialog clicks from overlay cancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<ModalInput title="JSON" multiline onConfirm={onConfirm} onCancel={onCancel} />);
    const textarea = container.querySelector("textarea")!;
    keyDown(textarea, "Enter");
    expect(onConfirm).not.toHaveBeenCalled();
    click(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Copy")!,
    );
    act(() => textarea.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onCancel).not.toHaveBeenCalled();
    act(() =>
      container.firstElementChild!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("exports JSON and handles empty, valid, and invalid imports", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<Exporter />);
    click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("JSON"),
      )!,
    );
    await act(async () => Promise.resolve());
    expect(filterMocks.exportState).toHaveBeenCalledWith(filterMocks.state, "json");
    expect(container.querySelector("textarea")?.value).toBe('{"chain":[]}');
    click([...container.querySelectorAll("button")].find((button) => button.textContent === "OK")!);

    click(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Import")!,
    );
    click([...container.querySelectorAll("button")].find((button) => button.textContent === "OK")!);
    expect(filterMocks.importState).not.toHaveBeenCalled();

    click(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Import")!,
    );
    const textarea = container.querySelector("textarea")!;
    changeValue(textarea, "valid");
    click([...container.querySelectorAll("button")].find((button) => button.textContent === "OK")!);
    expect(filterMocks.importState).toHaveBeenCalledWith("valid");

    filterMocks.importState.mockImplementation(() => {
      throw new Error("bad JSON");
    });
    click(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Import")!,
    );
    const invalid = container.querySelector("textarea")!;
    changeValue(invalid, "invalid");
    click([...container.querySelectorAll("button")].find((button) => button.textContent === "OK")!);
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("bad JSON"));

    filterMocks.importState.mockImplementation(() => {
      throw "non-error";
    });
    click([...container.querySelectorAll("button")].find((button) => button.textContent === "OK")!);
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("Unknown parsing error"));
    click(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!,
    );

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("JSON"),
      )!,
    );
    expect(container.querySelector("textarea")?.value).toBe('{"chain":[]}');
  });
});

describe("status chrome", () => {
  it("renders every WebMCP phase with bounded diagnostic detail", () => {
    const statuses = [
      { phase: "unsupported" as const, api: null },
      { phase: "registering" as const, api: "navigator", total: 12, registered: 0 },
      { phase: "ready" as const, api: "navigator", total: 12, registered: 12 },
      { phase: "partial" as const, api: "navigator", total: 12, registered: 7 },
      {
        phase: "partial" as const,
        api: "navigator",
        total: 12,
        registered: 7,
        error: "partial detail",
      },
      { phase: "failed" as const, api: "navigator", total: 12, registered: 0 },
      {
        phase: "failed" as const,
        api: "navigator",
        total: 12,
        registered: 0,
        error: "x".repeat(220),
      },
    ];
    for (const status of statuses) {
      render(<WebMCPBadge status={status as never} />);
      expect(
        container.querySelector("[data-testid='webmcp-badge']")?.getAttribute("data-phase"),
      ).toBe(status.phase);
    }
    expect(container.textContent).toContain("could not register");
    expect(container.textContent).not.toContain("x".repeat(181));
  });

  it("aggregates GL and WASM backend events and unsubscribes on unmount", () => {
    render(<BackendTags filterNames={["A", "B", "missing"]} />);
    expect(container.textContent).toBe("");
    backendMocks.backends.set("A", new Set(["WebGL2"]));
    act(() => backendMocks.subscriber?.());
    expect(container.textContent).toBe("GL");
    backendMocks.backends.set("A", new Set(["WASM"]));
    act(() => backendMocks.subscriber?.());
    expect(container.textContent).toBe("WASM");
    backendMocks.backends.set("A", new Set(["WebGL2"]));
    backendMocks.backends.set("B", new Set(["WASM", "WebGL2"]));
    act(() => backendMocks.subscriber?.());
    expect(container.textContent).toContain("GL");
    expect(container.textContent).toContain("WASM");
    act(() => root.unmount());
    expect(backendMocks.subscriber).toBeNull();
    root = createRoot(container);
  });
});
