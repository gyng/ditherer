import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const typesDirectory = fileURLToPath(new URL("../types", import.meta.url));

await rm(typesDirectory, { recursive: true, force: true });
