import Enum from "components/controls/Enum";
import Range from "components/controls/Range";
import { IMAGE_FORMAT_OPTIONS } from "../constants";
import { canWriteClipboard } from "../helpers";
import s from "../styles.module.css";

interface ImageTabProps {
  format: string;
  quality: number;
  resolution: string;
  customMultiplier: number;
  canvasWidth: number;
  canvasHeight: number;
  exportWidth: number;
  exportHeight: number;
  largeExport: boolean;
  canvasReady: boolean;
  copySuccess: boolean;
  setFormat: (value: string) => void;
  setQuality: (value: number) => void;
  setResolution: (value: string) => void;
  setCustomMultiplier: (value: number) => void;
  onSave: () => void;
  onCopy: () => void | Promise<void>;
}

export const ImageTab = ({
  format,
  quality,
  resolution,
  customMultiplier,
  canvasWidth,
  canvasHeight,
  exportWidth,
  exportHeight,
  largeExport,
  canvasReady,
  copySuccess,
  setFormat,
  setQuality,
  setResolution,
  setCustomMultiplier,
  onSave,
  onCopy,
}: ImageTabProps) => (
  <>
    <div className={s.row}>
      <span className={s.rowLabel}>Format</span>
      <Enum
        name="Format"
        types={IMAGE_FORMAT_OPTIONS}
        value={format}
        hideLabel
        onSetFilterOption={(_, value) => setFormat(String(value))}
      />
    </div>

    {format !== "png" && (
      <Range
        name="Quality"
        types={{ range: [0.01, 1] }}
        step={0.01}
        value={quality}
        onSetFilterOption={(_, value) => setQuality(Number(value))}
      />
    )}

    <div className={s.row}>
      <span className={s.rowLabel}>Resolution</span>
      <div className={s.radioGroup}>
        {["1", "2", "4"].map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="resolution"
              value={value}
              checked={resolution === value}
              onChange={() => setResolution(value)}
            />
            {value}x
          </label>
        ))}
        <label>
          <input
            type="radio"
            name="resolution"
            value="custom"
            checked={resolution === "custom"}
            onChange={() => setResolution("custom")}
          />
          Custom
        </label>
        {resolution === "custom" && (
          <input
            type="number"
            className={s.customInput}
            min={1}
            max={8}
            step={1}
            value={customMultiplier}
            onChange={(event) => setCustomMultiplier(Math.max(1, Math.min(8, parseInt(event.target.value) || 1)))}
          />
        )}
      </div>
    </div>

    <div className={s.dims}>
      {canvasWidth} x {canvasHeight} → {exportWidth} x {exportHeight}
    </div>

    {largeExport && (
      <div className={s.warning}>
        Large export dimensions may fail or use excessive memory.
      </div>
    )}

    <div className={s.buttons}>
      <button className={s.btn} disabled={!canvasReady} onClick={onSave}>
        Save
      </button>
      {canWriteClipboard() && (
        <button className={s.btn} disabled={!canvasReady} onClick={onCopy}>
          Copy to Clipboard
          {copySuccess && <span className={s.copyFlash}> Copied!</span>}
        </button>
      )}
    </div>
  </>
);
