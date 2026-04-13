import { RecordingPanel } from "./RecordingPanel";
import { FrameExportPanel } from "./FrameExportPanel";
import type {
  VideoFormatOption,
  RecordingPanelProps,
  FrameExportPanelProps,
} from "./VideoTabTypes";
import s from "../styles.module.css";

interface VideoTabProps {
  videoVolume: number;
  videoFormat: string;
  videoFormatOptions: VideoFormatOption[];
  onSetVideoFormat: (value: string) => void;
  recordingPanel: RecordingPanelProps;
  frameExportPanel: FrameExportPanelProps;
}

export const VideoTab = ({
  videoVolume,
  videoFormat,
  videoFormatOptions,
  onSetVideoFormat,
  recordingPanel,
  frameExportPanel,
}: VideoTabProps) => {
  return (
    <div className={s.videoTab}>
    <div className={s.row}>
      <span className={s.rowLabel}>
        Format
        <span
          className={s.inlineInfo}
          title="Choose the export output type. Recording uses realtime capture, while GIF and sequence export sampled frames."
        >
          (i)
        </span>
      </span>
      <div className={s.radioGroup}>
        {videoFormatOptions.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="videoFormat"
              value={option.value}
              checked={videoFormat === option.value}
              onChange={() => onSetVideoFormat(option.value)}
            />
            {option.name || option.value}
          </label>
        ))}
      </div>
    </div>

    {videoFormat === "recording" && <RecordingPanel {...recordingPanel} videoVolume={videoVolume} />}
    {(videoFormat === "gif" || videoFormat === "sequence") && <FrameExportPanel {...frameExportPanel} videoFormat={videoFormat} />}
  </div>
  );
};
