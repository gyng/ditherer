import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({
  snapshot: {} as Record<string, unknown>,
  subscriber: null as null | ((channel: string) => void),
  listDevices: vi.fn(),
  requestDevices: vi.fn(),
  update: vi.fn(),
}));

vi.mock("utils/audioVizBridge", () => ({
  getAudioVizSnapshot: () => audio.snapshot,
  listAudioInputDevices: audio.listDevices,
  requestMicPermissionAndList: audio.requestDevices,
  subscribeAudioViz: (subscriber: (channel: string) => void) => {
    audio.subscriber = subscriber;
    return () => { audio.subscriber = null; };
  },
  updateAudioVizChannel: audio.update,
}));

vi.mock("components/AudioBeatStrip", () => ({
  default: ({ channel }: { channel: string }) => <div data-testid="beat-strip">{channel}</div>,
}));

vi.mock("components/AudioBpmReadout", () => ({
  default: ({ snapshot }: { snapshot: { detectedBpm: number | null } }) => (
    <span data-testid="bpm-readout">{snapshot.detectedBpm ?? "waiting"}</span>
  ),
}));

import AudioVizControls from "components/AudioVizControls";

const metrics = (level = 0, peakDecay = 0) => ({ level, peakDecay });

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  enabled: false,
  source: "microphone",
  normalize: false,
  autoGainInput: false,
  deviceId: null,
  bpmOverride: null,
  status: "idle",
  error: null,
  deviceLabel: null,
  detectedBpm: null,
  tempoStatus: "idle",
  tempoWarmupProgress: 0,
  rawMetrics: metrics(),
  normalizedMetrics: metrics(),
  metrics: metrics(),
  ...overrides,
});

const device = (deviceId: string, label: string): MediaDeviceInfo => ({
  deviceId,
  label,
  kind: "audioinput",
  groupId: "group",
  toJSON: () => ({}),
});

const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string | boolean) => {
  act(() => {
    if (typeof value === "boolean") {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(element, value);
    } else {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("AudioVizControls state boundaries", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mediaDevices: {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    audio.snapshot = snapshot();
    audio.subscriber = null;
    audio.listDevices.mockReset().mockResolvedValue([]);
    audio.requestDevices.mockReset().mockResolvedValue([]);
    audio.update.mockReset().mockResolvedValue(undefined);
    mediaDevices = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const mount = async () => {
    await act(async () => {
      root.render(<AudioVizControls channel="chain" title="Audio input" />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("lists labelled microphones, selects a device, and cleans up device listeners", async () => {
    const microphones = [device("mic-1", "Studio mic"), device("mic-2", "")];
    audio.listDevices.mockResolvedValue(microphones);
    audio.requestDevices.mockResolvedValue(microphones);
    await mount();

    expect(container.textContent).toContain("Studio mic");
    expect(container.textContent).toContain("Microphone 2");
    expect(mediaDevices.addEventListener).toHaveBeenCalledWith("devicechange", expect.any(Function));

    const selects = container.querySelectorAll<HTMLSelectElement>("select");
    setValue(selects[1], "mic-1");
    expect(audio.update).toHaveBeenCalledWith("chain", {
      source: "microphone",
      deviceId: "mic-1",
      enabled: true,
    });

    act(() => root.unmount());
    expect(mediaDevices.removeEventListener).toHaveBeenCalledWith("devicechange", expect.any(Function));
    root = createRoot(container);
  });

  it("renders live display metrics and forwards source and normalization changes", async () => {
    audio.snapshot = snapshot({
      enabled: true,
      source: "display",
      normalize: true,
      status: "live",
      detectedBpm: 128.4,
      rawMetrics: metrics(1.4, -0.2),
    });
    await mount();

    expect(container.textContent).toContain("Listening to shared audio");
    expect(container.querySelector('[data-testid="beat-strip"]')?.textContent).toBe("chain");
    expect(container.querySelector('[data-testid="bpm-readout"]')?.textContent).toBe("128.4");
    expect(container.querySelector<HTMLElement>('[title^="Beat grid"]')?.title).toContain("128 BPM");
    expect(container.querySelector<HTMLElement>('[title^="Live input"] [style*="width"]')?.style.width).toBe("100%");

    const [enabled, normalize] = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    act(() => {
      enabled.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      normalize.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(audio.update).toHaveBeenCalledWith("chain", { enabled: false });
    expect(audio.update).toHaveBeenCalledWith("chain", { normalize: false });

    const source = container.querySelector<HTMLSelectElement>("select")!;
    setValue(source, "microphone");
    expect(audio.update).toHaveBeenCalledWith("chain", { source: "microphone", enabled: true });

    audio.snapshot = snapshot({ enabled: true, source: "microphone", status: "live" });
    await act(async () => {
      audio.subscriber?.("chain");
      await Promise.resolve();
    });
    const gainAfterMic = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2];
    act(() => gainAfterMic.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(audio.update).toHaveBeenCalledWith("chain", { autoGainInput: true });
  });

  it("shows connecting, error, permission, and stale-device states after subscriptions", async () => {
    audio.snapshot = snapshot({ status: "connecting" });
    await mount();
    expect(container.textContent).toContain("Requesting permission...");
    expect(container.textContent).toContain("Connecting...");

    audio.snapshot = snapshot({
      enabled: true,
      status: "error",
      error: "Microphone denied",
      deviceId: "gone",
      deviceLabel: "Missing mic",
    });
    await act(async () => {
      audio.subscriber?.("screensaver");
      expect(container.textContent).not.toContain("Microphone denied");
      audio.subscriber?.("chain");
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Microphone denied");
    expect(container.textContent).toContain("no longer in the available device list");

    const permission = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Grant mic permission"));
    expect(permission).toBeTruthy();
    audio.requestDevices.mockResolvedValue([device("new", "Granted mic")]);
    await act(async () => {
      permission!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Granted mic");
  });

  it("survives enumeration and permission failures without exposing rejected state", async () => {
    audio.listDevices.mockRejectedValue(new Error("enumeration failed"));
    audio.requestDevices.mockRejectedValue(new Error("permission failed"));
    await mount();
    expect(container.textContent).toContain("Request permission to list microphones");
    expect(container.textContent).toContain("Idle");
  });

  it("ignores async device results after unmount", async () => {
    let resolveList!: (devices: MediaDeviceInfo[]) => void;
    let resolveRequest!: (devices: MediaDeviceInfo[]) => void;
    audio.listDevices.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    audio.requestDevices.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    act(() => root.render(<AudioVizControls channel="chain" />));
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      resolveList([device("late", "Late list")]);
      resolveRequest([device("late", "Late permission")]);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("");
  });
});
