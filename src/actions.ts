import { Dispatch } from "redux";
import { createAction } from "@reduxjs/toolkit";
import * as types from "@src/constants/actionTypes";
import * as optionTypes from "@src/constants/optionTypes";
import { paletteList } from "@src/palettes";
import { THEMES } from "@src/palettes/user";

import type { ColorRGBA, Filter, FilterFunc } from "@src/types";

export const importState = createAction<any>(types.LOAD_STATE);
export const setInputVolume = createAction<number>(types.SET_INPUT_VOLUME);
export const setScalingAlgorithm = createAction<string>(types.SET_SCALING_ALGORITHM);

// export const importState = (json: string) => {
//   const deserialized = JSON.parse(json);
//   return {
//     type: types.LOAD_STATE,
//     data: deserialized,
//   };
// };

// export const setInputVolume = (volume: number) => ({
//   type: types.SET_INPUT_VOLUME,
//   volume,
// });

export const setInputPlaybackRate = (rate: number) => ({
  type: types.SET_INPUT_PLAYBACK_RATE,
  rate,
});

export const setInputCanvas = (canvas: HTMLCanvasElement) => ({
  type: types.SET_INPUT_CANVAS,
  canvas,
});

// export const setScalingAlgorithm = (algorithm: string) => ({
//   type: types.SET_SCALING_ALGORITHM,
//   algorithm,
// });

export const loadImage = (
  image: HTMLImageElement,
  time = 0,
  video?: HTMLVideoElement,
  dispatch?: any
) => ({
  type: types.LOAD_IMAGE,
  image,
  time,
  video,
  dispatch,
});

export const loadImageAsync = (file: File) => (dispatch: Dispatch) => {
  const reader = new FileReader();
  const image = new Image();

  reader.onload = (event) => {
    image.onload = () => {
      dispatch(loadImage(image, undefined, undefined, dispatch));
    };

    if (event.target && typeof event.target.result === "string") {
      image.src = event.target.result;
    }
  };

  reader.readAsDataURL(file);
};

export const loadVideoAsync = (file: File, volume = 1, playbackRate = 1) => (
  dispatch: Dispatch
) => {
  const reader = new FileReader();
  const video = document.createElement("video");

  reader.onload = (event) => {
    const i = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const loadFrame = () => {
      URL.revokeObjectURL(i.src);

      if (!video.paused && video.src !== "" && ctx) {
        i.width = video.videoWidth;
        i.height = video.videoHeight;

        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            i.src = URL.createObjectURL(blob);
            i.onload = () => {
              if (!video.paused && video.src !== "") {
                requestAnimationFrame(loadFrame);
                dispatch(loadImage(i, video.currentTime, video, dispatch));
              }
            };
          }
        });
      }
    };

    let firstPlay = true;
    video.onplaying = () => {
      if (firstPlay) {
        firstPlay = false;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        requestAnimationFrame(loadFrame);
      }
    };

    // @ts-ignore
    const blob = new Blob([event.target.result]);
    video.volume = volume;
    video.src = URL.createObjectURL(blob);
    video.playbackRate = playbackRate;
    video.loop = true;
    video.autoplay = true;
    video.play();
  };

  reader.readAsArrayBuffer(file);
};

export const loadMediaAsync = (file: File, volume = 1, playbackRate = 1) => {
  if (file.type.startsWith("video/")) {
    return loadVideoAsync(file, volume, playbackRate);
  }

  return loadImageAsync(file);
};

export const setConvertGrayscale = (value: boolean) => ({
  type: types.SET_GRAYSCALE,
  value,
});

export const selectFilter = (name: string, filter: Filter) => ({
  type: types.SELECT_FILTER,
  name,
  filter,
});

export const filterImage = (image: HTMLImageElement) => ({
  type: types.FILTER_IMAGE,
  image,
});

export const filterImageAsync = (
  input: HTMLCanvasElement,
  filter: FilterFunc,
  options?: any
) => (dispatch: Dispatch) => {
  const output = filter(input, options, dispatch);
  if (!output) return { type: types.ERROR, message: "Error filtering" };

  if (output instanceof HTMLCanvasElement) {
    const outputImage = new Image();
    outputImage.src = output.toDataURL("image/png");

    outputImage.onload = () => {
      dispatch(filterImage(outputImage));
    };
  }

  return null;
};

export const addPaletteColor = (color: ColorRGBA) => ({
  type: types.ADD_PALETTE_COLOR,
  color,
});

// FIXME: Why is it finding by name here? Fishy, potential problem when value is a valid palette name
export const setFilterOption = (optionName: string, value: any) => {
  const paletteObject = paletteList.find((p) => p.name === value);

  return {
    type: types.SET_FILTER_OPTION,
    optionName,
    value: paletteObject ? paletteObject.palette : value,
  };
};

export const setFilterPaletteOption = (optionName: string, value: any) => ({
  type: types.SET_FILTER_PALETTE_OPTION,
  optionName,
  value,
});

export const setScale = (scale: number) => ({
  type: types.SET_SCALE,
  scale,
});

export const setOutputScale = (scale: number) => ({
  type: types.SET_OUTPUT_SCALE,
  scale,
});

export const setRealtimeFiltering = (enabled: boolean) => ({
  type: types.SET_REAL_TIME_FILTERING,
  enabled,
});

export const saveCurrentColorPalette = (
  name: string,
  colors: Array<ColorRGBA>
) => {
  window.localStorage.setItem(
    `_palette_${name.replace(" ", "")}`,
    JSON.stringify({ type: optionTypes.PALETTE, name, colors })
  );

  // @ts-ignore
  THEMES[name] = colors;

  return {
    type: types.SAVE_CURRENT_COLOR_PALETTE,
    name,
  };
};

export const deleteCurrentColorPalette = (name: string) => {
  window.localStorage.removeItem(`_palette_${name.replace(" ", "")}`);
  // @ts-ignore
  delete THEMES[name];

  return {
    type: types.DELETE_CURRENT_COLOR_PALETTE,
    name,
  };
};
