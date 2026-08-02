import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Curve from "components/controls/Curve";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
let onSetFilterOption: ReturnType<typeof vi.fn>;

const render = (value: unknown) => {
  act(() =>
    root.render(
      <Curve
        name="toneCurve"
        value={value}
        types={{ desc: "Tone mapping curve" }}
        onSetFilterOption={onSetFilterOption}
      />,
    ),
  );
};

const clickButton = (label: string) => {
  const target = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );
  expect(target).toBeTruthy();
  act(() => target!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onSetFilterOption = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Curve control", () => {
  it("normalizes fractional, unsorted, malformed, and non-string values", () => {
    render("[[1,1],[0.5,0.25],[0,0],[42]]");
    expect(container.querySelectorAll("circle")).toHaveLength(3);
    expect(container.querySelector("path")?.getAttribute("d")).toBe("M 0 255 L 128 191 L 255 0");
    expect(container.querySelector('[title="Tone mapping curve"]')).not.toBeNull();

    render("not json");
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    render({ unexpected: true });
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "[[0,0],[255,255]]",
    );
  });

  it("adds, constrains, drags, and removes interior points", () => {
    render("[[0,0],[255,255]]");
    const svg = container.querySelector("svg")!;
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 255,
        height: 255,
        right: 255,
        bottom: 255,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    act(() =>
      svg.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 64,
          clientY: 64,
        }),
      ),
    );
    expect(onSetFilterOption).toHaveBeenLastCalledWith("toneCurve", "[[0,0],[64,191],[255,255]]");
    expect(container.querySelectorAll("circle")).toHaveLength(3);

    act(() =>
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 300,
          clientY: -20,
        }),
      ),
    );
    expect(onSetFilterOption).toHaveBeenLastCalledWith("toneCurve", "[[0,0],[254,255],[255,255]]");
    act(() => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));

    const interior = container.querySelectorAll("circle")[1];
    act(() => interior.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onSetFilterOption).toHaveBeenLastCalledWith("toneCurve", "[[0,0],[255,255]]");

    const endpoint = container.querySelector("circle")!;
    act(() => endpoint.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("supports reset, inversion, and raw JSON editing", () => {
    render("[[0,20],[100,80],[255,220]]");
    clickButton("Invert");
    expect(onSetFilterOption).toHaveBeenLastCalledWith("toneCurve", "[[0,235],[100,175],[255,35]]");
    clickButton("Reset");
    expect(onSetFilterOption).toHaveBeenLastCalledWith("toneCurve", "[[0,0],[255,255]]");

    const textarea = container.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "[[0,10],[255,245]]");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSetFilterOption).toHaveBeenLastCalledWith("toneCurve", "[[0,10],[255,245]]");
  });
});
