import { readFile } from "node:fs/promises";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));
const requestedRelease = process.argv[2];

if (!requestedRelease) {
  throw new Error("Pass a version (0.1.0) or filter tag (filters-v0.1.0)");
}

const requestedVersion = requestedRelease.replace(/^filters-v/, "");
if (requestedVersion !== packageJson.version) {
  throw new Error(
    `Release ${requestedRelease} does not match ${packageJson.name}@${packageJson.version}`,
  );
}

console.log(`Validated ${packageJson.name}@${packageJson.version}`);
