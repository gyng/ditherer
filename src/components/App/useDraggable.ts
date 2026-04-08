import { useRef, useCallback, useEffect } from "react";

const isMobile = () => window.innerWidth <= 768;

export default function useDraggable(ref, { defaultPosition = { x: 0, y: 0 } } = {}) {
  const pos = useRef(defaultPosition);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (ref.current && !isMobile()) {
      ref.current.style.transform = `translate(${pos.current.x}px, ${pos.current.y}px)`;
    }
  }, [ref]);

  const onMouseDown = useCallback((e) => {
    if (isMobile()) return;
    if (!ref.current) return;
    dragging.current = true;
    offset.current = {
      x: e.clientX - pos.current.x,
      y: e.clientY - pos.current.y,
    };

    const onMouseMove = (e) => {
      if (!dragging.current || !ref.current) return;
      const x = e.clientX - offset.current.x;
      const y = Math.max(0, e.clientY - offset.current.y); // bound top
      pos.current = { x, y };
      ref.current.style.transform = `translate(${x}px, ${y}px)`;
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [ref]);

  return { onMouseDown };
}
