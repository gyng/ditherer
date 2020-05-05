import React from "react";

interface ExporterProps {
  state: any;
  onImportState: (json: string) => any;
  onExportState: (state: any, key: string) => any;
}

type State = {};

export default class Exporter extends React.Component<ExporterProps, State> {
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
            this.props.onImportState(json ?? "{}");
          }}
        >
          Import
        </button>
      </div>
    );
  }
}
