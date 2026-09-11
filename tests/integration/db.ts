import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "../../server/db/schema.ts";

pg.types.setTypeParser(20, (value: string) => BigInt(value));

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });

/** Truncate every app and admin table except currencies (seeded reference data) and drizzle's migration table. */
export async function resetDb() {
  const { rows } = await pool.query<{ schemaname: string; tablename: string }>(
    `select schemaname, tablename from pg_tables where schemaname in ('public', 'admin')
       and tablename <> 'currencies'
       and tablename not like '__drizzle%'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.schemaname}"."${r.tablename}"`).join(", ");
  await pool.query(`truncate table ${tables} restart identity cascade`);
}
