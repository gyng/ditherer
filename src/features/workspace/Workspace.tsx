import React from "react";
import { VideoRecorder } from "./VideoRecorder";

const styles = require("./workspace.pcss");

// type Pixel = Uint8ClampedArray;

enum ImageFormats {
  RGBA = "rgba",
}

interface Colorspace {
  colorSpace: ImageFormats;
}

const colorspaceRGB: Colorspace = {
  colorSpace: ImageFormats.RGBA,
};

abstract class BaseSurface<PixelType> {
  public buffers: Uint8ClampedArray[];
  public colorspace: Colorspace;
  public height: number;
  public width: number;

  public constructor(options: {
    buffers: Uint8ClampedArray[];
    colorspace: Colorspace;
    height: number;
    width: number;
  }) {
    this.buffers = options.buffers;
    this.colorspace = options.colorspace;
    this.height = options.height;
    this.width = options.width;
  }

  abstract get(x: number, y: number): PixelType;
  abstract getMut(x: number, y: number): PixelType;
  abstract setMut(x: number, y: number, px: PixelType): void;
  abstract apply(
    fn: (px: PixelType, x: number, y: number, idx: number) => PixelType
  ): void;
  abstract applyMut(
    fn: (px: PixelType, x: number, y: number, idx: number) => PixelType
  ): void;
  abstract toImageData(): ImageData;
}

class RGBASurface extends BaseSurface<Uint8ClampedArray> {
  public colorspace: typeof colorspaceRGB;
  public pixelLength: number;

  public constructor(options: {
    width: number;
    height: number;
    buffer?: Uint8ClampedArray;
  }) {
    super({
      buffers: [
        options.buffer ||
          new Uint8ClampedArray(options.width * options.height * 4),
      ],
      colorspace: colorspaceRGB,
      height: options.height,
      width: options.width,
    });

    this.colorspace = colorspaceRGB;
    this.pixelLength = 4;
  }

  public getBufferIdx(x: number, y: number): number {
    const idx = y * this.width + x;
    return idx * this.pixelLength;
  }

  public get(x: number, y: number): Uint8ClampedArray {
    const idx = this.getBufferIdx(x, y);
    return this.buffers[0].slice(idx, idx + this.pixelLength + 1);
  }

  public getMut(x: number, y: number): Uint8ClampedArray {
    const idx = this.getBufferIdx(x, y);
    return this.buffers[0].subarray(idx, idx + this.pixelLength + 1);
  }

  public setMut(x: number, y: number, pixel: Uint8ClampedArray) {
    const idx = this.getBufferIdx(x, y);
    this.buffers[0].set(pixel, idx);
  }

  public apply(
    fn: (
      px: Uint8ClampedArray,
      x: number,
      y: number,
      idx: number
    ) => Uint8ClampedArray
  ) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = this.getBufferIdx(x, y);
        const curPx = this.get(x, y);
        const newSlice = fn(curPx, x, y, idx);
        this.setMut(x, y, newSlice);
      }
    }
  }

  public applyMut(
    fn: (px: Uint8ClampedArray, x: number, y: number, idx: number) => void
  ) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = this.getBufferIdx(x, y);
        const curPx = this.getMut(x, y);
        fn(curPx, x, y, idx);
      }
    }
  }

  // public clone(): Surface {
  //   return new Surface({
  //     colorSpace: this.colorspace,
  //     width: this.width,
  //     height: this.height,
  //     buffer: new Uint8ClampedArray(this.buffer),
  //   });
  // }

  public toImageData(): ImageData {
    return new ImageData(this.buffers[0], this.width, this.height);
  }

  public async toCanvas(
    canvas: HTMLCanvasElement,
    options?: { resize?: boolean }
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("could not get canvas context");
    }

    if (options?.resize) {
      canvas.width = this.width;
      canvas.height = this.height;
    }

    const data = this.toImageData();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(data, 0, 0);
  }

  public static fromCanvas(canvas: HTMLCanvasElement): Promise<RGBASurface> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject("could not get canvas context");
            return;
          }
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve(
            new RGBASurface({
              buffer: imageData.data,
              height: canvas.height,
              width: canvas.width,
            })
          );
        } else {
          reject("could not get canvas data");
        }
      });
    });
  }
}

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
    let lastTime = -1;

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
              if (video.currentTime !== lastTime) {
                lastTime = video.currentTime;
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
    console.log("vid");
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

const swapFnMut = (px: Uint8ClampedArray) => {
  const tmp = px[0];
  px[0] = px[1];
  px[1] = px[2];
  px[2] = tmp;
};

// Consider mutating inputSurface/have a mutation param
const filter = (inputSurface: RGBASurface, _options: any): RGBASurface => {
  // Avg 70FPS
  // inputSurface.apply(swapFn);

  // Avg 100FPS
  inputSurface.applyMut(swapFnMut);

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

  return inputSurface;
};

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
    const outputSurface = filter(inputSurface, {});
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
