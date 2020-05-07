import { convertTypedArray } from "..";

describe("color utils", () => {
  it("converts between typedarrays", () => {
    const inbuf = new Float32Array([-16, 0, 32]);
    const outbuf = new Uint8ClampedArray(inbuf.length);
    // Absolutes and multiplies by 2
    const convert = (inView: Float32Array, outView: Uint8ClampedArray) => {
      const newView = inView.map((x) => Math.abs(x) * 2);
      outView.set(newView);
    };

    convertTypedArray(inbuf, outbuf, convert, 1, 1);
    expect(outbuf).toEqual(new Uint8ClampedArray([32, 0, 64]));
  });
});
