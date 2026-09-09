import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "../../server/db/schema.ts";

pg.types.setTypeParser(20, (value: string) => BigInt(value));

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });

/** Truncate every table except currencies (seeded reference data) and drizzle's migration table. */
export async function resetDb() {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'
       and tablename <> 'currencies'
       and tablename not like '__drizzle%'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await pool.query(`truncate table ${tables} restart identity cascade`);
}
