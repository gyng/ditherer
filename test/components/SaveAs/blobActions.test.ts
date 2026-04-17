import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBlob, copyBlobWithFeedback } from "components/SaveAs/export/blobActions";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("saveBlob", () => {
  it("is a no-op when either blob or ext is missing", () => {
    // Spy the underlying downloadBlob via a URL.createObjectURL watch —
    // downloadBlob calls that first, so if it were invoked we'd see a call.
    const spy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:noop");
    saveBlob(null, "png");
    saveBlob(new Blob(["hi"]), null);
    saveBlob(null, null);
    expect(spy).not.toHaveBeenCalled();
  });

  it("kicks off a download when both blob and ext are present", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // Stub the anchor so we don't actually trigger a navigation attempt.
    const click = vi.fn();
    const original = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        return { href: "", download: "", click } as unknown as HTMLAnchorElement;
      }
      return original(tag);
    });

    saveBlob(new Blob(["data"]), "png");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});

describe("copyBlobWithFeedback", () => {
  it("early-returns on null blob without touching the setCopySuccess callback", async () => {
    const setCopySuccess = vi.fn();
    await copyBlobWithFeedback(null, setCopySuccess, "warn");
    expect(setCopySuccess).not.toHaveBeenCalled();
  });

  it("sets success true, then resets after the timeout fires", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    // Install a minimal clipboard stub — jsdom's navigator.clipboard may be
    // missing or read-only, so we always overwrite for the duration of
    // this test.
    const nav = navigator as Navigator & { clipboard?: Clipboard };
    const originalClipboard = nav.clipboard;
    Object.defineProperty(nav, "clipboard", {
      value: { write },
      configurable: true,
    });
    // ClipboardItem may be missing in jsdom; provide a passthrough.
    const originalCI = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = function ClipboardItem(data: unknown) {
      return { data };
    } as never;

    const setCopySuccess = vi.fn();
    await copyBlobWithFeedback(new Blob(["x"]), setCopySuccess, "warn");
    expect(setCopySuccess).toHaveBeenNthCalledWith(1, true);
    vi.advanceTimersByTime(2000);
    expect(setCopySuccess).toHaveBeenNthCalledWith(2, false);

    // Restore to avoid leaking into later tests.
    Object.defineProperty(nav, "clipboard", { value: originalClipboard, configurable: true });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalCI;
  });

  it("console.warns when the clipboard write rejects, leaving success untouched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const write = vi.fn().mockRejectedValue(new Error("denied"));
    const nav = navigator as Navigator & { clipboard?: Clipboard };
    const originalClipboard = nav.clipboard;
    Object.defineProperty(nav, "clipboard", { value: { write }, configurable: true });
    const originalCI = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = function ClipboardItem(data: unknown) {
      return { data };
    } as never;

    const setCopySuccess = vi.fn();
    await copyBlobWithFeedback(new Blob(["y"]), setCopySuccess, "clipboard unavailable");
    expect(setCopySuccess).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("clipboard unavailable", expect.any(Error));

    Object.defineProperty(nav, "clipboard", { value: originalClipboard, configurable: true });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalCI;
  });
});
