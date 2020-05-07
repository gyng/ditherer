import { laba2rgba, rgba2laba } from "../laba";

describe("laba", () => {
  it("converts between rgba and laba without mutating input", () => {
    const input = new Uint8ClampedArray([16, 32, 64, 255]);
    const laba = rgba2laba(input);
    expect(input).not.toBe(laba);
    const rgba = laba2rgba(laba);
    expect(input).not.toBe(rgba);
    expect(input).toEqual(rgba);
  });
});
