import { rgbToCss } from "../helpers";
import s from "../styles.module.css";

interface ExportProgressProps {
  progress: string | null;
  progressValue: number | null;
}

interface ResultActionsProps {
  blob: Blob | null;
  canWriteClipboard: boolean;
  copySuccess: boolean;
  onSave: () => void;
  onCopy: () => void | Promise<void>;
}

interface GifPalettePreviewProps {
  preview: number[][];
  overflow: number;
}

export const ExportProgress = ({ progress, progressValue }: ExportProgressProps) => {
  if (!progress) {
    return null;
  }

  return (
    <>
      {progressValue != null && (
        <div className={s.progressBar} aria-hidden="true">
          <div
            className={s.progressBarFill}
            style={{ width: `${Math.max(0, Math.min(100, progressValue * 100))}%` }}
          />
        </div>
      )}
      <div className={s.progress}>{progress}</div>
    </>
  );
};

export const ResultActions = ({
  blob,
  canWriteClipboard,
  copySuccess,
  onSave,
  onCopy,
}: ResultActionsProps) => (
  <div className={s.buttons}>
    <button className={s.btn} disabled={!blob} onClick={onSave}>
      Save
    </button>
    {canWriteClipboard && (
      <button className={s.btn} disabled={!blob} onClick={onCopy}>
        Copy
        {copySuccess && <span className={s.copyFlash}> Copied!</span>}
      </button>
    )}
  </div>
);

export const GifPalettePreview = ({ preview, overflow }: GifPalettePreviewProps) => (
  <div className={s.palettePreview} title="GIF palette preview from the current filter palette.">
    {preview.map((color, index) => (
      <span
        key={`${color.join("-")}-${index}`}
        className={s.paletteSwatch}
        style={{ backgroundColor: rgbToCss(color) }}
        title={rgbToCss(color)}
      />
    ))}
    {overflow > 0 && (
      <span className={s.paletteMore}>+{overflow} more</span>
    )}
  </div>
);
