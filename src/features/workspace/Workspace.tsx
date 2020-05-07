import React from "react";
import { VideoRecorder } from "./VideoRecorder";
import {
  BaseSurface,
  RGBASurface,
  SurfaceClassNames,
  ConvertCanvas,
  LabPixel,
  SurfaceApplyMut,
  RGBAPixel,
} from "@src/domains/surface";
import { Palette } from "@src/domains/color/palette";
import { rgba, gammaCorrectMut } from "@src/domains/color";
import { DistanceAlgorithm } from "@src/domains/color/distance";

const styles = require("./workspace.pcss");

interface VideoOptions {
  volume: number;
  playbackRate: number;
}

export const loadImage = (file: File, onLoad: (ev: Event) => void) => {
  const reader = new FileReader();
  const image = new Image();

  reader.onload = (event) => {
    image.onload = onLoad;
    if (event.target?.result && typeof event.target.result === "string") {
      image.src = event.target.result;
    }
  };

  reader.readAsDataURL(file);

  return {
    media: image,
    image,
    cleanup: () => {
      /* cleanup: noop */
    },
  };
};

const loadVideo = (
  file: File,
  onLoad: (ev: Event) => void,
  videoOptions: VideoOptions
) => {
  const reader = new FileReader();
  const video = document.createElement("video");

  reader.onload = (event) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let firstPlay = true;
    let prevVideoTime = -1;

    const loadFrame = () => {
      URL.revokeObjectURL(img.src);

      if (video.paused || !video.src) {
        return;
      }

      img.width = video.videoWidth;
      img.height = video.videoHeight;

      if (ctx) {
        ctx.drawImage(video, 0, 0);
      }

      canvas.toBlob((blob) => {
        if (blob) {
          img.onload = (ev) => {
            if (!video.paused && video.src) {
              if (video.currentTime !== prevVideoTime) {
                prevVideoTime = video.currentTime;
                onLoad(ev);
              }
              requestAnimationFrame(loadFrame);
            }
          };
          img.src = URL.createObjectURL(blob);
        }
      });
    };

    if (event.target?.result) {
      video.onplaying = () => {
        if (firstPlay) {
          firstPlay = false;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          // video.ontimeupdate is fired inconsistently, so we use rAF instead
          requestAnimationFrame(loadFrame);
        }
      };

      video.volume = videoOptions.volume;
      video.playbackRate = videoOptions.playbackRate;
      video.loop = true;
      video.autoplay = true;
      const blob = new Blob([event.target.result]);
      video.src = URL.createObjectURL(blob);
      video.play();
    }
  };

  reader.readAsArrayBuffer(file);

  return {
    media: video,
    video,
    cleanup: () => {
      video.pause();
      URL.revokeObjectURL(video.src);
    },
  };
};

const loadMedia = (
  file: File,
  onLoad: (ev: Event) => void,
  videoOptions: VideoOptions
) => {
  if (file.type.startsWith("video/")) {
    return loadVideo(file, onLoad, videoOptions);
  } else {
    return loadImage(file, onLoad);
  }
};

const drawImageToCanvas = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  scale: number
) => {
  const finalWidth = image.width * scale;
  const finalHeight = image.height * scale;
  canvas.width = finalWidth;
  canvas.height = finalHeight;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    // ctx.imageSmoothingEnabled =
    //   nextProps.scalingAlgorithm === SCALING_ALGORITHM.AUTO;
    ctx.drawImage(image, 0, 0, finalWidth, finalHeight);
  }
};

// const swapFn = (px) => {
//   return new Uint8ClampedArray([px[1], px[2], px[0], px[3]]);
// };

// const swapFnMut = (px: Uint8ClampedArray) => {
//   const tmp = px[0];
//   px[0] = px[1];
//   px[1] = px[2];
//   px[2] = tmp;
// };

// Consider mutating inputSurface/have a mutation param
const filterFinal = (
  inputSurface: BaseSurface<any, any>,
  _options: any
): ConvertCanvas => {
  const palette = new Palette([
    rgba(255, 0, 0, 255),
    rgba(0, 255, 0, 255),
    rgba(0, 0, 255, 255),
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
  ]);

  const initS = inputSurface.toRGBASurface();

  // initS.applyMut(gammaCorrectMut(0.1));

  const convert: SurfaceApplyMut<RGBAPixel> = (px) => {
    px.set(
      Palette.getNearest(
        px,
        palette.colors[initS.description.colorspace],
        DistanceAlgorithm.ApproxRGBA
      )
    );
  };
  initS.applyMut(convert);
  return initS;

  // const labaS = initS.toSurface(SurfaceClassNames.LabSurface);
  // const convert: SurfaceApplyMut<LabPixel> = (px) => {
  //   px.set(
  //     Palette.getNearest(
  //       px,
  //       palette.colors[labaS.description.colorspace],
  //       DistanceAlgorithm.LabaCIE94
  //     )
  //   );
  // };
  // labaS.applyMut(convert);
  // const rgbaS = labaS.toSurface(SurfaceClassNames.RGBASurface);
  // return rgbaS;
};

// Avg 70FPS
// inputSurface.apply(swapFn);

// Avg 100FPS
// inputSurface.applyMut(swapFnMut);

// Avg 140FPS
// for (let y = 0; y < inputSurface.height; y++) {
//   for (let x = 0; x < inputSurface.width; x++) {
//     const idx = inputSurface.getBufferIdx(x, y);
//     const tmp = inputSurface.buffers[0][idx];
//     inputSurface.buffers[0][idx] = inputSurface.buffers[0][idx + 1];
//     inputSurface.buffers[0][idx + 1] = inputSurface.buffers[0][idx + 2];
//     inputSurface.buffers[0][idx + 2] = tmp;
//   }
// }

//   return inputSurface as RGBASurface;
// };

const applyFilter = async (
  input: HTMLCanvasElement | null,
  output: HTMLCanvasElement | null
) => {
  if (!input || !output) {
    return;
  }

  const src = input;
  const dst = output;

  if (src && dst) {
    const inputSurface = await RGBASurface.fromCanvas(src);
    // const outputSurface = inputSurface;
    const outputSurface = filterFinal(inputSurface, {});
    await outputSurface.toCanvas(dst, {
      resize: true,
    });
  }
};

export class Workspace extends React.Component<{}, { realtime: boolean }> {
  private inputCanvas = React.createRef<HTMLCanvasElement>();
  private outputCanvas = React.createRef<HTMLCanvasElement>();
  private media: {
    image?: HTMLImageElement;
    video?: HTMLVideoElement;
    media: HTMLImageElement | HTMLVideoElement;
    cleanup: () => void;
  } | null = null;

  public constructor(props: {}) {
    super(props);
    this.state = { realtime: false };
  }

  render() {
    return (
      <div className={styles.container}>
        <canvas ref={this.inputCanvas}></canvas>
        <canvas ref={this.outputCanvas}></canvas>

        <button
          onClick={() => {
            applyFilter(this.inputCanvas.current, this.outputCanvas.current);
          }}
        >
          transfer once
        </button>

        <button
          onClick={() => {
            this.setState({ realtime: !this.state.realtime });
          }}
        >
          transfer realtime: {`${this.state.realtime}`}
        </button>

        <input
          type="file"
          id="imageLoader"
          name="imageLoader"
          onChange={(e) => {
            const file = e.target?.files?.[0];

            if (file) {
              if (this.media) {
                this.media.cleanup();
                this.media = null;
              }

              this.media = loadMedia(
                file,
                (ev) => {
                  if (this.inputCanvas.current) {
                    const target = ev.target as HTMLImageElement;
                    drawImageToCanvas(this.inputCanvas.current, target, 1);
                    if (this.state.realtime) {
                      applyFilter(
                        this.inputCanvas.current,
                        this.outputCanvas.current
                      );
                    }
                  }
                },
                { volume: 1, playbackRate: 1 }
              );
            }
            // this.props.onLoadImage(
            //   e,
            //   this.props.inputVideoVolume,
            //   this.props.inputVideoPlaybackRate
            // )
          }}
          // onDragLeave={() => {
          //   this.setState({ dropping: false });
          // }}
          // onDragOver={() => {
          //   this.setState({ dropping: true });
          // }}
          // onDragEnter={() => {
          //   this.setState({ dropping: true });
          // }}
          // onDrop={() => {
          //   this.setState({ dropping: false });
          // }}
        />

        <VideoRecorder
          captureAudio
          srcCanvas={this.outputCanvas.current}
          srcVideo={this.media?.video ?? null}
        />
      </div>
    );
  }
}
