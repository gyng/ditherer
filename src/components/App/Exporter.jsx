// @flow
import React from "react";
import { useFilter } from "context/FilterContext";

const Exporter = () => {
  const { state, actions } = useFilter();

  return (
    <div>
      <button onClick={() => actions.exportState(state, "uri")}>
        ⇧ URL
      </button>
      <button onClick={() => actions.exportState(state, "json")}>
        ⇧ JSON
      </button>
      <button
        onClick={() => {
          const json = prompt("Paste JSON"); // eslint-disable-line
          if (json) actions.importState(json);
        }}
      >
        Import
      </button>
    </div>
  );
};

export default Exporter;
