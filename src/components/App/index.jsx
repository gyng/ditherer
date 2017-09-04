// @flow
/* eslint-disable react/prefer-stateless-function, react/forbid-prop-types */

import React from "react";
import PropTypes from "prop-types";
import Draggable from "react-draggable";

import Controls from "containers/Controls";

import controls from "components/controls/styles.scss";
import s from "./styles.scss";

export default class App extends React.Component<*, *, *> {
  static defaultProps: {
    className: string
  };

  constructor(props: any) {
    super(props);
    this.inputCanvas = null;
    this.outputCanvas = null;
    this.zIndex = 0;
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

    if (this.inputCanvas && nextProps.inputImage && (newInput || newScale)) {
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

  inputCanvas: ?HTMLCanvasElement;
  outputCanvas: ?HTMLCanvasElement;
  zIndex: number;

  render() {
    const loadImageSection = (
      <div className={s.section}>
        <h2>Load image</h2>
        <input
          className={controls.file}
          type="file"
          id="imageLoader"
          name="imageLoader"
          onChange={this.props.onLoadImage}
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
            <div className={controls.value}>
              {Math.round(this.props.scale * 100)}%
            </div>
          </div>
        </div>
      </div>
    );

    const filterOptionsSection = (
      <div className={s.section}>
        <h2>Algorithm</h2>
        <div className={s.filterOptions}>
          <select
            className={controls.enum}
            onChange={e => {
              const name = e.target.value;
              const filter = this.props.availableFilters.find(
                f => f.displayName === name
              );
              this.props.onSelectFilter(name, filter);
            }}
            value={this.props.selectedFilter.displayName}
          >
            {this.props.availableFilters.map(f =>
              <option key={f.displayName} value={f.displayName}>
                {f.displayName}
              </option>
            )}
          </select>
          <div className={controls.group}>
            <span className={controls.name}>Options</span>
            <Controls />
            <input
              name="convertGrayscale"
              type="checkbox"
              checked={this.props.convertGrayscale}
              onChange={e => this.props.onConvertGrayscale(e.target.checked)}
            />
            Pre-convert to grayscale
          </div>
          <button
            className={s.copyButton}
            onClick={() => {
              if (this.outputCanvas) {
                const image = new Image();
                image.src = this.outputCanvas.toDataURL("image/png");
                image.onload = () => {
                  this.props.onSetInput(image);
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
          className={s.filterButton}
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
      </div>
    );

    const bringToTop = e => {
      this.zIndex += 1;
      e.currentTarget.style.zIndex = `${this.zIndex}`;
    };

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
  match: PropTypes.object,
  onConvertGrayscale: PropTypes.func,
  onFilterImage: PropTypes.func,
  onLoadImage: PropTypes.func,
  onSelectFilter: PropTypes.func,
  onSetInput: PropTypes.func,
  onSetScale: PropTypes.func,
  outputImage: PropTypes.object,
  scale: PropTypes.number,
  selectedFilter: PropTypes.object
};

App.defaultProps = {
  availableFilters: [],
  children: null,
  className: s.app,
  convertGrayscale: false,
  inputImage: null,
  match: { url: "unknown" },
  onConvertGrayscale: () => {},
  onFilterImage: () => {},
  onLoadImage: () => {},
  onSelectFilter: () => {},
  onSetInput: () => {},
  onSetScale: () => {},
  outputImage: null,
  scale: 1,
  selectedFilter: null
};
