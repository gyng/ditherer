/**
 * Vitest bench reporter — saves results to bench-results/<timestamp>.json
 * and overwrites bench-results/latest.json.
 *
 * Silently does nothing when there are no benchmark tasks (regular test runs).
 *
 * Report format:
 * {
 *   "timestamp": "2026-04-08T12:00:00.000Z",
 *   "suites": {
 *     "<suite name>": {
 *       "<bench name>": { "hz": 12540699, "mean": 0.000080, "p75": 0.000076,
 *                         "p99": 0.000098, "rme": 0.40, "samples": 6270350 }
 *     }
 *   }
 * }
 *
 * Compare two reports:
 *   node test/perf/compareBench.mjs bench-results/before.json bench-results/after.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface BenchEntry {
  hz: number;
  mean: number;
  p75: number;
  p99: number;
  rme: number;
  samples: number;
}

interface Report {
  timestamp: string;
  suites: Record<string, Record<string, BenchEntry>>;
}

export default class BenchJsonReporter {
  // Vitest 4: onTestRunEnd replaces the old onFinished hook.
  // testModules is ReadonlyArray<TestModule>; each has a .task property
  // that carries the old-style File object with tasks/suites/bench results.
  onTestRunEnd(testModules: any[]): void {
    const suites: Record<string, Record<string, BenchEntry>> = {};
    // Benches that ran but produced no stats. A bench whose body throws every
    // iteration lands here: vitest leaves `result.benchmark` as a stub carrying
    // only name/rank/rme/samples, with no `hz` or `mean`.
    const statless: string[] = [];

    for (const testModule of testModules) {
      // testModule.task is the old-style File; its tasks are the top-level suites
      for (const suite of testModule.task?.tasks ?? []) {
        if (suite.type !== "suite") continue;
        const entries: Record<string, BenchEntry> = {};

        for (const task of suite.tasks ?? []) {
          // Bench tasks: meta.benchmark === true, result.benchmark has the stats
          const b = task.result?.benchmark;
          if (!task.meta?.benchmark || !b) continue;

          // Reading b.mean straight off the stub threw `Cannot read properties
          // of undefined (reading 'toFixed')` from inside the reporter — which
          // aborted the whole run *before* the file was written, so one broken
          // bench silently cost every other suite's results. Collect and report
          // by name instead; the data that did survive is still worth writing.
          if (typeof b.mean !== "number" || typeof b.hz !== "number") {
            statless.push(`${suite.name} > ${task.name}`);
            continue;
          }

          entries[task.name] = {
            hz:      Math.round(b.hz),
            mean:    +b.mean.toFixed(6),
            p75:     +b.p75.toFixed(6),
            p99:     +b.p99.toFixed(6),
            rme:     +b.rme.toFixed(3),
            samples: Array.isArray(b.samples) ? b.samples.length : (b.sampleCount ?? 0),
          };
        }

        if (Object.keys(entries).length > 0) {
          suites[suite.name] = entries;
        }
      }
    }

    // Nothing to write — this was a regular test run, not a bench run
    if (Object.keys(suites).length === 0) return;

    const report: Report = {
      timestamp: new Date().toISOString(),
      suites,
    };

    const dir = resolve(process.cwd(), "bench-results");
    mkdirSync(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outPath = resolve(dir, `${ts}.json`);
    const latestPath = resolve(dir, "latest.json");

    const json = JSON.stringify(report, null, 2);
    writeFileSync(outPath, json);
    writeFileSync(latestPath, json);

    process.stdout.write(`\nBench report saved → bench-results/${ts}.json\n`);

    // Loud, and after the write so the good results survive. A bench with no
    // stats measured nothing, and a bench that measured nothing but is left in
    // the file reads as coverage it doesn't have — which is how the Binarize
    // and precomputed-Lab benches both sat broken while reporting numbers.
    if (statless.length > 0) {
      throw new Error(
        `${statless.length} bench(es) produced no stats — their bodies threw on every ` +
          `iteration and measured nothing:\n  ${statless.join("\n  ")}\n` +
          `Report was still written to bench-results/${ts}.json without them.`,
      );
    }
  }
}
