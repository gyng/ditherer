import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const buildRoot = process.argv[2] ?? "/tmp/ditherer-selective-consumer-build";
const files = [];
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.name.endsWith(".js")) files.push(absolute);
  }
};
await walk(buildRoot);

const contents = await Promise.all(files.map((file) => readFile(file)));
const gzipBytes = contents.reduce((total, contents) => total + gzipSync(contents).byteLength, 0);
const combined = Buffer.concat(contents).toString("utf8");
const ceiling = 120_000;

if (files.length === 0) throw new Error("Selective consumer emitted no JavaScript");
if (gzipBytes > ceiling) {
  throw new Error(`Selective consumer is ${gzipBytes} gzip bytes; ceiling is ${ceiling}`);
}
if (combined.includes("Path-Traced Diorama") || combined.includes("FFT Spectral Gate")) {
  throw new Error("Selective consumer contains unrelated full-catalog filters");
}

console.log(`Selective Grayscale consumer: ${files.length} JS files, ${gzipBytes} gzip bytes`);
