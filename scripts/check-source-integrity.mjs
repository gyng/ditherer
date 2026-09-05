import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { extname } from "node:path";

// Run directly with Node even when package.json is damaged. Explicit paths also
// allow checking recovered files before bringing them back into the repository.
const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : (await promisify(execFile)("git", ["ls-files", "-z"], { encoding: "utf8" })).stdout
        .split("\0")
        .filter(Boolean);
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".rs",
  ".toml",
]);
let failed = false;
for (const file of files) {
  if (!textExtensions.has(extname(file))) continue;
  try {
    if (readFileSync(file).includes(0)) {
      console.error(`NUL bytes in text file: ${file}`);
      failed = true;
    }
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.message}`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
