import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { config } from "../config.ts";
import { logger } from "../logger.ts";
import * as schema from "./schema.ts";

// int8 (OID 20) -> bigint, numeric (OID 1700) stays as string (default pg behaviour).
pg.types.setTypeParser(20, (value: string) => BigInt(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// node-postgres requires an "error" listener on the pool: an idle client can emit one
// asynchronously (e.g. a dropped connection or a server-side idle timeout) with no in-flight
// query to reject, and an EventEmitter "error" with no listener is rethrown as an uncaught
// exception, crashing the whole process. See node-postgres's own pooling docs.
pool.on("error", (err) => {
  logger.error({ module: "db", err }, "idle database client error");
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
