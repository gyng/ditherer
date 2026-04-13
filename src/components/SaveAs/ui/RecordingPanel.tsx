import Enum from "components/controls/Enum";
import Range from "components/controls/Range";
import {
  DEFAULT_RELIABLE_MAX_FPS,
  DEFAULT_RELIABLE_SETTLE_FRAMES,
  RELIABLE_SCOPE_OPTIONS,
  VIDEO_LOOP_MODE_OPTIONS,
} from "../constants";
import { canWriteClipboard, formatTime } from "../helpers";
import { ExportProgress, ResultActions } from "./sections";
import type { RecordingPanelProps } from "./VideoTabTypes";
import s from "../styles.module.css";

const recordingModeHelper = (
  mode: "realtime" | "offline" | "webcodecs",
  includeVideoAudio: boolean,
  videoVolume: number,
  support: RecordingPanelProps["reliableVideoSupport"],
  strictValidation: boolean,
) => {
  if (mode === "realtime") {
    return `Realtime recording is the fastest option. It captures the live filtered canvas${includeVideoAudio && videoVolume > 0 ? " and can keep source audio" : ""}, but can also reflect playback hiccups.`;
  }
  if (mode === "offline") {
    return support?.supported
      ? `Offline Render (Browser) is slower but steadier. It samples exact timestamps with browser seek and exports WebM${includeVideoAudio && videoVolume > 0 ? " with source audio" : ""} via WebCodecs.${strictValidation ? " Strict validation is slower but more conservative." : " Fast validation is on for quicker seeks."}`
      : (support?.reason || "Offline Render (Browser) needs WebCodecs video encoding support in this browser.");
  }
  return support?.supported
    ? `Offline Render (WebCodecs) can be faster or slower depending on the source. It decodes source frames with WebCodecs before the offline render pass, then exports WebM${includeVideoAudio && videoVolume > 0 ? " with source audio" : ""}. It may fall back to the browser path if decode fails.`
    : (support?.reason || "Offline Render (WebCodecs) needs WebCodecs video encoding support in this browser.");
};

export const RecordingPanel = ({
  hasSourceVideo,
  sourceDuration,
  sourceTime,
  exporting,
  capturing,
  copySuccess,
  recordingTime,
  videoVolume,
  videoLoopMode,
  includeVideoAudio,
  reliableVideoSupport,
  recordingFormats,
  recFormatOptions,
  activeRecFormatLabel,
  autoRecordFps,
  recordFps,
  reliableMaxFps,
  autoBitrate,
  bitrate,
  reliableSettleFrames,
  reliableStrictValidation,
  reliableScope,
  reliableRangeStart,
  reliableRangeEnd,
  videoDuration,
  recordedUrl,
  recordedBlob,
  progress,
  progressValue,
  onSetVideoLoopMode,
  onSetIncludeVideoAudio,
  onSetSelectedRecFormat,
  onSetAutoRecordFps,
  onSetRecordFps,
  onSetReliableMaxFps,
  onSetAutoBitrate,
  onSetBitrate,
  onSetReliableSettleFrames,
  onSetReliableStrictValidation,
  onSetReliableScope,
  onSetReliableRangeStart,
  onSetReliableRangeEnd,
  onRecord,
  onRecordLoop,
  videoPreviewRef,
  onSaveVideo,
  onCopyVideo,
}: RecordingPanelProps) => (
  <>
    {hasSourceVideo && (
      <>
        <div className={s.row}>
          <span className={s.rowLabel}>
            Capture Mode
            <span className={s.inlineInfo} title="Choose between realtime loop recording and deterministic reliable offline rendering.">(i)</span>
          </span>
          <Enum
            name="Capture Mode"
            types={VIDEO_LOOP_MODE_OPTIONS}
            value={videoLoopMode}
            hideLabel
            onSetFilterOption={(_, value) => onSetVideoLoopMode(value as "offline" | "realtime" | "webcodecs")}
          />
        </div>
        <div className={s.helperText}>
          {recordingModeHelper(videoLoopMode, includeVideoAudio, videoVolume, reliableVideoSupport, reliableStrictValidation)}
        </div>
        <div className={s.row}>
          <span className={s.rowLabel}>
            Audio
            <span className={s.inlineInfo} title="Include or exclude audio from the source video in exported video files. This is separate from preview volume, so muted playback can still export audio.">(i)</span>
          </span>
          <label className={s.checkboxLabel}>
            <input
              type="checkbox"
              checked={includeVideoAudio}
              onChange={(event) => onSetIncludeVideoAudio(event.target.checked)}
            />
            Include source audio
          </label>
        </div>
        <div className={s.helperText}>
          Preview volume and export audio are separate. You can mute playback and still include source audio in the final video.
        </div>
        {videoLoopMode !== "realtime" && reliableVideoSupport?.audio === false && includeVideoAudio && reliableVideoSupport?.supported && (
          <div className={s.helperText}>
            Source audio could not be verified for reliable export, so the render may fall back to silent video.
          </div>
        )}
      </>
    )}

    {recordingFormats.length > 0 && (
      <div className={s.row}>
        <span className={s.rowLabel}>
          Codec
          <span className={s.inlineInfo} title="Select the browser-supported recording codec/container for realtime capture.">(i)</span>
        </span>
        <Enum
          name="Codec"
          types={recFormatOptions}
          value={activeRecFormatLabel}
          hideLabel
          onSetFilterOption={(_, value) => onSetSelectedRecFormat(String(value))}
        />
      </div>
    )}

    <div className={s.row}>
      <span className={s.rowLabel}>
        FPS
        <span className={s.inlineInfo} title="Frames per second for export. Turn Auto off to choose a fixed FPS manually.">(i)</span>
      </span>
      <div className={s.fpsControls}>
        <label className={s.checkboxLabel}>
          <input
            type="checkbox"
            checked={autoRecordFps}
            onChange={(event) => onSetAutoRecordFps(event.target.checked)}
          />
          Auto
        </label>
        {hasSourceVideo && videoLoopMode !== "realtime" && autoRecordFps && (
          <div className={s.inlineSliderGroup}>
            <span className={s.inlineSliderLabel}>
              Max Encoding FPS
              <span className={s.inlineInfo} title="When Auto FPS is on, reliable export uses the lower of the source-estimated FPS and this cap. Lower values speed up export by encoding fewer frames.">(i)</span>
            </span>
            <div className={s.inlineSliderRow}>
              <input
                className={s.slider}
                type="range"
                min={6}
                max={30}
                step={1}
                value={reliableMaxFps}
                onChange={(event) => onSetReliableMaxFps(parseInt(event.target.value) || DEFAULT_RELIABLE_MAX_FPS)}
              />
              <span className={s.sliderValue}>{reliableMaxFps}</span>
            </div>
          </div>
        )}
      </div>
    </div>
    {!autoRecordFps && (
      <Range
        name="fps"
        types={{ range: [1, 60] }}
        step={1}
        value={recordFps}
        onSetFilterOption={(_, value) => onSetRecordFps(Number(value))}
      />
    )}

    <div className={s.row}>
      <span className={s.rowLabel}>
        Bitrate
        <span className={s.inlineInfo} title="Controls output quality and file size for realtime recording. Higher bitrate usually means larger files and fewer compression artifacts.">(i)</span>
      </span>
      <label className={s.checkboxLabel}>
        <input
          type="checkbox"
          checked={autoBitrate}
          onChange={(event) => onSetAutoBitrate(event.target.checked)}
        />
        Auto
        <span className={s.inlineInfo} title="When enabled, the browser chooses the recording bitrate automatically.">(i)</span>
      </label>
    </div>
    {!autoBitrate && (
      <div className={s.row}>
        <span className={s.rowLabel}>
          Mbps
          <span className={s.inlineInfo} title="Manual recording bitrate in megabits per second.">(i)</span>
        </span>
        <div className={s.sliderRow}>
          <input
            className={s.slider}
            type="range"
            min={0.5}
            max={20}
            step={0.5}
            value={bitrate}
            onChange={(event) => onSetBitrate(parseFloat(event.target.value) || 0.5)}
          />
          <span className={s.sliderValue}>{bitrate}</span>
        </div>
      </div>
    )}

    {hasSourceVideo && videoLoopMode !== "realtime" && (
      <>
        <div className={s.row}>
          <span className={s.rowLabel}>
            Settle
            <span className={s.inlineInfo} title="How many animation frames to wait after each seek before capturing. Lower is faster; higher is safer if you see wrong-frame captures.">(i)</span>
          </span>
          <div className={s.sliderRow}>
            <input
              className={s.slider}
              type="range"
              min={1}
              max={2}
              step={1}
              value={reliableSettleFrames}
              onChange={(event) => onSetReliableSettleFrames(parseInt(event.target.value) || DEFAULT_RELIABLE_SETTLE_FRAMES)}
            />
            <span className={s.sliderValue}>{reliableSettleFrames}</span>
          </div>
        </div>
        <div className={s.row}>
          <span className={s.rowLabel}>
            Validation
            <span className={s.inlineInfo} title={`Fast mode waits for \`seeked\` plus ${reliableSettleFrames} animation frame${reliableSettleFrames === 1 ? "" : "s"}. Turn strict validation on only if you see wrong-frame captures.`}>(i)</span>
          </span>
          <label className={s.checkboxLabel}>
            <input
              type="checkbox"
              checked={reliableStrictValidation}
              onChange={(event) => onSetReliableStrictValidation(event.target.checked)}
            />
            Strict frame validation
          </label>
        </div>
        <div className={s.row}>
          <span className={s.rowLabel}>
            Export Range
            <span className={s.inlineInfo} title="Choose whether reliable export covers the full loop or only a selected timestamp range.">(i)</span>
          </span>
          <div className={s.radioGroup}>
            {RELIABLE_SCOPE_OPTIONS.options.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="reliableExportRange"
                  value={option.value}
                  checked={reliableScope === option.value}
                  onChange={() => onSetReliableScope(option.value as "loop" | "range")}
                />
                {option.name || option.value}
              </label>
            ))}
          </div>
        </div>
      </>
    )}

    {hasSourceVideo && videoLoopMode !== "realtime" && reliableScope === "range" && (
      <>
        <div className={s.row}>
          <span className={s.rowLabel}>Start <span className={s.inlineInfo} title="Start timestamp for reliable export.">(i)</span></span>
          <div className={s.sliderRow}>
            <input
              className={s.slider}
              type="range"
              min={0}
              max={Math.max(0, videoDuration)}
              step={0.01}
              value={Math.min(reliableRangeStart, Math.max(0, reliableRangeEnd - 0.01))}
              onChange={(event) => onSetReliableRangeStart(Math.min(parseFloat(event.target.value) || 0, Math.max(0, reliableRangeEnd - 0.01)))}
            />
            <span className={s.sliderValue}>{reliableRangeStart.toFixed(2)}</span>
          </div>
        </div>
        <div className={s.row}>
          <span className={s.rowLabel}>End <span className={s.inlineInfo} title="End timestamp for reliable export.">(i)</span></span>
          <div className={s.sliderRow}>
            <input
              className={s.slider}
              type="range"
              min={0.01}
              max={Math.max(0.01, videoDuration)}
              step={0.01}
              value={Math.max(reliableRangeEnd, Math.min(videoDuration, reliableRangeStart + 0.01))}
              onChange={(event) => onSetReliableRangeEnd(Math.max(parseFloat(event.target.value) || 0.01, Math.min(videoDuration, reliableRangeStart + 0.01)))}
            />
            <span className={s.sliderValue}>{reliableRangeEnd.toFixed(2)}</span>
          </div>
        </div>
      </>
    )}

    <div className={s.buttons}>
      {videoLoopMode === "realtime" && (
        <button className={s.btn} disabled={exporting} onClick={onRecord}>
          {capturing ? "\u25A0 Stop" : "\u25CF Record"}
        </button>
      )}
      {hasSourceVideo && (
        <button
          className={s.btn}
          disabled={capturing || (videoLoopMode !== "realtime" && !exporting && reliableVideoSupport?.supported === false)}
          onClick={onRecordLoop}
          title={videoLoopMode === "realtime" ? "Seek to start and record one full loop" : (reliableVideoSupport?.reason || "Start offline rendering")}
        >
          {videoLoopMode === "realtime" ? "⟲ Record loop" : exporting ? "Stop render" : "Start rendering"}
        </button>
      )}
    </div>
    {capturing && (
      <>
        <div className={s.rec}>
          ● REC {formatTime(recordingTime)}
          {hasSourceVideo && sourceDuration > 0 && (
            <span className={s.sourceTimecode}>
              {" "}· source {formatTime(Math.floor(sourceTime))} / {formatTime(Math.floor(sourceDuration))}
            </span>
          )}
        </div>
        {hasSourceVideo && sourceDuration > 0 && (
          <div className={s.seekbar}>
            <div
              className={s.seekbarFill}
              style={{ width: `${Math.min(100, (sourceTime / sourceDuration) * 100)}%` }}
            />
          </div>
        )}
      </>
    )}

    {(capturing || recordedUrl) && (
      <video
        ref={videoPreviewRef}
        className={s.videoPreview}
        controls={!capturing}
        autoPlay
        loop
        playsInline
      />
    )}
    <ResultActions
      blob={recordedBlob}
      canWriteClipboard={canWriteClipboard()}
      copySuccess={copySuccess}
      onSave={onSaveVideo}
      onCopy={onCopyVideo}
    />
    <ExportProgress progress={progress} progressValue={progressValue} />
  </>
);
