import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  adminElevationExpiry,
  createBrowserSession,
  effectiveRole,
  deleteBrowserSessionIfEmpty,
  findBrowserSessionByToken,
  getGrant,
  grantAccess,
  isActiveAdmin,
  listGrants,
  purgeExpiredBrowserSessions,
  revokeGrant,
  rotateBrowserSession,
} from "../../server/modules/auth/browser-session.ts";
import { requireAdmin, requireSessionAccess } from "../../server/modules/auth/session-auth.ts";
import { browserSessions, sessionGrants, sessions } from "../../server/db/schema.ts";
import { db, resetDb } from "./db.ts";

const config = { cookieSecure: true };
const ADMIN_TTL_MS = 30 * 60 * 1000;
const adminConfig = { adminElevationTtlMs: ADMIN_TTL_MS };
const adminExpiry = () => adminElevationExpiry(adminConfig);

/** Sets admin_until directly (bypassing grantAccess) so tests never have to sleep. */
async function setAdminUntil(browserSessionId: bigint, sessionId: bigint, adminUntil: Date | null) {
  await db
    .update(sessionGrants)
    .set({ adminUntil })
    .where(and(eq(sessionGrants.browserSessionId, browserSessionId), eq(sessionGrants.sessionId, sessionId)));
}

beforeEach(async () => {
  await resetDb();
});

async function createSession(overrides: Partial<typeof sessions.$inferInsert> = {}) {
  const [session] = await db
    .insert(sessions)
    .values({
      publicId: `pub-${randomBytes(6).toString("hex")}`,
      name: "Test session",
      baseCurrency: "SEK",
      accessKeyIndex: randomBytes(16),
      accessKeyVerifier: "verifier",
      adminKeyHash: randomBytes(16),
      pepperVersion: 1,
      expiresAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    })
    .returning();
  return session;
}

function cookieHeaderFor(token: string) {
  return `__Host-skyldig=${token}`;
}

function requestFor(token: string | null, path = "/") {
  const headers = new Headers();
  if (token) headers.set("cookie", cookieHeaderFor(token));
  return new Request(`https://skyldig.example${path}`, { headers });
}

describe("browser sessions and grants", () => {
  it("creates a browser session and resolves it by token", async () => {
    const created = await db.transaction((tx) => createBrowserSession(tx));
    expect(created.token).toBeTruthy();

    const found = await findBrowserSessionByToken(db, created.token);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  it("returns null for an unknown token", async () => {
    const found = await findBrowserSessionByToken(db, "not-a-real-token");
    expect(found).toBeNull();
  });

  it("grants access and lists it via listGrants", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    const grants = await listGrants(db, created.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      sessionId: session.id,
      sessionPublicId: session.publicId,
      sessionName: session.name,
      role: "member",
    });

    const grant = await getGrant(db, created.id, session.id);
    expect(grant?.role).toBe("member");
  });

  it("never downgrades an admin grant to member on re-grant", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin", adminExpiry()));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    const grant = await getGrant(db, created.id, session.id);
    expect(grant?.role).toBe("admin");
  });

  it("upgrades a member grant to admin on re-grant", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin", adminExpiry()));

    const grant = await getGrant(db, created.id, session.id);
    expect(grant?.role).toBe("admin");
  });

  it("hides grants to expired sessions from listGrants", async () => {
    const activeSession = await createSession();
    const expiredSession = await createSession({ expiresAt: new Date(Date.now() - 1000) });
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction(async (tx) => {
      await grantAccess(tx, created.id, activeSession.id, "member");
      await grantAccess(tx, created.id, expiredSession.id, "member");
    });

    const grants = await listGrants(db, created.id);
    expect(grants).toHaveLength(1);
    expect(grants[0].sessionId).toBe(activeSession.id);
  });

  it("revokes a grant and deletes the browser session once empty", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    await db.transaction((tx) => revokeGrant(tx, created.id, session.id));
    expect(await getGrant(db, created.id, session.id)).toBeNull();

    const deleted = await db.transaction((tx) => deleteBrowserSessionIfEmpty(tx, created.id));
    expect(deleted).toBe(true);
    expect(await findBrowserSessionByToken(db, created.token)).toBeNull();
  });

  it("does not delete a browser session that still holds grants", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    const deleted = await db.transaction((tx) => deleteBrowserSessionIfEmpty(tx, created.id));
    expect(deleted).toBe(false);
  });

  it("rotates a browser session, moving grants and invalidating the old token", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    const rotated = await db.transaction((tx) => rotateBrowserSession(tx, created.id));
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.id).not.toBe(created.id);

    // Old token is gone.
    expect(await findBrowserSessionByToken(db, created.token)).toBeNull();

    // New token resolves and holds the grant.
    const found = await findBrowserSessionByToken(db, rotated.token);
    expect(found?.id).toBe(rotated.id);
    const grant = await getGrant(db, rotated.id, session.id);
    expect(grant?.role).toBe("member");

    const remainingGrants = await db
      .select()
      .from(sessionGrants)
      .where(eq(sessionGrants.browserSessionId, rotated.id));
    expect(remainingGrants).toHaveLength(1);
  });

  it("purges expired browser sessions and reports the count", async () => {
    await db.transaction((tx) => createBrowserSession(tx));
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db
      .update(browserSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(browserSessions.id, created.id));

    const purgedCount = await purgeExpiredBrowserSessions(db);
    expect(purgedCount).toBe(1);
    expect(await findBrowserSessionByToken(db, created.token)).toBeNull();
  });
});

describe("requireSessionAccess / requireAdmin", () => {
  it("returns the session, browser session, and grant on success", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    const access = await requireSessionAccess(db, requestFor(created.token), config, session.publicId);
    expect(access.session.id).toBe(session.id);
    expect(access.browserSession.id).toBe(created.id);
    expect(access.grant.role).toBe("member");
  });

  it("throws 404 when there is no cookie", async () => {
    const session = await createSession();
    await expect(requireSessionAccess(db, requestFor(null), config, session.publicId)).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("throws 404 when the browser session has no grant for the target session", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));

    await expect(
      requireSessionAccess(db, requestFor(created.token), config, session.publicId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws 404 when the session has expired, even with a valid grant", async () => {
    const session = await createSession({ expiresAt: new Date(Date.now() - 1000) });
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    await expect(
      requireSessionAccess(db, requestFor(created.token), config, session.publicId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws 404 for an unknown session public id", async () => {
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await expect(
      requireSessionAccess(db, requestFor(created.token), config, "does-not-exist"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("requireAdmin succeeds for an admin grant", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin", adminExpiry()));

    const access = await requireAdmin(db, requestFor(created.token), config, session.publicId);
    expect(access.grant.role).toBe("admin");
  });

  it("requireAdmin throws 403 for a member grant", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    await expect(requireAdmin(db, requestFor(created.token), config, session.publicId)).rejects.toMatchObject(
      { status: 403 },
    );
  });
});

describe("admin elevation is time-boxed (admin_until)", () => {
  async function elevatedGrant() {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin", adminExpiry()));
    return { session, created };
  }

  it("elevation stamps admin_until ≈ now + TTL", async () => {
    const before = Date.now();
    const { session, created } = await elevatedGrant();
    const after = Date.now();

    const grant = await getGrant(db, created.id, session.id);
    expect(grant?.role).toBe("admin");
    expect(grant?.storedRole).toBe("admin");
    const until = grant?.adminUntil?.getTime() ?? 0;
    expect(until).toBeGreaterThanOrEqual(before + ADMIN_TTL_MS);
    expect(until).toBeLessThanOrEqual(after + ADMIN_TTL_MS);
  });

  it("requireAdmin passes before expiry and 403s after, keeping the grant", async () => {
    const { session, created } = await elevatedGrant();
    const request = requestFor(created.token);

    await expect(requireAdmin(db, request, config, session.publicId)).resolves.toMatchObject({
      grant: { role: "admin" },
    });

    await setAdminUntil(created.id, session.id, new Date(Date.now() - 1000));
    await expect(requireAdmin(db, request, config, session.publicId)).rejects.toMatchObject({ status: 403 });

    // Membership survives: the row is intact, only the effective role drops to member.
    const access = await requireSessionAccess(db, request, config, session.publicId);
    expect(access.grant.role).toBe("member");
    expect(access.grant.storedRole).toBe("admin");
    const [raw] = await db
      .select()
      .from(sessionGrants)
      .where(and(eq(sessionGrants.browserSessionId, created.id), eq(sessionGrants.sessionId, session.id)));
    expect(raw?.role).toBe("admin");
  });

  it("listGrants reports the effective role once the elevation lapsed", async () => {
    const { session, created } = await elevatedGrant();
    expect((await listGrants(db, created.id)).map((g) => g.role)).toEqual(["admin"]);

    await setAdminUntil(created.id, session.id, new Date(Date.now() - 1000));
    expect((await listGrants(db, created.id)).map((g) => g.role)).toEqual(["member"]);
  });

  it("re-elevating refreshes admin_until", async () => {
    const { session, created } = await elevatedGrant();
    const stale = new Date(Date.now() - 1000);
    await setAdminUntil(created.id, session.id, stale);
    await expect(requireAdmin(db, requestFor(created.token), config, session.publicId)).rejects.toMatchObject(
      { status: 403 },
    );

    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin", adminExpiry()));
    const grant = await getGrant(db, created.id, session.id);
    expect(grant?.adminUntil?.getTime()).toBeGreaterThan(stale.getTime() + ADMIN_TTL_MS);
    await expect(requireAdmin(db, requestFor(created.token), config, session.publicId)).resolves.toBeTruthy();
  });

  it("a member re-grant onto an admin row neither extends nor cuts short the elevation", async () => {
    const { session, created } = await elevatedGrant();
    const original = (await getGrant(db, created.id, session.id))?.adminUntil;
    expect(original).toBeInstanceOf(Date);

    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));
    const grant = await getGrant(db, created.id, session.id);
    expect(grant?.role).toBe("admin");
    expect(grant?.adminUntil?.getTime()).toBe(original?.getTime());
  });

  it("treats admin_until = now as already expired (strict >) and NULL as expired", () => {
    const now = new Date();
    expect(isActiveAdmin({ role: "admin", adminUntil: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(isActiveAdmin({ role: "admin", adminUntil: now }, now)).toBe(false);
    expect(isActiveAdmin({ role: "admin", adminUntil: new Date(now.getTime() - 1) }, now)).toBe(false);
    // Rows elevated before admin_until existed carry NULL: no grandfathering, re-elevate.
    expect(isActiveAdmin({ role: "admin", adminUntil: null }, now)).toBe(false);
    expect(effectiveRole({ role: "admin", adminUntil: null }, now)).toBe("member");
    // A future admin_until on a member row never confers admin.
    expect(isActiveAdmin({ role: "member", adminUntil: new Date(now.getTime() + 60_000) }, now)).toBe(false);
  });

  it("a legacy admin row with NULL admin_until is denied by requireAdmin but keeps access", async () => {
    const { session, created } = await elevatedGrant();
    await setAdminUntil(created.id, session.id, null);

    await expect(requireAdmin(db, requestFor(created.token), config, session.publicId)).rejects.toMatchObject(
      { status: 403 },
    );
    const access = await requireSessionAccess(db, requestFor(created.token), config, session.publicId);
    expect(access.grant.role).toBe("member");
  });

  it("refuses an admin grant without adminUntil", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await expect(db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin"))).rejects.toThrow(
      /requires adminUntil/,
    );
  });
});
