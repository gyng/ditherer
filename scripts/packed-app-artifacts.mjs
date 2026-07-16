import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerModulePattern = /(^|\/)filterWorker-[^/]+\.js$/;
const inlineWasmMarker = "data:application/wasm;base64,";

export const summarizePackedAppArtifacts = (files) => ({
  hasHtmlEntry: files.has("index.html"),
  hasWorkerModule: [...files.keys()].some((name) => workerModulePattern.test(name)),
  hasWasmPayload: [...files.entries()].some(([name, contents]) =>
    name.includes("rgba2laba")
    && (
      name.endsWith(".wasm")
      || (name.endsWith(".js") && contents.includes(inlineWasmMarker))
    )),
});

export const assertPackedAppArtifacts = (files) => {
  const summary = summarizePackedAppArtifacts(files);
  const missing = [];
  if (!summary.hasHtmlEntry) missing.push("HTML entry");
  if (!summary.hasWorkerModule) missing.push("filter worker module");
  if (!summary.hasWasmPayload) missing.push("WASM payload");
  if (missing.length > 0) {
    throw new Error(`packed Ditherer build is missing ${missing.join(", ")}`);
  }
  return summary;
};

const readBuildFiles = async (root, directory = root, files = new Map()) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await readBuildFiles(root, absolutePath, files);
      continue;
    }
    const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, "/");
    const contents = entry.name.endsWith(".js") || entry.name.endsWith(".html")
      ? await readFile(absolutePath, "utf8")
      : "";
    files.set(relativePath, contents);
  }
  return files;
};

const isCommand = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCommand) {
  const buildDirectory = path.resolve(process.argv[2] ?? "/tmp/ditherer-packed-app-build");
  const files = await readBuildFiles(buildDirectory);
  const summary = assertPackedAppArtifacts(files);
  console.log(
    `Packed Ditherer artifacts verified: ${files.size} files, `
    + `worker=${summary.hasWorkerModule}, wasm=${summary.hasWasmPayload}`,
  );
}
