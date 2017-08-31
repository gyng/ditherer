// @flow

const getBufferIndex = (x: number, y: number, width: number) =>
  (x + width * y) * 4;

const fillBufferPixel = (
  buf: Uint8ClampedArray,
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
  buf: Uint8ClampedArray,
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

export const floydSteinberg = (input: HTMLCanvasElement) => {
  const getColor = (i: number) => (i > 127 ? 255 : 0);

  const output = cloneCanvas(input, true);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return;

  let buf = outputCtx.getImageData(0, 0, input.width, input.height).data;
  if (!buf) return;
//   buf = Array.from(buf);

  for (let x = 0; x < output.width; x += 1) {
    for (let y = 0; y < output.height; y += 1) {
      const i = getBufferIndex(x, y, output.width);

      // Should not happen
      if (buf.length < i + 3) return;

      const intensity = (buf[i] + buf[i + 1] + buf[i + 2] + buf[i + 3]) / 4;
      const color = getColor(intensity);
      const error = intensity - color;
      fillBufferPixel(buf, i, color, color, color, color);
    //   debugger

      // Diffuse error down diagonally right, following for loops
      // [_,    *,    7/16]
      // [3/16, 5/16, 1/16]
      const errorMatrix = [[0, 0, 7 / 16], [3 / 16, 5 / 16, 1 / 16]];

      const a = getBufferIndex(x + 1, y, output.width);
      const aError = error * errorMatrix[0][2];
      addBufferPixel(buf, a, aError, aError, aError, aError);

      const b = getBufferIndex(x - 1, y + 1, output.width);
      const bError = error * errorMatrix[1][0];
      addBufferPixel(buf, b, bError, bError, bError, bError);

      const c = getBufferIndex(x, y + 1, output.width);
      const cError = error * errorMatrix[1][1];
      addBufferPixel(buf, c, cError, cError, cError, cError);

      const d = getBufferIndex(x + 1, y + 1, output.width);
      const dError = error * errorMatrix[1][2];
      addBufferPixel(buf, d, dError, dError, dError, dError);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);

//   x = input.getContext("2d").getImageData(0, 0, input.width, input.height);
//   y = outputCtx.getImageData(0, 0, output.width, output.height);

//   console.log(x, y, buf)

  return output;
};
