import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: {
      ...(existsSync("/usr/bin/chromium")
        ? { executablePath: "/usr/bin/chromium" }
        : {}),
      args: ["--disable-dev-shm-usage"],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    env: {
      DATA_DIR: "/tmp/recovertrack-e2e",
      ALLOWED_ORIGINS: "http://127.0.0.1:5173",
    },
  },
});
