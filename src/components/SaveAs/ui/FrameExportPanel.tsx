import Enum from "components/controls/Enum";
import { GIF_PALETTE_SOURCE_OPTIONS, LOOP_CAPTURE_MODE_OPTIONS, RELIABLE_SCOPE_OPTIONS } from "../constants";
import { canWriteClipboard } from "../helpers";
import { ExportProgress, GifPalettePreview, ResultActions } from "./sections";
import type { FrameExportPanelProps } from "./VideoTabTypes";
import s from "../styles.module.css";

const frameModeHelper = (
  videoFormat: string,
  loopCaptureMode: "realtime" | "offline" | "webcodecs",
  loopAutoFps: boolean,
) => {
  const description = videoFormat === "gif"
    ? (loopCaptureMode === "realtime"
      ? "Realtime GIF export is the fastest option. It follows the visible player, but it is more likely to reflect playback hiccups or timing drift."
      : loopCaptureMode === "offline"
        ? "Offline Render (Browser) is slower but steadier. It samples source timestamps with browser seek, runs each frame through the offline renderer, and then encodes the GIF."
        : "Offline Render (WebCodecs) can be faster or slower depending on the source. It decodes source frames with WebCodecs before the offline render pass, then encodes the GIF. It may fall back automatically if decode fails.")
    : videoFormat === "sequence"
      ? (loopCaptureMode === "realtime"
        ? "Realtime playback is the fastest option. It follows the playing source and can use decoded frame callbacks when available, but it can still reflect playback hiccups."
        : loopCaptureMode === "offline"
          ? "Offline Render (Browser) is slower but steadier. It samples the loop at exact timestamps with browser seek and stays the default because it is the safer choice for matching a loop precisely."
          : "Offline Render (WebCodecs) can be faster or slower depending on the source. It decodes source frames before the offline render pass and avoids relying on browser seek for source-frame access.")
      : (loopCaptureMode === "realtime"
        ? "Realtime contact sheet export samples the currently playing output and arranges the captured frames into a grid."
        : loopCaptureMode === "offline"
          ? "Offline Render (Browser) samples evenly spaced timestamps with browser seek, then builds a contact sheet from the rendered frames."
          : "Offline Render (WebCodecs) decodes source frames around the requested timestamps before rendering the sampled contact sheet grid.");
  return videoFormat === "contact"
    ? description
    : `${description}${loopAutoFps ? " Match source is on." : " Manual FPS is on."}`;
};

export const FrameExportPanel = ({
  hasSourceVideo,
  exporting,
  copySuccess,
  videoFormat,
  frames,
  loopCaptureMode,
  loopAutoFps,
  gifFps,
  contactColumns,
  videoDuration,
  loopExportScope,
  loopRangeStart,
  loopRangeEnd,
  canUseGifFilterPalette,
  gifPaletteSource,
  gifPalettePreview,
  gifPaletteOverflow,
  gifUrl,
  gifResultLabel,
  gifBlob,
  sequenceBlob,
  contactSheetBlob,
  contactSheetUrl,
  progress,
  progressValue,
  onSetFrames,
  onSetLoopCaptureMode,
  onSetLoopAutoFps,
  onSetGifFps,
  onSetContactColumns,
  onSetGifPaletteSource,
  onSetLoopExportScope,
  onSetLoopRangeStart,
  onSetLoopRangeEnd,
  onAbortExport,
  onVideoExport,
  onSaveGif,
  onCopyGif,
  onSaveSequence,
  onCopySequence,
  onSaveContactSheet,
  onCopyContactSheet,
}: FrameExportPanelProps) => {
  const startRenderLabel = hasSourceVideo
    ? loopExportScope === "range"
      ? "Render Range"
      : "Render Whole Video"
    : videoFormat === "contact"
      ? "Render Contact Sheet"
      : "Render Frames";

  return (
  <>
    <div className={s.row}>
      <span className={s.rowLabel}>
        Capture Mode
        <span className={s.inlineInfo} title="Choose between realtime playback, Offline Render (Browser), or Offline Render (WebCodecs).">(i)</span>
      </span>
      <Enum
        name="Capture Mode"
        types={LOOP_CAPTURE_MODE_OPTIONS}
        value={loopCaptureMode}
        hideLabel
        onSetFilterOption={(_, value) => onSetLoopCaptureMode(value as "offline" | "realtime" | "webcodecs")}
      />
    </div>
    {(!hasSourceVideo || videoFormat === "contact") && (
      <div className={s.row}>
        <span className={s.rowLabel}>
          {videoFormat === "contact" ? "Samples" : "Frames"}
          <span className={s.inlineInfo} title={videoFormat === "contact" ? "Number of frames to sample into the contact sheet." : "Number of frames to export when rendering from the current live output instead of a source video loop."}>(i)</span>
        </span>
        <div className={s.sliderRow}>
          <input
            className={s.slider}
            type="range"
            min={1}
            max={videoFormat === "contact" ? 64 : 120}
            step={1}
            value={frames}
            onChange={(event) => onSetFrames(parseInt(event.target.value) || 1)}
          />
          <span className={s.sliderValue}>{frames}</span>
        </div>
      </div>
    )}
    {videoFormat !== "contact" && (
      <>
        <div className={s.row}>
          <span className={s.rowLabel}>
            FPS
            <span className={s.inlineInfo} title={videoFormat === "gif" ? "Frames per second for GIF export. Match source uses the source video's estimated cadence for offline frame sampling." : "Frames per second for GIF or sequence export. Match source uses the source video's estimated cadence when exporting a loop."}>(i)</span>
          </span>
          <div className={s.fpsControls}>
            <label className={s.checkboxLabel}>
              <input
                type="checkbox"
                checked={loopAutoFps}
                onChange={(event) => onSetLoopAutoFps(event.target.checked)}
              />
              Match source
            </label>
          </div>
        </div>
        {!loopAutoFps && (
          <div className={s.row}>
            <span className={s.rowLabel}>Manual FPS</span>
            <div className={s.sliderRow}>
              <input
                className={s.slider}
                type="range"
                min={1}
                max={60}
                step={1}
                value={gifFps}
                onChange={(event) => onSetGifFps(parseInt(event.target.value) || 1)}
              />
              <span className={s.sliderValue}>{gifFps}</span>
            </div>
          </div>
        )}
      </>
    )}
    {videoFormat === "contact" && (
      <div className={s.row}>
        <span className={s.rowLabel}>
          Columns
          <span className={s.inlineInfo} title="How many thumbnails to place in each row of the contact sheet.">(i)</span>
        </span>
        <div className={s.sliderRow}>
          <input
            className={s.slider}
            type="range"
            min={1}
            max={Math.max(1, frames)}
            step={1}
            value={contactColumns}
            onChange={(event) => onSetContactColumns(parseInt(event.target.value) || 1)}
          />
          <span className={s.sliderValue}>{contactColumns}</span>
        </div>
      </div>
    )}
    <div className={s.helperText}>
      {frameModeHelper(videoFormat, loopCaptureMode, loopAutoFps)}
    </div>

    {videoFormat === "gif" && (
      <>
        <div className={s.row}>
          <span className={s.rowLabel}>
            Palette Source
            <span className={s.inlineInfo} title="Auto builds a GIF palette from the offline-rendered export frames. Current filter palette reuses the active filter's explicit color list when available.">(i)</span>
          </span>
          <Enum
            name="Palette Source"
            types={{
              options: canUseGifFilterPalette
                ? GIF_PALETTE_SOURCE_OPTIONS.options
                : [GIF_PALETTE_SOURCE_OPTIONS.options[0]],
            }}
            value={canUseGifFilterPalette ? gifPaletteSource : "auto"}
            hideLabel
            onSetFilterOption={(_, value) => onSetGifPaletteSource(value as "filter" | "auto")}
          />
        </div>
        <div className={s.helperText}>
          {canUseGifFilterPalette
            ? "Current filter palette is available, so the GIF can reuse your active palette instead of deriving one from the rendered frames."
            : "No explicit filter palette is active right now, so GIF export will derive a palette from the offline-rendered frames."}
        </div>
        {canUseGifFilterPalette && (
          <GifPalettePreview preview={gifPalettePreview} overflow={gifPaletteOverflow} />
        )}
      </>
    )}

    {hasSourceVideo && (
      <div className={s.row}>
        <span className={s.rowLabel}>
          Export Range
          <span className={s.inlineInfo} title={videoFormat === "gif" ? "Choose whether GIF export samples the whole video or only a selected timestamp range before encoding." : videoFormat === "sequence" ? "Choose whether sequence export covers the whole video or only a selected timestamp range." : "Choose whether the contact sheet samples the whole video or only a selected timestamp range."}>(i)</span>
        </span>
        <div className={s.radioGroup}>
          {RELIABLE_SCOPE_OPTIONS.options.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="loopExportRange"
                value={option.value}
                checked={loopExportScope === option.value}
                onChange={() => onSetLoopExportScope(option.value as "loop" | "range")}
              />
              {option.name || option.value}
            </label>
          ))}
        </div>
      </div>
    )}

    {hasSourceVideo && loopExportScope === "range" && (
      <>
        <div className={s.row}>
          <span className={s.rowLabel}>Start <span className={s.inlineInfo} title={videoFormat === "contact" ? "Start timestamp for contact sheet sampling." : "Start timestamp for GIF or sequence export."}>(i)</span></span>
          <div className={s.sliderRow}>
            <input
              className={s.slider}
              type="range"
              min={0}
              max={Math.max(0, videoDuration)}
              step={0.01}
              value={Math.min(loopRangeStart, Math.max(0, loopRangeEnd - 0.01))}
              onChange={(event) => onSetLoopRangeStart(Math.min(parseFloat(event.target.value) || 0, Math.max(0, loopRangeEnd - 0.01)))}
            />
            <span className={s.sliderValue}>{loopRangeStart.toFixed(2)}</span>
          </div>
        </div>
        <div className={s.row}>
          <span className={s.rowLabel}>End <span className={s.inlineInfo} title={videoFormat === "contact" ? "End timestamp for contact sheet sampling." : "End timestamp for GIF or sequence export."}>(i)</span></span>
          <div className={s.sliderRow}>
            <input
              className={s.slider}
              type="range"
              min={0.01}
              max={Math.max(0.01, videoDuration)}
              step={0.01}
              value={Math.max(loopRangeEnd, Math.min(videoDuration, loopRangeStart + 0.01))}
              onChange={(event) => onSetLoopRangeEnd(Math.max(parseFloat(event.target.value) || 0.01, Math.min(videoDuration, loopRangeStart + 0.01)))}
            />
            <span className={s.sliderValue}>{loopRangeEnd.toFixed(2)}</span>
          </div>
        </div>
      </>
    )}

    <div className={s.buttons}>
      <button className={s.btn} onClick={exporting ? onAbortExport : onVideoExport}>
        {exporting ? "Stop" : startRenderLabel}
      </button>
    </div>

    {videoFormat === "gif" && gifUrl && (
      <>
        <img
          src={gifUrl}
          className={s.videoPreview}
          alt="GIF export preview"
        />
        {gifResultLabel && (
          <div className={s.helperText}>
            {gifResultLabel}
          </div>
        )}
      </>
    )}

    {videoFormat === "gif" && (
      <ResultActions
        blob={gifBlob}
        canWriteClipboard={canWriteClipboard()}
        copySuccess={copySuccess}
        onSave={onSaveGif}
        onCopy={onCopyGif}
      />
    )}

    {videoFormat === "sequence" && sequenceBlob && (
      <div className={s.helperText}>
        Sequence ZIP ready to save or copy.
      </div>
    )}

    {videoFormat === "sequence" && (
      <ResultActions
        blob={sequenceBlob}
        canWriteClipboard={canWriteClipboard()}
        copySuccess={copySuccess}
        onSave={onSaveSequence}
        onCopy={onCopySequence}
      />
    )}

    {videoFormat === "contact" && contactSheetUrl && (
      <img
        src={contactSheetUrl}
        className={s.videoPreview}
        alt="Contact sheet export preview"
      />
    )}

    {videoFormat === "contact" && contactSheetBlob && (
      <div className={s.helperText}>
        Contact sheet PNG ready to save or copy.
      </div>
    )}

    {videoFormat === "contact" && (
      <ResultActions
        blob={contactSheetBlob}
        canWriteClipboard={canWriteClipboard()}
        copySuccess={copySuccess}
        onSave={onSaveContactSheet}
        onCopy={onCopyContactSheet}
      />
    )}

    <ExportProgress progress={progress} progressValue={progressValue} />
  </>
  );
};
