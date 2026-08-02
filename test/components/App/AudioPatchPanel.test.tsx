import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPatchPanel, ScreensaverDebugOverlay } from "components/App";
import {
  setGlobalAudioVizModulation,
  type AudioVizConnection,
  type AudioVizMetric,
  type AudioVizSnapshot,
} from "utils/audioVizBridge";
import {
  notifyScreensaverChainSwap,
  notifyScreensaverVideoSwap,
  resetScreensaverSwapMarkers,
} from "utils/randomCycleBridge";

const rangeOptions = [
  ["amount", { label: "Amount", range: [0, 10], step: 1 }],
  ["fine", { targetLabel: "Fine tune", range: [-1, 1], step: 0.05 }],
  ["continuous", { label: "Continuous", range: [0, 1] }],
  ["invalid", { label: "Invalid", range: [0, 1] }],
] as const;

const initialConnections: AudioVizConnection[] = [
  { metric: "level", target: "amount", weight: 0.5 },
  { metric: "bass", target: "fine", weight: -0.25 },
  { metric: "mid", target: "missing", weight: 0.1 },
];

let root: Root;
let container: HTMLDivElement;

const click = (element: Element | null) => {
  expect(element).not.toBeNull();
  act(() => element!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

const change = (
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
  checked?: boolean,
) => {
  act(() => {
    if (element instanceof HTMLInputElement && checked !== undefined) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
      setter?.call(element, checked);
    } else {
      const prototype =
        element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(element, value);
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const Harness = ({ empty = false }: { empty?: boolean }) => {
  const [connections, setConnections] = useState<AudioVizConnection[]>(
    empty ? [] : initialConnections,
  );
  const [normalized, setNormalized] = useState<AudioVizMetric[]>(["level"]);
  return (
    <AudioPatchPanel
      channel="chain"
      rangeOptions={(empty ? [] : rangeOptions) as never}
      optionValues={{ amount: 4, fine: 0.25, continuous: 0.5, invalid: Number.NaN }}
      connections={connections}
      normalizedMetrics={normalized}
      onNormalizedMetricsChange={setNormalized}
      onConnectionsChange={setConnections}
      collapsibleBody
      bodyTitle="Cable patch panel"
    />
  );
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  resetScreensaverSwapMarkers();
  setGlobalAudioVizModulation("screensaver", null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setGlobalAudioVizModulation("screensaver", null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AudioPatchPanel interaction contract", () => {
  it("edits normalization, BPM override, density, sections, and collapsed state", async () => {
    await act(async () => root.render(<Harness />));

    const density = container.querySelector<HTMLInputElement>('input[type="range"][max="0.8"]')!;
    expect(container.textContent).toContain("auto (");
    change(density, "0.4");
    expect(container.textContent).toContain("40%");

    const mode = container.querySelector<HTMLSelectElement>('select[aria-label="Auto Viz mode"]')!;
    change(mode, "chaotic");
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Reroll",
      ) ?? null,
    );

    const settings = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle auto viz settings"]',
    )!;
    click(settings);
    expect(density.isConnected).toBe(false);
    click(settings);

    const tempoSection = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Tempo & rhythm"),
    )!;
    expect(tempoSection.getAttribute("aria-expanded")).toBe("true");
    click(tempoSection);
    expect(tempoSection.getAttribute("aria-expanded")).toBe("false");
    click(tempoSection);

    const normalize = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((input) => input.parentElement?.textContent?.includes("Normalize"))!;
    expect(normalize.checked).toBe(false);
    change(normalize, "", true);
    expect(normalize.checked).toBe(true);
    change(normalize, "", false);

    const override = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((input) => input.parentElement?.textContent?.includes("Override"))!;
    change(override, "", true);
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Tap",
      ) ?? null,
    );
    click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Reset",
      ) ?? null,
    );

    const collapse = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Cable patch panel"),
    )!;
    click(collapse);
    expect(container.textContent).not.toContain("Fine tune");
    click(collapse);
    expect(container.textContent).toContain("Fine tune");
  });

  it("creates, removes, prompts, and drags cables while containing invalid gestures", async () => {
    await act(async () => root.render(<Harness />));

    const levelJack = container.querySelector<HTMLButtonElement>('button[title="Patch Level"]')!;
    const amountJack = container.querySelector<HTMLButtonElement>(
      'button[title="Patch to Amount"]',
    )!;
    const amountTarget = amountJack.closest("div")!;

    act(() => amountTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
    act(() =>
      levelJack.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      ),
    );
    act(() =>
      window.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 20, clientY: 20 }),
      ),
    );
    act(() => amountTarget.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })));
    act(() => amountTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
    expect(container.querySelectorAll("svg g").length).toBeGreaterThan(0);

    const cable = container.querySelector<SVGPathElement>("svg g path")!;
    act(() => cable.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })));
    act(() => cable.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true })));

    const prompt = vi.spyOn(window, "prompt");
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    prompt.mockReturnValueOnce(null).mockReturnValueOnce("not-a-number").mockReturnValueOnce("175");
    for (let i = 0; i < 3; i += 1) {
      const label = container.querySelector<SVGTextElement>("svg g text")!;
      act(() =>
        label.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientY: 20 })),
      );
      act(() => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientY: 20 })));
    }
    expect(alert).toHaveBeenCalledWith("Please enter a number.");

    const draggable = container.querySelector<SVGTextElement>("svg g text")!;
    act(() =>
      draggable.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientY: 100 }),
      ),
    );
    act(() => window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientY: -2000 })));
    act(() => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientY: -2000 })));

    const remainingCable = container.querySelector<SVGPathElement>("svg g path")!;
    act(() =>
      remainingCable.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    expect(container.querySelectorAll("svg g").length).toBeLessThan(initialConnections.length);
  });

  it("renders the no-target state and controlled auto-viz callbacks", async () => {
    const onMode = vi.fn();
    const onRefresh = vi.fn();
    await act(async () =>
      root.render(
        <AudioPatchPanel
          channel="screensaver"
          rangeOptions={[]}
          optionValues={{}}
          connections={[]}
          normalizedMetrics={[]}
          onNormalizedMetricsChange={vi.fn()}
          onConnectionsChange={vi.fn()}
          autoVizMode="flow"
          onAutoVizModeChange={onMode}
          autoVizOnChainChange={false}
          onAutoVizOnChainChange={onRefresh}
        />,
      ),
    );
    expect(container.textContent).toContain("No numeric range parameters");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "Reroll",
      )?.disabled,
    ).toBe(true);
    change(container.querySelector('select[aria-label="Auto Viz mode"]')!, "punchy");
    const refresh = Array.from(container.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Refresh on chain change"))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(refresh).not.toBeNull();
    click(refresh!);
    expect(onMode).toHaveBeenCalledWith("punchy");
    expect(onRefresh).toHaveBeenCalledWith(true);
  });

  it("explains disabled, connecting, failed, warming, silent, and searching tempo states", async () => {
    const debug = (
      window as unknown as {
        __audioVizDebug: { getRuntime: (channel: string) => { snapshot: AudioVizSnapshot } };
      }
    ).__audioVizDebug;
    const runtime = debug.getRuntime("chain");
    const original = runtime.snapshot;
    const publish = async (changes: Partial<AudioVizSnapshot>) => {
      runtime.snapshot = { ...runtime.snapshot, ...changes };
      await act(async () => setGlobalAudioVizModulation("chain", null));
    };

    try {
      await act(async () => root.render(<Harness />));
      await publish({ enabled: false, status: "idle", bpmOverride: null });
      expect(container.querySelector('[aria-label^="Audio input disabled"]')).not.toBeNull();

      await publish({ enabled: true, status: "connecting" });
      expect(container.querySelector('[aria-label^="Connecting to audio source"]')).not.toBeNull();

      await publish({ status: "error", error: null });
      expect(container.querySelector('[aria-label="Audio error: unknown"]')).not.toBeNull();

      await publish({ status: "live", tempoStatus: "warmup", tempoWarmupProgress: 0.42 });
      expect(container.querySelector('[aria-label^="Warming up (42%)"]')).not.toBeNull();

      await publish({ tempoStatus: "silent" });
      expect(container.querySelector('[aria-label^="Signal too quiet"]')).not.toBeNull();

      await publish({ tempoStatus: "searching" });
      expect(container.querySelector('[aria-label^="Searching for tempo"]')).not.toBeNull();

      await publish({ tempoStatus: "locked", detectedBpm: 122, bpmOverride: 122 });
      expect(container.textContent).toContain("122 BPM");
      expect(container.querySelector('[aria-label^="Searching for tempo"]')).toBeNull();
    } finally {
      runtime.snapshot = original;
      await act(async () => setGlobalAudioVizModulation("chain", null));
    }
  });

  it("adds a new cable, ignores secondary-button drags, and falls back to option names", async () => {
    const onConnectionsChange = vi.fn();
    await act(async () =>
      root.render(
        <AudioPatchPanel
          channel="chain"
          rangeOptions={[["fallbackTarget", { range: [0, 1] }]]}
          optionValues={{ fallbackTarget: 0.25 }}
          connections={[]}
          normalizedMetrics={[]}
          onNormalizedMetricsChange={vi.fn()}
          onConnectionsChange={onConnectionsChange}
          bodyDefaultOpen={false}
        />,
      ),
    );
    expect(container.textContent).toContain("fallbackTarget");

    const metric = container.querySelector<HTMLButtonElement>('button[title="Patch Level"]')!;
    const targetJack = container.querySelector<HTMLButtonElement>(
      'button[title="Patch to fallbackTarget"]',
    )!;
    const target = targetJack.closest("div")!;
    act(() =>
      metric.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 5,
          clientY: 5,
        }),
      ),
    );
    act(() => target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })));
    expect(onConnectionsChange).toHaveBeenCalledWith([
      { metric: "level", target: "fallbackTarget", weight: expect.any(Number) },
    ]);

    await act(async () =>
      root.render(
        <AudioPatchPanel
          channel="chain"
          rangeOptions={[["fallbackTarget", { range: [0, 1] }]]}
          optionValues={{ fallbackTarget: 0.25 }}
          connections={[{ metric: "level", target: "fallbackTarget", weight: 0.25 }]}
          normalizedMetrics={[]}
          onNormalizedMetricsChange={vi.fn()}
          onConnectionsChange={onConnectionsChange}
        />,
      ),
    );
    const calls = onConnectionsChange.mock.calls.length;
    const cableLabel = container.querySelector<SVGTextElement>("svg g text");
    if (cableLabel) {
      act(() =>
        cableLabel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 })),
      );
      act(() =>
        window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientY: -200 })),
      );
    }
    expect(onConnectionsChange).toHaveBeenCalledTimes(calls);
  });
});

describe("ScreensaverDebugOverlay", () => {
  it("reports empty and active chains, timers, disabled stages, video swaps, and patches", async () => {
    await act(async () =>
      root.render(
        <ScreensaverDebugOverlay
          chain={[]}
          activeIndex={0}
          chainSwapSeconds={null}
          videoSwapEnabled={false}
          videoSwapSeconds={null}
        />,
      ),
    );
    expect(container.textContent).toContain("(empty)");
    expect(container.textContent).toContain("(none)");
    expect(container.textContent).toContain("next --");

    setGlobalAudioVizModulation("screensaver", {
      connections: [
        { metric: "beat", target: "first:amount", weight: 0.5 },
        { metric: "level", target: "second:speed", weight: -0.25 },
      ],
      normalizedMetrics: ["beat"],
    });
    notifyScreensaverVideoSwap();
    await act(async () =>
      root.render(
        <ScreensaverDebugOverlay
          chain={[
            { id: "first", displayName: "First", enabled: true },
            { id: "second", displayName: "Second", enabled: false },
          ]}
          activeIndex={1}
          chainSwapSeconds={2}
          videoSwapEnabled
          videoSwapSeconds={8}
        />,
      ),
    );
    expect(container.textContent).toContain("chain (2)");
    expect(container.textContent).toContain("Second (off)");
    expect(container.textContent).toContain("patches (2)");
    expect(container.textContent).toContain("video swap");
    expect(container.textContent).toContain("/ 8.00s");
  });

  it("reports live audio fallbacks, warmup status, and non-positive swap intervals", async () => {
    const debug = (
      window as unknown as {
        __audioVizDebug: { getRuntime: (channel: string) => { snapshot: AudioVizSnapshot } };
      }
    ).__audioVizDebug;
    const runtime = debug.getRuntime("screensaver");
    const original = runtime.snapshot;
    try {
      runtime.snapshot = {
        ...runtime.snapshot,
        enabled: true,
        source: "display",
        status: "live",
        tempoStatus: "warmup",
        tempoWarmupProgress: 0.37,
        rawMetrics: {
          ...runtime.snapshot.rawMetrics,
          level: undefined as unknown as number,
          beatConfidence: undefined as unknown as number,
        },
      };
      notifyScreensaverChainSwap();
      await act(async () =>
        root.render(
          <ScreensaverDebugOverlay
            chain={[{ id: "only", displayName: "Only", enabled: true }]}
            activeIndex={0}
            chainSwapSeconds={0}
            videoSwapEnabled
            videoSwapSeconds={-1}
          />,
        ),
      );
      expect(container.textContent).toContain("display / live / level 0%");
      expect(container.textContent).toContain("warming up 37%");
      expect(container.textContent).toContain("next --");

      runtime.snapshot = { ...runtime.snapshot, tempoStatus: "custom-status" as never };
      await act(async () => setGlobalAudioVizModulation("screensaver", null));
      expect(container.textContent).toContain("custom-status");
    } finally {
      runtime.snapshot = original;
      await act(async () => setGlobalAudioVizModulation("screensaver", null));
    }
  });
});
