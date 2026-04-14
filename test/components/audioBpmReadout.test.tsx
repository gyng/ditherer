import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import AudioBpmReadout from "components/AudioBpmReadout";
import AudioBeatStrip from "components/AudioBeatStrip";
import { setGlobalAudioVizModulation } from "utils/audioVizBridge";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  // Reset shared bridge state so tests don't bleed
  setGlobalAudioVizModulation("chain", null);
  setGlobalAudioVizModulation("screensaver", null);
});

const mount = (element: React.ReactElement) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
};

describe("AudioBpmReadout", () => {
  it("renders 'off' when the channel is disabled", () => {
    mount(<AudioBpmReadout channel="chain" />);
    expect(container!.textContent).toMatch(/off/i);
  });

  it("renders a fixed BPM when given an external snapshot", () => {
    const snapshot = {
      enabled: true,
      source: "microphone" as const,
      normalize: false,
      deviceId: null,
      bpmOverride: null,
      status: "live" as const,
      error: null,
      deviceLabel: null,
      detectedBpm: 120,
      tempoStatus: "locked" as const,
      tempoWarmupProgress: 1,
      rawMetrics: {} as never,
      normalizedMetrics: {} as never,
      metrics: {} as never,
    };
    mount(<AudioBpmReadout channel="chain" snapshot={snapshot} />);
    expect(container!.textContent).toContain("120");
  });

  it("appends override suffix when bpmOverride is set", () => {
    const snapshot = {
      enabled: true,
      source: "microphone" as const,
      normalize: false,
      deviceId: null,
      bpmOverride: 100,
      status: "live" as const,
      error: null,
      deviceLabel: null,
      detectedBpm: 100,
      tempoStatus: "locked" as const,
      tempoWarmupProgress: 1,
      rawMetrics: {} as never,
      normalizedMetrics: {} as never,
      metrics: {} as never,
    };
    mount(<AudioBpmReadout channel="chain" snapshot={snapshot} />);
    expect(container!.textContent).toMatch(/override/i);
  });

  it("renders a pending state with spinner text for warmup", () => {
    const snapshot = {
      enabled: true,
      source: "microphone" as const,
      normalize: false,
      deviceId: null,
      bpmOverride: null,
      status: "live" as const,
      error: null,
      deviceLabel: null,
      detectedBpm: null,
      tempoStatus: "warmup" as const,
      tempoWarmupProgress: 0.4,
      rawMetrics: {} as never,
      normalizedMetrics: {} as never,
      metrics: {} as never,
    };
    mount(<AudioBpmReadout channel="chain" snapshot={snapshot} />);
    expect(container!.textContent).toMatch(/%/);
  });
});

describe("AudioBeatStrip", () => {
  it("renders the requested number of boxes", () => {
    mount(<AudioBeatStrip channel="chain" boxes={5} height={12} />);
    // Boxes are rendered as <div> children of the wrapping flex div.
    const wrapper = container!.firstElementChild!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.children.length).toBe(5);
  });

  it("defaults to 4 boxes when none specified", () => {
    mount(<AudioBeatStrip channel="chain" />);
    const wrapper = container!.firstElementChild!;
    expect(wrapper.children.length).toBe(4);
  });

  it("attaches a tooltip when no BPM has been detected yet", () => {
    mount(<AudioBeatStrip channel="chain" />);
    const wrapper = container!.firstElementChild!;
    expect(wrapper.getAttribute("title")).toMatch(/no detected bpm/i);
  });
});
