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
    // The app now resolves the interface language from `Accept-Language` on a first visit (see
    // docs/todo.md "Add English as a second language"). Every existing spec asserts Swedish
    // copy, so pin the default context locale to Swedish here; the i18n spec overrides
    // `Accept-Language` explicitly per-context to exercise English.
    locale: "sv-SE",
    extraHTTPHeaders: { "Accept-Language": "sv-SE,sv;q=0.9" },
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
          // Trust the loopback hop, as production trusts its reverse proxy. Requests without
          // X-Forwarded-For still resolve to the loopback address exactly as before; a spec can
          // send its own X-Forwarded-For to get a rate-limit identity of its own (see
          // tests/e2e/new-rate-limit.spec.ts).
          TRUST_PROXY: "loopback",
          // Threaded through explicitly (not inherited automatically) so a verification run
          // like `FX_RATE_LOOKUP_ENABLED=false pnpm exec playwright test` actually disables
          // live exchange-rate lookups in the spawned `pnpm dev` server — see
          // tests/e2e/expense-fx-rate.spec.ts and docs/architecture.md §5.1.
          ...(process.env.FX_RATE_LOOKUP_ENABLED
            ? { FX_RATE_LOOKUP_ENABLED: process.env.FX_RATE_LOOKUP_ENABLED }
            : {}),
        },
      },
});
