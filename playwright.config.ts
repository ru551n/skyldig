import { defineConfig, devices } from "@playwright/test";

import { startE2eDatabase } from "./tests/e2e/db.ts";

const PORT = 3000;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// Resolved up front (top-level await) so the URL can be threaded directly into
// `webServer.env` below — see tests/e2e/db.ts for why we don't rely on env var
// inheritance into the later-spawned `pnpm dev` child process.
const databaseUrl = process.env.PLAYWRIGHT_BASE_URL ? undefined : await startE2eDatabase();

export default defineConfig({
  testDir: "tests/e2e",
  globalTeardown: process.env.PLAYWRIGHT_BASE_URL ? undefined : "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          DATABASE_URL: databaseUrl!,
          ACCESS_KEY_PEPPER: process.env.ACCESS_KEY_PEPPER ?? "e2e-test-pepper-not-for-production-use-12345678",
          PUBLIC_ORIGIN: baseURL,
          NODE_ENV: "development",
        },
      },
});
