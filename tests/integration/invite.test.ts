import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { config } from "../../server/config.ts";
import { sessions } from "../../server/db/schema.ts";
import { createBrowserSession, getGrant, grantAccess } from "../../server/modules/auth/browser-session.ts";
import { createSession } from "../../server/modules/session/session.ts";
import {
  burnInvite,
  createInvite,
  findRedeemableInvite,
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
