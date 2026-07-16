import { rm } from "node:fs/promises";
import path from "node:path";

await rm(path.resolve(process.cwd(), ".browser-coverage"), {
  recursive: true,
  force: true,
});
