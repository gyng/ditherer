// @flow

const getBufferIndex = (x: number, y: number, width: number) =>
  (x + width * y) * 4;

const fillBufferPixel = (
  buf: Uint8ClampedArray | Array<number>,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number
) => {
  buf[i] = r; // eslint-disable-line
  buf[i + 1] = g; // eslint-disable-line
  buf[i + 2] = b; // eslint-disable-line
  buf[i + 3] = a; // eslint-disable-line
};

const addBufferPixel = (
  buf: Uint8ClampedArray | Array<number>,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number
) => {
  buf[i] += r; // eslint-disable-line
  buf[i + 1] += g; // eslint-disable-line
  buf[i + 2] += b; // eslint-disable-line
  buf[i + 3] += a; // eslint-disable-line
};

export const cloneCanvas = (
  original: HTMLCanvasElement,
  copyData: boolean = true
) => {
  const clone = document.createElement("canvas");

  clone.width = original.width;
  clone.height = original.height;

  const cloneCtx = clone.getContext("2d");

  if (cloneCtx && copyData) {
    cloneCtx.drawImage(original, 0, 0);
  }

  return clone;
};

export const binarize = (input: HTMLCanvasElement, threshold: number = 127) => {
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (inputCtx && outputCtx) {
    const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const intensity = (buf[i] + buf[i + 1] + buf[i + 2] + buf[i + 3]) / 4;

        if (intensity < threshold) {
          outputCtx.fillStyle = "black";
          outputCtx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  return output;
};

export const floydSteinberg = (
  input: HTMLCanvasElement,
  options: { levels: number } = { levels: 2 }
) => {
  const getColor = (i: number, levels: number) => {
    // Special case: Slightly improve speed when levels == 2
    if (levels === 2) {
      return i >= 127.5 ? 255 : 0;
    }

    const step = 255 / (levels - 1);
    const bucket = Math.round(i / step);
    return Math.round(bucket * step);
  };

  const output = cloneCanvas(input, true);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return null;

  const buf = outputCtx.getImageData(0, 0, input.width, input.height).data;
  if (!buf) return null;
  // Increase precision over u8 (from getImageData) for error diffusion
  const errBuf = Array.from(buf);

  for (let x = 0; x < output.width; x += 1) {
    for (let y = 0; y < output.height; y += 1) {
      const i = getBufferIndex(x, y, output.width);

      // Ignore alpha channel when calculating error
      const intensity = (errBuf[i] + errBuf[i + 1] + errBuf[i + 2]) / 3;
      const color = getColor(intensity, options.levels);
      const error = intensity - color;
      // Copy alpha value from input
      fillBufferPixel(buf, i, color, color, color, buf[i + 3]);

      // Diffuse error down diagonally right, following for loops
      // [_,    *,    7/16]
      // [3/16, 5/16, 1/16]
      const errorMatrix = [[0, 0, 7 / 16], [3 / 16, 5 / 16, 1 / 16]];

      const a = getBufferIndex(x + 1, y, output.width);
      const aError = error * errorMatrix[0][2];
      addBufferPixel(errBuf, a, aError, aError, aError, 0);

      const b = getBufferIndex(x - 1, y + 1, output.width);
      const bError = error * errorMatrix[1][0];
      addBufferPixel(errBuf, b, bError, bError, bError, 0);

      const c = getBufferIndex(x, y + 1, output.width);
      const cError = error * errorMatrix[1][1];
      addBufferPixel(errBuf, c, cError, cError, cError, 0);

      const d = getBufferIndex(x + 1, y + 1, output.width);
      const dError = error * errorMatrix[1][2];
      addBufferPixel(errBuf, d, dError, dError, dError, 0);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};
