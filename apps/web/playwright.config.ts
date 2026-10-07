import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npx tsx e2e/server.ts",
    url: "http://localhost:3100/api/config",
    timeout: 600_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
  },
});
