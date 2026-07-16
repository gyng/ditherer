import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_LIBRARY_PORT ?? 4187);
const serverUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "../e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: serverUrl,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `env -u NO_COLOR -u FORCE_COLOR npm run dev -- examples/filter-library --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${serverUrl}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
