import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:4187",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: "env -u NO_COLOR -u FORCE_COLOR npm run dev -- test/library-consumer/fixture --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187/library-smoke.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
