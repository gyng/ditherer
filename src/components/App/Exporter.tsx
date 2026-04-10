import React, { useState } from "react";
import { useFilter } from "context/useFilter";
import ModalInput from "components/ModalInput";

const Exporter = () => {
  const { state, actions } = useFilter();
  const [modal, setModal] = useState<null | "import" | "json">(null);
  const [jsonValue, setJsonValue] = useState("");

  return (
    <div>
      <button onClick={() => {
        const json = actions.exportState(state, "json");
        setJsonValue(json);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(json).then(
            () => setModal("json"),
            () => setModal("json")
          );
        } else {
          setModal("json");
        }
      }}>
        ⇧ JSON
      </button>
      <button onClick={() => setModal("import")}>
        Import
      </button>

      {modal === "import" && (
        <ModalInput
          title="Paste JSON"
          multiline
          onConfirm={json => {
            setModal(null);
            if (json) actions.importState(json);
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal === "json" && (
        <ModalInput
          title="Export JSON (copied to clipboard)"
          defaultValue={jsonValue}
          multiline
          onConfirm={() => setModal(null)}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
};

export default Exporter;
