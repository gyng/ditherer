import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSaveAsResults } from "components/SaveAs/hooks/useSaveAsResults";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useSaveAsResults>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

const Harness = () => {
  latest = useSaveAsResults();
  return null;
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let serial = 0;
  createObjectURL = vi.fn(() => `blob:result-${++serial}`);
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  act(() => root.render(<Harness />));
});

afterEach(() => {
  if (container.isConnected) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("useSaveAsResults", () => {
  it("replaces and clears artifact URLs without leaking previous objects", () => {
    const first = new Blob(["first"]);
    const second = new Blob(["second"]);
    act(() => latest.setRecordedResult(first));
    expect(latest.recordedBlob).toBe(first);
    expect(latest.recordedUrl).toBe("blob:result-1");
    act(() => latest.setRecordedResult(second));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:result-1");
    expect(latest.recordedUrl).toBe("blob:result-2");
    act(() => latest.clearRecordedResult());
    expect(latest.recordedBlob).toBeNull();
    expect(latest.recordedUrl).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:result-2");

    act(() => latest.setGifResult(first, "5 frames"));
    expect(latest.gifResultLabel).toBe("5 frames");
    expect(latest.gifUrl).toBe("blob:result-3");
    act(() => latest.clearGifResult());
    expect(latest.gifBlob).toBeNull();
    expect(latest.gifResultLabel).toBeNull();
    expect(latest.gifUrl).toBeNull();

    act(() => latest.setContactSheetResult(second));
    expect(latest.contactSheetUrl).toBe("blob:result-4");
    act(() => latest.clearContactSheetResult());
    expect(latest.contactSheetBlob).toBeNull();
    expect(latest.contactSheetUrl).toBeNull();
  });

  it("tracks sequence blobs and revokes live previews during unmount", () => {
    const blob = new Blob(["artifact"]);
    act(() => {
      latest.setSequenceResult(blob);
      latest.setRecordedResult(blob);
      latest.setGifResult(blob, "ready");
      latest.setContactSheetResult(blob);
    });
    expect(latest.sequenceBlob).toBe(blob);
    act(() => latest.clearSequenceResult());
    expect(latest.sequenceBlob).toBeNull();

    act(() => root.unmount());
    container.remove();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:result-1");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:result-2");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:result-3");
  });
});
