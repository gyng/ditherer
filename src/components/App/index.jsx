// @flow
/* eslint-disable react/prefer-stateless-function, react/forbid-prop-types */

import React from "react";
import PropTypes from "prop-types";

import Echo from "components/Echo";

import hello from "./hello.jpg";
import s from "./styles.scss";

export default class App extends React.Component {
  static defaultProps: {
    className: string
  };

  constructor(props: any) {
    super(props);
    this.inputCanvas = null;
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

  render() {
    return (
      <div>
        <input
          type="file"
          id="imageLoader"
          name="imageLoader"
          onChange={this.props.onLoadImage}
        />

        <button
          onClick={() => {
            this.props.onFilterImage(this.inputCanvas);
          }}
        >
          F I L T E R - - T H I S - - I F - - Y O U - - C A N
        </button>

        <div style={{ border: "solid 1px grey" }}>
          <canvas
            style={{ border: "solid 1px green" }}
            ref={c => {
              this.inputCanvas = c;
            }}
          />

          <canvas
            style={{ border: "solid 1px red"}}
            ref={c => {
              this.outputCanvas = c;
            }}
          />
        </div>
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
  outputImage: PropTypes.object
};

App.defaultProps = {
  children: null,
  className: s.app,
  match: { url: "unknown" },
  onLoadImage: () => {},
  onFilterImage: () => {},
  inputImage: null,
  outputImage: null
};
