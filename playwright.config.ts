import { defineConfig, devices } from "@playwright/test";

const launchArgs = [
  ...(process.env.PLAYWRIGHT_ANGLE === "1" ? ["--use-gl=angle", "--use-angle=gl"] : []),
  ...(process.env.PLAYWRIGHT_WEBMCP === "1"
    ? ["--enable-features=WebMCPTesting,DevToolsWebMCPSupport"]
    : []),
];

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
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: launchArgs.length > 0 ? launchArgs : undefined,
    },
  },
  webServer: {
    command: "env -u NO_COLOR -u FORCE_COLOR npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/wasm-smoke.html",
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
