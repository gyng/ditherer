import { describe, expect, it } from "vitest";
import { buildOfflineTimeline } from "components/SaveAs/offlineRender";

describe("buildOfflineTimeline", () => {
  it("builds exact-cadence timestamps for a loop duration", () => {
    const frames = buildOfflineTimeline(1, 4);

    expect(frames).toHaveLength(4);
    expect(frames.map((frame) => frame.timestampUs)).toEqual([
      0,
      250000,
      500000,
      750000,
    ]);
    expect(frames[3].timeSec).toBeCloseTo(0.75, 3);
    expect(frames[3].durationUs).toBe(250000);
  });

  it("keeps a final sample inside the source duration", () => {
    const frames = buildOfflineTimeline(1.1, 2);

    expect(frames).toHaveLength(3);
    expect(frames[2].timeSec).toBeLessThan(1.1);
    expect(frames[2].durationUs).toBe(100000);
  });
});
