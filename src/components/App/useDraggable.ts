import { useRef, useCallback, useEffect, useLayoutEffect, type RefObject } from "react";

const isMobile = () => window.innerWidth <= 768;

const EDGE = 8; // px from border to trigger resize
const WINDOW_MARGIN = 16;
const WINDOW_VISIBLE_X = 56;
const WINDOW_VISIBLE_Y = 36;

type Edge = "" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const getEdge = (el: HTMLElement, clientX: number, clientY: number): Edge => {
  const rect = el.getBoundingClientRect();
  const top = clientY - rect.top < EDGE;
  const bottom = rect.bottom - clientY < EDGE;
  const left = clientX - rect.left < EDGE;
  const right = rect.right - clientX < EDGE;
  if (top && left) return "nw";
  if (top && right) return "ne";
  if (bottom && left) return "sw";
  if (bottom && right) return "se";
  if (top) return "n";
  if (bottom) return "s";
  if (left) return "w";
  if (right) return "e";
  return "";
};

const edgeCursor: Record<Edge, string> = {
  "": "", n: "n-resize", s: "s-resize", e: "e-resize", w: "w-resize",
  ne: "ne-resize", nw: "nw-resize", se: "se-resize", sw: "sw-resize"
};

type DraggableOptions = {
  defaultPosition?: { x: number; y: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
  onScale?: (delta: number) => void;
  // Called during border drag with (ratio, startSize) where ratio is relative to drag start
  onScaleAbsolute?: (ratio: number, startSize: number) => void;
};

export default function useDraggable(
  ref: RefObject<HTMLElement | null>,
  { defaultPosition = { x: 0, y: 0 }, onPositionChange, onScale, onScaleAbsolute }: DraggableOptions = {},
) {
  const pos = useRef(defaultPosition);
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);

  const clampPosition = useCallback((el: HTMLElement, nextPos: { x: number; y: number }) => {
    const width = el.offsetWidth || el.getBoundingClientRect().width;
    const height = el.offsetHeight || el.getBoundingClientRect().height;
    const minX = Math.min(WINDOW_MARGIN, window.innerWidth - WINDOW_VISIBLE_X);
    const maxX = Math.max(minX, window.innerWidth - WINDOW_VISIBLE_X);
    const minY = Math.min(WINDOW_MARGIN, window.innerHeight - WINDOW_VISIBLE_Y);
    const maxY = Math.max(minY, window.innerHeight - WINDOW_VISIBLE_Y);
    return {
      x: Math.min(Math.max(minX - width, nextPos.x), maxX),
      y: Math.min(Math.max(minY - height, nextPos.y), maxY),
    };
  }, []);

  const applyClampedPosition = useCallback((
    el: HTMLElement,
    nextPos: { x: number; y: number },
    notify = true,
  ) => {
    const clamped = clampPosition(el, nextPos);
    pos.current = clamped;
    el.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    if (notify) onPositionChange?.(clamped);
  }, [clampPosition, onPositionChange]);

  const readTranslateFromStyle = (el: HTMLElement) => {
    const transform = window.getComputedStyle(el).transform;
    if (!transform || transform === "none") return null;
    const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
    if (matrix3d) {
      const parts = matrix3d[1].split(",").map((v) => Number(v.trim()));
      if (parts.length === 16) return { x: parts[12] || 0, y: parts[13] || 0 };
      return null;
    }
    const matrix2d = transform.match(/^matrix\((.+)\)$/);
    if (matrix2d) {
      const parts = matrix2d[1].split(",").map((v) => Number(v.trim()));
      if (parts.length === 6) return { x: parts[4] || 0, y: parts[5] || 0 };
      return null;
    }
    return null;
  };

  const ensureInitializedPosition = useCallback((notify = false) => {
    if (!ref.current || isMobile()) return;
    if (!initialized.current) {
      applyClampedPosition(ref.current, pos.current, notify);
      initialized.current = true;
      return;
    }
    const fromStyle = readTranslateFromStyle(ref.current);
    if (fromStyle) {
      applyClampedPosition(ref.current, fromStyle, notify);
    } else {
      applyClampedPosition(ref.current, pos.current, notify);
    }
  }, [applyClampedPosition, ref]);

  useLayoutEffect(() => {
    pos.current = defaultPosition;
    initialized.current = false;
  }, [defaultPosition.x, defaultPosition.y]);

  // Apply initial transform before paint so first drag starts from the visible position.
  useLayoutEffect(() => {
    ensureInitializedPosition();
  }, [ensureInitializedPosition, defaultPosition.x, defaultPosition.y]);

  const onMouseDown = useCallback((e: MouseEvent | React.MouseEvent<Element>) => {
    if (isMobile()) return;
    if (!ref.current) return;
    ensureInitializedPosition();

    const edge = getEdge(ref.current, e.clientX, e.clientY);

    if (edge && (onScale || onScaleAbsolute)) {
      // --- Resize mode: drag border to scale ---
      didDrag.current = true;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = ref.current.getBoundingClientRect();
      const startSize = Math.max(rect.width, rect.height);

      const onMouseMove = (e: MouseEvent) => {
        let dx = e.clientX - startX;
        let dy = e.clientY - startY;

        // Flip deltas for left/top edges (dragging left = shrinking)
        if (edge.includes("w")) dx = -dx;
        if (edge.includes("n")) dy = -dy;

        // Use the dominant axis for scale
        const dominant =
          (edge === "e" || edge === "w") ? dx :
          (edge === "n" || edge === "s") ? dy :
          (dx + dy) / 2; // corners use average

        // Ratio relative to start: 1.0 = no change, 1.5 = 50% bigger
        const scaleRatio = Math.max(0.05, 1 + dominant / startSize);
        if (onScaleAbsolute) {
          onScaleAbsolute(scaleRatio, startSize);
        }
      };

      const onMouseUp = () => {
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.body.style.cursor = edgeCursor[edge];
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      return;
    }

    // --- Drag mode: move the window ---
    dragging.current = true;
    didDrag.current = false;
    const currentPos = readTranslateFromStyle(ref.current) ?? pos.current;
    pos.current = currentPos;
    offset.current = {
      x: e.clientX - currentPos.x,
      y: e.clientY - currentPos.y,
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !ref.current) return;
      didDrag.current = true;
      applyClampedPosition(ref.current, {
        x: e.clientX - offset.current.x,
        y: e.clientY - offset.current.y,
      }, true);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [ensureInitializedPosition, ref, onScale, onScaleAbsolute]);

  // Update cursor on hover near edges
  const onMouseMove = useCallback((e: MouseEvent | React.MouseEvent<Element>) => {
    if (isMobile() || !ref.current || (!onScale && !onScaleAbsolute)) return;
    ensureInitializedPosition();
    const edge = getEdge(ref.current, e.clientX, e.clientY);
    ref.current.style.cursor = edge ? edgeCursor[edge] : "";
  }, [ensureInitializedPosition, ref, onScale, onScaleAbsolute]);

  // Scroll wheel on the window scales up/down
  // Use native listener with { passive: false } so we can preventDefault
  useEffect(() => {
    const el = ref.current;
    if (!el || !onScale) return;
    const handler = (e: WheelEvent) => {
      if (isMobile()) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      onScale(delta);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [ref, onScale]);

  useEffect(() => {
    if (isMobile()) return undefined;
    const handleResize = () => {
      if (!ref.current) return;
      ensureInitializedPosition(true);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [ensureInitializedPosition, ref]);

  return { onMouseDown, onMouseMove, didDrag };
}
