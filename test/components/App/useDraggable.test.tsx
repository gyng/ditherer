import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useRef } from "react";
import useDraggable from "components/App/useDraggable";

const parseTranslate = (transform: string) => {
  const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  return {
    x: match ? Number(match[1]) : 0,
    y: match ? Number(match[2]) : 0,
  };
};

const attachRectStub = (element: HTMLElement, width = 160, height = 120) => {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: width });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
  element.getBoundingClientRect = () => {
    const { x, y } = parseTranslate(element.style.transform || "");
    return {
      x,
      y,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };
};

const attachStaticOffsetRectStub = (
  element: HTMLElement,
  baseOffset: { x: number; y: number },
  width = 160,
  height = 120,
) => {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: width });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
  element.getBoundingClientRect = () => {
    const { x, y } = parseTranslate(element.style.transform || "");
    const left = baseOffset.x + x;
    const top = baseOffset.y + y;
    return {
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };
};

const DraggableProbe = ({
  position,
  onPositionChange,
  onScale,
  onScaleAbsolute,
}: {
  position: { x: number; y: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
  onScale?: (delta: number) => void;
  onScaleAbsolute?: (ratio: number, startSize: number) => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useDraggable(ref, {
    defaultPosition: position,
    onPositionChange,
    onScale,
    onScaleAbsolute,
  });
  return (
    <div
      ref={ref}
      role="presentation"
      onMouseDown={drag.onMouseDown}
      onMouseMove={drag.onMouseMove}
    />
  );
};

describe("useDraggable", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
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
    vi.restoreAllMocks();
  });

  it("repositions the element when defaultPosition changes", () => {
    act(() => {
      root.render(<DraggableProbe position={{ x: 120, y: 80 }} />);
    });

    const element = container.firstElementChild as HTMLElement;
    attachRectStub(element);

    act(() => {
      root.render(<DraggableProbe position={{ x: 260, y: 180 }} />);
    });

    expect(element.style.transform).toBe("translate(260px, 180px)");
  });

  it("reports dragged positions through onPositionChange", () => {
    const onPositionChange = vi.fn();

    act(() => {
      root.render(
        <DraggableProbe position={{ x: 120, y: 80 }} onPositionChange={onPositionChange} />,
      );
    });

    const element = container.firstElementChild as HTMLElement;
    attachRectStub(element);

    act(() => {
      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 170,
          clientY: 130,
        }),
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 250,
          clientY: 210,
        }),
      );
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(onPositionChange).toHaveBeenCalled();
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 200, y: 160 });
    expect(element.style.transform).toBe("translate(200px, 160px)");
  });

  it("does not jump on first drag when the element has a static base offset", () => {
    const onPositionChange = vi.fn();

    act(() => {
      root.render(
        <DraggableProbe position={{ x: 120, y: 80 }} onPositionChange={onPositionChange} />,
      );
    });

    const element = container.firstElementChild as HTMLElement;
    attachStaticOffsetRectStub(element, { x: 10, y: 10 });

    act(() => {
      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 150,
          clientY: 110,
        }),
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 160,
          clientY: 120,
        }),
      );
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 130, y: 90 });
    expect(element.style.transform).toBe("translate(130px, 90px)");
  });

  it("identifies every resize edge and clears the cursor over the interior", () => {
    const onScaleAbsolute = vi.fn();
    act(() => {
      root.render(
        <DraggableProbe position={{ x: 100, y: 80 }} onScaleAbsolute={onScaleAbsolute} />,
      );
    });
    const element = container.firstElementChild as HTMLElement;
    attachRectStub(element);

    const cases = [
      [101, 81, "nw-resize"],
      [259, 81, "ne-resize"],
      [101, 199, "sw-resize"],
      [259, 199, "se-resize"],
      [180, 81, "n-resize"],
      [180, 199, "s-resize"],
      [101, 140, "w-resize"],
      [259, 140, "e-resize"],
      [180, 140, ""],
    ] as const;

    for (const [clientX, clientY, cursor] of cases) {
      act(() => {
        element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
      });
      expect(element.style.cursor).toBe(cursor);
    }
  });

  it("scales from horizontal, vertical, and corner borders and releases listeners", () => {
    const onScaleAbsolute = vi.fn();
    act(() => {
      root.render(
        <DraggableProbe position={{ x: 100, y: 80 }} onScaleAbsolute={onScaleAbsolute} />,
      );
    });
    const element = container.firstElementChild as HTMLElement;
    attachRectStub(element, 160, 120);

    const resize = (start: { x: number; y: number }, end: { x: number; y: number }) => {
      act(() => {
        element.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: start.x,
            clientY: start.y,
          }),
        );
        document.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: end.x,
            clientY: end.y,
          }),
        );
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    };

    resize({ x: 259, y: 140 }, { x: 299, y: 140 });
    expect(onScaleAbsolute).toHaveBeenLastCalledWith(1.25, 160);
    expect(document.body.style.cursor).toBe("");

    resize({ x: 180, y: 81 }, { x: 180, y: 41 });
    expect(onScaleAbsolute).toHaveBeenLastCalledWith(1.25, 160);

    resize({ x: 101, y: 81 }, { x: 501, y: 481 });
    expect(onScaleAbsolute).toHaveBeenLastCalledWith(0.05, 160);

    const callsAfterRelease = onScaleAbsolute.mock.calls.length;
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 900, clientY: 900 }),
      );
    });
    expect(onScaleAbsolute).toHaveBeenCalledTimes(callsAfterRelease);
  });

  it("scales with the wheel in both directions and removes the native listener", () => {
    const onScale = vi.fn();
    act(() => {
      root.render(<DraggableProbe position={{ x: 40, y: 30 }} onScale={onScale} />);
    });
    const element = container.firstElementChild as HTMLElement;
    attachRectStub(element);

    const down = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 10 });
    const up = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -10 });
    act(() => {
      element.dispatchEvent(down);
      element.dispatchEvent(up);
    });
    expect(onScale.mock.calls).toEqual([[-0.1], [0.1]]);
    expect(down.defaultPrevented).toBe(true);

    act(() => root.render(<DraggableProbe position={{ x: 40, y: 30 }} />));
    act(() => element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 10 })));
    expect(onScale).toHaveBeenCalledTimes(2);
  });

  it("recovers two- and three-dimensional transform matrices and clamps on viewport resize", () => {
    const onPositionChange = vi.fn();
    const getComputedStyle = vi.spyOn(window, "getComputedStyle");
    getComputedStyle.mockReturnValue({
      transform: "matrix(1, 0, 0, 1, 40, 50)",
    } as CSSStyleDeclaration);
    act(() => {
      root.render(<DraggableProbe position={{ x: 0, y: 0 }} onPositionChange={onPositionChange} />);
    });
    const element = container.firstElementChild as HTMLElement;
    attachRectStub(element, 160, 120);

    act(() => {
      element.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 120, clientY: 130 }),
      );
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 60, y: 80 });

    getComputedStyle.mockReturnValue({
      transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 900, 700, 0, 1)",
    } as CSSStyleDeclaration);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 900, y: 700 });

    getComputedStyle.mockReturnValue({ transform: "matrix3d(1, 2)" } as CSSStyleDeclaration);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(element.style.transform).toBe("translate(900px, 700px)");

    getComputedStyle.mockReturnValue({ transform: "matrix(1, 2)" } as CSSStyleDeclaration);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(element.style.transform).toBe("translate(900px, 700px)");
  });

  it("keeps windows reachable in tiny viewports and disables desktop gestures on mobile", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 40 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 30 });
    const onPositionChange = vi.fn();
    const onScale = vi.fn();
    act(() => {
      root.render(
        <DraggableProbe
          position={{ x: 500, y: 500 }}
          onPositionChange={onPositionChange}
          onScale={onScale}
        />,
      );
    });
    const element = container.firstElementChild as HTMLElement;
    attachRectStub(element, 160, 120);

    act(() => {
      element.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 20, clientY: 20 }),
      );
      element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 1, clientY: 1 }));
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 10 }));
      window.dispatchEvent(new Event("resize"));
    });
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(onScale).not.toHaveBeenCalled();
    expect(element.style.cursor).toBe("");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  });
});
