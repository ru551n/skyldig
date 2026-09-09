import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { config } from "../../server/config.ts";
import { participants, sessions } from "../../server/db/schema.ts";
import { createBrowserSession, getGrant, grantAccess } from "../../server/modules/auth/browser-session.ts";
import {
  createSession,
  deleteSession,
  getSessionByPublicId,
  joinSession,
  rotateAccessPhrase,
  rotateAdminKey,
  verifyAdminKey,
} from "../../server/modules/session/session.ts";
import { PHRASE_WORDS } from "../../server/modules/session/phrase.ts";
import { db, pool, resetDb } from "./db.ts";

// scrypt (N=2^15) is ~100ms per call and createSession/rotate each do one; keep a generous
// per-test timeout rather than a global bump, and keep the number of createSession calls per
// test modest.
const SLOW_TEST_TIMEOUT = 15_000;

beforeEach(async () => {
  await resetDb();
});

async function makeSession(overrides: Partial<Parameters<typeof createSession>[2]> = {}) {
  return createSession(db, config, {
    name: "Cabin trip",
    baseCurrency: "SEK",
    participantNames: ["Alice", "Bob"],
    ...overrides,
  });
}

describe("createSession / joinSession", () => {
  it(
    "creates a session with a 4-word phrase that joins successfully",
    async () => {
      const { session, phrase, adminKey } = await makeSession();
      expect(phrase.split("-")).toHaveLength(PHRASE_WORDS);
      expect(adminKey).toMatch(/^admin-/);
      expect(session.baseCurrency).toBe("SEK");

      const joined = await joinSession(db, config, phrase);
      expect(joined).not.toBeNull();
      expect(joined?.publicId).toBe(session.publicId);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "normalizes whitespace/comma/case variants of the phrase and still joins",
    async () => {
      const { session, phrase } = await makeSession();
      const words = phrase.split("-");
      // Re-space the ACTUAL generated phrase using mixed separators and case, mirroring the
      // architecture doc's example: "Skog Banan  Fyrkant, Mossa cykel Torn".
      const messy = [
        words[0].toUpperCase(),
        words[1],
        " ",
        words[2],
        ",",
        words[3].toUpperCase(),
        words[4],
        words[5],
      ].join(" ");

      const joined = await joinSession(db, config, messy);
      expect(joined).not.toBeNull();
      expect(joined?.publicId).toBe(session.publicId);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "returns null for a wrong phrase",
    async () => {
      await makeSession();
      const joined = await joinSession(db, config, "not-the-right-phrase-at-all");
      expect(joined).toBeNull();
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "returns null for an expired session even with the correct phrase",
    async () => {
      const { session, phrase } = await makeSession();
      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.publicId, session.publicId));

      const joined = await joinSession(db, config, phrase);
      expect(joined).toBeNull();
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "rejects an unknown base currency",
    async () => {
      await expect(makeSession({ baseCurrency: "ZZZ" })).rejects.toMatchObject({
        code: "UNKNOWN_CURRENCY",
      });
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "rejects a name longer than 80 characters",
    async () => {
      await expect(makeSession({ name: "x".repeat(81) })).rejects.toMatchObject({
        code: "INVALID_NAME",
      });
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "creates participants with unique positions",
    async () => {
      const { session } = await makeSession({ participantNames: ["Alice", "Bob", "Carol"] });
      const [row] = await db.select().from(sessions).where(eq(sessions.publicId, session.publicId));
      const rows = await db.select().from(participants).where(eq(participants.sessionId, row.id));
      expect(rows).toHaveLength(3);
      const positions = rows.map((r) => r.position).sort((a, b) => a - b);
      expect(positions).toEqual([...new Set(positions)]);
      expect(positions).toHaveLength(3);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "rejects duplicate participant names within the input",
    async () => {
      // addParticipants (server/modules/participants) rejects duplicate normalized names
      // rather than silently deduping them; session creation surfaces that same error.
      await expect(
        makeSession({ participantNames: ["Alice", "alice"] }),
      ).rejects.toMatchObject({ code: "PARTICIPANT_NAME_TAKEN" });
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "stores no plaintext phrase or admin key in the database",
    async () => {
      const { phrase, adminKey } = await makeSession();
      const { rows } = await pool.query<{ access_key_verifier: string; admin_key_hash: Buffer }>(
        "select access_key_verifier, admin_key_hash from sessions",
      );
      for (const row of rows) {
        expect(row.access_key_verifier).not.toContain(phrase);
        expect(row.admin_key_hash.toString("hex")).not.toContain(Buffer.from(adminKey).toString("hex"));
        expect(row.admin_key_hash.toString("latin1")).not.toContain(adminKey);
      }
    },
    SLOW_TEST_TIMEOUT,
  );
});

describe("createSession collision retry", () => {
  it(
    "retries the insert (via a SAVEPOINT) and succeeds when the first generated phrase collides",
    async () => {
      // Force a real access_key_index collision on the *first* attempt by seeding a session
      // whose phrase we control, then handing createSession a phrase generator that returns
      // that exact phrase first (colliding) and a fresh one thereafter. This exercises the real
      // 23505 retry path end-to-end, rather than mocking the DB error.
      const collidingPhrase = "alfa-alfa-alfa-alfa-alfa-alfa";
      // Seed a session directly with the colliding phrase, so its access_key_index is a real,
      // correctly-derived one that the next createSession call will collide with.
      const seeded = await createSession(
        db,
        config,
        { name: "Seed", baseCurrency: "SEK", participantNames: [] },
        { generatePhrase: () => collidingPhrase },
      );
      expect(seeded.phrase).toBe(collidingPhrase);

      let genCalls = 0;
      const outcomes = [collidingPhrase, "bravo-bravo-bravo-bravo-bravo-bravo"];
      const result = await createSession(
        db,
        config,
        { name: "Collider", baseCurrency: "SEK", participantNames: [] },
        {
          generatePhrase: () => {
            const phrase = outcomes[Math.min(genCalls, outcomes.length - 1)];
            genCalls += 1;
            return phrase;
          },
        },
      );

      // The retry actually happened: two candidate phrases were generated.
      expect(genCalls).toBeGreaterThanOrEqual(2);
      // The final stored phrase is the second (non-colliding) candidate, not the first.
      expect(result.phrase).toBe("bravo-bravo-bravo-bravo-bravo-bravo");
      const joined = await joinSession(db, config, result.phrase);
      expect(joined?.publicId).toBe(result.session.publicId);
    },
    SLOW_TEST_TIMEOUT,
  );
});

describe("verifyAdminKey", () => {
  it(
    "verifies only against its own session",
    async () => {
      const a = await makeSession({ name: "Session A" });
      const b = await makeSession({ name: "Session B" });

      const [rowA] = await db.select().from(sessions).where(eq(sessions.publicId, a.session.publicId));
      const [rowB] = await db.select().from(sessions).where(eq(sessions.publicId, b.session.publicId));

      expect(await verifyAdminKey(db, config, rowA.id, a.adminKey)).toBe(true);
      expect(await verifyAdminKey(db, config, rowB.id, a.adminKey)).toBe(false);
      expect(await verifyAdminKey(db, config, rowA.id, b.adminKey)).toBe(false);
      expect(await verifyAdminKey(db, config, rowB.id, b.adminKey)).toBe(true);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "returns false against an expired session even with the correct admin key",
    async () => {
      const { session, adminKey } = await makeSession();
      const [row] = await db.select().from(sessions).where(eq(sessions.publicId, session.publicId));
      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, row.id));

      expect(await verifyAdminKey(db, config, row.id, adminKey)).toBe(false);
    },
    SLOW_TEST_TIMEOUT,
  );
});

describe("rotateAccessPhrase", () => {
  it(
    "invalidates the old phrase and makes the new one work",
    async () => {
      const { session, phrase: oldPhrase } = await makeSession();
      const [row] = await db.select().from(sessions).where(eq(sessions.publicId, session.publicId));
      const keeper = await db.transaction((tx) => createBrowserSession(tx));

      const newPhrase = await db.transaction((tx) => rotateAccessPhrase(tx, config, row.id, keeper.id));
      expect(newPhrase).not.toBe(oldPhrase);

      expect(await joinSession(db, config, oldPhrase)).toBeNull();
      const joined = await joinSession(db, config, newPhrase);
      expect(joined?.publicId).toBe(session.publicId);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "revokes every other browser session's grant to this session, keeping only the caller's",
    async () => {
      const { session } = await makeSession();
      const [row] = await db.select().from(sessions).where(eq(sessions.publicId, session.publicId));

      const keeper = await db.transaction((tx) => createBrowserSession(tx));
      const other1 = await db.transaction((tx) => createBrowserSession(tx));
      const other2 = await db.transaction((tx) => createBrowserSession(tx));
      await db.transaction(async (tx) => {
        await grantAccess(tx, keeper.id, row.id, "member");
        await grantAccess(tx, other1.id, row.id, "member");
        await grantAccess(tx, other2.id, row.id, "admin");
      });

      await db.transaction((tx) => rotateAccessPhrase(tx, config, row.id, keeper.id));

      expect(await getGrant(db, keeper.id, row.id)).not.toBeNull();
      expect(await getGrant(db, other1.id, row.id)).toBeNull();
      expect(await getGrant(db, other2.id, row.id)).toBeNull();
    },
    SLOW_TEST_TIMEOUT,
  );
});

describe("rotateAdminKey", () => {
  it(
    "invalidates the old admin key and makes the new one work",
    async () => {
      const { session, adminKey: oldKey } = await makeSession();
      const [row] = await db.select().from(sessions).where(eq(sessions.publicId, session.publicId));
      const keeper = await db.transaction((tx) => createBrowserSession(tx));

      const newKey = await db.transaction((tx) => rotateAdminKey(tx, config, row.id, keeper.id));
      expect(newKey).not.toBe(oldKey);

      expect(await verifyAdminKey(db, config, row.id, oldKey)).toBe(false);
      expect(await verifyAdminKey(db, config, row.id, newKey)).toBe(true);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "downgrades every other grant's admin role to member, keeping only the caller's admin role",
    async () => {
      const { session } = await makeSession();
      const [row] = await db.select().from(sessions).where(eq(sessions.publicId, session.publicId));

      const keeper = await db.transaction((tx) => createBrowserSession(tx));
      const other = await db.transaction((tx) => createBrowserSession(tx));
      await db.transaction(async (tx) => {
        await grantAccess(tx, keeper.id, row.id, "admin");
        await grantAccess(tx, other.id, row.id, "admin");
      });

      await db.transaction((tx) => rotateAdminKey(tx, config, row.id, keeper.id));

      expect((await getGrant(db, keeper.id, row.id))?.role).toBe("admin");
      // Downgraded, not removed: the other browser session keeps member-level access.
      expect((await getGrant(db, other.id, row.id))?.role).toBe("member");
    },
    SLOW_TEST_TIMEOUT,
  );
});

describe("deleteSession", () => {
  it(
    "removes the session and cascades to its participants",
    async () => {
      const { session } = await makeSession();
      const [row] = await db.select().from(sessions).where(eq(sessions.publicId, session.publicId));

      await db.transaction((tx) => deleteSession(tx, row.id));

      expect(await getSessionByPublicId(db, session.publicId)).toBeNull();
      const remainingParticipants = await db.select().from(participants).where(eq(participants.sessionId, row.id));
      expect(remainingParticipants).toHaveLength(0);
    },
    SLOW_TEST_TIMEOUT,
  );
});
