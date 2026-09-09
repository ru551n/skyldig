import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const dataDir = fileURLToPath(new URL("../../.pg-embedded/e2e", import.meta.url));
const PORT = 55555;

let pg: EmbeddedPostgres | undefined;

/**
 * Starts a dedicated embedded Postgres instance for the e2e run (separate from the one
 * `pnpm dev:db` uses on 5432 and the one integration tests use on 55432) and runs migrations
 * against it. Returns the connection URL. Called synchronously at `playwright.config.ts`
 * module-evaluation time (via top-level await) so the resolved URL can be passed directly into
 * `webServer.env` — relying on env var inheritance into a later-spawned child process is
 * fragile across Playwright's setup ordering, so we thread it through explicitly instead.
 */
export async function startE2eDatabase(): Promise<string> {
  // playwright.config.ts (and this top-level call) is re-evaluated in every worker process,
  // not just the root runner process. Only the first evaluation should actually boot Postgres;
  // later ones (in spawned workers, which inherit the root process's env) must reuse the URL
  // instead of racing to start a second instance on the same port.
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "skyldig_e2e",
    password: "skyldig_e2e",
    port: PORT,
    persistent: false,
    onLog: process.env.PG_EMBEDDED_VERBOSE === "1" ? console.log : () => {},
    onError: process.env.PG_EMBEDDED_VERBOSE === "1" ? console.error : () => {},
  });

  if (!existsSync(dataDir)) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase("skyldig_e2e");
  } catch {
    // already exists
  }

  const databaseUrl = `postgres://skyldig_e2e:skyldig_e2e@localhost:${PORT}/skyldig_e2e`;

  // server/config.ts parses process.env eagerly at import time, so DATABASE_URL must already
  // be set before the dynamic import below (mirrors tests/integration/global-setup.ts).
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV ??= "development";
  process.env.ACCESS_KEY_PEPPER ??= "e2e-test-pepper-not-for-production-use-12345678";
  process.env.PUBLIC_ORIGIN ??= "http://localhost:3000";

  const { runMigrations } = await import("../../server/db/migrate.ts");
  await runMigrations(databaseUrl);

  // Cache it for later re-evaluations of this module in worker processes (see comment above).
  process.env.TEST_DATABASE_URL = databaseUrl;

  return databaseUrl;
}

export async function stopE2eDatabase(): Promise<void> {
  await pg?.stop();
}
