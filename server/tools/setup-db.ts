/**
 * Database role setup, run with superuser credentials before the app starts (compose runs it as
 * a one-shot service on every `up`; it is safe to repeat). It creates:
 *
 * - the app's own role (APP_DB_USER, e.g. `skyldig_app`) when APP_DB_PASSWORD is set: a
 *   login that is not a superuser, owns the app's tables and may create its schemas — so the app
 *   can migrate and run without superuser powers (reading other databases, COPY ... TO PROGRAM,
 *   creating roles). Objects the superuser owns in the app's schemas are handed over to it.
 * - the admin app's role (`skyldig_admin`) when ADMIN_DB_PASSWORD is set: a login with no access
 *   to any table, only to the aggregate views and narrow functions in the `admin` schema
 *   (drizzle/0006_admin_schema.sql).
 *
 * Passwords are only ever sent to PostgreSQL, never logged.
 */
import { fileURLToPath } from "node:url";

import pg from "pg";

export const ADMIN_ROLE = "skyldig_admin";
const APP_SCHEMAS = ["public", "drizzle", "admin"];
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export interface SetupOptions {
  appUser?: string;
  appPassword?: string;
  adminPassword?: string;
  log?: (message: string) => void;
}

export interface SetupResult {
  appRole: string | null;
  objectsTransferred: number;
  adminRole: string | null;
}

async function upsertLoginRole(client: pg.Client, role: string, password: string): Promise<void> {
  const exists = await client.query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = $1", [role]);
  // Never demote a superuser by accident — e.g. APP_DB_USER set to the database's own superuser.
  if (exists.rows[0]?.rolsuper) {
    throw new Error(`role ${role} is a superuser; choose a different, dedicated role name`);
  }
  const verb = exists.rowCount ? "ALTER ROLE" : "CREATE ROLE";
  const withKw = exists.rowCount ? " WITH" : "";
  await client.query(
    `${verb} ${client.escapeIdentifier(role)}${withKw} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ` +
      `NOREPLICATION NOBYPASSRLS PASSWORD ${client.escapeLiteral(password)}`,
  );
}

/** Hands every object the connected superuser owns in the app's schemas over to `role`. */
async function transferOwnership(client: pg.Client, role: string): Promise<number> {
  const to = client.escapeIdentifier(role);
  let count = 0;

  const schemas = await client.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1) AND nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
    [APP_SCHEMAS.filter((s) => s !== "public")],
  );
  for (const { nspname } of schemas.rows) {
    await client.query(`ALTER SCHEMA ${client.escapeIdentifier(nspname)} OWNER TO ${to}`);
    count += 1;
  }

  // Tables first: sequences owned by a table column change owner along with the table.
  const relations = await client.query<{ nspname: string; relname: string; relkind: string }>(
    `SELECT n.nspname, c.relname, c.relkind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      ORDER BY CASE c.relkind WHEN 'S' THEN 1 ELSE 0 END`,
    [APP_SCHEMAS],
  );
  const kind: Record<string, string> = { r: "TABLE", p: "TABLE", v: "VIEW", m: "MATERIALIZED VIEW", S: "SEQUENCE" };
  for (const r of relations.rows) {
    const name = `${client.escapeIdentifier(r.nspname)}.${client.escapeIdentifier(r.relname)}`;
    if (r.relkind === "S") {
      const stillOurs = await client.query(
        `SELECT 1 FROM pg_class WHERE oid = $1::regclass AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
        [name],
      );
      if (!stillOurs.rowCount) continue;
    }
    await client.query(`ALTER ${kind[r.relkind]} ${name} OWNER TO ${to}`);
    count += 1;
  }

  const functions = await client.query<{ nspname: string; proname: string; args: string }>(
    `SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ANY($1) AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
    [APP_SCHEMAS],
  );
  for (const f of functions.rows) {
    await client.query(
      `ALTER FUNCTION ${client.escapeIdentifier(f.nspname)}.${client.escapeIdentifier(f.proname)}(${f.args}) OWNER TO ${to}`,
    );
    count += 1;
  }

  // Enums and domains; a table's own row type follows the table.
  const types = await client.query<{ nspname: string; typname: string }>(
    `SELECT n.nspname, t.typname
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = ANY($1) AND t.typtype IN ('e', 'd')
        AND t.typowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
    [APP_SCHEMAS],
  );
  for (const t of types.rows) {
    await client.query(
      `ALTER TYPE ${client.escapeIdentifier(t.nspname)}.${client.escapeIdentifier(t.typname)} OWNER TO ${to}`,
    );
    count += 1;
  }
  return count;
}

export async function setupDatabase(client: pg.Client, options: SetupOptions): Promise<SetupResult> {
  const log = options.log ?? (() => {});
  const who = await client.query<{ rolsuper: boolean; db: string }>(
    "SELECT rolsuper, current_database() AS db FROM pg_roles WHERE rolname = current_user",
  );
  if (!who.rows[0]?.rolsuper) {
    throw new Error("setup-db must connect as a PostgreSQL superuser (SUPERUSER_DATABASE_URL)");
  }
  const database = client.escapeIdentifier(who.rows[0].db);
  const result: SetupResult = { appRole: null, objectsTransferred: 0, adminRole: null };

  if (options.appPassword) {
    // Required rather than defaulted: compose builds the app's DATABASE_URL from the same
    // variable, so both sides must name the same role.
    const appUser = options.appUser;
    if (!appUser) throw new Error("APP_DB_PASSWORD is set but APP_DB_USER is not; set both");
    if (!IDENTIFIER.test(appUser) || appUser === ADMIN_ROLE) {
      throw new Error(`APP_DB_USER must be a plain lowercase role name other than ${ADMIN_ROLE}`);
    }
    await upsertLoginRole(client, appUser, options.appPassword);
    const app = client.escapeIdentifier(appUser);
    await client.query(`GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${database} TO ${app}`);
    await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${app}`);
    result.appRole = appUser;
    result.objectsTransferred = await transferOwnership(client, appUser);
    log(`app role ${appUser} ready (${result.objectsTransferred} objects handed over)`);
  }

  if (options.adminPassword) {
    await upsertLoginRole(client, ADMIN_ROLE, options.adminPassword);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${client.escapeIdentifier(ADMIN_ROLE)}`);
    await client.query(`ALTER ROLE ${client.escapeIdentifier(ADMIN_ROLE)} SET search_path = admin`);
    const hasAdminSchema = await client.query(
      "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'admin' AND p.proname = 'apply_admin_grants'",
    );
    // On a fresh install the admin schema doesn't exist yet; the migration grants on creation.
    if (hasAdminSchema.rowCount) {
      await client.query("SELECT admin.apply_admin_grants($1)", [ADMIN_ROLE]);
    }
    result.adminRole = ADMIN_ROLE;
    log(`admin role ${ADMIN_ROLE} ready`);
  }

  if (!result.appRole && !result.adminRole) {
    log("nothing to do: set APP_DB_PASSWORD and/or ADMIN_DB_PASSWORD to create the roles");
  }
  return result;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const connectionString = process.env.SUPERUSER_DATABASE_URL;
  if (!connectionString) {
    console.error("setup-db: SUPERUSER_DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString });
  client
    .connect()
    .then(() =>
      setupDatabase(client, {
        appUser: process.env.APP_DB_USER || undefined,
        appPassword: process.env.APP_DB_PASSWORD || undefined,
        adminPassword: process.env.ADMIN_DB_PASSWORD || undefined,
        log: (message) => console.log(`setup-db: ${message}`),
      }),
    )
    .then(() => client.end())
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      console.error(`setup-db: ${error instanceof Error ? error.message : String(error)}`);
      await client.end().catch(() => {});
      process.exit(1);
    });
}
