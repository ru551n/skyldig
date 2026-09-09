import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { config } from "../config.ts";
import { logger } from "../logger.ts";

// process.cwd() is used (rather than import.meta.url) because this module is bundled for
// production and its build output location does not mirror the source tree; both the dev
// server and the production server (server.js) are always launched from the repo root, where
// the `drizzle/` migrations folder lives alongside package.json.
const migrationsFolder = `${process.cwd()}/drizzle`;

export async function runMigrations(connectionString: string = config.databaseUrl) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool);
  try {
    logger.info({ migrationsFolder }, "running database migrations");
    await migrate(db, { migrationsFolder });
    logger.info("database migrations complete");
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error({ err: error }, "migration failed");
      process.exit(1);
    });
}
