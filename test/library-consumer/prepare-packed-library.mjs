import { mkdir, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageRoot = path.join(repositoryRoot, "packages/ditherer-filters");
const fixtureRoot = path.join(repositoryRoot, "examples/filter-library");
const packDirectory = path.join("/tmp", "ditherer-library-pack");
const npmCache = path.join("/tmp", "ditherer-library-npm-cache");

await rm(packDirectory, { recursive: true, force: true });
await rm(path.join(fixtureRoot, "node_modules"), { recursive: true, force: true });
await mkdir(packDirectory, { recursive: true });

const environment = { ...process.env, NPM_CONFIG_CACHE: npmCache };
const runNpm = (args, cwd) => {
  const result = spawnSync("npm", args, { cwd, env: environment, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

runNpm(["pack", "--pack-destination", packDirectory], packageRoot);
const tarballName = (await readdir(packDirectory)).find((name) => name.endsWith(".tgz"));
if (!tarballName) throw new Error("npm pack did not produce a tarball");

runNpm([
  "install",
  "--ignore-scripts",
  "--no-save",
  "--package-lock=false",
  path.join(packDirectory, tarballName),
], fixtureRoot);
