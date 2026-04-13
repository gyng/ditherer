/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
  // lots of mutation

const ASYNC_FILTER = "ASYNC_FILTER";
const filterImage = (image: ImageBitmap) => ({ type: "FILTER_IMAGE", image });

import { BOOL, ENUM, RANGE } from "constants/controlTypes";
import { cloneCanvas } from "utils";
import { deflateSync, inflateSync } from "fflate";
import { defineFilter, type FilterOptionValues } from "filters/types";

export const IMAGE_JPEG = "IMAGE_JPEG";
export const IMAGE_PNG = "IMAGE_PNG";
export const IMAGE_WEBP = "IMAGE_WEBP";
export const IMAGE_BMP = "IMAGE_BMP";
export const IMAGE_ICO = "IMAGE_ICO";

const formatMap: Record<string, string> = {
  [IMAGE_JPEG]: "image/jpeg",
  [IMAGE_PNG]: "image/png",
  [IMAGE_WEBP]: "image/webp",
  [IMAGE_BMP]: "image/gif",
  [IMAGE_ICO]: "image/ico"
};

export const optionTypes = {
  format: {
    type: ENUM,
    options: [
      {
        name: "image/jpeg",
        value: IMAGE_JPEG
      },
      {
        name: "image/png",
        value: IMAGE_PNG
      },
      {
        name: "image/webp",
        value: IMAGE_WEBP
      },
      {
        name: "image/bmp",
        value: IMAGE_BMP
      },
      {
        name: "image/ico",
        value: IMAGE_ICO
      }
    ],
    default: IMAGE_JPEG,
    desc: "Image format to corrupt"
  },
  errors: { type: RANGE, range: [0, 300], step: 1, default: 30, desc: "Number of byte-level corruptions" },
  errTranspose: { type: BOOL, default: true, desc: "Enable byte transposition errors" },
  errRepeat: { type: BOOL, default: false, desc: "Enable byte repetition errors" },
  errSubstitute: { type: BOOL, default: true, desc: "Enable byte substitution errors" },
  jpegQuality: { type: RANGE, range: [0, 1], step: 0.01, default: 0.92, desc: "JPEG quality before corruption" }
};

const defaults = {
  errRepeat: optionTypes.errRepeat.default,
  errTranspose: optionTypes.errTranspose.default,
  errSubstitute: optionTypes.errSubstitute.default,
  errors: optionTypes.errors.default,
  format: optionTypes.format.default,
  jpegQuality: optionTypes.jpegQuality.default
};

type GlitchblobOptions = FilterOptionValues & typeof defaults;

type PngContext = {
  filter: Uint8Array;
  skippedBeforeIdat: Uint8Array[];
  skippedAfterIdat: Uint8Array[];
};

class PngError extends Error {
  constructor(...params: ConstructorParameters<typeof Error>) {
    super(...params);
    const ErrorWithCaptureTrace = Error as ErrorConstructor & {
      captureStackTrace?: (
        _target: object,
        _constructorOpt?: abstract new (..._args: never[]) => object,
      ) => void;
    };
    ErrorWithCaptureTrace.captureStackTrace?.(this, PngError);
  }
}

const canvasToBlob = (
  image: HTMLCanvasElement,
  format: string
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    image.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed"));
    }, formatMap[format]);
  });

const blobToImage = (blob: Blob) => createImageBitmap(blob);

const isExpectedGlitchFailure = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("invalid length/literal") ||
    message.includes("invalid distance") ||
    message.includes("unexpected eof") ||
    message.includes("crc") ||
    message.includes("image") ||
    message.includes("decode") ||
    message.includes("usable")
  );
};

const blobToUint8Array = async (blob: Blob) =>
  new Uint8Array(await blob.arrayBuffer());

const transformTranspose = (
  header: number,
  input: Uint8Array,
  ..._rest: unknown[]
): Uint8Array => {
  const idx = header + Math.floor(Math.random() * (input.length - header - 1));
  const tmp = input[idx];
  input[idx] = input[idx + 1];
  input[idx + 1] = tmp;
  return input;
};

const transformSubstitute = (
  header: number,
  input: Uint8Array,
  ..._rest: unknown[]
): Uint8Array => {
  const by = Math.floor(Math.random() * 256);
  const idx = header + Math.floor(Math.random() * (input.length - header));
  input[idx] = by;
  return input;
};

const transformRepeat = (
  header: number,
  input: Uint8Array,
  ..._rest: unknown[]
): Uint8Array => {
  const idx = header + Math.floor(Math.random() * (input.length - header));
  const by = input[idx];

  const repeatedBuf = new Uint8Array(Math.floor(Math.random() * 10));
  for (let i = 0; i < repeatedBuf.length; i += 1) {
    repeatedBuf[i] = by;
  }

  const newOut = new Uint8Array(input.length + repeatedBuf.length - 1);
  newOut.set(input.subarray(0, idx), 0);
  let wrote = idx;
  newOut.set(repeatedBuf, wrote);
  wrote += repeatedBuf.length;
  newOut.set(input.subarray(idx + 1), wrote);
  return newOut;
};

const setU32 = (data: Uint8Array, value: number) => {
  const tmpBuf = new ArrayBuffer(4);
  new DataView(tmpBuf).setUint32(0, value);
   
  data[0] = new Uint8Array(tmpBuf)[0];
  data[1] = new Uint8Array(tmpBuf)[1];
  data[2] = new Uint8Array(tmpBuf)[2];
  data[3] = new Uint8Array(tmpBuf)[3];
   
};

const getU32 = (data: Uint8Array) => {
  const tmpBuf = new ArrayBuffer(4);
   
  new Uint8Array(tmpBuf)[0] = data[0];
  new Uint8Array(tmpBuf)[1] = data[1];
  new Uint8Array(tmpBuf)[2] = data[2];
  new Uint8Array(tmpBuf)[3] = data[3];
   
  return new DataView(tmpBuf).getUint32(0);
};

const computeCrc = (data: Uint8Array, crcBuf: Uint8Array) => {
   
  function buildCRC32Table(poly: number) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        if (c & 1) {
          c = poly ^ (c >>> 1);
        } else {
          c >>>= 1;
        }
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  const table = buildCRC32Table(0xedb88320);
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  crc ^= 0xffffffff;
   
  setU32(crcBuf, crc);
};

const postprocessPNG = (ctx: PngContext) => {
  const CHUNK_SIZE = 8192;
  // prettier-ignore
  const pngHeader = new Uint8Array([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  let outSize = pngHeader.length;
  const filterDeflate = deflateSync(ctx.filter);

  for (let i = 0; i < ctx.skippedBeforeIdat.length; i += 1) {
    outSize += ctx.skippedBeforeIdat[i].length;
  }

  for (let s = 0; s < filterDeflate.length; s += CHUNK_SIZE) {
    outSize += filterDeflate.subarray(s, s + CHUNK_SIZE).length + 12;
  }

  for (let i = 0; i < ctx.skippedAfterIdat.length; i += 1) {
    outSize += ctx.skippedAfterIdat[i].length;
  }

  const out = new Uint8Array(outSize);
  let outOff = 0;
  out.set(pngHeader, outOff);
  outOff += pngHeader.length;
  for (let i = 0; i < ctx.skippedBeforeIdat.length; i += 1) {
    out.set(ctx.skippedBeforeIdat[i], outOff);
    outOff += ctx.skippedBeforeIdat[i].length;
  }

  for (let s = 0; s < filterDeflate.length; s += CHUNK_SIZE) {
    const data = filterDeflate.subarray(s, s + CHUNK_SIZE);
    const chunkTmp = new Uint8Array(data.length + 12);

    setU32(chunkTmp.subarray(0, 4), data.length);
    chunkTmp[4 + 0] = 73;
    chunkTmp[4 + 1] = 68;
    chunkTmp[4 + 2] = 65;
    chunkTmp[4 + 3] = 84;

    let chunkOffset = 8;
    chunkTmp.set(data, chunkOffset);
    chunkOffset += data.length;
    computeCrc(
      chunkTmp.subarray(4, chunkOffset),
      chunkTmp.subarray(chunkOffset, chunkOffset + 4)
    );
    chunkOffset += 4;
    out.set(chunkTmp.subarray(0, chunkOffset), outOff);
    outOff += chunkOffset;
  }

  for (let i = 0; i < ctx.skippedAfterIdat.length; i += 1) {
    out.set(ctx.skippedAfterIdat[i], outOff);
    outOff += ctx.skippedAfterIdat[i].length;
  }

  return out;
};

const preprocessPNG = (buffer: Uint8Array): PngContext => {
  let offset = 0;
  const skippedBeforeIdat: Uint8Array[] = [];
  const skippedAfterIdat: Uint8Array[] = [];

  // prettier-ignore
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (; offset < pngHeader.length; offset += 1) {
    if (buffer[offset] !== pngHeader[offset]) {
      throw new PngError("invalid magic");
    }
  }
  let dataBytes = 0;
  // measure.
  for (;;) {
    if (buffer.length < offset + 4) {
      throw new PngError("truncated");
    }
    const length = getU32(buffer.subarray(offset, offset + 4));
    if (length < 0) {
      throw new Error("Unreachable?");
    }
    offset += 4;

    if (buffer.length < offset + length + 4) {
      // not a valid PNG
      throw new PngError("truncated");
    }
    const headerType = String.fromCharCode.apply(
      null,
      Array.from(buffer.subarray(offset, offset + 4))
    );
    offset += 4;

    dataBytes += length;
    offset += length;

    offset += 4;
    if (headerType === "IEND") {
      break;
    }
  }

  offset = 0;
  const filterDeflated = new Uint8Array(dataBytes);
  let outPos = 0;
  let beforeIdat = true;
  for (; offset < pngHeader.length; offset += 1) {
    if (buffer[offset] !== pngHeader[offset]) {
      // not a PNG
      throw new PngError("invalid magic");
    }
  }
  for (;;) {
    if (buffer.length < offset + 4) {
      // not a valid PNG
      throw new PngError("truncated");
    }

    const chunkStart = offset;
    const length = getU32(buffer.subarray(offset, offset + 4));
    offset += 4;
    if (length < 0) {
      throw new Error("Unreachable?");
    }
    if (buffer.length < offset + length + 4) {
      // not a valid PNG
      throw new PngError("truncated");
    }
    const headerType = String.fromCharCode.apply(
      null,
      Array.from(buffer.subarray(offset, offset + 4))
    );
    offset += 4;
    if (headerType === "IDAT") {
      for (let i = 0; i < length; i += 1) {
        filterDeflated[outPos] = buffer[offset + i];
        outPos += 1;
      }
      beforeIdat = false;
    }
    offset += length;
    offset += 4;

    if (headerType !== "IDAT") {
      const chunk = buffer.subarray(chunkStart, offset);
      if (beforeIdat) {
        skippedBeforeIdat.push(chunk);
      } else {
        skippedAfterIdat.push(chunk);
      }
    }
    if (headerType === "IEND") {
      break;
    }
  }
  return {
    filter: inflateSync(filterDeflated),
    skippedBeforeIdat,
    skippedAfterIdat
  };
};

const glitchblob = (
  input: any,
  options: GlitchblobOptions = defaults,
  dispatch?: (_action: { type: string; image: ImageBitmap }) => void
) => {
  if (typeof dispatch !== "function") {
    return input;
  }

  const { errRepeat, errSubstitute, errTranspose, errors, format } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const corruptThis = (
    image: HTMLCanvasElement,
    fmt: string
  ) => {
    const retry = (
      limit: number,
      promiseChainFactory: () => Promise<ImageBitmap>
    ) =>
      promiseChainFactory().catch(
        (e: unknown) =>
          new Promise((reso, rej) => {
            if (limit === 0) {
              rej(e);
            } else {
              reso(retry(limit - 1, promiseChainFactory));
            }
          })
      );

    const corruptor = (corruptedArg: Uint8Array): Uint8Array => {
      let corrupted = corruptedArg;
      let context: PngContext | undefined;
      let header = Math.round(Math.min(100, 0.9 * corrupted.length));

      if (fmt === IMAGE_PNG) {
        context = preprocessPNG(corrupted);
        corrupted = context.filter;
        header = 0;
      }

      const corruptors: Array<(
        _header: number,
        _inputBytes: Uint8Array,
        _width: number,
        _height: number,
        _currentX: number,
        _currentY: number
      ) => Uint8Array> = [];

      if (errTranspose) {
        corruptors.push(transformTranspose);
      }

      if (errSubstitute) {
        corruptors.push(transformSubstitute);
      }

      if (errRepeat) {
        corruptors.push(transformRepeat);
      }

      if (corruptors.length > 0) {
        for (let i = 0; i < errors; i += 1) {
          const cIdx = Math.floor(Math.random() * corruptors.length);
          const currentX = cIdx % input.width;
          const currentY = Math.floor(cIdx / input.width);
          corrupted = corruptors[cIdx](
            header,
            corrupted,
            input.width,
            input.height,
            currentX,
            currentY
          );
        }
      }

      if (fmt === IMAGE_PNG && context != null) {
        corrupted = postprocessPNG(context);
      }
      return corrupted;
    };

    return retry(10, () =>
      canvasToBlob(image, format)
        .then(blobToUint8Array)
        .then(corruptor)
        .then(u8a => new Blob([Uint8Array.from(u8a)], { type: formatMap[format] }))
        .then(blobToImage as (_value: Blob) => Promise<ImageBitmap>)
    );
  };

  corruptThis(input, format)
    .then((image) => {
      dispatch(filterImage(image as ImageBitmap));
    })
    .catch((error: unknown) => {
      if (!isExpectedGlitchFailure(error)) {
        console.warn("[glitchblob] async corruption failed", error);
      }
    });

  return ASYNC_FILTER;
};

export default defineFilter({
  name: "Glitch",
  func: glitchblob,
  options: defaults,
  optionTypes,
  defaults,
  mainThread: true
});
