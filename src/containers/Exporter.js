// @flow

import { connect } from "react-redux";
import { importState } from "actions";
import Exporter from "components/App/Exporter";

import type { State } from "types";
import type { Dispatch } from "redux";

const mapStateToProps = (state: State) => ({
  state: state.filters
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onExportState: (state, format) => {
    const json = JSON.stringify(
      {
        selected: state.selected,
        convertGrayscale: state.convertGrayscale
      },
      (k, v) => {
        if (
          k === "defaults" ||
          k === "optionTypes" ||
          typeof v === "function"
        ) {
          return undefined;
        }

        return v;
      }
    );

    if (format === "json") {
      window.open(`data:application/json,${encodeURI(json)}`);
    } else {
      const base = `${window.location.origin}${window.location.pathname}`;
      prompt("URL", `${base}?state=${encodeURI(btoa(json))}`); // eslint-disable-line
    }
  },
  onImportState: json => dispatch(importState(json))
});

const ContainedExporter = connect(
  mapStateToProps,
  mapDispatchToProps
)(Exporter);

export default ContainedExporter;
