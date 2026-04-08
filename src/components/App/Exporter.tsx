import React, { useState } from "react";
import { useFilter } from "context/FilterContext";
import ModalInput from "components/ModalInput";

const Exporter = () => {
  const { state, actions } = useFilter();
  const [modal, setModal] = useState<null | "import" | "url">(null);
  const [urlValue, setUrlValue] = useState("");

  return (
    <div>
      <button
        onClick={() => {
          const url = actions.getExportUrl(state);
          setUrlValue(url);
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(
              () => setModal("url"),
              () => setModal("url")
            );
          } else {
            setModal("url");
          }
        }}
      >
        ⇧ URL
      </button>
      <button onClick={() => actions.exportState(state, "json")}>
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

      {modal === "url" && (
        <ModalInput
          title="Export URL (copied to clipboard)"
          defaultValue={urlValue}
          onConfirm={() => setModal(null)}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
};

export default Exporter;
