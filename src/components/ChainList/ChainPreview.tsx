import { useEffect, useRef, useState, useCallback } from "react";
import s from "./styles.module.css";

const MAX_SIZE = 200;

interface ChainPreviewProps {
  sourceCanvas: HTMLCanvasElement;
  top: number;
  left: number;
  stepNumber: number;
  pinned?: boolean;
}

const ChainPreview = ({ sourceCanvas, top, left, stepNumber, pinned = false }: ChainPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const aspect = sourceCanvas.width / sourceCanvas.height;
  const width = aspect >= 1 ? MAX_SIZE : Math.round(MAX_SIZE * aspect);
  const height = aspect >= 1 ? Math.round(MAX_SIZE / aspect) : MAX_SIZE;

  // Live-update the preview canvas every frame via rAF
  useEffect(() => {
    let rafId: number;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(sourceCanvas, 0, 0, width, height);
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [sourceCanvas, width, height]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!pinned) return;
    e.preventDefault();
    draggingRef.current = true;
    startRef.current = { x: e.clientX, y: e.clientY, ox: dragOffset.x, oy: dragOffset.y };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      setDragOffset({
        x: startRef.current.ox + (ev.clientX - startRef.current.x),
        y: startRef.current.oy + (ev.clientY - startRef.current.y),
      });
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [pinned, dragOffset]);

  return (
    <div
      className={s.preview}
      style={{
        top: top + dragOffset.y,
        left: left + dragOffset.x,
        pointerEvents: pinned ? "auto" : "none",
        cursor: pinned ? "grab" : undefined,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={s.previewTitle}>Step {stepNumber}</div>
      <canvas ref={canvasRef} width={width} height={height} className={s.previewCanvas} />
    </div>
  );
};

export default ChainPreview;
