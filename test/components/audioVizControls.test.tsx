import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import AudioVizControls from "components/AudioVizControls";
import { setGlobalAudioVizModulation } from "utils/audioVizBridge";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  // Minimal navigator.mediaDevices stub so the component's device-enumeration
  // effects can resolve without actually touching the host audio stack.
  const mediaDevices = {
    enumerateDevices: vi.fn().mockResolvedValue([]),
    getUserMedia: vi.fn().mockRejectedValue(new Error("not available in test")),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
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

describe("AudioVizControls", () => {
  it("renders a title when provided", () => {
    mount(<AudioVizControls channel="chain" title="Input" />);
    expect(container!.textContent).toContain("Input");
  });

  it("renders the enable checkbox and source select", () => {
    mount(<AudioVizControls channel="chain" />);
    const checkboxes = container!.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    const selects = container!.querySelectorAll<HTMLSelectElement>("select");
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(selects.length).toBeGreaterThan(0);
    // Source select has two options: microphone + display
    const sourceOptions = Array.from(selects[0].options).map((option) => option.value);
    expect(sourceOptions).toContain("microphone");
    expect(sourceOptions).toContain("display");
  });

  it("renders the normalize checkbox with label text", () => {
    mount(<AudioVizControls channel="chain" />);
    expect(container!.textContent.toLowerCase()).toContain("normalize");
  });

  it("renders independently per channel without crashing", () => {
    mount(<AudioVizControls channel="screensaver" title="Screensaver" />);
    expect(container!.textContent).toContain("Screensaver");
  });
});
