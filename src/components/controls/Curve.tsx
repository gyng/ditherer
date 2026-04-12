import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ControlProps } from "./types";

import s from "./styles.module.css";

type CurvePoint = [number, number];

const DEFAULT_POINTS: CurvePoint[] = [
  [0, 0],
  [255, 255]
];

const clamp255 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const parsePoints = (value: string): CurvePoint[] => {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return DEFAULT_POINTS;
    const points = parsed
      .filter((entry) => Array.isArray(entry) && entry.length >= 2)
      .map((entry) => {
        const rawX = Number(entry[0]);
        const rawY = Number(entry[1]);
        const normalized = rawX <= 1 && rawY <= 1;
        return [
          clamp255(normalized ? rawX * 255 : rawX),
          clamp255(normalized ? rawY * 255 : rawY)
        ] as CurvePoint;
      })
      .sort((a, b) => a[0] - b[0]);

    if (points.length < 2) return DEFAULT_POINTS;
    points[0] = [0, points[0][1]];
    points[points.length - 1] = [255, points[points.length - 1][1]];
    return points;
  } catch {
    return DEFAULT_POINTS;
  }
};

const serializePoints = (points: CurvePoint[]) =>
  JSON.stringify(points.map(([x, y]) => [clamp255(x), clamp255(y)]));

const Curve = (props: ControlProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState(typeof props.value === "string" ? props.value : serializePoints(DEFAULT_POINTS));
  const points = useMemo(() => parsePoints(draft), [draft]);

  useEffect(() => {
    setDraft(typeof props.value === "string" ? props.value : serializePoints(DEFAULT_POINTS));
  }, [props.value]);

  const commit = (nextPoints: CurvePoint[]) => {
    const ordered = nextPoints
      .map(([x, y]) => [clamp255(x), clamp255(y)] as CurvePoint)
      .sort((a, b) => a[0] - b[0]);
    ordered[0] = [0, ordered[0][1]];
    ordered[ordered.length - 1] = [255, ordered[ordered.length - 1][1]];
    const serialized = serializePoints(ordered);
    setDraft(serialized);
    props.onSetFilterOption(props.name, serialized);
  };

  const getLocalPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = ((clientX - rect.left) / rect.width) * 255;
    const y = 255 - ((clientY - rect.top) / rect.height) * 255;
    return [clamp255(x), clamp255(y)] as CurvePoint;
  };

  useEffect(() => {
    if (dragIndex == null) return undefined;

    const handleMove = (event: PointerEvent) => {
      const point = getLocalPoint(event.clientX, event.clientY);
      if (!point) return;
      const next = points.map((entry, index) => {
        if (index !== dragIndex) return entry;
        const minX = dragIndex === 0 ? 0 : points[dragIndex - 1][0] + 1;
        const maxX = dragIndex === points.length - 1 ? 255 : points[dragIndex + 1][0] - 1;
        return [
          dragIndex === 0 || dragIndex === points.length - 1
            ? entry[0]
            : Math.max(minX, Math.min(maxX, point[0])),
          point[1]
        ] as CurvePoint;
      });
      commit(next);
    };

    const handleUp = () => setDragIndex(null);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [commit, dragIndex, points]);

  const pathD = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${255 - y}`)
    .join(" ");

  return (
    <div className={s.curveControl}>
      <div className={s.label}>
        {props.name}
        {props.types?.desc && <span className={s.info} title={props.types.desc}>(i)</span>}
      </div>
      <div className={s.curveMeta}>Click to add points, drag to shape, double-click a point to remove it.</div>
      <svg
        ref={svgRef}
        className={s.curveEditor}
        viewBox="0 0 255 255"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.dataset.pointIndex != null) return;
          const point = getLocalPoint(event.clientX, event.clientY);
          if (!point) return;
          const next = [...points, point].sort((a, b) => a[0] - b[0]);
          commit(next);
          setDragIndex(next.findIndex(([x, y]) => x === point[0] && y === point[1]));
        }}
      >
        {[0, 64, 128, 192, 255].map((value) => (
          <React.Fragment key={value}>
            <line x1={value} y1={0} x2={value} y2={255} className={s.curveGridLine} />
            <line x1={0} y1={value} x2={255} y2={value} className={s.curveGridLine} />
          </React.Fragment>
        ))}
        <polyline points="0,255 255,0" className={s.curveBaseline} />
        <path d={pathD} className={s.curvePath} />
        {points.map(([x, y], index) => (
          <circle
            key={`${x}-${y}-${index}`}
            data-point-index={index}
            cx={x}
            cy={255 - y}
            r={index === 0 || index === points.length - 1 ? 6 : 5}
            className={s.curvePoint}
            onPointerDown={(event) => {
              event.stopPropagation();
              setDragIndex(index);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (index === 0 || index === points.length - 1 || points.length <= 2) return;
              commit(points.filter((_, pointIndex) => pointIndex !== index));
            }}
          />
        ))}
      </svg>
      <div className={s.curveToolbar}>
        <button
          type="button"
          onClick={() => commit(DEFAULT_POINTS)}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            const inverse = points.map(([x, y]) => [x, 255 - y] as CurvePoint);
            inverse[0] = [0, inverse[0][1]];
            inverse[inverse.length - 1] = [255, inverse[inverse.length - 1][1]];
            commit(inverse);
          }}
        >
          Invert
        </button>
      </div>
      <textarea
        className={s.curveTextarea}
        value={draft}
        wrap="off"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          props.onSetFilterOption(props.name, event.target.value);
        }}
      />
    </div>
  );
};

export default Curve;
