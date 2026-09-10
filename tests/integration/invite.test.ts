import { beforeEach, describe, expect, it } from "vitest";

import { eq, sql } from "drizzle-orm";

import { config } from "../../server/config.ts";
import { sessionInvites, sessions } from "../../server/db/schema.ts";
import { createBrowserSession, getGrant, grantAccess } from "../../server/modules/auth/browser-session.ts";
import { createSession, rotateAccessPhrase } from "../../server/modules/session/session.ts";
import {
  burnInvite,
  createInvite,
  findRedeemableInvite,
  INVITE_TTL_MS,
  InviteLimitError,
  MAX_OUTSTANDING_INVITES_PER_SESSION,
  purgeExpiredInvites,
  revokeInvite,
} from "../../server/modules/session/invite.ts";
import { db, pool, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
});

async function makeGroup() {
  const { session } = await createSession(db, config, {
    name: "Cabin trip",
    baseCurrency: "SEK",
    participantNames: ["Alice", "Bob"],
  });
  // createSession returns the public DTO only; the invite module works with the internal id.
  const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.publicId, session.publicId));
  const { id: browserSessionId } = await createBrowserSession(db);
  return { session: { ...session, id: row!.id }, browserSessionId };
}

describe("session invites", () => {
  it(
    "stores an expiry exactly INVITE_TTL_MS (24 hours) in the future",
    async () => {
      // The TTL was raised from 30 minutes to 24 hours for the real sharing pattern (a link
      // posted in a group chat and opened the next morning). This pins both the value and the
      // fact that the row's `expires_at` is derived from the constant the UI renders, so the
      // two cannot drift apart.
      expect(INVITE_TTL_MS).toBe(24 * 60 * 60 * 1000);

      const { session, browserSessionId } = await makeGroup();
      const before = Date.now();
      const created = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
      const after = Date.now();

      const ttl = created.invite.expiresAt.getTime();
      expect(ttl).toBeGreaterThanOrEqual(before + INVITE_TTL_MS - 5_000);
      expect(ttl).toBeLessThanOrEqual(after + INVITE_TTL_MS + 5_000);
    },
    15_000,
  );

  it(
    "creates a redeemable invite, and redeeming it grants access and burns it",
    async () => {
      const { session, browserSessionId } = await makeGroup();
      const created = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));

      expect(created.token).toBeTruthy();
      expect(created.invite.role).toBe("member");

      const found = await findRedeemableInvite(db, created.publicId, created.token);
      expect(found).not.toBeNull();
      expect(found!.sessionId).toBe(session.id);

      const { id: joinerBrowserSessionId } = await createBrowserSession(db);
      const burned = await db.transaction((tx) => burnInvite(tx, found!.id, joinerBrowserSessionId));
      expect(burned).toBe(true);

      // A second redemption attempt of the same invite must fail — it is single-use.
      const secondFind = await findRedeemableInvite(db, created.publicId, created.token);
      expect(secondFind).toBeNull();
    },
    10_000,
  );

  it(
    "rejects a wrong token, a wrong public id, and a double burn",
    async () => {
      const { session, browserSessionId } = await makeGroup();
      const created = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));

      expect(await findRedeemableInvite(db, created.publicId, "not-the-token")).toBeNull();
      expect(await findRedeemableInvite(db, "not-a-real-invite-id", created.token)).toBeNull();

      const found = await findRedeemableInvite(db, created.publicId, created.token);
      expect(found).not.toBeNull();

      const { id: browserId } = await createBrowserSession(db);
      const firstBurn = await db.transaction((tx) => burnInvite(tx, found!.id, browserId));
      const secondBurn = await db.transaction((tx) => burnInvite(tx, found!.id, browserId));
      expect(firstBurn).toBe(true);
      expect(secondBurn).toBe(false);
    },
    10_000,
  );

  it(
    "revoking an invite makes it unredeemable even though it has not expired or been used",
    async () => {
      const { session, browserSessionId } = await makeGroup();
      const created = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));

      const revoked = await revokeInvite(db, session.id, created.publicId);
      expect(revoked).toBe(true);
      expect(await findRedeemableInvite(db, created.publicId, created.token)).toBeNull();

      // Revoking an already-revoked (or nonexistent) invite reports no change.
      expect(await revokeInvite(db, session.id, created.publicId)).toBe(false);
    },
    10_000,
  );

  it(
    "an expired invite cannot be redeemed",
    async () => {
      const { session, browserSessionId } = await makeGroup();
      const created = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));

      await pool.query(
        `update session_invites set expires_at = now() - interval '1 minute' where public_id = $1`,
        [created.publicId],
      );

      expect(await findRedeemableInvite(db, created.publicId, created.token)).toBeNull();
    },
    10_000,
  );

  it(
    "redeeming an invite grants the invite's role via the same flow the redeem route uses",
    async () => {
      const { session, browserSessionId } = await makeGroup();
      const created = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId, "member"));

      const found = await findRedeemableInvite(db, created.publicId, created.token);
      const { id: joinerBrowserSessionId } = await createBrowserSession(db);

      await db.transaction(async (tx) => {
        const burned = await burnInvite(tx, found!.id, joinerBrowserSessionId);
        expect(burned).toBe(true);
        await grantAccess(tx, joinerBrowserSessionId, session.id, found!.role);
      });

      const grant = await getGrant(db, joinerBrowserSessionId, session.id);
      expect(grant?.role).toBe("member");
    },
    10_000,
  );

  it(
    "purgeExpiredInvites removes expired, used, and revoked invites but keeps live ones",
    async () => {
      const { session, browserSessionId } = await makeGroup();

      const live = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
      const toExpire = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
      const toUse = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
      const toRevoke = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));

      await pool.query(`update session_invites set expires_at = now() - interval '1 minute' where public_id = $1`, [
        toExpire.publicId,
      ]);
      const foundToUse = await findRedeemableInvite(db, toUse.publicId, toUse.token);
      await db.transaction((tx) => burnInvite(tx, foundToUse!.id, browserSessionId));
      await revokeInvite(db, session.id, toRevoke.publicId);

      const purged = await purgeExpiredInvites(db);
      expect(purged).toBe(3);

      expect(await findRedeemableInvite(db, live.publicId, live.token)).not.toBeNull();
    },
    10_000,
  );

  it("an invite is deleted when its group is deleted (cascade)", async () => {
    const { session, browserSessionId } = await makeGroup();
    const created = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));

    await pool.query(`delete from sessions where id = $1`, [session.id]);

    const { rows } = await pool.query(`select 1 from session_invites where public_id = $1`, [created.publicId]);
    expect(rows).toHaveLength(0);
  });
});

describe("invites and access-phrase rotation", () => {
  async function rotate(sessionId: bigint, keeperBrowserSessionId: bigint) {
    return db.transaction((tx) => rotateAccessPhrase(tx, config, sessionId, keeperBrowserSessionId));
  }

  it("an invite issued before the phrase is rotated is no longer redeemable afterwards", async () => {
    const { session, browserSessionId } = await makeGroup();
    const before = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
    expect(await findRedeemableInvite(db, before.publicId, before.token)).not.toBeNull();

    await rotate(session.id, browserSessionId);

    // Same row, same token, unexpired, unused, unrevoked — retired purely by the generation bump.
    expect(await findRedeemableInvite(db, before.publicId, before.token)).toBeNull();
    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row!.accessGeneration).toBe(2);
    expect(before.invite.accessGeneration).toBe(1);
  });

  it("an invite issued after the rotation is redeemable, and a second rotation retires it too", async () => {
    const { session, browserSessionId } = await makeGroup();
    await rotate(session.id, browserSessionId);

    const after = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
    expect(after.invite.accessGeneration).toBe(2);
    const found = await findRedeemableInvite(db, after.publicId, after.token);
    expect(found).not.toBeNull();

    const { id: joiner } = await createBrowserSession(db);
    expect(await db.transaction((tx) => burnInvite(tx, found!.id, joiner))).toBe(true);

    const third = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
    await rotate(session.id, browserSessionId);
    expect(await findRedeemableInvite(db, third.publicId, third.token)).toBeNull();
  });

  it("used, revoked and expired invites stay unredeemable across a rotation (no resurrection)", async () => {
    const { session, browserSessionId } = await makeGroup();
    const used = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
    const revoked = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
    const expired = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));

    const { id: joiner } = await createBrowserSession(db);
    await db.transaction((tx) => burnInvite(tx, used.invite.id, joiner));
    await revokeInvite(db, session.id, revoked.publicId);
    await db
      .update(sessionInvites)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(sessionInvites.id, expired.invite.id));

    await rotate(session.id, browserSessionId);

    for (const inv of [used, revoked, expired]) {
      expect(await findRedeemableInvite(db, inv.publicId, inv.token)).toBeNull();
    }
    // Burning/revoking an already-retired invite is still a no-op (guards unchanged).
    expect(await db.transaction((tx) => burnInvite(tx, used.invite.id, joiner))).toBe(false);
    expect(await revokeInvite(db, session.id, revoked.publicId)).toBe(false);
  });

  it("a rotation that rolls back leaves the generation, phrase index and invites untouched", async () => {
    const { session, browserSessionId } = await makeGroup();
    const invite = await db.transaction((tx) => createInvite(tx, session.id, browserSessionId));
    const [beforeRow] = await db.select().from(sessions).where(eq(sessions.id, session.id));

    await expect(
      db.transaction(async (tx) => {
        await rotateAccessPhrase(tx, config, session.id, browserSessionId);
        throw new Error("simulated failure after rotation");
      }),
    ).rejects.toThrow("simulated failure");

    const [afterRow] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(afterRow!.accessGeneration).toBe(beforeRow!.accessGeneration);
    expect(afterRow!.accessKeyIndex.equals(beforeRow!.accessKeyIndex)).toBe(true);
    expect(afterRow!.accessKeyVerifier).toBe(beforeRow!.accessKeyVerifier);
    expect(await findRedeemableInvite(db, invite.publicId, invite.token)).not.toBeNull();
  });

  it("rotation and invite creation racing each other never produce a redeemable stale invite", async () => {
    const { session, browserSessionId } = await makeGroup();
    // Fire both at once; whichever wins the row lock, an invite stamped with the OLD
    // generation must not be redeemable once the rotation has committed.
    const [created] = await Promise.all([
      db.transaction((tx) => createInvite(tx, session.id, browserSessionId)),
      rotate(session.id, browserSessionId),
    ]);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    const found = await findRedeemableInvite(db, created.publicId, created.token);
    if (created.invite.accessGeneration === row!.accessGeneration) {
      expect(found).not.toBeNull();
    } else {
      expect(found).toBeNull();
    }
  });
});

describe("outstanding-invite cap", () => {
  it("refuses the invite after MAX_OUTSTANDING_INVITES_PER_SESSION live invites, and frees up when one is used or revoked", async () => {
    const { session, browserSessionId } = await makeGroup();
    const created: Awaited<ReturnType<typeof createInvite>>[] = [];
    for (let i = 0; i < MAX_OUTSTANDING_INVITES_PER_SESSION; i += 1) {
      created.push(await db.transaction((tx) => createInvite(tx, session.id, browserSessionId)));
    }
    await expect(db.transaction((tx) => createInvite(tx, session.id, browserSessionId))).rejects.toBeInstanceOf(
      InviteLimitError,
    );
    // The refused attempt must not have inserted anything.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessionInvites)
      .where(eq(sessionInvites.sessionId, session.id));
    expect(count).toBe(MAX_OUTSTANDING_INVITES_PER_SESSION);

    await revokeInvite(db, session.id, created[0]!.publicId);
    await expect(db.transaction((tx) => createInvite(tx, session.id, browserSessionId))).resolves.toBeTruthy();

    await expect(db.transaction((tx) => createInvite(tx, session.id, browserSessionId))).rejects.toBeInstanceOf(
      InviteLimitError,
    );
    const { id: joiner } = await createBrowserSession(db);
    await db.transaction((tx) => burnInvite(tx, created[1]!.invite.id, joiner));
    await expect(db.transaction((tx) => createInvite(tx, session.id, browserSessionId))).resolves.toBeTruthy();

    // Expired invites don't count either.
    await db
      .update(sessionInvites)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(sessionInvites.id, created[2]!.invite.id));
    await expect(db.transaction((tx) => createInvite(tx, session.id, browserSessionId))).resolves.toBeTruthy();
  });

  it("the cap holds under concurrent creation (row lock serializes the count)", async () => {
    const { session, browserSessionId } = await makeGroup();
    const attempts = MAX_OUTSTANDING_INVITES_PER_SESSION + 10;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => db.transaction((tx) => createInvite(tx, session.id, browserSessionId))),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected" && r.reason instanceof InviteLimitError).length;
    expect(ok).toBe(MAX_OUTSTANDING_INVITES_PER_SESSION);
    expect(refused).toBe(attempts - MAX_OUTSTANDING_INVITES_PER_SESSION);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessionInvites)
      .where(eq(sessionInvites.sessionId, session.id));
    expect(count).toBe(MAX_OUTSTANDING_INVITES_PER_SESSION);
  });

  it("the cap is per group — another group is unaffected", async () => {
    const a = await makeGroup();
    const b = await makeGroup();
    for (let i = 0; i < MAX_OUTSTANDING_INVITES_PER_SESSION; i += 1) {
      await db.transaction((tx) => createInvite(tx, a.session.id, a.browserSessionId));
    }
    await expect(db.transaction((tx) => createInvite(tx, b.session.id, b.browserSessionId))).resolves.toBeTruthy();
  });
});
