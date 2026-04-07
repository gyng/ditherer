// @flow
import React from "react";
import { createRoot } from "react-dom/client";

import "styles/global.css";

import App from "components/App";
import { FilterProvider } from "context/FilterContext";
import { PALETTE } from "constants/optionTypes";
import { THEMES } from "palettes/user";

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
    // ignore
  }
});

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <FilterProvider>
      <App />
    </FilterProvider>
  );
}
