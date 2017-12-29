// @flow
/* eslint-disable react/prefer-stateless-function, react/forbid-prop-types */

import React from "react";
import PropTypes from "prop-types";

type State = {};

export default class Exporter extends React.Component<*, State> {
  static defaultProps;

  render() {
    return (
      <div>
        <button
          onClick={() => {
            this.props.onExportState(this.props.state, "uri");
          }}
        >
          ⇧ URL
        </button>
        <button
          onClick={() => {
            this.props.onExportState(this.props.state, "json");
          }}
        >
          ⇧ JSON
        </button>
        <button
          onClick={() => {
            const json = prompt("Paste JSON"); // eslint-disable-line
            this.props.onImportState(json);
          }}
        >
          Import
        </button>
      </div>
    );
  }
}

Exporter.propTypes = {
  state: PropTypes.object,
  onImportState: PropTypes.func,
  onExportState: PropTypes.func
};

Exporter.defaultProps = {
  state: {},
  onImportState: () => {},
  onExportState: () => {}
};
