import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

const root = process.cwd();
const unitCoveragePath = path.join(root, "coverage/coverage-final.json");
const browserCoveragePaths = [
  ".browser-coverage/app-advanced.json",
  ".browser-coverage/app-boundaries.json",
  ".browser-coverage/app-workflow.json",
  ".browser-coverage/audio-inputs.json",
  ".browser-coverage/control-inputs.json",
  ".browser-coverage/export-artifacts-contact.json",
  ".browser-coverage/export-artifacts-gif.json",
  ".browser-coverage/export-artifacts-image.json",
  ".browser-coverage/export-artifacts-sequence.json",
  ".browser-coverage/export-artifacts-video.json",
  ".browser-coverage/gl-smoke.json",
  ".browser-coverage/library-discovery.json",
  ".browser-coverage/project-state.json",
  ".browser-coverage/resilience-no-gl.json",
  ".browser-coverage/resilience-recovery.json",
  ".browser-coverage/source-ingestion.json",
  ".browser-coverage/test-media-share.json",
  ".browser-coverage/ux-onboarding.json",
  ".browser-coverage/ux-filter-typeahead.json",
  ".browser-coverage/ux-workbench-desktop.json",
  ".browser-coverage/ux-workbench-mobile.json",
  ".browser-coverage/vj-mode.json",
  ".browser-coverage/wasm-smoke.json",
  ".browser-coverage/workspace-layout.json",
];

const readCoverage = async (filePath) =>
  JSON.parse(await readFile(path.join(root, filePath), "utf8"));

const unitMap = libCoverage.createCoverageMap(
  JSON.parse(await readFile(unitCoveragePath, "utf8")),
);
const browserMap = libCoverage.createCoverageMap({});

for (const filePath of browserCoveragePaths) {
  browserMap.merge(await readCoverage(filePath));
}

const locationKey = (location) => location
  ? `${location.start.line}:${location.start.column ?? ""}-${location.end.line}:${location.end.column ?? ""}`
  : "";

const counterSignatures = {
  statement: (entry) => locationKey(entry),
  function: (entry) => `${entry.name}|${locationKey(entry.decl)}|${locationKey(entry.loc)}`,
  branch: (entry) => `${entry.type}|${locationKey(entry.loc)}|${entry.locations.map(locationKey).join("|")}`,
};

const addCountersByLocation = (base, incoming, mapKey, counterKey, signature) => {
  const idsBySignature = new Map();
  for (const [id, entry] of Object.entries(base[mapKey])) {
    const key = signature(entry);
    const ids = idsBySignature.get(key) ?? [];
    ids.push(id);
    idsBySignature.set(key, ids);
  }
  const used = new Map();
  for (const [incomingId, entry] of Object.entries(incoming[mapKey])) {
    const key = signature(entry);
    const index = used.get(key) ?? 0;
    const baseId = idsBySignature.get(key)?.[index];
    used.set(key, index + 1);
    if (baseId === undefined) continue;
    const baseCount = base[counterKey][baseId];
    const incomingCount = incoming[counterKey][incomingId];
    if (Array.isArray(baseCount) && Array.isArray(incomingCount)) {
      base[counterKey][baseId] = baseCount.map((count, outcome) => count + (incomingCount[outcome] ?? 0));
    } else if (typeof baseCount === "number" && typeof incomingCount === "number") {
      base[counterKey][baseId] = baseCount + incomingCount;
    }
  }
};

const mergeFileByLocation = (canonical, incoming) => {
  const merged = structuredClone(canonical);
  addCountersByLocation(merged, incoming, "statementMap", "s", counterSignatures.statement);
  addCountersByLocation(merged, incoming, "fnMap", "f", counterSignatures.function);
  addCountersByLocation(merged, incoming, "branchMap", "b", counterSignatures.branch);
  return merged;
};

// Vitest and Chromium instrument the same source after different transforms,
// so their numeric coverage IDs are not portable between maps. Istanbul's
// default file merge can double-count those transform-specific IDs. Keep one
// canonical source schema and add matching execution counts by source location.
// Browser owns files with no unit execution; otherwise the unit schema is the
// canonical map and browser hits are overlaid onto it.
const map = libCoverage.createCoverageMap({});
const filenames = new Set([...unitMap.files(), ...browserMap.files()]);
for (const filename of filenames) {
  const unitCoverage = unitMap.data[filename];
  const browserCoverage = browserMap.data[filename];
  const unit = unitCoverage?.toJSON();
  const browser = browserCoverage?.toJSON();
  if (!unit) {
    map.addFileCoverage(browser);
    continue;
  }
  if (!browser) {
    map.addFileCoverage(unit);
    continue;
  }
  const unitSummary = unitMap.fileCoverageFor(filename).toSummary().toJSON();
  const unitExecuted = unitSummary.statements.covered > 0
    || unitSummary.functions.covered > 0
    || unitSummary.branches.covered > 0;
  map.addFileCoverage(unitExecuted ? mergeFileByLocation(unit, browser) : browser);
}

// Test harnesses and generated WASM glue are execution infrastructure, not
// shipped TypeScript product code. Everything else under src remains in the
// merged denominator, including GL, React, workers, and export orchestration.
map.filter((filename) => {
  const relative = path.relative(root, filename).replaceAll(path.sep, "/");
  return relative !== "src/glSmoke.ts"
    && relative !== "src/ncParity.ts"
    && relative !== "src/wasmSmoke.ts"
    && !relative.startsWith("packages/ditherer-filters/src/wasm/");
});

const thresholds = {
  lines: 80,
  statements: 80,
  functions: 80,
  branches: 80,
};
const summary = map.getCoverageSummary().toJSON();
const failures = [];

for (const [metric, threshold] of Object.entries(thresholds)) {
  const actual = Number(summary[metric].pct);
  if (!Number.isFinite(actual) || actual < threshold) {
    failures.push(`${metric}: ${actual.toFixed(2)}% < ${threshold}%`);
  }
}

await writeFile(
  path.join(root, "coverage/coverage-merged.json"),
  JSON.stringify(map.toJSON()),
  "utf8",
);
await writeFile(
  path.join(root, "coverage/coverage-merged-summary.json"),
  JSON.stringify({ total: summary, thresholds }, null, 2),
  "utf8",
);

const context = libReport.createContext({
  dir: path.join(root, "coverage/merged"),
  coverageMap: map,
});
reports.create("text-summary").execute(context);
reports.create("html").execute(context);

if (failures.length > 0) {
  throw new Error(`Merged coverage gate failed:\n${failures.join("\n")}`);
}

console.log(
  `Merged coverage gate passed: ${Object.entries(thresholds)
    .map(([metric, threshold]) => `${metric} ${summary[metric].pct}% (floor ${threshold}%)`)
    .join(", ")}`,
);
