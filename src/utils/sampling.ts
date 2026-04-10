const clampValue = (min, max, value) => Math.max(min, Math.min(max, value));
const getIndex = (x, y, width) => (y * width + x) * 4;

export const sampleNearest = (
  buf,
  width,
  height,
  x,
  y,
  out = [0, 0, 0, 0]
) => {
  const sx = Math.round(clampValue(0, width - 1, x));
  const sy = Math.round(clampValue(0, height - 1, y));
  const i = getIndex(sx, sy, width);
  out[0] = buf[i];
  out[1] = buf[i + 1];
  out[2] = buf[i + 2];
  out[3] = buf[i + 3];
  return out;
};

export const sampleBilinear = (
  buf,
  width,
  height,
  x,
  y,
  out = [0, 0, 0, 0]
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

  out[0] = Math.round(buf[i00] * w00 + buf[i10] * w10 + buf[i01] * w01 + buf[i11] * w11);
  out[1] = Math.round(buf[i00 + 1] * w00 + buf[i10 + 1] * w10 + buf[i01 + 1] * w01 + buf[i11 + 1] * w11);
  out[2] = Math.round(buf[i00 + 2] * w00 + buf[i10 + 2] * w10 + buf[i01 + 2] * w01 + buf[i11 + 2] * w11);
  out[3] = Math.round(buf[i00 + 3] * w00 + buf[i10 + 3] * w10 + buf[i01 + 3] * w01 + buf[i11 + 3] * w11);
  return out;
};
