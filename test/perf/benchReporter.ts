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

    for (const testModule of testModules) {
      // testModule.task is the old-style File; its tasks are the top-level suites
      for (const suite of testModule.task?.tasks ?? []) {
        if (suite.type !== "suite") continue;
        const entries: Record<string, BenchEntry> = {};

        for (const task of suite.tasks ?? []) {
          // Bench tasks: meta.benchmark === true, result.benchmark has the stats
          const b = task.result?.benchmark;
          if (!task.meta?.benchmark || !b) continue;

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
  }
}
