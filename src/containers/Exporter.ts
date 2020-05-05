import { connect } from "react-redux";
import Exporter from "@src/components/App/Exporter";
import { importState } from "@src/actions";
import type { State, RootDispatch } from "@src/types";

const mapStateToProps = (state: State) => ({
  state: state.filters,
});

const mapDispatchToProps = (dispatch: RootDispatch) => ({
  onExportState: (
    state: { selected: any; convertGrayscale: any },
    format: string
  ) => {
    const json = JSON.stringify(
      {
        selected: state.selected,
        convertGrayscale: state.convertGrayscale,
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
  onImportState: (json: string) => dispatch(importState(json)),
});

const ContainedExporter = connect(
  mapStateToProps,
  mapDispatchToProps
)(Exporter);

export default ContainedExporter;
