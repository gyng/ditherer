// @flow
import { filterImage } from "actions";
import { ASYNC_FILTER } from "constants/actionTypes";

import { BOOL, ENUM, RANGE } from "constants/controlTypes";
import { cloneCanvas } from "utils";

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
  errBtoa: { type: BOOL, default: false },
  errSubstitute: { type: BOOL, default: true },
  jpegQuality: { type: RANGE, range: [0, 1], step: 0.01, default: 0.92 }
};

const defaults = {
  errRepeat: optionTypes.errRepeat.default,
  errBtoa: optionTypes.errBtoa.default,
  errTranspose: optionTypes.errTranspose.default,
  errSubstitute: optionTypes.errSubstitute.default,
  errors: optionTypes.errors.default,
  format: optionTypes.format.default,
  jpegQuality: optionTypes.jpegQuality.default
};

const glitch = (
  input: HTMLCanvasElement,
  options: {
    errSubstitute: boolean,
    errTranspose: boolean,
    errRepeat: boolean,
    errBtoa: boolean,
    errors: number,
    format: Format,
    jpegQuality: number
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
    jpegQuality
  } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const corruptThis = (dataUrl: string): string => {
    let corrupted = dataUrl;
    const header = Math.round(Math.min(100, 0.9 * corrupted.length));

    const transpose = () => {
      const idx =
        header + Math.round(Math.random() * (corrupted.length - header - 1));
      corrupted =
        corrupted.substr(0, idx) +
        corrupted.charAt(idx + 1) +
        corrupted.charAt(idx) +
        corrupted.substr(idx + 2);
    };

    const substitute = () => {
      const domain =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      const idx =
        header + Math.round(Math.random() * corrupted.length - header - 1);
      const char = domain[Math.floor(Math.random() * domain.length)];
      corrupted = corrupted.substr(0, idx) + char + corrupted.substr(idx + 1);
    };

    const repeat = () => {
      const idx =
        header + Math.round(Math.random() * corrupted.length - header - 1);
      corrupted =
        corrupted.substr(0, idx) +
        corrupted.charAt(idx).repeat(Math.floor(Math.random() * 10)) +
        corrupted.substr(idx + 1);
    };

    const btoa = () => {
      const idx =
        header + Math.round(Math.random() * corrupted.length - header - 1);
      corrupted = corrupted.substr(0, idx) + window.btoa(corrupted.substr(idx));
    };

    const corruptors = [];

    if (errTranspose) {
      corruptors.push(transpose);
    }

    if (errSubstitute) {
      corruptors.push(substitute);
    }

    if (errRepeat) {
      corruptors.push(repeat);
    }

    if (errBtoa) {
      corruptors.push(btoa);
    }

    if (corruptors.length > 0) {
      for (let i = 0; i < errors; i += 1) {
        corruptors[Math.floor(Math.random() * corruptors.length)]();
      }
    }

    return corrupted;
  };

  const data = input.toDataURL(formatMap[format], jpegQuality);
  const corrupted = corruptThis(data);

  const corruptedImage = new Image();
  corruptedImage.src = corrupted;

  corruptedImage.onload = () => {
    dispatch(filterImage(corruptedImage));
  };

  let maxTries = 10;
  corruptedImage.onerror = () => {
    maxTries -= 1;
    if (maxTries > 0) {
      const newCorrupted = corruptThis(data);
      corruptedImage.src = newCorrupted;
    }
  };

  return ASYNC_FILTER;
};

export default {
  name: "Glitch",
  func: glitch,
  options: defaults,
  optionTypes,
  defaults
};
