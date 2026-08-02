import { defineConfig, devices } from "@playwright/test";

// PLAYWRIGHT_ANGLE picks the ANGLE backend: "1" keeps the original "gl", any
// other value is passed through as the backend name ("vulkan", "swiftshader").
// Under WSLg "gl" is the one that reaches the GPU: ANGLE renders through Mesa's
// Gallium d3d12 driver and reports "ANGLE (Microsoft Corporation, D3D12
// (<adapter>), OpenGL 4.6)". There is no NVIDIA Vulkan ICD here, so
// --use-angle=vulkan reaches llvmpipe or no context at all — never the GPU.
const angleBackend = process.env.PLAYWRIGHT_ANGLE === "1" ? "gl" : process.env.PLAYWRIGHT_ANGLE;
const wantsGpu = process.env.PLAYWRIGHT_GPU === "1";
const launchArgs = [
  ...(angleBackend ? ["--use-gl=angle", `--use-angle=${angleBackend}`] : []),
  ...(wantsGpu
    ? ["--ignore-gpu-blocklist", "--enable-features=Vulkan", "--enable-gpu-rasterization"]
    : []),
  ...(process.env.PLAYWRIGHT_WEBMCP === "1"
    ? ["--enable-features=WebMCPTesting,DevToolsWebMCPSupport"]
    : []),
];

// Mesa picks its driver from the environment, not from a Chrome flag, so this
// is what the GPU route actually turns on. GALLIUM_DRIVER is the knob that lands
// on the adapter; MESA_LOADER_DRIVER_OVERRIDE alone leaves Chrome with no GPU
// context at all. Setting it here keeps PLAYWRIGHT_GPU=1 meaning the GPU rather
// than depending on the caller's shell, and an explicit value still wins.
//
// This is the only thing that matters — measured with google-chrome under WSLg,
// headless and headed alike: with GALLIUM_DRIVER=d3d12 both report "ANGLE
// (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 3080), OpenGL 4.6)";
// without it both report llvmpipe, window or no window. So GPU runs stay
// headless and keep working where there is no display.
//
// A benchmark whose answer depends on GPU behaviour must still assert the
// RENDERER it actually got (see nc-bench.spec.ts) — note EXT_disjoint_timer_-
// query_webgl2 is exposed on llvmpipe too, so its presence proves nothing.
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const launchEnv = wantsGpu
  ? {
      ...inheritedEnvironment,
      GALLIUM_DRIVER: process.env.GALLIUM_DRIVER ?? "d3d12",
    }
  : undefined;
const serverPort = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const serverUrl = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  testDir: "./test/e2e",
  // V8 coverage conversion and the GL registry smoke test are both memory and
  // CPU intensive. Keeping the release gate at two browser workers prevents
  // instrumented pages from starving the shared dev server/software renderer.
  workers: process.env.COLLECT_BROWSER_COVERAGE === "1" ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: serverUrl,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: launchArgs.length > 0 ? launchArgs : undefined,
      env: launchEnv,
    },
  },
  webServer: {
    command: `env -u NO_COLOR -u FORCE_COLOR npm run dev -- --host 127.0.0.1 --port ${serverPort} --strictPort`,
    url: `${serverUrl}/wasm-smoke.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
