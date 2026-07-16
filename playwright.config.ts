import { defineConfig, devices } from "@playwright/test";

// PLAYWRIGHT_ANGLE picks the ANGLE backend: "1" keeps the original "gl", any
// other value is passed through as the backend name ("vulkan", "swiftshader").
// Vulkan is how you reach a real GPU under WSLg instead of the SwiftShader CPU
// rasterizer that headless Chrome otherwise falls back to — which matters for
// any benchmark whose answer depends on GPU behaviour (see nc-bench.spec.ts).
const angleBackend = process.env.PLAYWRIGHT_ANGLE === "1" ? "gl" : process.env.PLAYWRIGHT_ANGLE;
const launchArgs = [
  ...(angleBackend ? ["--use-gl=angle", `--use-angle=${angleBackend}`] : []),
  ...(process.env.PLAYWRIGHT_GPU === "1"
    ? ["--ignore-gpu-blocklist", "--enable-features=Vulkan", "--enable-gpu-rasterization"]
    : []),
  ...(process.env.PLAYWRIGHT_WEBMCP === "1"
    ? ["--enable-features=WebMCPTesting,DevToolsWebMCPSupport"]
    : []),
];
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
