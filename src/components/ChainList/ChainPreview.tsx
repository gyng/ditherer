import { useEffect, useRef } from "react";
import s from "./styles.module.css";

const MAX_SIZE = 200;

interface ChainPreviewProps {
  sourceCanvas: HTMLCanvasElement;
  top: number;
  left: number;
  stepNumber: number;
}

const ChainPreview = ({ sourceCanvas, top, left, stepNumber }: ChainPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const aspect = sourceCanvas.width / sourceCanvas.height;
  const width = aspect >= 1 ? MAX_SIZE : Math.round(MAX_SIZE * aspect);
  const height = aspect >= 1 ? Math.round(MAX_SIZE / aspect) : MAX_SIZE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
  }, [sourceCanvas, width, height]);

  return (
    <div
      className={s.preview}
      style={{ top, left }}
    >
      <div className={s.previewTitle}>Step {stepNumber}</div>
      <canvas ref={canvasRef} width={width} height={height} className={s.previewCanvas} />
    </div>
  );
};

export default ChainPreview;
