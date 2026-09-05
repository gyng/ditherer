import { afterEach, describe, expect, it, vi } from "vitest";
import { getReliableVideoSupport } from "components/SaveAs/export/offlineVideoEncode";

afterEach(() => vi.unstubAllGlobals());

describe("getReliableVideoSupport", () => {
  it.each([false, true])(
    "probes silent video support without audio APIs (codec supported: %s)",
    async (supported) => {
      const isConfigSupported = vi.fn(async () => ({ supported }));
      vi.stubGlobal("VideoEncoder", { isConfigSupported });
      vi.stubGlobal("VideoFrame", class {});
      vi.stubGlobal("AudioContext", undefined);
      vi.stubGlobal("webkitAudioContext", undefined);
      vi.stubGlobal("OfflineAudioContext", undefined);
      const result = await getReliableVideoSupport(16, 16, 30, false);
      expect(result.supported).toBe(supported);
      expect(result.audio).toBe(false);
      expect(isConfigSupported).toHaveBeenCalled();
      if (!supported) expect(result.reason).toContain("video encoder configuration");
    },
  );
});
