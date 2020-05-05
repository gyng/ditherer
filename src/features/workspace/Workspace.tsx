import React from "react";

const styles = require("./workspace.pcss");

type Pixel = Uint8ClampedArray;

enum ColorSpaceTypes {
  RGBA = "rgba",
}

interface ColorSpace {
  colorSpace: ColorSpaceTypes;
  pxLen: number;
}

const ColorSpaces: Record<ColorSpaceTypes, ColorSpace> = {
  [ColorSpaceTypes.RGBA]: { colorSpace: ColorSpaceTypes.RGBA, pxLen: 4 },
};

class Surface {
  public colorspace: ColorSpace;
  public width: number;
  public height: number;
  public buffer: Uint8ClampedArray;

  public constructor(options: {
    colorSpace?: ColorSpace;
    width: number;
    height: number;
    buffer?: Uint8ClampedArray;
  }) {
    this.colorspace = options.colorSpace ?? ColorSpaces[ColorSpaceTypes.RGBA];
    this.buffer =
      options.buffer ||
      new Uint8ClampedArray(options.width * options.height * 4);
    this.width = options.width;
    this.height = options.height;
  }

  public getBufferIdx(x: number, y: number): number {
    const idx = y * this.width + x;
    return idx * this.colorspace.pxLen;
  }

  public get(x: number, y: number, pixelLength = 4): Pixel {
    const idx = this.getBufferIdx(x, y);
    return this.buffer.slice(idx, idx + pixelLength + 1);
  }

  public getMut(x: number, y: number, pixelLength = 4): Pixel {
    const idx = this.getBufferIdx(x, y);
    return this.buffer.subarray(idx, idx + pixelLength + 1);
  }

  public mut(x: number, y: number, pixel: Pixel) {
    const idx = this.getBufferIdx(x, y);
    this.buffer.set(pixel, idx);
  }

  public map(fn: (px: Pixel, x: number, y: number, idx: number) => Pixel) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = this.getBufferIdx(x, y);
        const curPx = this.get(x, y);
        const newSlice = fn(curPx, x, y, idx);
        this.mut(x, y, newSlice);
      }
    }
  }

  public mapMut(fn: (px: Pixel, x: number, y: number, idx: number) => void) {
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
    return new ImageData(this.buffer, this.width, this.height);
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

  public static fromCanvas(canvas: HTMLCanvasElement): Promise<Surface> {
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
            new Surface({
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

export const loadImage = (
  file: File,
  onLoad: (ev: Event) => void
): (() => void) => {
  const reader = new FileReader();
  const image = new Image();

  reader.onload = (event) => {
    image.onload = onLoad;
    if (event.target?.result && typeof event.target.result === "string") {
      image.src = event.target.result;
    }
  };

  reader.readAsDataURL(file);

  return () => {
    /* cleanup: noop */
  };
};

const loadVideo = (
  file: File,
  onLoad: (ev: Event) => void,
  videoOptions: VideoOptions
): (() => void) => {
  const reader = new FileReader();
  const video = document.createElement("video");

  reader.onload = (event) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let firstPlay = true;

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
              requestAnimationFrame(loadFrame);
              onLoad(ev);
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

  return () => {
    video.pause();
    URL.revokeObjectURL(video.src);
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

// Consider mutating inputSurface/have a mutation param
const filter = (inputSurface: Surface, _options: any): Surface => {
  // Avg 70FPS
  // inputSurface.map((px) => {
  //   return new Uint8ClampedArray([px[1], px[2], px[0], px[3]]);
  // });

  // Avg 120FPS, min 50
  // inputSurface.mapMut((px) => {
  //   const tmp = px[0];
  //   px[0] = px[1];
  //   px[1] = px[2];
  //   px[2] = tmp;
  // });

  // Avg 140FPS
  for (let y = 0; y < inputSurface.height; y++) {
    for (let x = 0; x < inputSurface.width; x++) {
      const idx = inputSurface.getBufferIdx(x, y);
      const tmp = inputSurface.buffer[idx];
      inputSurface.buffer[idx] = inputSurface.buffer[idx + 1];
      inputSurface.buffer[idx + 1] = inputSurface.buffer[idx + 2];
      inputSurface.buffer[idx + 2] = tmp;
    }
  }

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
    const inputSurface = await Surface.fromCanvas(src);
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
  private cleanUpHandler: null | (() => void) = null;

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
              if (this.cleanUpHandler) {
                this.cleanUpHandler();
                this.cleanUpHandler = null;
              }

              this.cleanUpHandler = loadMedia(
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
      </div>
    );
  }
}
