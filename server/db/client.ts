import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { config } from "../config.ts";
import * as schema from "./schema.ts";

// int8 (OID 20) -> bigint, numeric (OID 1700) stays as string (default pg behaviour).
pg.types.setTypeParser(20, (value: string) => BigInt(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
