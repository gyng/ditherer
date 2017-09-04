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
      image: HTMLImageElement
    ) => {
      canvas.width = image.width; // eslint-disable-line
      canvas.height = image.height; // eslint-disable-line
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.drawImage(image, 0, 0);
      }
    };

    if (
      this.inputCanvas &&
      nextProps.inputImage &&
      nextProps.inputImage !== this.props.inputImage
    ) {
      drawToCanvas(this.inputCanvas, nextProps.inputImage);
    }

    if (
      this.outputCanvas &&
      nextProps.outputImage &&
      nextProps.outputImage !== this.props.outputImage
    ) {
      drawToCanvas(this.outputCanvas, nextProps.outputImage);
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
            Pre-convert to grayscale:
            <input
              name="convertGrayscale"
              type="checkbox"
              checked={this.props.convertGrayscale}
              onChange={e => this.props.onConvertGrayscale(e.target.checked)}
            />
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
        <Draggable handle=".handle">
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

        <Draggable handle=".handle">
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
          {filterButtonSection}
          {filterOptionsSection}
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
  className: PropTypes.string,
  match: PropTypes.object,
  onLoadImage: PropTypes.func,
  onFilterImage: PropTypes.func,
  inputImage: PropTypes.object,
  outputImage: PropTypes.object,
  availableFilters: PropTypes.arrayOf(PropTypes.object),
  selectedFilter: PropTypes.object,
  onSelectFilter: PropTypes.func,
  convertGrayscale: PropTypes.bool,
  onConvertGrayscale: PropTypes.func,
  onSetInput: PropTypes.func
};

App.defaultProps = {
  children: null,
  className: s.app,
  match: { url: "unknown" },
  onLoadImage: () => {},
  onFilterImage: () => {},
  inputImage: null,
  outputImage: null,
  availableFilters: [],
  selectedFilter: null,
  onSelectFilter: () => {},
  convertGrayscale: false,
  onConvertGrayscale: () => {},
  onSetInput: () => {}
};
