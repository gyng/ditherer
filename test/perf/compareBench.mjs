#!/usr/bin/env node
/**
 * Compare two bench report JSON files and print a diff table.
 *
 * Usage:
 *   npm run bench:compare                       # auto: 2nd-latest vs latest
 *   npm run bench:compare -- before.json after.json  # explicit paths
 *
 * Output columns:
 *   suite / bench | before hz | after hz | delta % | speedup
 */

import { readFileSync, readdirSync } from "node:fs";

let [, , beforePath, afterPath] = process.argv;

if (!beforePath || !afterPath) {
  // Auto-detect: pick the two most recent timestamped files in bench-results/
  const dir = "bench-results";
  const files = readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}T.*\.json$/.test(f))
    .sort();
  if (files.length < 2) {
    console.error(
      files.length === 0
        ? "No bench reports found in bench-results/. Run `npm run bench` first."
        : "Only one report found — need at least two runs to compare.\nRun `npm run bench` again after your changes.",
    );
    process.exit(1);
  }
  beforePath = `${dir}/${files[files.length - 2]}`;
  afterPath  = `${dir}/${files[files.length - 1]}`;
  console.log(`Auto-detected:\n  before: ${beforePath}\n  after:  ${afterPath}`);
}

const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after  = JSON.parse(readFileSync(afterPath,  "utf8"));

const COL = { suite: 42, hz: 14, delta: 9, speedup: 8 };
const pad  = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const sep  = "-".repeat(COL.suite + COL.hz * 2 + COL.delta + COL.speedup + 9);

const fmtHz = (n) => n >= 1e6
  ? (n / 1e6).toFixed(2) + "M"
  : n >= 1e3
  ? (n / 1e3).toFixed(1) + "K"
  : String(n);

console.log(`\nBefore : ${before.timestamp}`);
console.log(`After  : ${after.timestamp}\n`);
console.log(
  pad("Suite / Bench", COL.suite) +
  rpad("Before", COL.hz) +
  rpad("After", COL.hz) +
  rpad("Δ%", COL.delta) +
  rpad("Speedup", COL.speedup),
);
console.log(sep);

const allSuites = new Set([
  ...Object.keys(before.suites ?? {}),
  ...Object.keys(after.suites ?? {}),
]);

let improved = 0, regressed = 0, unchanged = 0;

for (const suite of allSuites) {
  const bSuite = before.suites?.[suite] ?? {};
  const aSuite = after.suites?.[suite] ?? {};
  const allBenches = new Set([...Object.keys(bSuite), ...Object.keys(aSuite)]);

  let suiteHeaderPrinted = false;
  for (const bench of allBenches) {
    if (!suiteHeaderPrinted) {
      console.log(pad(`[${suite}]`, COL.suite));
      suiteHeaderPrinted = true;
    }

    const bHz = bSuite[bench]?.hz ?? null;
    const aHz = aSuite[bench]?.hz ?? null;

    if (bHz === null && aHz !== null) {
      console.log(
        pad(`  ${bench}`, COL.suite) +
        rpad("—", COL.hz) +
        rpad(fmtHz(aHz), COL.hz) +
        rpad("new", COL.delta) +
        rpad("", COL.speedup),
      );
      continue;
    }
    if (aHz === null && bHz !== null) {
      console.log(
        pad(`  ${bench}`, COL.suite) +
        rpad(fmtHz(bHz), COL.hz) +
        rpad("—", COL.hz) +
        rpad("removed", COL.delta) +
        rpad("", COL.speedup),
      );
      continue;
    }

    const deltaPct = ((aHz - bHz) / bHz) * 100;
    const speedup  = aHz / bHz;
    const sign     = deltaPct >= 0 ? "+" : "";
    const marker   = deltaPct >=  5 ? "▲" : deltaPct <= -5 ? "▼" : " ";

    if (deltaPct >= 2)       improved++;
    else if (deltaPct <= -2) regressed++;
    else                     unchanged++;

    console.log(
      pad(`  ${bench}`, COL.suite) +
      rpad(fmtHz(bHz), COL.hz) +
      rpad(fmtHz(aHz), COL.hz) +
      rpad(`${sign}${deltaPct.toFixed(1)}%`, COL.delta) +
      rpad(`${marker}${speedup.toFixed(2)}x`, COL.speedup),
    );
  }
}

console.log(sep);
console.log(`  ▲ improved: ${improved}   ▼ regressed: ${regressed}   unchanged: ${unchanged}\n`);
