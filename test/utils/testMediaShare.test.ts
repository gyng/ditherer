import { describe, expect, it } from "vitest";

import {
  getShareableTestMediaSearch,
  parseSharedTestMedia,
  updateTestMediaSearch,
} from "utils/testMediaShare";

describe("test media URL sharing", () => {
  it.each([
    ["?testMedia=image%3Apepper.png", { kind: "image", file: "pepper.png" }],
    ["?testMedia=video%3Aakiyo.mp4", { kind: "video", file: "akiyo.mp4" }],
  ] as const)("parses an allow-listed bundled source from %s", (search, expected) => {
    expect(parseSharedTestMedia(search)).toEqual(expected);
  });

  it.each([
    "?testMedia=image:missing.png",
    "?testMedia=video:../akiyo.mp4",
    "?testMedia=https://example.com/video.mp4",
    "?testMedia=blob:1234",
    "?testMedia=image:",
  ])("rejects an unshareable or malformed source: %s", (search) => {
    expect(parseSharedTestMedia(search)).toBeNull();
  });

  it("updates or removes only the test-media parameter", () => {
    expect(updateTestMediaSearch("?debug=1", { kind: "image", file: "pepper.png" }))
      .toBe("?debug=1&testMedia=image%3Apepper.png");
    expect(updateTestMediaSearch("?debug=1&testMedia=image%3Apepper.png", { kind: "video", file: "akiyo.mp4" }))
      .toBe("?debug=1&testMedia=video%3Aakiyo.mp4");
    expect(updateTestMediaSearch("?debug=1&testMedia=video%3Aakiyo.mp4", null))
      .toBe("?debug=1");
  });

  it("copies only a valid test-media parameter into explicit share URLs", () => {
    expect(getShareableTestMediaSearch("?debug=1&testMedia=video%3Aakiyo.mp4"))
      .toBe("?testMedia=video%3Aakiyo.mp4");
    expect(getShareableTestMediaSearch("?debug=1&testMedia=video%3Amissing.mp4"))
      .toBe("");
  });
});
