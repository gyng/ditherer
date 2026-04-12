import {
  referenceTable,
  rgba2laba,
  wasmReady,
  wasmQuantizeBufferRgb,
} from "utils";
import initWasm, {
  quantize_buffer_rgb as rawQuantizeBufferRgb,
  rgba2laba as rawWasmRgba2laba,
} from "./wasm/rgba2laba/wasm/rgba2laba";

declare global {
  interface Window {
    __wasmSmokeResult?: Record<string, unknown>;
  }
}

const statusNode = document.querySelector('[data-testid="status"]');
const detailsNode = document.querySelector('[data-testid="details"]');

const setStatus = (status: string, details: unknown) => {
  if (statusNode) statusNode.textContent = status;
  if (detailsNode) detailsNode.textContent = JSON.stringify(details, null, 2);
  window.__wasmSmokeResult = { status, ...((details as Record<string, unknown>) || {}) };
};

const main = async () => {
  const sample = [61, 128, 243, 255] as const;
  const sampleBuffer = new Uint8Array(sample);
  const palette = [
    [0, 0, 0, 255],
    [64, 128, 255, 255],
    [255, 255, 255, 255],
  ];
  const paletteFlat = new Float64Array(palette.flat());
  const ref = referenceTable.CIE_1931.D65;

  await initWasm();
  const utilsWasmReady = await wasmReady;

  const jsLab = Array.from(rgba2laba(sample, ref));
  const wasmLab = Array.from(
    rawWasmRgba2laba(sample[0], sample[1], sample[2], sample[3], ref.x, ref.y, ref.z),
  );
  const maxLabDiff = Math.max(
    ...jsLab.map((value, index) => Math.abs(value - wasmLab[index])),
  );

  const rawQuantized = Array.from(rawQuantizeBufferRgb(sampleBuffer, paletteFlat));
  const wrappedQuantized = utilsWasmReady
    ? wasmQuantizeBufferRgb(new Uint8Array(sampleBuffer), palette)
    : null;

  const details = {
    maxLabDiff,
    rawQuantized,
    wrappedQuantized: wrappedQuantized ? Array.from(wrappedQuantized) : null,
    utilsReady: utilsWasmReady && wrappedQuantized !== null,
  };

  if (maxLabDiff > 0.001) {
    throw new Error(`Unexpected WASM lab mismatch: ${maxLabDiff}`);
  }

  if (!utilsWasmReady || !wrappedQuantized) {
    throw new Error("utils WASM wrapper did not initialize in time");
  }

  if (wrappedQuantized.length !== sampleBuffer.length) {
    throw new Error("utils WASM quantize wrapper returned an unexpected buffer length");
  }

  if (rawQuantized.join(",") !== Array.from(wrappedQuantized).join(",")) {
    throw new Error("raw WASM quantize output did not match the utils wrapper output");
  }

  setStatus("ok", details);
};

main().catch((error) => {
  const details = {
    message: error instanceof Error ? error.message : String(error),
  };
  setStatus("failed", details);
  console.error("WASM smoke failed:", error);
});
