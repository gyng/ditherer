import React, { useEffect, useMemo, useRef } from "react";
import type { FilterOptionValues } from "filters/types";
import { getOrderedThresholdMapPreview } from "filters/ordered";

import s from "./styles.module.css";

type ThresholdMapPreviewProps = {
  name: string;
  label?: string | undefined;
  desc?: string | undefined;
  options: FilterOptionValues;
  sourceOption?: string | undefined;
  polarityOption?: string | undefined;
};

const drawPreview = (
  canvas: HTMLCanvasElement,
  data: number[][],
) => {
  const height = data.length;
  const width = data[0]?.length ?? 0;
  if (!width || !height) return;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.max(0, Math.min(255, Math.round((data[y][x] ?? 0) * 255)));
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
};

const ThresholdMapPreview = ({
  name,
  label,
  desc,
  options,
  sourceOption = "thresholdMap",
  polarityOption = "thresholdPolarity",
}: ThresholdMapPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapKey = String(options[sourceOption] ?? "");
  const polarity = String(options[polarityOption] ?? "");

  const preview = useMemo(
    () => getOrderedThresholdMapPreview(mapKey, polarity),
    [mapKey, polarity],
  );

  useEffect(() => {
    if (canvasRef.current && preview) drawPreview(canvasRef.current, preview.thresholdMap);
  }, [preview]);

  if (!preview) return null;

  const title = `${preview.name} - ${preview.width}x${preview.height}, ${preview.levels} levels`;

  return (
    <div className={s.thresholdPreview}>
      <div className={s.label}>
        {label || name}
        {desc && <span className={s.info} title={desc}>(i)</span>}
      </div>
      <canvas
        ref={canvasRef}
        className={s.thresholdPreviewCanvas}
        title={title}
        aria-label={title}
      />
      <div className={s.thresholdPreviewMeta}>{title}</div>
    </div>
  );
};

export default ThresholdMapPreview;
