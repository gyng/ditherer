const clampValue = (min: number, max: number, value: number) =>
  Math.max(min, Math.min(max, value));
const getIndex = (x: number, y: number, width: number) => (y * width + x) * 4;

export const sampleNearest = (
  buf: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  out: number[] = [0, 0, 0, 0]
) => {
  const sx = Math.round(clampValue(0, width - 1, x));
  const sy = Math.round(clampValue(0, height - 1, y));
  const i = getIndex(sx, sy, width);
  out[0] = buf[i] ?? 0;
  out[1] = buf[i + 1] ?? 0;
  out[2] = buf[i + 2] ?? 0;
  out[3] = buf[i + 3] ?? 0;
  return out;
};

export const sampleBilinear = (
  buf: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  out: number[] = [0, 0, 0, 0]
) => {
  const sx = clampValue(0, width - 1, x);
  const sy = clampValue(0, height - 1, y);

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const tx = sx - x0;
  const ty = sy - y0;

  const i00 = getIndex(x0, y0, width);
  const i10 = getIndex(x1, y0, width);
  const i01 = getIndex(x0, y1, width);
  const i11 = getIndex(x1, y1, width);

  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;

  out[0] = Math.round((buf[i00] ?? 0) * w00 + (buf[i10] ?? 0) * w10 + (buf[i01] ?? 0) * w01 + (buf[i11] ?? 0) * w11);
  out[1] = Math.round((buf[i00 + 1] ?? 0) * w00 + (buf[i10 + 1] ?? 0) * w10 + (buf[i01 + 1] ?? 0) * w01 + (buf[i11 + 1] ?? 0) * w11);
  out[2] = Math.round((buf[i00 + 2] ?? 0) * w00 + (buf[i10 + 2] ?? 0) * w10 + (buf[i01 + 2] ?? 0) * w01 + (buf[i11 + 2] ?? 0) * w11);
  out[3] = Math.round((buf[i00 + 3] ?? 0) * w00 + (buf[i10 + 3] ?? 0) * w10 + (buf[i01 + 3] ?? 0) * w01 + (buf[i11 + 3] ?? 0) * w11);
  return out;
};
