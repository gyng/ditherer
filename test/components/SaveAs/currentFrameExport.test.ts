import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runCurrentFrameContactSheetExport,
  runCurrentFrameGifExport,
  runCurrentFrameSequenceExport,
} from "components/SaveAs/export/currentFrameExport";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  finalizeGif: vi.fn(),
  finalizeSequence: vi.fn(),
  finalizeContact: vi.fn(),
}));

vi.mock("components/SaveAs/export/liveFrameExport", () => ({
  captureCurrentOutputFrames: mocks.capture,
  addFrameDelay: (frame: Record<string, unknown>, delay: number) => ({ ...frame, delay }),
}));
vi.mock("components/SaveAs/export/finalizeFrameExports", () => ({
  finalizeGifExport: mocks.finalizeGif,
  finalizeSequenceExport: mocks.finalizeSequence,
  finalizeContactSheetExport: mocks.finalizeContact,
}));

const frame = {
  data: new Uint8ClampedArray([1, 2, 3, 255]),
  width: 1,
  height: 1,
};

const common = () => ({
  frameCount: 2,
  getScaledCanvas: vi.fn(() => document.createElement("canvas")),
  updateProgress: vi.fn(),
  clearProgress: vi.fn(),
  isAborted: vi.fn(() => false),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capture.mockResolvedValue({ capturedFrames: [frame], aborted: false });
  mocks.finalizeGif.mockResolvedValue(undefined);
  mocks.finalizeSequence.mockResolvedValue(undefined);
  mocks.finalizeContact.mockResolvedValue(undefined);
});

describe("current-frame export orchestration", () => {
  it("builds a palette-aware animated GIF with quantized frame delays", async () => {
    const options = {
      ...common(),
      gifFps: 20,
      clearGifResult: vi.fn(),
      setGifResult: vi.fn(),
      gifPaletteSource: "filter" as const,
      gifFilterPalette: [
        [0, 0, 0],
        [255, 255, 255],
      ],
    };

    await runCurrentFrameGifExport(options);

    expect(options.clearGifResult).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({ frameCount: 2 }));
    expect(mocks.finalizeGif).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [expect.objectContaining({ delay: 50 })],
        colorTable: options.gifFilterPalette,
        capturedFrameCount: 1,
        aborted: false,
      }),
    );
    expect(options.clearProgress).toHaveBeenCalledOnce();
  });

  it("clears GIF progress without encoding when capture yields no frames", async () => {
    mocks.capture.mockResolvedValueOnce({ capturedFrames: [], aborted: true });
    const options = {
      ...common(),
      gifFps: 10,
      clearGifResult: vi.fn(),
      setGifResult: vi.fn(),
      gifPaletteSource: "auto" as const,
      gifFilterPalette: null,
    };

    await runCurrentFrameGifExport(options);

    expect(mocks.finalizeGif).not.toHaveBeenCalled();
    expect(options.clearProgress).toHaveBeenCalledOnce();
  });

  it("publishes a zero-delay PNG sequence after a complete capture", async () => {
    const options = {
      ...common(),
      clearSequenceResult: vi.fn(),
      setSequenceResult: vi.fn(),
    };

    await runCurrentFrameSequenceExport(options);

    expect(options.clearSequenceResult).toHaveBeenCalledOnce();
    expect(mocks.finalizeSequence).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [expect.objectContaining({ delay: 0 })],
        progressBase: 0.86,
        progressSpan: 0.08,
      }),
    );
    expect(options.clearProgress).toHaveBeenCalledOnce();
  });

  it("does not publish a partial sequence after cancellation", async () => {
    mocks.capture.mockResolvedValueOnce({ capturedFrames: [frame], aborted: true });
    const options = {
      ...common(),
      clearSequenceResult: vi.fn(),
      setSequenceResult: vi.fn(),
    };

    await runCurrentFrameSequenceExport(options);

    expect(mocks.finalizeSequence).not.toHaveBeenCalled();
    expect(options.clearProgress).toHaveBeenCalledOnce();
  });

  it("publishes a contact sheet only when capture completed with frames", async () => {
    const options = {
      ...common(),
      columns: 3,
      clearContactSheetResult: vi.fn(),
      setContactSheetResult: vi.fn(),
    };

    await runCurrentFrameContactSheetExport(options);

    expect(options.clearContactSheetResult).toHaveBeenCalledOnce();
    expect(mocks.finalizeContact).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [expect.objectContaining({ delay: 0 })],
        columns: 3,
      }),
    );

    mocks.capture.mockResolvedValueOnce({ capturedFrames: [], aborted: false });
    await runCurrentFrameContactSheetExport(options);
    expect(mocks.finalizeContact).toHaveBeenCalledTimes(1);
    expect(options.clearProgress).toHaveBeenCalledTimes(2);
  });
});
