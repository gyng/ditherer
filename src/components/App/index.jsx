// @flow
/* eslint-disable react/prefer-stateless-function, react/forbid-prop-types */

import React from "react";
import PropTypes from "prop-types";
import Draggable from "react-draggable";

import Controls from "containers/Controls";

import controls from "components/controls/styles.scss";
import s from "./styles.scss";

type State = {
  dropping: boolean,
  capturing: boolean,
  hasCapture: boolean
};

export default class App extends React.Component<*, State> {
  static defaultProps: {
    className: string
  };

  constructor(props: any) {
    super(props);
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
    this.props.onSetInputCanvas(this.inputCanvas);

    if (document.body && this.captureVideo) {
      const captureOutputContainer = document.body.querySelector(
        "#captureOutput"
      );
      if (captureOutputContainer) {
        captureOutputContainer.appendChild(this.captureVideo);
      }
    }
  }

  componentWillUpdate(nextProps: any) {
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
      drawToCanvas(this.outputCanvas, nextProps.outputImage, 1);
    }
  }

  capturing: boolean;
  captureVideo: HTMLVideoElement;
  dropping: boolean;
  stream: ?any;
  chunks: Array<any>;
  mediaRecorder: ?any;
  inputCanvas: ?HTMLCanvasElement;
  outputCanvas: ?HTMLCanvasElement;
  zIndex: number;

  render() {
    const bringToTop = e => {
      this.zIndex += 1;
      e.currentTarget.style.zIndex = `${this.zIndex}`;
    };

    const loadImageSection = (
      <div>
        <h2>Load image or video</h2>
        <input
          className={[
            controls.file,
            this.state.dropping ? controls.dropping : null
          ].join(" ")}
          type="file"
          id="imageLoader"
          name="imageLoader"
          onChange={this.props.onLoadImage}
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

        {/* TODO: make controls more generic and take in onchange functions */}
        <div className={controls.range}>
          <div className={controls.label}>Scale</div>
          <div className={controls.rangeGroup}>
            <input
              type="range"
              min={10}
              max={400}
              step={10}
              value={this.props.scale * 100}
              onChange={e =>
                this.props.onSetScale(parseInt(e.target.value, 10) / 100)}
            />
            <div
              role="button"
              tabIndex="0"
              className={[controls.value, controls.clickable].join(" ")}
              onClick={() => {
                const newScale = window.prompt("Scale in percentage (%)"); // eslint-disable-line
                const parsed = parseFloat(newScale);

                if (parsed) {
                  this.props.onSetScale(parsed / 100);
                }
              }}
            >
              {Math.round(this.props.scale * 100)}%
            </div>
          </div>
        </div>
      </div>
    );

    const filterOptionsSection = (
      <div className={s.section}>
        <h2>Algorithm</h2>
        <div className={["filterOptions", s.filterOptions].join(" ")}>
          <select
            className={controls.enum}
            onChange={e => {
              const name = e.target.value;
              const filter = this.props.availableFilters.find(
                f => f && f.displayName === name
              );
              this.props.onSelectFilter(name, filter);
            }}
            value={
              this.props.selectedFilter &&
              (this.props.selectedFilter.displayName ||
                this.props.selectedFilter.name)
            }
          >
            {this.props.availableFilters.map(f => (
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
                onChange={e => this.props.onConvertGrayscale(e.target.checked)}
              />
              <span
                role="presentation"
                onClick={() =>
                  this.props.onConvertGrayscale(!this.props.convertGrayscale)}
                className={controls.label}
              >
                Pre-convert to grayscale
              </span>
            </div>
          </div>
          <button
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

        <div className={s.section}>
          <h2>Video</h2>
          <label className={controls.label}>
            <input
              type="checkbox"
              onChange={e => {
                this.props.onSetRealTimeFiltering(e.target.checked);
              }}
              checked={this.props.realtimeFiltering}
            />
            Realtime filtering (videos)
          </label>

          <div className={s.captureSection}>
            <button
              id="captureButton"
              style={{ margin: "5px 0" }}
              disabled={!this.props.realtimeFiltering}
              onClick={() => {
                if (!this.state.capturing && this.outputCanvas) {
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

                    if (streams && this.stream) {
                      const audioTracks = streams.getAudioTracks();
                      audioTracks.forEach(t => {
                        // $FlowFixMe
                        this.stream.addTrack(t.clone());
                      });
                    }
                  }

                  this.captureVideo.srcObject = this.stream;

                  // $FlowFixMe
                  this.mediaRecorder = new MediaRecorder(this.stream);
                  this.mediaRecorder.start();
                  // $FlowFixMe
                  this.mediaRecorder.ondataavailable = e => {
                    this.chunks.push(e.data);
                  };
                  // $FlowFixMe
                  this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.chunks, { type: "video/webm" });
                    this.chunks = [];
                    const dataUrl = URL.createObjectURL(blob);
                    this.captureVideo.srcObject = null;
                    this.captureVideo.src = dataUrl;
                  };
                  this.setState({ capturing: true, hasCapture: true });
                } else if (this.stream) {
                  // $FlowFixMe
                  this.stream.getTracks().forEach(track => track.stop());
                  // $FlowFixMe
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
        </div>
      </div>
    );

    const canvases = (
      <div className={s.canvases}>
        <Draggable bounds={{ top: 0, left: 0 }}>
          <div role="presentation" onMouseDownCapture={bringToTop}>
            <div className={controls.window}>
              <div className={["handle", controls.titleBar].join(" ")}>
                Input
              </div>
              <canvas
                className={s.canvas}
                ref={c => {
                  this.inputCanvas = c;
                }}
              />
            </div>
          </div>
        </Draggable>

        <Draggable
          bounds={{
            top: 0,
            left: (this.inputCanvas && -this.inputCanvas.width) || -300
          }}
        >
          <div role="presentation" onMouseDownCapture={bringToTop}>
            <div className={controls.window}>
              <div className={["handle", controls.titleBar].join(" ")}>
                Output
              </div>
              <canvas
                className={s.canvas}
                ref={c => {
                  this.outputCanvas = c;
                }}
              />
            </div>
          </div>
        </Draggable>

        <Draggable
          bounds={{
            top: 0,
            left: ((this.inputCanvas && -this.inputCanvas.width) || -300) * 2
          }}
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

App.propTypes = {
  availableFilters: PropTypes.arrayOf(PropTypes.object),
  className: PropTypes.string,
  convertGrayscale: PropTypes.bool,
  inputImage: PropTypes.object,
  inputVideo: PropTypes.object,
  match: PropTypes.object,
  onConvertGrayscale: PropTypes.func,
  onFilterImage: PropTypes.func,
  onLoadImage: PropTypes.func,
  onSelectFilter: PropTypes.func,
  onSetInput: PropTypes.func,
  onSetInputCanvas: PropTypes.func,
  onSetRealTimeFiltering: PropTypes.func,
  onSetScale: PropTypes.func,
  outputImage: PropTypes.object,
  realtimeFiltering: PropTypes.bool,
  scale: PropTypes.number,
  selectedFilter: PropTypes.object,
  time: PropTypes.number
};

App.defaultProps = {
  availableFilters: [],
  children: null,
  className: s.app,
  convertGrayscale: false,
  inputImage: null,
  inputVideo: null,
  match: { url: "unknown" },
  onConvertGrayscale: () => {},
  onFilterImage: () => {},
  onLoadImage: () => {},
  onSelectFilter: () => {},
  onSetInput: () => {},
  onSetInputCanvas: () => {},
  onSetRealTimeFiltering: () => {},
  onSetScale: () => {},
  outputImage: null,
  realtimeFiltering: false,
  scale: 1,
  selectedFilter: null,
  time: null
};
