import React from "react";
import Draggable, { DraggableBounds } from "react-draggable";
import { SCALING_ALGORITHM } from "@src/constants/optionTypes";
import Controls from "@src/containers/Controls";
import Exporter from "@src/containers/Exporter";
import Range from "@src/components/controls/Range";
import Enum from "@src/components/controls/Enum";
import { SCALING_ALGORITHM_OPTIONS } from "@src/constants/controlTypes";
import { Filter } from "@src/types";
const s = require("./styles.scss");
const controls = require("@src/components/controls/styles.scss");

type Props = {
  availableFilters: any[];
  className: string;
  convertGrayscale: boolean;
  inputImage: any;
  inputVideo: any;
  inputVideoVolume: number;
  inputVideoPlaybackRate: number;
  match: any;
  onConvertGrayscale: (value: boolean) => any;
  onFilterImage: (
    canvas: HTMLCanvasElement | null,
    filter: Filter,
    greyscale: boolean
  ) => any;
  onLoadImage: (a: any, b: any, c: any) => any;
  onSelectFilter: (name: string, filter: any) => any;
  onSetInput: (image: HTMLImageElement) => any;
  onSetInputVolume: (volumn: number) => any;
  onSetInputPlaybackRate: (rate: number) => any;
  onSetInputCanvas: (inputCanvas: HTMLCanvasElement) => any;
  onSetRealTimeFiltering: (value: boolean) => any;
  onSetScale: (scale: number) => any;
  onSetOutputScale: (scale: number) => any;
  onSetScalingAlgorithm: () => any;
  outputImage: any;
  realtimeFiltering: boolean;
  scale: number;
  outputScale: number;
  scalingAlgorithm: string;
  selectedFilter: any;
  time: number;
};

type State = {
  dropping: boolean;
  capturing: boolean;
  hasCapture: boolean;
};

export default class App extends React.Component<Props, State> {
  static defaultProps: {
    className: string;
  };

  capturing: boolean;
  captureVideo: HTMLVideoElement;
  dropping: boolean;
  stream?: any;
  chunks: Array<any>;
  mediaRecorder?: any;
  inputCanvas: HTMLCanvasElement | null;
  outputCanvas: HTMLCanvasElement | null;
  zIndex: number;

  constructor(props: Props) {
    super(props);
    this.dropping = false;
    this.capturing = false;
    this.inputCanvas = null;
    this.outputCanvas = null;
    this.chunks = [];
    this.mediaRecorder = null;
    this.captureVideo = document.createElement("video");
    this.captureVideo.controls = true;
    this.captureVideo.autoplay = true;
    this.captureVideo.loop = true;
    this.zIndex = 0;
    this.stream = null;
    this.state = { dropping: false, capturing: false, hasCapture: false };
  }

  componentDidMount() {
    if (this.inputCanvas) {
      this.props.onSetInputCanvas(this.inputCanvas);
    }

    if (document.body && this.captureVideo) {
      const captureOutputContainer = document.body.querySelector(
        "#captureOutput"
      );
      if (captureOutputContainer) {
        captureOutputContainer.appendChild(this.captureVideo);
      }
    }
  }

  public UNSAFE_componentWillUpdate(nextProps: any) {
    const drawToCanvas = (
      canvas: HTMLCanvasElement,
      image: HTMLImageElement,
      scale: number
    ) => {
      const finalWidth = image.width * scale;
      const finalHeight = image.height * scale;

      canvas.width = finalWidth; // eslint-disable-line
      canvas.height = finalHeight; // eslint-disable-line
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.imageSmoothingEnabled =
          nextProps.scalingAlgorithm === SCALING_ALGORITHM.AUTO;
        ctx.drawImage(image, 0, 0, finalWidth, finalHeight);
      }
    };

    const newInput = nextProps.inputImage !== this.props.inputImage;
    const newScale = nextProps.scale !== this.props.scale;
    const newTime = nextProps.time !== this.props.time;

    if (
      this.inputCanvas &&
      nextProps.inputImage &&
      (newTime || newInput || newScale)
    ) {
      drawToCanvas(this.inputCanvas, nextProps.inputImage, nextProps.scale);
    }

    if (
      this.outputCanvas &&
      nextProps.outputImage &&
      nextProps.outputImage !== this.props.outputImage
    ) {
      drawToCanvas(
        this.outputCanvas,
        nextProps.outputImage,
        nextProps.outputScale
      );
    }
  }

  render() {
    const bringToTop = (e: any) => {
      this.zIndex += 1;
      e.currentTarget.style.zIndex = `${this.zIndex}`;
    };

    const loadImageSection = (
      <div>
        <h2>Load image or video</h2>
        <input
          className={[
            controls.file,
            this.state.dropping ? controls.dropping : null,
          ].join(" ")}
          type="file"
          id="imageLoader"
          name="imageLoader"
          onChange={(e) =>
            this.props.onLoadImage(
              e,
              this.props.inputVideoVolume,
              this.props.inputVideoPlaybackRate
            )
          }
          onDragLeave={() => {
            this.setState({ dropping: false });
          }}
          onDragOver={() => {
            this.setState({ dropping: true });
          }}
          onDragEnter={() => {
            this.setState({ dropping: true });
          }}
          onDrop={() => {
            this.setState({ dropping: false });
          }}
        />

        <Range
          name="Input Scale"
          types={{ range: [0.1, 4] }}
          step={0.1}
          onSetFilterOption={(_: string, value: any) => {
            this.props.onSetScale(value);
          }}
          value={this.props.scale}
        />
      </div>
    );

    const filterOptionsSection = (
      <div className={s.section}>
        <h2>Algorithm</h2>
        <div className={["filterOptions", s.filterOptions].join(" ")}>
          <select
            className={controls.enum}
            onBlur={(e) => {
              const name = e.target.value;
              const filter = this.props.availableFilters.find(
                (f) => f && f.displayName === name
              );
              this.props.onSelectFilter(name, filter);
            }}
            value={
              this.props.selectedFilter &&
              (this.props.selectedFilter.displayName ||
                this.props.selectedFilter.name)
            }
          >
            {this.props.availableFilters.map((f) => (
              <option key={f && f.displayName} value={f && f.displayName}>
                {f && f.displayName}
              </option>
            ))}
          </select>
          <div className={controls.group}>
            <span className={controls.name}>Options</span>
            <Controls inputCanvas={this.inputCanvas} />
            <div className={controls.checkbox}>
              <input
                name="convertGrayscale"
                type="checkbox"
                checked={this.props.convertGrayscale}
                onChange={(e) =>
                  this.props.onConvertGrayscale(e.target.checked)
                }
              />
              <span
                role="presentation"
                onClick={() =>
                  this.props.onConvertGrayscale(!this.props.convertGrayscale)
                }
                className={controls.label}
              >
                Pre-convert to grayscale
              </span>
            </div>
          </div>

          <Exporter />
        </div>
      </div>
    );

    const filterButtonSection = (
      <div className={s.section}>
        <h2>Filter</h2>
        <button
          className={[s.filterButton, s.waitButton].join(" ")}
          onClick={() => {
            this.props.onFilterImage(
              this.inputCanvas,
              this.props.selectedFilter.filter,
              this.props.convertGrayscale
            );
          }}
        >
          Filter
        </button>

        <button
          style={{ marginLeft: "auto" }}
          className={s.copyButton}
          onClick={() => {
            if (this.outputCanvas) {
              const image = new Image();
              image.src = this.outputCanvas.toDataURL("image/png");
              image.onload = () => {
                this.props.onSetInput(image);
                this.props.onSetScale(1);
              };
            }
          }}
        >
          {"<< Copy output to input"}
        </button>

        <div className={s.section}>
          <h2>Video</h2>

          <div>
            <label className={controls.label} htmlFor="mute">
              <input
                id="mute"
                type="checkbox"
                checked={this.props.inputVideoVolume === 0}
                onChange={() => {
                  this.props.onSetInputVolume(
                    this.props.inputVideoVolume > 0 ? 0 : 1
                  );
                }}
              />
              Mute video
            </label>
          </div>

          <div>
            <label className={controls.label} htmlFor="realtimeFiltering">
              <input
                id="realtimeFiltering"
                type="checkbox"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  this.props.onSetRealTimeFiltering(e.target.checked);
                }}
                checked={this.props.realtimeFiltering}
              />
              Realtime filtering (videos)
            </label>
          </div>

          <div>
            <Range
              name="Video Playback Rate"
              types={{ range: [0, 2] }}
              step={0.05}
              onSetFilterOption={(_: string, value: any) => {
                this.props.onSetInputPlaybackRate(value);
              }}
              value={this.props.inputVideoPlaybackRate}
            />
          </div>

          <div className={s.captureSection}>
            <button
              id="captureButton"
              style={{ margin: "5px 0" }}
              disabled={!this.props.realtimeFiltering}
              onClick={() => {
                if (!this.state.capturing && this.outputCanvas) {
                  // @ts-ignore
                  this.stream = this.outputCanvas.captureStream(25);

                  // Mux audio + video tracks together
                  if (this.stream && this.props.inputVideo) {
                    const vid = this.props.inputVideo;
                    let streams;
                    // Audio capture doesn't work on Firefox 57
                    // https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream
                    // if (vid.mozCaptureStream) {
                    //   streams = vid.mozCaptureStream(25);
                    // } else if (vid.captureStream) {
                    //   streams = vid.captureStream(25);
                    // }

                    if (vid.captureStream) {
                      streams = vid.captureStream(25);
                    }

                    if (
                      streams &&
                      this.stream &&
                      this.props.inputVideoVolume > 0
                    ) {
                      const audioTracks = streams.getAudioTracks();
                      audioTracks.forEach((t: any) => {
                        this.stream.addTrack(t.clone());
                      });
                    }
                  }

                  this.captureVideo.srcObject = this.stream;

                  // @ts-ignore
                  this.mediaRecorder = new MediaRecorder(this.stream);
                  this.mediaRecorder.start();
                  this.mediaRecorder.ondataavailable = (e: any) => {
                    this.chunks.push(e.data);
                  };
                  this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.chunks, { type: "video/webm" });
                    this.chunks = [];
                    const dataUrl = URL.createObjectURL(blob);
                    this.captureVideo.srcObject = null;
                    this.captureVideo.src = dataUrl;
                  };
                  this.setState({ capturing: true, hasCapture: true });
                } else if (this.stream) {
                  this.stream.getTracks().forEach((track: any) => track.stop());
                  this.mediaRecorder.stop();
                  this.setState({ capturing: false });
                }
              }}
            >
              {this.state.capturing ? "Stop capture" : "Capture output video"}
            </button>

            <div className={controls.unselectable}>
              Audio capture requires Chrome
            </div>
          </div>

          <div className={s.section}>
            <h2>Others</h2>
            <Enum
              name="Scaling algorithm"
              onSetFilterOption={this.props.onSetScalingAlgorithm}
              value={this.props.scalingAlgorithm}
              types={SCALING_ALGORITHM_OPTIONS}
            />

            <Range
              name="Output Scale"
              types={{ range: [0.1, 4] }}
              step={0.1}
              onSetFilterOption={(_: string, value: any) => {
                this.props.onSetOutputScale(value);
              }}
              value={this.props.outputScale}
            />
          </div>
        </div>
      </div>
    );

    const canvases = (
      <div className={s.canvases}>
        <Draggable bounds={{ top: 0, left: 0 } as DraggableBounds}>
          <div role="presentation" onMouseDownCapture={bringToTop}>
            <div className={controls.window}>
              <div className={["handle", controls.titleBar].join(" ")}>
                Input
              </div>
              <canvas
                className={[s.canvas, s[this.props.scalingAlgorithm]].join(" ")}
                ref={(c) => {
                  this.inputCanvas = c;
                }}
              />
            </div>
          </div>
        </Draggable>

        <Draggable
          bounds={
            {
              top: 0,
              left: (this.inputCanvas && -this.inputCanvas.width) || -300,
            } as DraggableBounds
          }
        >
          <div role="presentation" onMouseDownCapture={bringToTop}>
            <div className={controls.window}>
              <div className={["handle", controls.titleBar].join(" ")}>
                Output
              </div>
              <canvas
                className={s.canvas}
                ref={(c) => {
                  this.outputCanvas = c;
                }}
              />
            </div>
          </div>
        </Draggable>

        <Draggable
          bounds={
            {
              top: 0,
              left: ((this.inputCanvas && -this.inputCanvas.width) || -300) * 2,
            } as DraggableBounds
          }
        >
          <div
            role="presentation"
            onMouseDownCapture={bringToTop}
            id="captureWindow"
            className={this.state.hasCapture ? "" : s.hide}
          >
            <div className={controls.window}>
              <div className={["handle", controls.titleBar].join(" ")}>
                Capture
              </div>
              <div id="captureOutput" />
              <div
                className={[s.rec, !this.state.capturing ? s.hide : ""].join(
                  " "
                )}
              >
                ● REC
              </div>
            </div>
          </div>
        </Draggable>
      </div>
    );

    return (
      <div className={s.app}>
        <div className={s.chrome}>
          <h1>ＤＩＴＨＥＲＥＲ ▓▒░</h1>
          {loadImageSection}
          {filterOptionsSection}
          {filterButtonSection}
          <div className={s.github}>
            <a href="https://github.com/gyng/ditherer/">GitHub</a>
          </div>
        </div>

        {canvases}
      </div>
    );
  }
}
