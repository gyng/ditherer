import React from "react";
import { createRoot } from "react-dom/client";

import "styles/global.css";

// Eagerly load heavy modules during the boot screen
import "utils"; // triggers WASM init
import "filters"; // loads all filter modules
import "workers/workerRPC"; // pre-warms the Web Worker

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
