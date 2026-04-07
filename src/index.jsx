// @flow
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "components/App";
import { FilterProvider, useFilter } from "context/FilterContext";
import { PALETTE } from "constants/optionTypes";
import { THEMES } from "palettes/user";
import { filterList } from "filters";

import s from "styles/style.module.css";

// Load localStorage palettes
Object.values(localStorage).forEach(json => {
  try {
    if (typeof json !== "string") return;
    const option = JSON.parse(json);
    if (!option || !option.type) return;
    if (option.type === PALETTE) {
      THEMES[option.name] = option.colors;
    }
  } catch (e) {
    // ignore invalid localStorage entries
  }
});

// Wrapper to handle URL params on mount
const AppWithParams = () => {
  const { actions } = useFilter();

  React.useEffect(() => {
    if (window.URLSearchParams && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const alg = params.get("alg");
      const selectedFilter = filterList.find(
        f => f && f.displayName && f.displayName === alg
      );
      if (alg && selectedFilter) {
        actions.selectFilter(alg, selectedFilter);
      }
      const stateParam = params.get("state");
      try {
        const decoded = window.atob(stateParam);
        if (stateParam && decoded) {
          actions.importState(decoded);
        }
      } catch (e) {
        console.warn("Invalid state:", e); // eslint-disable-line
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <App className={s.app} />;
};

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <FilterProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<AppWithParams />} />
          </Routes>
        </BrowserRouter>
      </FilterProvider>
    </React.StrictMode>
  );
}
