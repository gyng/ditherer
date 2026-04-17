import { describe, it, expect } from "vitest";
import {
  IMAGE_FORMAT_OPTIONS,
  LOOP_CAPTURE_MODE_OPTIONS,
  VIDEO_LOOP_MODE_OPTIONS,
  RELIABLE_SCOPE_OPTIONS,
  GIF_PALETTE_SOURCE_OPTIONS,
  DEFAULT_RELIABLE_MAX_FPS,
  DEFAULT_RELIABLE_SETTLE_FRAMES,
  GIF_PALETTE_PREVIEW_LIMIT,
} from "components/SaveAs/constants";

// These constants wire directly into saved-state + URL sharing — a rename or
// reordering here would silently invalidate older saved chains. Guard the
// value keys (not labels) so translation tweaks don't break the tests.

describe("SaveAs constants", () => {
  it("exposes the three still-image formats in stable order", () => {
    expect(IMAGE_FORMAT_OPTIONS.options.map((o) => o.value)).toEqual(["png", "jpeg", "webp"]);
  });

  it("offers the same capture-mode values for loop + video export dialogs", () => {
    const loop = LOOP_CAPTURE_MODE_OPTIONS.options.map((o) => o.value).sort();
    const video = VIDEO_LOOP_MODE_OPTIONS.options.map((o) => o.value).sort();
    expect(loop).toEqual(video);
    expect(loop).toContain("realtime");
    expect(loop).toContain("offline");
    expect(loop).toContain("webcodecs");
  });

  it("keeps the reliable-scope option keys wired to the orchestrator", () => {
    expect(RELIABLE_SCOPE_OPTIONS.options.map((o) => o.value)).toEqual(["loop", "range"]);
  });

  it("keeps the GIF palette source keys wired to the palette auto-detect path", () => {
    expect(GIF_PALETTE_SOURCE_OPTIONS.options.map((o) => o.value)).toEqual(["auto", "filter"]);
  });

  it("ships sane defaults for the reliable exporter", () => {
    expect(DEFAULT_RELIABLE_MAX_FPS).toBeGreaterThan(0);
    expect(DEFAULT_RELIABLE_MAX_FPS).toBeLessThanOrEqual(60);
    expect(DEFAULT_RELIABLE_SETTLE_FRAMES).toBeGreaterThanOrEqual(0);
    expect(GIF_PALETTE_PREVIEW_LIMIT).toBeGreaterThan(0);
  });
});
