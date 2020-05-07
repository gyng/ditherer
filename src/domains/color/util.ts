import { SurfaceApplyMut } from "../surface";

export const clamp = (min: number, max: number, value: number): number =>
  Math.max(min, Math.min(max, value));

export type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Uint8ClampedArray
  | Float32Array
  | Float64Array;

/** Does 1:1 mapping of user-defined elements between TypedArrays */
export function convertTypedArray<T extends TypedArray, U extends TypedArray>(
  inBuf: T,
  outBuf: U,
  convertMut: (inView: T, outView: U) => void,
  inStep: number,
  outStep: number
): void {
  const iterations = inBuf.length / inStep;

  for (let i = 0; i < iterations; i++) {
    const inIdx = i * inStep;
    // TODO: check if .subarray is causing lots of GC collections
    const inView = inBuf.subarray(inIdx, inIdx + inStep);
    const outIdx = i * outStep;
    const outView = outBuf.subarray(outIdx, outIdx + outStep);

    if (inView && outView) {
      // @ts-ignore this should work fine
      convertMut(inView, outView);
    }
  }
}

export const rgba = (
  r: number,
  g: number,
  b: number,
  a = 255
): Uint8ClampedArray => {
  return new Uint8ClampedArray([r, g, b, a]);
};

export const gammaCorrectSingle = (val: number, gamma = 2.2): number => {
  return 255 * (val / 255) ** (1 / gamma);
};

export const gammaCorrectMut: (gamma: number) => SurfaceApplyMut<TypedArray> = (
  gamma = 2.2
) => (px) => {
  if (px.length !== 4) {
    throw new Error("cannot gamma correct invalid pixel");
  }

  px[0] = gammaCorrectSingle(px[0], gamma);
  px[1] = gammaCorrectSingle(px[1], gamma);
  px[2] = gammaCorrectSingle(px[2], gamma);
};
