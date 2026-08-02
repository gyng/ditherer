# GPU testing and benchmarking

How to get real GPU numbers out of this repo, and the ways it silently lies to
you if you don't. Measured on WSLg + `google-chrome` + NVIDIA RTX 3080, July 2026.

Correctness suites (`npm run test:gl`) don't need any of this — a software
rasterizer compiles the same shaders. This matters when the _answer depends on
GPU behaviour_: register pressure, occupancy, bandwidth, "is this fast enough for
video".

## Getting on the GPU

```bash
NC_BENCH=1 PLAYWRIGHT_ANGLE=gl PLAYWRIGHT_GPU=1 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
  npx playwright test test/e2e/nc-bench.spec.ts --project=chromium
```

`PLAYWRIGHT_GPU=1` sets `GALLIUM_DRIVER=d3d12` on the browser process, which is
the whole mechanism: Chrome → ANGLE → Mesa's Gallium **d3d12** driver →
`libd3d12.so` → the adapter. It works headless and needs nothing in your shell.

Measured, four ways:

|                                      | renderer                              |
| ------------------------------------ | ------------------------------------- |
| headless, no mesa env                | `llvmpipe` (CPU)                      |
| **headless, `GALLIUM_DRIVER=d3d12`** | **`D3D12 (NVIDIA GeForce RTX 3080)`** |
| headed, no mesa env                  | `llvmpipe` (CPU)                      |
| headed, `GALLIUM_DRIVER=d3d12`       | `D3D12 (NVIDIA GeForce RTX 3080)`     |

The env var is necessary and sufficient. A window is neither — don't force headed
mode for GPU access, it only costs you the ability to run without a display.

**Vulkan is a dead end here.** `--use-angle=vulkan` reaches `llvmpipe`, because
this box has no NVIDIA Vulkan ICD and no dzn (Vulkan-on-D3D12) driver —
`/usr/share/vulkan/icd.d/` holds only Mesa's software ICDs. `nvidia-smi` seeing
the card does not mean Vulkan can use it. Use ANGLE-over-GL.

## Three ways this lies to you

### 1. You are probably not on a GPU

Default headless Chrome gives SwiftShader. `--use-angle=vulkan` gives llvmpipe.
Both are CPU rasterizers that model **no register file and no occupancy**, so
they cannot answer the questions you'd reach for a GPU to answer — no matter how
carefully you time them.

**Always print `UNMASKED_RENDERER_WEBGL` in any GL benchmark and read it before
trusting a number.** Not pedantry — the limits differ enough to invalidate
design decisions:

|                                | SwiftShader | RTX 3080 |
| ------------------------------ | ----------- | -------- |
| `MAX_FRAGMENT_UNIFORM_VECTORS` | 4096        | **1024** |

Believe the software renderer and you'd size a uniform array 4× past what the
real GPU allows. (The ES 3.0 guaranteed minimum is only 224 — mobile is stricter
than both.)

Do **not** use extension presence as a proxy for "on a GPU": llvmpipe exposes
`EXT_disjoint_timer_query_webgl2` (SwiftShader doesn't). Only the renderer string
tells you.

### 2. Wall-clock timing measures the readback, not the shader

`readoutToCanvas` draws the GL canvas into a 2D canvas; forcing that to land
costs far more than the draw it wraps. At 640×400 a 3080 runs a heavy dither
shader in ~1ms while the surrounding readback/IPC costs 10–40ms, so wall-clock
sweeps produce results that contradict themselves — a _bigger_ workload timing
_faster_.

Use `EXT_disjoint_timer_query_webgl2`, which brackets only the GL command stream:

```js
gl.finish(); // drain what's queued
gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
render();
gl.endQuery(ext.TIME_ELAPSED_EXT);
gl.finish(); // land our draw inside the window
// then poll QUERY_RESULT_AVAILABLE, and discard the sample if
// gl.getParameter(ext.GPU_DISJOINT_EXT) — the spec requires throwing it away
```

Only one `TIME_ELAPSED` query can be in flight per context, so this is
sequential. Warm up a few draws first or your first sample measures a downclocked
card.

### 3. A median with no spread beside it is not evidence

Report `min`/`max`/spread per cell, not a bare median. In practice the bad cells
had **5× max/min while their medians looked perfectly respectable** — and
undrained timer queries came out bimodal, some samples at the real cost and
others at a floor that was _identical across different configurations_ (the
query was timing a window the draw hadn't reached).

Before believing any result:

- **Does it obey physics?** Cost must rise with work. If a bigger palette
  measures cheaper, the measurement is broken — stop and fix it.
- **Does it reproduce?** Run it twice. See the war story below.
- **Is the GPU quiet?** Another project's browser fleet resident on the same GPU
  is enough to wreck every number.

## War story: how this went wrong

Worth reading before you trust your own sweep. Full detail in
[plan 055](plan/055-n-candidate-dithering.md).

A palette cap was set at 64 on the reasoning that a 256-entry per-fragment array
"would be brutal on registers". That was asserted, never measured. Then:

1. **SwiftShader** said the cap was ~free — but it's a CPU rasterizer, blind to
   the exact effect claimed. No evidence either way.
2. **Wall-clock on the GPU** gave self-contradictory numbers. It was timing the
   readback.
3. **GPU timer queries, run 1** showed a clean ~30% step between cap=64 and
   cap=128 across two independent palette sizes — exactly the shape of a spill,
   apparently vindicating the original guess.
4. **Run 2 did not reproduce it**, and measured cost _falling_ as the palette
   grew, which is impossible.

The step in run 1 was noise that happened to look like signal across two columns.
The cap stayed at 64 as a conservative default, explicitly documented as _not
shown correct_. The lesson isn't "benchmarking is hard" — it's that a plausible
mechanism plus one run that agrees with it is exactly how you end up confidently
wrong. Reproduce first.

## Reference implementation

`test/e2e/nc-bench.spec.ts` + the `bench` hook in `src/ncParity.ts` do all of the
above: renderer assertion, timer queries, drain, disjoint handling, spread
reporting. Copy the shape rather than rebuilding it. It's opt-in (`NC_BENCH=1`)
because its result is a judgement call, not a pass/fail.
