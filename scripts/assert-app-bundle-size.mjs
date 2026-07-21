import { readdir, stat } from "node:fs/promises";

const MAX_CHUNK_BYTES = 1_000_000;
const assetsDirectory = new URL("../build/assets/", import.meta.url);

const assetNames = await readdir(assetsDirectory);
const javascriptAssets = assetNames.filter((name) => name.endsWith(".js"));
const measuredAssets = await Promise.all(
  javascriptAssets.map(async (name) => ({
    name,
    size: (await stat(new URL(name, assetsDirectory))).size,
  })),
);
const oversizedAssets = measuredAssets
  .filter(({ size }) => size > MAX_CHUNK_BYTES)
  .sort((a, b) => b.size - a.size);

if (oversizedAssets.length > 0) {
  const details = oversizedAssets
    .map(({ name, size }) => `  ${name}: ${(size / 1_000).toFixed(2)} kB`)
    .join("\n");
  throw new Error(
    `Production JavaScript chunk budget exceeded (${MAX_CHUNK_BYTES / 1_000} kB):\n${details}`,
  );
}

const largestAsset = measuredAssets.sort((a, b) => b.size - a.size)[0];
if (largestAsset) {
  console.log(
    `JavaScript chunk budget passed: largest is ${largestAsset.name} at ${(largestAsset.size / 1_000).toFixed(2)} kB.`,
  );
}
