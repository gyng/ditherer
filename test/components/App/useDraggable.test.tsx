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
}: {
  position: { x: number; y: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useDraggable(ref, { defaultPosition: position, onPositionChange });
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
      root.render(<DraggableProbe position={{ x: 120, y: 80 }} onPositionChange={onPositionChange} />);
    });

    const element = container.firstElementChild as HTMLElement;
    attachRectStub(element);

    act(() => {
      element.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        clientX: 170,
        clientY: 130,
      }));
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 250,
        clientY: 210,
      }));
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
      root.render(<DraggableProbe position={{ x: 120, y: 80 }} onPositionChange={onPositionChange} />);
    });

    const element = container.firstElementChild as HTMLElement;
    attachStaticOffsetRectStub(element, { x: 10, y: 10 });

    act(() => {
      element.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        clientX: 150,
        clientY: 110,
      }));
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 160,
        clientY: 120,
      }));
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 130, y: 90 });
    expect(element.style.transform).toBe("translate(130px, 90px)");
  });
});
