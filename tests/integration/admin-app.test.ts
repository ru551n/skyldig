/**
 * The admin app over real HTTP, with the real admin database role: who gets in, that forms must
 * come from the admin site, that pages show counts and never group content, and the two actions.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAdminApp } from "../../server/admin/app.ts";
import type { AdminConfig } from "../../server/admin/config.ts";
import { config } from "../../server/config.ts";
import { sessions } from "../../server/db/schema.ts";
import { createSession } from "../../server/modules/session/session.ts";
import { ADMIN_ROLE, setupDatabase } from "../../server/tools/setup-db.ts";
import { db, resetDb } from "./db.ts";

const ORIGIN = "https://admin.example";
const superUrl = process.env.DATABASE_URL!;
const adminUrl = (() => {
  const url = new URL(superUrl);
  url.username = ADMIN_ROLE;
  url.password = "admin-app-pw";
  return url.toString();
})();

const baseConfig: AdminConfig = {
  databaseUrl: adminUrl,
  publicOrigin: ORIGIN,
  trustedProxies: ["127.0.0.1", "::1"],
  requiredGroup: "skyldig-admins",
  timeZone: "Europe/Stockholm",
  port: 0,
};

let pool: pg.Pool;
const servers: Server[] = [];

async function start(overrides: Partial<AdminConfig> = {}): Promise<string> {
  const app = createAdminApp({ pool, config: { ...baseConfig, ...overrides } });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const signedIn = (user = "alice") => ({ "x-authentik-username": user, "x-authentik-groups": "staff|skyldig-admins" });

function post(base: string, path: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { ...signedIn(), origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body),
  });
}

async function makeGroup(name: string) {
  const { session } = await createSession(db, config, { name, baseCurrency: "SEK", participantNames: ["Ada", "Bo"] });
  return session.publicId;
}

let base: string;

beforeAll(async () => {
  const client = new pg.Client({ connectionString: superUrl });
  await client.connect();
  await setupDatabase(client, { adminPassword: "admin-app-pw" });
  await client.end();
  pool = new pg.Pool({ connectionString: adminUrl, max: 2 });
  base = await start();
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

describe("who gets in", () => {
  it("turns away requests without a signed-in admin, or from anywhere but the proxy", async () => {
    expect((await fetch(`${base}/`)).status).toBe(403);
    expect((await fetch(`${base}/`, { headers: { ...signedIn(), "x-authentik-groups": "staff" } })).status).toBe(403);
    const elsewhere = await start({ trustedProxies: ["10.9.9.9"] });
    expect((await fetch(`${elsewhere}/`, { headers: signedIn() })).status).toBe(403);
    expect((await fetch(`${base}/`, { headers: signedIn() })).status).toBe(200);
  });

  it("answers the container healthcheck from inside, without sign-in", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("only accepts forms posted from the admin site", async () => {
    expect((await post(base, "/underhall/rensa", {}, { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await fetch(`${base}/underhall/rensa`, { method: "POST", redirect: "manual", headers: signedIn() });
    expect(noOrigin.status).toBe(403);
  });
});

describe("pages", () => {
  it("shows counts but never a group's name, with a locked-down policy", async () => {
    await makeGroup("HEMLIG-GRUPP");
    const res = await fetch(`${base}/`, { headers: signedIn() });
    const body = await res.text();
    expect(body).toContain("Aktiva grupper");
    expect(body).not.toContain("HEMLIG");
    expect(body).not.toContain("Ada");
    expect(body).not.toContain("<script");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("speaks English with ?lang=en", async () => {
    const body = await (await fetch(`${base}/?lang=en`, { headers: signedIn() })).text();
    expect(body).toContain('<html lang="en">');
    expect(body).toContain("Active groups");
  });

  it("escapes what it shows, even the signed-in name", async () => {
    await post(base, "/underhall/rensa", {}, signedIn('<script>alert(1)</script>'));
    const body = await (await fetch(`${base}/logg`, { headers: signedIn() })).text();
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>alert(1)");
  });
});

describe("actions", () => {
  it("requests a cleanup once, and logs who asked", async () => {
    const first = await post(base, "/underhall/rensa", {});
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toContain("status=requested");
    expect((await post(base, "/underhall/rensa", {})).headers.get("location")).toContain("status=pending");
    const log = await (await fetch(`${base}/logg`, { headers: signedIn() })).text();
    expect(log).toContain("Begärde rensning");
    expect(log).toContain("alice");
  });

  it("looks a group up from a pasted link, showing dates and counts only", async () => {
    const id = await makeGroup("HEMLIG-GRUPP");
    const body = await (
      await fetch(`${base}/grupp?id=${encodeURIComponent(`https://skyldig.nu/s/${id}/gor-upp`)}`, { headers: signedIn() })
    ).text();
    expect(body).toContain("Deltagare");
    expect(body).not.toContain("HEMLIG");
    expect(await (await fetch(`${base}/grupp?id=abc`, { headers: signedIn() })).text()).toContain("ser inte ut som");
  });

  it("deletes a group only with a reason and the ID typed back, and logs it", async () => {
    const id = await makeGroup("Spam");
    expect((await post(base, "/grupp/radera", { id, reason: "spam", confirm: "wrong" })).status).toBe(400);
    expect((await post(base, "/grupp/radera", { id, reason: "", confirm: id })).status).toBe(400);
    expect(await db.select().from(sessions).where(eq(sessions.publicId, id))).toHaveLength(1);

    const done = await post(base, "/grupp/radera", { id, reason: "reported spam", confirm: id });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toContain("status=deleted");
    expect(await db.select().from(sessions).where(eq(sessions.publicId, id))).toHaveLength(0);
    const log = await (await fetch(`${base}/logg`, { headers: signedIn() })).text();
    expect(log).toContain("reported spam");
    expect(log).toContain(id);
  });
});
