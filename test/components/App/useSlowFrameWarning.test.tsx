import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import useSlowFrameWarning, {
  SLOW_FRAME_HIDE_DELAY_MS,
  SLOW_FRAME_SHOW_DELAY_MS,
} from "components/App/useSlowFrameWarning";

let latest = false;
const Probe = ({ frameTime }: { frameTime: number | null }) => {
  latest = useSlowFrameWarning(frameTime);
  return null;
};

describe("useSlowFrameWarning", () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (frameTime: number | null) =>
    act(() => root.render(<Probe frameTime={frameTime} />));
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    root = createRoot(container);
    latest = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("warns only after sustained slow frames and clears after sustained recovery", () => {
    render(80);
    expect(latest).toBe(false);
    advance(SLOW_FRAME_SHOW_DELAY_MS - 1);
    expect(latest).toBe(false);
    advance(1);
    expect(latest).toBe(true);

    for (let i = 0; i < 20; i += 1) render(20 + i / 100);
    advance(SLOW_FRAME_HIDE_DELAY_MS - 1);
    expect(latest).toBe(true);
    advance(1);
    expect(latest).toBe(false);
  });

  it("does not flap when frame times jitter around the threshold", () => {
    for (let i = 0; i < 40; i += 1) {
      render((i % 2 ? 44 : 52) + i / 1000);
      advance(100);
    }
    expect(latest).toBe(false);

    for (let i = 0; i < 30; i += 1) render(70 + i / 100);
    advance(SLOW_FRAME_SHOW_DELAY_MS);
    expect(latest).toBe(true);
    for (let i = 0; i < 40; i += 1) {
      render((i % 2 ? 44 : 52) + i / 1000);
      advance(100);
    }
    expect(latest).toBe(true);
  });

  it("ignores a single slow frame", () => {
    for (let i = 0; i < 10; i += 1) render(20 + i / 100);
    render(300);
    for (let i = 0; i < 10; i += 1) render(20 + i / 100);
    advance(SLOW_FRAME_SHOW_DELAY_MS * 2);
    expect(latest).toBe(false);
  });
});
