// @flow
import { filterImage } from "actions";
import { ASYNC_FILTER } from "constants/actionTypes";

import { BOOL, ENUM, RANGE } from "constants/controlTypes";
import { cloneCanvas } from "utils";
import { deflate, inflate, inflateRaw } from "pako";

export const IMAGE_JPEG = "IMAGE_JPEG";
export const IMAGE_PNG = "IMAGE_PNG";
export const IMAGE_WEBP = "IMAGE_WEBP";
export const IMAGE_BMP = "IMAGE_BMP";
export const IMAGE_ICO = "IMAGE_ICO";

export type Format =
  | "IMAGE_JPEG"
  | "IMAGE_PNG"
  | "IMAGE_WEBP"
  | "IMAGE_BMP"
  | "IMAGE_ICO";

const formatMap: { [Format]: string } = {
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
    default: IMAGE_JPEG
  },
  errors: { type: RANGE, range: [0, 300], step: 1, default: 30 },
  errTranspose: { type: BOOL, default: true },
  errRepeat: { type: BOOL, default: false },
  errSubstitute: { type: BOOL, default: true },
  jpegQuality: { type: RANGE, range: [0, 1], step: 0.01, default: 0.92 },
};

const defaults = {
  errRepeat: optionTypes.errRepeat.default,
  errTranspose: optionTypes.errTranspose.default,
  errSubstitute: optionTypes.errSubstitute.default,
  errors: optionTypes.errors.default,
  format: optionTypes.format.default,
  jpegQuality: optionTypes.jpegQuality.default,
};

const imageToBlob = (image: Image, format: Fomat): Promise<Blob> => {
  return new Promise(function(resolve, reject) {
    const data = image.toBlob((blob) => {
      resolve(blob);
    }, formatMap[format])
  });
};

const blobToImage = (blob: Blob): Promise<Image> => {
  return new Promise(function(resolve, reject) {
    const corruptedImage = new Image();
    corruptedImage.onload = () => {
      resolve(corruptedImage)
    }
    corruptedImage.onerror = (e) => {
      reject(e)
    }
    corruptedImage.src = URL.createObjectURL(blob);
  });
};

const blobToUint8Array = (blob: Blob): Promise<Uint8Array> => {
  return new Promise(function(resolve, reject) {
    var fileReader = new FileReader();
    fileReader.onload = function(event) {
      if (blob.size == event.target.result.byteLength) {
        resolve(new Uint8Array(event.target.result));
      } else {
        reject("I've lost my mind");
      }
    };
    fileReader.onerror = function(e) {
      reject(e);
    }

    fileReader.readAsArrayBuffer(blob)
  });
};

const transformTranspose = (header: number, input: Uint8Array, map: Uint32Array): Uint8Array => {
  let idx = header + Math.floor(Math.random() * (input.length - header - 1));
  if (map != null) {
    idx = map[Math.floor(Math.random() * map.length)];
  }
  let tmp = input[idx];
  input[idx] = input[idx + 1]
  input[idx + 1] = tmp;
  return input;
};

const transformSubstitute = (header: number, input: Uint8Array, map: Uint32Array): Uint8Array => {
  const by = Math.floor(Math.random() * 256)
  let idx = header + Math.floor(Math.random() * (input.length - header));
  if (map != null) {
    idx = map[Math.floor(Math.random() * map.length)];
  }
  input[idx] = by;
  return input;
};

const transformRepeat = (header: number, input: Uint8Array, map: Uint32Array): Uint8Array => {
  let idx = header + Math.floor(Math.random() * (input.length - header));
  if (map != null) {
    idx = map[Math.floor(Math.random() * map.length)];
  }
  const by = input[idx];

  let repeatedBuf = new Uint8Array(Math.floor(Math.random() * 10));
  for (let i = 0; i < repeatedBuf.length; i += 1) {
    repeatedBuf[i] = by;
  }

  let newOut = new ArrayBuffer(input.length + repeatedBuf.length - 1);
  newOut.set(input.subarray(0, idx), 0);
  let wrote = idx;
  newOut.set(repeatedBuf, wrote);
  wrote += repeatedBuf.length;
  newOut.set(input.subarray(idx + 1), wrote);
  return newOut;
}

const computeCrc = (data: Uint8Array, crcBuf: Uint8Array) => {
  function buildCRC32Table(poly) {
    let table = new Uint32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) {
        if (c & 1) {
          c = poly ^ (c >>> 1);
        } else {
          c = c >>> 1;
        }
      }
      table[n] = c >>> 0;
    }
    return table
  }

  let table = buildCRC32Table(0xEDB88320);
  let crc = 0xFFFFFFFF;
  for (i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
    // let tidx = (crc & 0xFF) ^ data[i];
    // crc = 0xFFFFFFFF & ((crc >> 8) ^ table[tidx]);
  }
  crc ^= 0xFFFFFFFF;
  setU32(crcBuf, crc);
}

const asHex = (crcBuf: Uint8Array) => {
  var tmpBuf = new ArrayBuffer(4);
  let crcCopy = new Uint8Array(tmpBuf);
  crcCopy[0] = crcBuf[0];
  crcCopy[1] = crcBuf[1];
  crcCopy[2] = crcBuf[2];
  crcCopy[3] = crcBuf[3];
  let unpadded = (new Uint32Array(tmpBuf)[0]).toString(16);
  return "0x" + ("0".repeat(8) + unpadded).slice(-8)
}
const setU32 = (data: Uint8Array, value: number) => {
  var tmpBuf = new ArrayBuffer(4);
  new DataView(tmpBuf).setUint32(0, value);
  data[0] = new Uint8Array(tmpBuf)[0];
  data[1] = new Uint8Array(tmpBuf)[1];
  data[2] = new Uint8Array(tmpBuf)[2];
  data[3] = new Uint8Array(tmpBuf)[3];
}
const getU32 = (data: Uint8Array) => {
  var tmpBuf = new ArrayBuffer(4);
  new Uint8Array(tmpBuf)[0] = data[0];
  new Uint8Array(tmpBuf)[1] = data[1];
  new Uint8Array(tmpBuf)[2] = data[2];
  new Uint8Array(tmpBuf)[3] = data[3];
  return new DataView(tmpBuf).getUint32(0);
}

type PNGContext = {
  filter: Uint8Array,
  skipped_before_idat: Uint8Array,
  skipped_after_idat: Uint8Array,
};

const postprocessPNG = (ctx: PNGContext): Uint8Array => {
  const CHUNK_SIZE = 8192;
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  let outSize = pngHeader.length;
  let filterDeflate = deflate(ctx.filter)

  for (let i = 0; i < ctx.skipped_before_idat.length; i += 1) {
    outSize += ctx.skipped_before_idat[i].length;
  }
  for (let s = 0; s < filterDeflate.length; s += CHUNK_SIZE) {
    outSize += filterDeflate.subarray(s, s + CHUNK_SIZE).length + 12;
  }
  for (let i = 0; i < ctx.skipped_after_idat.length; i += 1) {
    outSize += ctx.skipped_after_idat[i].length;
  }

  let out = new Uint8Array(outSize);
  let outOff = 0;
  out.set(pngHeader, outOff);
  outOff += pngHeader.length;
  for (let i = 0; i < ctx.skipped_before_idat.length; i += 1) {
    out.set(ctx.skipped_before_idat[i], outOff);
    outOff += ctx.skipped_before_idat[i].length;
  }
  
  
  for (let s = 0; s < filterDeflate.length; s += CHUNK_SIZE) {
    let data = filterDeflate.subarray(s, s + CHUNK_SIZE);
    let chunkTmp = new Uint8Array(data.length + 12);
    setU32(chunkTmp.subarray(0, 4), data.length);
    chunkTmp[4+0] = 73
    chunkTmp[4+1] = 68
    chunkTmp[4+2] = 65
    chunkTmp[4+3] = 84
    let chunkOffset = 8;
    chunkTmp.set(data, chunkOffset);
    chunkOffset += data.length 
    computeCrc(chunkTmp.subarray(4, chunkOffset), chunkTmp.subarray(chunkOffset, chunkOffset + 4));
    chunkOffset += 4;
    out.set(chunkTmp.subarray(0, chunkOffset), outOff);
    outOff += chunkOffset;
  }
  for (let i = 0; i < ctx.skipped_after_idat.length; i += 1) {
    out.set(ctx.skipped_after_idat[i], outOff);
    outOff += ctx.skipped_after_idat[i].length;
  }
  return out
}

const preprocessPNG = (buffer: Uint8Array): PNGContext => {
  let offset = 0;
  let skipped_before_idat = [];
  let skipped_after_idat = [];
  let pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  for (; offset < pngHeader.length; offset += 1) {
    if (buffer[offset] != pngHeader[offset]) {
      // not a PNG
      return null;
    }
  }
  let dataBytes = 0;
  // measure.
  while (true) {
    if (buffer.length < (offset + 4)) {
      // not a valid PNG
      return null;
    }
    var length = getU32(buffer.subarray(offset, offset + 4));
    if (length < 0) {
      return null;
    }
    offset += 4;

    if (buffer.length < (offset + length + 4)) {
      // not a valid PNG
      return null;
    }
    var headerType = String.fromCharCode.apply(null, buffer.subarray(offset, offset + 4));
    offset += 4;
    
    dataBytes += length;
    offset += length;

    var crc = getU32(buffer.subarray(offset, offset + 4));
    offset += 4;
    if (headerType == "IEND") {
      break;
    }
  }

  offset = 0;
  let filterDeflated = new Uint8Array(dataBytes);
  let outPos = 0;
  let beforeIdat = true;
  for (; offset < pngHeader.length; offset += 1) {
    if (buffer[offset] != pngHeader[offset]) {
      // not a PNG
      return null;
    }
  }
  while (true) {
    if (buffer.length < (offset + 4)) {
      // not a valid PNG
      return null;
    }
    
    let chunkStart = offset;
    var length = getU32(buffer.subarray(offset, offset + 4));
    offset += 4;
    if (length < 0) {
      return null;
    }
    if (buffer.length < (offset + length + 4)) {
      // not a valid PNG
      return null;
    }
    var headerType = String.fromCharCode.apply(null, buffer.subarray(offset, offset + 4));
    offset += 4;
    if (headerType == "IDAT") {
      for (let i = 0; i < length; i += 1) {
        filterDeflated[outPos] = buffer[offset + i];
        outPos += 1;
      }
      beforeIdat = false;
    }
    offset += length;
    offset += 4;
    
    if (headerType != "IDAT") {
      let chunk = buffer.subarray(chunkStart, offset);
      if (beforeIdat) {
        skipped_before_idat.push(chunk);
      } else {
        skipped_after_idat.push(chunk);
      }
    }
    if (headerType == "IEND") {
      break;
    }
  }
  return {
    filter: inflate(filterDeflated),
    skipped_before_idat: skipped_before_idat,
    skipped_after_idat: skipped_after_idat,
  };
}

const glitchblob = (
  input: HTMLCanvasElement,
  options: {
    errSubstitute: boolean,
    errTranspose: boolean,
    errRepeat: boolean,
    errBtoa: boolean,
    errors: number,
    format: Format,
    jpegQuality: number,
    useBlobCorruptor: boolean,
  } = defaults,
  dispatch: Dispatch
): HTMLCanvasElement | "ASYNC_FILTER" => {
  const {
    errRepeat,
    errBtoa,
    errSubstitute,
    errTranspose,
    errors,
    format,
    jpegQuality,
    useBlobCorruptor,
  } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const corruptThis = (image: Image, format: Format): Promise<Blob> => {
    const retry = (limit: number, promiseChainFactory): Promise => {
      return promiseChainFactory().catch((e) => {
        if (limit == 0) {
          throw e;
        }
        retry(limit - 1, promiseChainFactory)
      })
    }

    const corruptor = (corrupted: Uint8Buffer): Uint8Buffer => {
      let context = undefined;
      let header = Math.round(Math.min(100, 0.9 * corrupted.length));

      if (format == IMAGE_PNG) {
        context = preprocessPNG(corrupted);
        corrupted = context.filter;
        header = 0;
      }

      const corruptors = [];

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
          let cIdx = Math.floor(Math.random() * corruptors.length);
          corrupted = corruptors[cIdx](header, corrupted);
        }
      }
      if (format == IMAGE_PNG && context != null) {
        corrupted = postprocessPNG(context)
      }
      return corrupted;
    }

    return retry(10, () => imageToBlob(image, format)
      .then(blobToUint8Array)
      .then(corruptor)
      .then((u8a) => new Blob([u8a], {type: formatMap[format]}))
      .then(blobToImage));
  };

  corruptThis(input, format).then((image) => {
    dispatch(filterImage(image));
  })

  return ASYNC_FILTER;
};

export default {
  name: "Glitch",
  func: glitchblob,
  options: defaults,
  optionTypes,
  defaults
};
