import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageTab } from "components/SaveAs/ui/ImageTab";
import { RecordingPanel } from "components/SaveAs/ui/RecordingPanel";
import { FrameExportPanel } from "components/SaveAs/ui/FrameExportPanel";
import { VideoTab } from "components/SaveAs/ui/VideoTab";

vi.mock("components/SaveAs/helpers", async (importOriginal) => {
  const original = await importOriginal<typeof import("components/SaveAs/helpers")>();
  return { ...original, canWriteClipboard: () => true };
});

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;

const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const click = (element: Element | null) => {
  expect(element).not.toBeNull();
  act(() => element!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((entry) =>
    entry.textContent?.includes(label),
  ) ?? null;

const callbackRecord = () =>
  new Proxy<Record<string, ReturnType<typeof vi.fn>>>(
    {},
    {
      get(target, key: string) {
        target[key] ??= vi.fn();
        return target[key];
      },
    },
  );

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("SaveAs panels", () => {
  it("routes image format, quality, resolution, and clipboard actions", () => {
    const cb = callbackRecord();
    const render = (overrides: Record<string, unknown> = {}) =>
      act(() =>
        root.render(
          <ImageTab
            {...({
              format: "png",
              quality: 0.9,
              resolution: "1",
              customMultiplier: 2,
              canvasWidth: 100,
              canvasHeight: 50,
              exportWidth: 100,
              exportHeight: 50,
              largeExport: false,
              canvasReady: true,
              copySuccess: false,
              setFormat: cb.setFormat,
              setQuality: cb.setQuality,
              setResolution: cb.setResolution,
              setCustomMultiplier: cb.setCustomMultiplier,
              onSave: cb.onSave,
              onCopy: cb.onCopy,
              ...overrides,
            } as never)}
          />,
        ),
      );
    render();
    expect(container.textContent).toContain("100 x 50 → 100 x 50");
    expect(container.textContent).not.toContain("Quality");
    setValue(container.querySelector("select")!, "jpeg");
    expect(cb.setFormat).toHaveBeenCalledWith("jpeg");
    click(container.querySelector('input[value="2"]'));
    expect(cb.setResolution).toHaveBeenCalledWith("2");
    click(button("Save"));
    click(button("Copy to Clipboard"));
    expect(cb.onSave).toHaveBeenCalled();
    expect(cb.onCopy).toHaveBeenCalled();

    render({ format: "jpeg", resolution: "custom", largeExport: true, copySuccess: true });
    expect(container.textContent).toContain("Large export dimensions");
    expect(container.textContent).toContain("Copied!");
    const quality = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    setValue(quality, "0.5");
    expect(cb.setQuality).toHaveBeenCalledWith(0.5);
    const custom = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom resolution multiplier"]',
    )!;
    setValue(custom, "99");
    expect(cb.setCustomMultiplier).toHaveBeenCalledWith(8);
    setValue(custom, "bad");
    expect(cb.setCustomMultiplier).toHaveBeenLastCalledWith(1);

    render({ canvasReady: false });
    expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  });

  it("covers the frame-export mode decision table and range/palette controls", () => {
    const cb = callbackRecord();
    const base = {
      hasSourceVideo: true,
      exporting: false,
      copySuccess: false,
      videoFormat: "gif",
      frames: 12,
      loopCaptureMode: "offline",
      loopAutoFps: true,
      gifFps: 10,
      contactColumns: 4,
      videoDuration: 8,
      loopExportScope: "loop",
      loopRangeStart: 1,
      loopRangeEnd: 7,
      canUseGifFilterPalette: false,
      gifPaletteSource: "auto",
      gifPalettePreview: [],
      gifPaletteOverflow: 0,
      gifUrl: null,
      gifResultLabel: null,
      gifBlob: null,
      sequenceBlob: null,
      contactSheetBlob: null,
      contactSheetUrl: null,
      progress: null,
      progressValue: null,
      ...Object.fromEntries(
        [
          "onSetFrames",
          "onSetLoopCaptureMode",
          "onSetLoopAutoFps",
          "onSetGifFps",
          "onSetContactColumns",
          "onSetGifPaletteSource",
          "onSetLoopExportScope",
          "onSetLoopRangeStart",
          "onSetLoopRangeEnd",
          "onAbortExport",
          "onVideoExport",
          "onSaveGif",
          "onCopyGif",
          "onSaveSequence",
          "onCopySequence",
          "onSaveContactSheet",
          "onCopyContactSheet",
        ].map((name) => [name, cb[name]]),
      ),
    };
    const render = (overrides: Record<string, unknown> = {}) =>
      act(() => root.render(<FrameExportPanel {...({ ...base, ...overrides } as never)} />));

    const descriptions = new Set<string>();
    for (const videoFormat of ["gif", "sequence", "contact"]) {
      for (const loopCaptureMode of ["realtime", "offline", "webcodecs"]) {
        render({ videoFormat, loopCaptureMode, loopAutoFps: loopCaptureMode !== "offline" });
        descriptions.add(container.textContent ?? "");
      }
    }
    expect(descriptions.size).toBe(9);

    const gif = new Blob(["gif"]);
    render({
      videoFormat: "gif",
      loopCaptureMode: "webcodecs",
      loopAutoFps: false,
      loopExportScope: "range",
      canUseGifFilterPalette: true,
      gifPaletteSource: "filter",
      gifPalettePreview: [[1, 2, 3]],
      gifPaletteOverflow: 5,
      gifUrl: "blob:gif",
      gifResultLabel: "12 frames",
      gifBlob: gif,
      copySuccess: true,
      progress: "Encoding",
      progressValue: 1.5,
    });
    expect(container.textContent).toContain("+5 more");
    expect(container.textContent).toContain("12 frames");
    expect(
      container.querySelector<HTMLImageElement>('img[alt="GIF export preview"]')?.src,
    ).toContain("blob:gif");
    expect(
      container.querySelector<HTMLElement>('[aria-hidden="true"] div')?.getAttribute("style"),
    ).toContain("100%");

    const selects = container.querySelectorAll("select");
    setValue(selects[0], "realtime");
    setValue(selects[1], "auto");
    expect(cb.onSetLoopCaptureMode).toHaveBeenCalledWith("realtime");
    expect(cb.onSetGifPaletteSource).toHaveBeenCalledWith("auto");
    for (const radio of container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      click(radio);
    expect(cb.onSetLoopExportScope).toHaveBeenCalledWith("loop");
    render({ loopExportScope: "loop" });
    click(container.querySelector('input[name="loopExportRange"][value="range"]'));
    expect(cb.onSetLoopExportScope).toHaveBeenCalledWith("range");
    render({
      videoFormat: "gif",
      loopCaptureMode: "webcodecs",
      loopAutoFps: false,
      loopExportScope: "range",
      canUseGifFilterPalette: true,
      gifPaletteSource: "filter",
      gifPalettePreview: [[1, 2, 3]],
      gifPaletteOverflow: 5,
      gifUrl: "blob:gif",
      gifResultLabel: "12 frames",
      gifBlob: gif,
      copySuccess: true,
      progress: "Encoding",
      progressValue: 1.5,
    });
    const ranges = container.querySelectorAll<HTMLInputElement>('input[type="range"]');
    for (const range of ranges) setValue(range, "3");
    expect(cb.onSetGifFps).toHaveBeenCalled();
    expect(cb.onSetLoopRangeStart).toHaveBeenCalled();
    expect(cb.onSetLoopRangeEnd).toHaveBeenCalled();
    click(button("Render Range"));
    click(button("Save"));
    click(button("Copy"));
    expect(cb.onVideoExport).toHaveBeenCalled();
    expect(cb.onSaveGif).toHaveBeenCalled();
    expect(cb.onCopyGif).toHaveBeenCalled();

    render({ exporting: true });
    click(button("Stop"));
    expect(cb.onAbortExport).toHaveBeenCalled();

    render({
      hasSourceVideo: false,
      videoFormat: "contact",
      contactSheetBlob: new Blob(),
      contactSheetUrl: "blob:sheet",
    });
    expect(container.textContent).toContain("Render Contact Sheet");
    expect(container.textContent).toContain("Contact sheet PNG ready");
    const contactRanges = container.querySelectorAll<HTMLInputElement>('input[type="range"]');
    setValue(contactRanges[0], "20");
    setValue(contactRanges[1], "5");
    expect(cb.onSetFrames).toHaveBeenCalledWith(20);
    expect(cb.onSetContactColumns).toHaveBeenCalledWith(5);
    click(button("Save"));
    expect(cb.onSaveContactSheet).toHaveBeenCalled();

    render({ videoFormat: "sequence", sequenceBlob: new Blob(), loopAutoFps: true });
    expect(container.textContent).toContain("Sequence ZIP ready");
    click(button("Save"));
    expect(cb.onSaveSequence).toHaveBeenCalled();
  });

  it("covers recording support/mode decisions and all editable recording controls", () => {
    const cb = callbackRecord();
    const base = {
      hasSourceVideo: true,
      sourceDuration: 20,
      sourceTime: 5,
      exporting: false,
      capturing: false,
      copySuccess: false,
      recordingTime: 65,
      videoVolume: 1,
      videoLoopMode: "offline",
      includeVideoAudio: true,
      reliableVideoSupport: { supported: true, audio: false },
      recordingFormats: [{ label: "WebM" }],
      recFormatOptions: { options: [{ value: "WebM" }] },
      activeRecFormatLabel: "WebM",
      autoRecordFps: true,
      recordFps: 30,
      reliableMaxFps: 24,
      autoBitrate: false,
      bitrate: 2.5,
      reliableSettleFrames: 2,
      reliableStrictValidation: true,
      reliableScope: "range",
      reliableRangeStart: 1,
      reliableRangeEnd: 10,
      videoDuration: 20,
      recordedUrl: null,
      recordedBlob: null,
      progress: null,
      progressValue: null,
      videoPreviewRef: { current: null },
      ...Object.fromEntries(
        [
          "onSetVideoLoopMode",
          "onSetIncludeVideoAudio",
          "onSetSelectedRecFormat",
          "onSetAutoRecordFps",
          "onSetRecordFps",
          "onSetReliableMaxFps",
          "onSetAutoBitrate",
          "onSetBitrate",
          "onSetReliableSettleFrames",
          "onSetReliableStrictValidation",
          "onSetReliableScope",
          "onSetReliableRangeStart",
          "onSetReliableRangeEnd",
          "onRecord",
          "onRecordLoop",
          "onSaveVideo",
          "onCopyVideo",
        ].map((name) => [name, cb[name]]),
      ),
    };
    const render = (overrides: Record<string, unknown> = {}) =>
      act(() => root.render(<RecordingPanel {...({ ...base, ...overrides } as never)} />));

    for (const mode of ["realtime", "offline", "webcodecs"]) {
      render({
        videoLoopMode: mode,
        reliableVideoSupport: { supported: true, audio: true },
        reliableStrictValidation: mode === "offline",
      });
      expect(container.textContent).toContain(
        mode === "realtime" ? "fastest" : mode === "offline" ? "Browser" : "WebCodecs",
      );
    }
    render({
      reliableVideoSupport: { supported: false, reason: "Codec unavailable", audio: false },
    });
    expect(container.textContent).toContain("Codec unavailable");

    render();
    expect(container.textContent).toContain("Source audio could not be verified");
    render({ capturing: true });
    expect(container.textContent).toContain("source 00:05 / 00:20");
    render();
    const selects = container.querySelectorAll("select");
    setValue(selects[0], "realtime");
    setValue(selects[1], "WebM");
    expect(cb.onSetVideoLoopMode).toHaveBeenCalledWith("realtime");
    expect(cb.onSetSelectedRecFormat).toHaveBeenCalledWith("WebM");
    for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      click(checkbox);
    expect(cb.onSetIncludeVideoAudio).toHaveBeenCalled();
    expect(cb.onSetAutoRecordFps).toHaveBeenCalled();
    expect(cb.onSetAutoBitrate).toHaveBeenCalled();
    expect(cb.onSetReliableStrictValidation).toHaveBeenCalled();
    for (const radio of container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      click(radio);
    expect(cb.onSetReliableScope).toHaveBeenCalled();
    for (const range of container.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      setValue(range, range.value === "1" ? "2" : "1");
    }
    expect(cb.onSetReliableMaxFps).toHaveBeenCalled();
    expect(cb.onSetBitrate).toHaveBeenCalled();
    expect(cb.onSetReliableSettleFrames).toHaveBeenCalled();
    expect(cb.onSetReliableRangeStart).toHaveBeenCalled();
    expect(cb.onSetReliableRangeEnd).toHaveBeenCalled();
    render({ recordedBlob: new Blob(["video"]) });
    click(button("Start rendering"));
    click(button("Save"));
    click(button("Copy"));
    expect(cb.onRecordLoop).toHaveBeenCalled();
    expect(cb.onSaveVideo).toHaveBeenCalled();
    expect(cb.onCopyVideo).toHaveBeenCalled();

    render({
      hasSourceVideo: false,
      videoLoopMode: "realtime",
      autoRecordFps: false,
      autoBitrate: true,
      capturing: true,
      recordedUrl: "blob:recording",
    });
    expect(container.textContent).toContain("■ Stop");
    expect(container.querySelector("video")).not.toBeNull();
    click(button("Stop"));
    expect(cb.onRecord).toHaveBeenCalled();
  });

  it("switches VideoTab between recording and each frame-export format", () => {
    const cb = callbackRecord();
    const recordingPanel = {
      hasSourceVideo: false,
      recordingFormats: [],
      recFormatOptions: { options: [] },
      videoLoopMode: "realtime",
      autoRecordFps: true,
      autoBitrate: true,
      capturing: false,
      exporting: false,
    };
    const frameExportPanel = {
      hasSourceVideo: false,
      frames: 1,
      loopCaptureMode: "offline",
      loopAutoFps: true,
      gifFps: 10,
      contactColumns: 1,
    };
    const render = (format: string) =>
      act(() =>
        root.render(
          <VideoTab
            {...({
              videoVolume: 0,
              videoFormat: format,
              videoFormatOptions: [
                { value: "recording" },
                { value: "gif" },
                { name: "contact sheet", value: "contact" },
              ],
              onSetVideoFormat: cb.onSetVideoFormat,
              recordingPanel,
              frameExportPanel,
            } as never)}
          />,
        ),
      );
    render("recording");
    expect(container.textContent).toContain("Record");
    render("gif");
    expect(container.textContent).toContain("Palette Source");
    render("contact");
    expect(container.textContent).toContain("Columns");
    click(container.querySelector('input[value="recording"]'));
    expect(cb.onSetVideoFormat).toHaveBeenCalledWith("recording");
  });
});
