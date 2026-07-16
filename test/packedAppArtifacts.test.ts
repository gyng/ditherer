import { describe, expect, it } from "vitest";
import {
  assertPackedAppArtifacts,
  summarizePackedAppArtifacts,
} from "../scripts/packed-app-artifacts.mjs";

describe("packed application artifact validation", () => {
  it("accepts a Ditherer build with the packaged worker and inline WASM payload", () => {
    const files = new Map([
      ["assets/rgba2laba-abc.js", "const wasm = 'data:application/wasm;base64,AGFzbQ=='"],
      ["assets/filterWorker-def.js", "self.onmessage = () => {}"],
      ["index.html", "<script type=module src=/assets/rgba2laba-abc.js></script>"],
    ]);

    expect(summarizePackedAppArtifacts(files)).toEqual({
      hasHtmlEntry: true,
      hasWorkerModule: true,
      hasWasmPayload: true,
    });
    expect(() => assertPackedAppArtifacts(files)).not.toThrow();
  });

  it("accepts an emitted WASM file and rejects missing package runtime assets", () => {
    const emittedWasm = new Map([
      ["index.html", ""],
      ["assets/filterWorker-def.js", ""],
      ["assets/rgba2laba-abc.wasm", ""],
    ]);
    const missingRuntimeAssets = new Map([
      ["index.html", ""],
      ["assets/index-abc.js", "console.log('app')"],
    ]);

    expect(() => assertPackedAppArtifacts(emittedWasm)).not.toThrow();
    expect(() => assertPackedAppArtifacts(missingRuntimeAssets)).toThrow(
      "packed Ditherer build is missing filter worker module, WASM payload",
    );
  });
});
