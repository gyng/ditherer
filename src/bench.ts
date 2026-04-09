/**
 * In-browser pipeline benchmark.
 * Measures real canvas ops (getImageData, putImageData, toDataURL, Image decode).
 *
 * Open /bench.html in the browser to run.
 */
import { floydSteinberg } from "filters/errorDiffusing";
import ordered from "filters/ordered";
import convolve from "filters/convolve";
import * as palettes from "palettes";

const palette = palettes.nearest;

const makeNoiseCanvas = (w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(w, h);
  for (let i = 0; i < imageData.data.length; i++) {
    imageData.data[i] = (i * 2654435761) & 0xff;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

interface BenchResult {
  name: string;
  runs: number;
  mean: number;
  min: number;
  max: number;
  p75: number;
  fps: number;
}

const runBench = (name: string, fn: () => void, minTime = 2000): BenchResult => {
  // Warmup
  for (let i = 0; i < 3; i++) fn();

  const times: number[] = [];
  const deadline = performance.now() + minTime;

  while (performance.now() < deadline || times.length < 5) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
    if (times.length > 200) break;
  }

  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const p75 = times[Math.floor(times.length * 0.75)];

  return {
    name,
    runs: times.length,
    mean: +mean.toFixed(2),
    min: +times[0].toFixed(2),
    max: +times[times.length - 1].toFixed(2),
    p75: +p75.toFixed(2),
    fps: +(1000 / mean).toFixed(1),
  };
};

const pngDecodeBench = (name: string, filterFn: () => HTMLCanvasElement, minTime = 2000): Promise<BenchResult> => {
  // Warmup
  for (let i = 0; i < 3; i++) filterFn();

  return new Promise((resolve) => {
    const times: number[] = [];
    const deadline = performance.now() + minTime;

    const runOne = () => {
      const t0 = performance.now();
      const output = filterFn();
      const dataUrl = output.toDataURL("image/png");
      const img = new Image();
      img.onload = () => {
        times.push(performance.now() - t0);
        if ((performance.now() < deadline || times.length < 5) && times.length < 100) {
          runOne();
        } else {
          times.sort((a, b) => a - b);
          const mean = times.reduce((a, b) => a + b, 0) / times.length;
          const p75 = times[Math.floor(times.length * 0.75)];
          resolve({
            name,
            runs: times.length,
            mean: +mean.toFixed(2),
            min: +times[0].toFixed(2),
            max: +times[times.length - 1].toFixed(2),
            p75: +p75.toFixed(2),
            fps: +(1000 / mean).toFixed(1),
          });
        }
      };
      img.src = dataUrl;
    };
    runOne();
  });
};

const log = (msg: string) => {
  const el = document.getElementById("log")!;
  el.textContent += msg + "\n";
  console.log(msg);
};

const formatRow = (r: BenchResult) =>
  `  ${r.name.padEnd(48)} ${String(r.mean).padStart(8)}ms  p75 ${String(r.p75).padStart(8)}ms  ${String(r.fps).padStart(6)} fps  (${r.runs} runs)`;

const runSuite = async () => {
  log("Preparing 640×480 noise canvas...");
  const canvas640 = makeNoiseCanvas(640, 480);

  const suites: { title: string; benches: (() => BenchResult | Promise<BenchResult>)[] }[] = [
    {
      title: "Filter only (640×480)",
      benches: [
        () => runBench("Floyd-Steinberg sRGB", () => { floydSteinberg.func(canvas640, { palette, _linearize: false }); }),
        () => runBench("Floyd-Steinberg linear", () => { floydSteinberg.func(canvas640, { palette, _linearize: true }); }),
        () => runBench("Ordered Bayer sRGB", () => { ordered.func(canvas640, ordered.defaults as any); }),
        () => runBench("Convolve Gaussian sRGB", () => { convolve.func(canvas640, { ...convolve.defaults, _linearize: false } as any); }),
      ],
    },
    {
      title: "Pipeline: filter → direct canvas (current path)",
      benches: [
        () => runBench("Floyd-Steinberg → canvas", () => { floydSteinberg.func(canvas640, { palette, _linearize: false }); }),
        () => runBench("Ordered Bayer → canvas", () => { ordered.func(canvas640, ordered.defaults as any); }),
        () => runBench("3-chain: Ordered → Conv → Conv", () => {
          let c: any = ordered.func(canvas640, ordered.defaults as any);
          c = convolve.func(c, { ...convolve.defaults, _linearize: false } as any);
          convolve.func(c, { ...convolve.defaults, _linearize: false } as any);
        }),
      ],
    },
    {
      title: "Pipeline: filter → PNG encode + decode (old path)",
      benches: [
        () => pngDecodeBench("Floyd-Steinberg → toDataURL → Image", () => floydSteinberg.func(canvas640, { palette, _linearize: false }) as HTMLCanvasElement),
        () => pngDecodeBench("Ordered Bayer → toDataURL → Image", () => ordered.func(canvas640, ordered.defaults as any) as HTMLCanvasElement),
        () => pngDecodeBench("3-chain → toDataURL → Image", () => {
          let c: any = ordered.func(canvas640, ordered.defaults as any);
          c = convolve.func(c, { ...convolve.defaults, _linearize: false } as any);
          return convolve.func(c, { ...convolve.defaults, _linearize: false } as any) as HTMLCanvasElement;
        }),
      ],
    },
    {
      title: "Isolated overhead: toDataURL + Image decode only",
      benches: [
        () => {
          // Pre-render a canvas, then measure just the encode+decode
          const output = floydSteinberg.func(canvas640, { palette, _linearize: false }) as HTMLCanvasElement;
          return pngDecodeBench("640×480 toDataURL → Image decode", () => output);
        },
      ],
    },
  ];

  for (const suite of suites) {
    log(`\n── ${suite.title} ${"─".repeat(Math.max(0, 58 - suite.title.length))}`);
    for (const benchFn of suite.benches) {
      const result = await benchFn();
      log(formatRow(result));
    }
  }

  log("\n✓ Done");
};

// Auto-run on load
runSuite();
