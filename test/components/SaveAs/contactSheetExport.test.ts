import { describe, expect, it } from "vitest";
import { calculateContactSheetLayout } from "components/SaveAs/export/contactSheetExport";

describe("contactSheetExport", () => {
  it("calculates a bounded grid layout from frame count and preferred columns", () => {
    expect(calculateContactSheetLayout(7, 160, 90, 3)).toEqual({
      columns: 3,
      rows: 3,
      width: 24 + 3 * 160 + 2 * 10,
      height: 24 + 3 * 90 + 2 * 10,
      frameWidth: 160,
      frameHeight: 90,
      gap: 10,
      padding: 12,
    });
  });

  it("clamps columns so sparse sheets do not create empty leading slots", () => {
    expect(calculateContactSheetLayout(2, 100, 50, 6).columns).toBe(2);
  });
});
