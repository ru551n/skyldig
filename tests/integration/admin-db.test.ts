/**
 * The admin app's database access (drizzle/0006_admin_schema.sql, server/tools/setup-db.ts).
 * Privacy first: the admin role must reach nothing but aggregates and three narrow functions —
 * no table, no group name, nothing a group's members wrote.
 */
import { eq } from "drizzle-orm";
import pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";

import { config } from "../../server/config.ts";
import { sessions } from "../../server/db/schema.ts";
import { createBrowserSession, grantAccess } from "../../server/modules/auth/browser-session.ts";
import { runCleanup, startCleanupScheduler } from "../../server/modules/expiration/cleanup.ts";
import { createSession } from "../../server/modules/session/session.ts";
import { runMigrations } from "../../server/db/migrate.ts";
import { ADMIN_ROLE, setupDatabase } from "../../server/tools/setup-db.ts";
import { db, pool, resetDb } from "./db.ts";

// Provided by tests/integration/setup.ts from the embedded test database.
const superUrl = process.env.DATABASE_URL!;

function urlFor(user: string, password: string): string {
  const url = new URL(superUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const asSuper = <T>(fn: (client: pg.Client) => Promise<T>) => withClient(superUrl, fn);
const asAdmin = <T>(fn: (client: pg.Client) => Promise<T>) => withClient(urlFor(ADMIN_ROLE, "admin-pw"), fn);

async function makeGroup(name: string, participantNames: string[]) {
  const { session } = await createSession(db, config, { name, baseCurrency: "SEK", participantNames });
  const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.publicId, session.publicId));
  const browser = await db.transaction((tx) => createBrowserSession(tx));
  await db.transaction((tx) => grantAccess(tx, browser.id, row!.id, "member", null));
  return session.publicId;
}

beforeEach(async () => {
  await resetDb();
  await asSuper((client) => setupDatabase(client, { adminPassword: "admin-pw" }));
});

describe("admin role", () => {
  it("reads aggregates but no table and no group content", async () => {
    await makeGroup("HEMLIG-GRUPP", ["Ada", "Bo"]);
    await makeGroup("Stuga", ["Ceci", "Dan", "Eva"]);

    await asAdmin(async (client) => {
      const { rows } = await client.query("SELECT * FROM admin.overview");
      expect(Number(rows[0].active_groups)).toBe(2);
      expect(Number(rows[0].participants_active)).toBe(5);
      expect(Number(rows[0].browsers_joined)).toBe(2);

      for (const table of ["sessions", "participants", "expenses", "payments", "revisions", "browser_sessions"]) {
        await expect(client.query(`SELECT * FROM public.${table} LIMIT 1`), table).rejects.toThrow(/permission denied/);
      }
      await expect(client.query("SELECT * FROM admin.audit_log")).rejects.toThrow(/permission denied/);
      await expect(client.query("SELECT admin.apply_admin_grants('x')")).rejects.toThrow(/permission denied/);

      const everything = JSON.stringify(
        [
          (await client.query("SELECT * FROM admin.overview")).rows,
          (await client.query("SELECT * FROM admin.daily_activity")).rows,
          (await client.query("SELECT * FROM admin.group_sizes")).rows,
          (await client.query("SELECT * FROM admin.currency_mix")).rows,
        ],
        (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
      );
      for (const secret of ["HEMLIG", "Stuga", "Ada", "Ceci"]) expect(everything).not.toContain(secret);
    });
  }, 20_000);

  it("looks a group up by its public ID with dates and counts only", async () => {
    const publicId = await makeGroup("HEMLIG-GRUPP", ["Ada", "Bo"]);
    await asAdmin(async (client) => {
      const { rows, fields } = await client.query("SELECT * FROM admin.group_metadata($1)", [publicId]);
      expect(Number(rows[0].participants)).toBe(2);
      expect(fields.map((f) => f.name)).toEqual([
        "created_at",
        "expires_at",
        "participants",
        "expenses",
        "payments",
        "last_activity",
      ]);
      expect((await client.query("SELECT * FROM admin.group_metadata('nope')")).rowCount).toBe(0);
    });
  }, 20_000);

  it("deletes a group with a reason, and the deletion is audited", async () => {
    const publicId = await makeGroup("Spam", ["Ada", "Bo"]);
    await asAdmin(async (client) => {
      await expect(client.query("SELECT admin.delete_group($1, 'alice', '')", [publicId])).rejects.toThrow(
        /reason are required/,
      );
      const { rows } = await client.query("SELECT admin.delete_group($1, 'alice', 'reported spam') AS ok", [publicId]);
      expect(rows[0].ok).toBe(true);
      const audit = await client.query("SELECT actor, action, target, detail FROM admin.recent_audit");
      expect(audit.rows).toEqual([
        { actor: "alice", action: "delete_group", target: publicId, detail: "reported spam" },
      ]);
      const again = await client.query("SELECT admin.delete_group($1, 'alice', 'again') AS ok", [publicId]);
      expect(again.rows[0].ok).toBe(false);
    });
    expect(await db.select().from(sessions).where(eq(sessions.publicId, publicId))).toHaveLength(0);
  }, 20_000);

  it("can request a cleanup, one outstanding request at a time", async () => {
    await asAdmin(async (client) => {
      expect((await client.query("SELECT admin.request_cleanup('alice') AS ok")).rows[0].ok).toBe(true);
      expect((await client.query("SELECT admin.request_cleanup('bob') AS ok")).rows[0].ok).toBe(false);
      const status = await client.query("SELECT pending_since FROM admin.cleanup_status");
      expect(status.rows[0].pending_since).not.toBeNull();
    });
  }, 20_000);
});

describe("cleanup history", () => {
  it("records each run", async () => {
    await runCleanup(db);
    const { rows } = await pool.query("SELECT trigger, actor, skipped FROM admin.maintenance_runs");
    expect(rows).toEqual([{ trigger: "schedule", actor: null, skipped: false }]);
  });

  it("serves a request from the admin app with the normal cleanup, within a poll", async () => {
    await asAdmin((client) => client.query("SELECT admin.request_cleanup('alice')"));
    const scheduler = startCleanupScheduler(db, { intervalMs: 60 * 60 * 1000, pollMs: 50 });
    try {
      await expect
        .poll(async () => (await pool.query("SELECT count(*)::int AS n FROM admin.cleanup_requests WHERE handled_at IS NULL")).rows[0].n, { timeout: 5_000 })
        .toBe(0);
      const { rows } = await pool.query("SELECT trigger, actor FROM admin.maintenance_runs WHERE trigger = 'admin'");
      expect(rows).toEqual([{ trigger: "admin", actor: "alice" }]);
    } finally {
      scheduler.stop();
    }
  }, 20_000);
});

describe("setup-db", () => {
  it("refuses to run without superuser rights, or with a half-configured app role", async () => {
    await expect(asAdmin((client) => setupDatabase(client, { adminPassword: "x" }))).rejects.toThrow(/superuser/);
    await expect(asSuper((client) => setupDatabase(client, { appPassword: "x" }))).rejects.toThrow(/APP_DB_USER/);
    const superuser = new URL(superUrl).username;
    await expect(
      asSuper((client) => setupDatabase(client, { appUser: superuser, appPassword: "x" })),
    ).rejects.toThrow(/is a superuser/);
  }, 20_000);

  it("creates the app's own role, hands it the app's objects, and is safe to repeat", async () => {
    const first = await asSuper((client) => setupDatabase(client, { appUser: "skyldig_app", appPassword: "app-pw" }));
    expect(first.objectsTransferred).toBeGreaterThan(0);
    const second = await asSuper((client) => setupDatabase(client, { appUser: "skyldig_app", appPassword: "app-pw" }));
    expect(second.objectsTransferred).toBe(0);

    const owners = await pool.query(
      "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname IN ('public', 'admin', 'drizzle')",
    );
    expect(owners.rows).toEqual([{ tableowner: "skyldig_app" }]);

    const appUrl = urlFor("skyldig_app", "app-pw");
    await withClient(appUrl, async (client) => {
      const who = await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
      expect(who.rows[0].rolsuper).toBe(false);
      await client.query("SELECT count(*) FROM public.sessions");
    });
    // The app can still run its migrations under its own role.
    await runMigrations(appUrl);
  }, 30_000);
});
