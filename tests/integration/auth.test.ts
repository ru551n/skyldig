import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createBrowserSession,
  deleteBrowserSessionIfEmpty,
  findBrowserSessionByToken,
  getGrant,
  grantAccess,
  listGrants,
  purgeExpiredBrowserSessions,
  revokeGrant,
  rotateBrowserSession,
} from "../../server/modules/auth/browser-session.ts";
import { requireAdmin, requireSessionAccess } from "../../server/modules/auth/session-auth.ts";
import { browserSessions, sessionGrants, sessions } from "../../server/db/schema.ts";
import { db, resetDb } from "./db.ts";

const config = { cookieSecure: true };

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
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin"));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));

    const grant = await getGrant(db, created.id, session.id);
    expect(grant?.role).toBe("admin");
  });

  it("upgrades a member grant to admin on re-grant", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => createBrowserSession(tx));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "member"));
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin"));

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
    await db.transaction((tx) => grantAccess(tx, created.id, session.id, "admin"));

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
