import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it } from "vitest";

import { runCleanup, startCleanupScheduler, CLEANUP_LOCK_KEY } from "../../server/modules/expiration/cleanup.ts";
import { browserSessions, participants, sessionGrants, sessions } from "../../server/db/schema.ts";
import * as schema from "../../server/db/schema.ts";
import { db, pool, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
});

async function createSession(expiresAtExpr: ReturnType<typeof sql>) {
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
      expiresAt: expiresAtExpr,
    })
    .returning();
  return session;
}

async function createParticipant(sessionId: bigint) {
  const [participant] = await db
    .insert(participants)
    .values({
      publicId: `part-${randomBytes(6).toString("hex")}`,
      sessionId,
      displayName: "Test Participant",
      normalizedName: "test_participant",
      position: 0,
    })
    .returning();
  return participant;
}

async function createBrowserSession(expiresAtExpr: ReturnType<typeof sql> = sql`now() + interval '90 days'`) {
  const [bs] = await db
    .insert(browserSessions)
    .values({
      tokenHash: randomBytes(32),
      expiresAt: expiresAtExpr,
    })
    .returning();
  return bs;
}

describe("expiration cleanup", () => {
  it("deletes expired sessions and cascades to participants and grants", async () => {
    // Create expired session 1 with participant and grant
    const exp1 = await createSession(sql.raw("now() - interval '1 day'"));
    const part1 = await createParticipant(exp1.id);
    const bs1 = await createBrowserSession();
    await db.insert(sessionGrants).values({
      browserSessionId: bs1.id,
      sessionId: exp1.id,
      role: "member",
    });

    // Create expired session 2 with participant and grant
    const exp2 = await createSession(sql.raw("now() - interval '1 minute'"));
    const part2 = await createParticipant(exp2.id);
    const bs2 = await createBrowserSession();
    await db.insert(sessionGrants).values({
      browserSessionId: bs2.id,
      sessionId: exp2.id,
      role: "admin",
    });

    // Create live session with participant and grant
    const live = await createSession(sql.raw("now() + interval '89 days'"));
    const partLive = await createParticipant(live.id);
    const bsLive = await createBrowserSession();
    await db.insert(sessionGrants).values({
      browserSessionId: bsLive.id,
      sessionId: live.id,
      role: "member",
    });

    // Create expired browser session (no grants)
    await createBrowserSession(sql.raw("now() - interval '1 day'"));

    // Run cleanup
    const result = await runCleanup(db);

    expect(result.sessionsDeleted).toBe(2);
    expect(result.browserSessionsDeleted).toBe(1);
    expect(result.skipped).toBe(false);

    // Verify expired sessions are gone
    const expSessions = await db
      .select()
      .from(sessions)
      .where(sql`${sessions.id} IN (${exp1.id}, ${exp2.id})`);
    expect(expSessions).toHaveLength(0);

    // Verify expired participants are gone (cascade)
    const expParts = await db
      .select()
      .from(participants)
      .where(sql`${participants.id} IN (${part1.id}, ${part2.id})`);
    expect(expParts).toHaveLength(0);

    // Verify expired grants are gone (cascade)
    const expGrants = await db
      .select()
      .from(sessionGrants)
      .where(sql`${sessionGrants.sessionId} IN (${exp1.id}, ${exp2.id})`);
    expect(expGrants).toHaveLength(0);

    // Verify live session and participant remain
    const liveSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, live.id));
    expect(liveSessions).toHaveLength(1);

    const liveParts = await db
      .select()
      .from(participants)
      .where(eq(participants.id, partLive.id));
    expect(liveParts).toHaveLength(1);

    // Verify live grant remains
    const liveGrants = await db
      .select()
      .from(sessionGrants)
      .where(eq(sessionGrants.sessionId, live.id));
    expect(liveGrants).toHaveLength(1);
  });

  it("returns 0 deletions on second run", async () => {
    // Create expired session
    const exp = await createSession(sql.raw("now() - interval '1 day'"));
    await createParticipant(exp.id);
    const bs = await createBrowserSession();
    await db.insert(sessionGrants).values({
      browserSessionId: bs.id,
      sessionId: exp.id,
      role: "member",
    });

    // First run deletes it
    const result1 = await runCleanup(db);
    expect(result1.sessionsDeleted).toBe(1);
    expect(result1.skipped).toBe(false);

    // Second run finds nothing to delete and is not skipped
    const result2 = await runCleanup(db);
    expect(result2.sessionsDeleted).toBe(0);
    expect(result2.browserSessionsDeleted).toBe(0);
    expect(result2.skipped).toBe(false);
  });

  it("skips cleanup when advisory lock is held", async () => {
    // Create expired session
    const exp = await createSession(sql.raw("now() - interval '1 day'"));
    await createParticipant(exp.id);
    const bs = await createBrowserSession();
    await db.insert(sessionGrants).values({
      browserSessionId: bs.id,
      sessionId: exp.id,
      role: "member",
    });

    // Test that pg_try_advisory_xact_lock returns false when lock is already held

    // First cleanup should succeed and get the lock
    const result1 = await runCleanup(db);
    expect(result1.skipped).toBe(false);
    expect(result1.sessionsDeleted).toBe(1);

    // Now test in a transaction that holds the lock
    let skippedResult = false;
    await db.transaction(async (tx) => {
      // Hold the exclusive lock (pg_advisory_xact_lock returns void, but pg_try_advisory_xact_lock returns boolean)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).execute(sql`SELECT pg_advisory_xact_lock(${CLEANUP_LOCK_KEY})`);

      // Try to run cleanup from a different transaction using a separate connection
      const client = await pool.connect();
      try {
        const tempDb = drizzle(client, { schema });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result2 = await runCleanup(tempDb as any);
        skippedResult = result2.skipped;
      } finally {
        client.release();
      }
    });

    // The second cleanup should have skipped because the lock was held
    expect(skippedResult).toBe(true);
  });

  it("removes more than one batch (250 expired sessions) in a single runCleanup call", async () => {
    // Insert 250 cheaply-generated expired sessions in one statement, so batching (BATCH_SIZE
    // = 200) is actually exercised: a single 200-row batch must not be mistaken for "done" when
    // more expired rows remain.
    await db.execute(sql`
      INSERT INTO sessions (
        public_id, name, base_currency, access_key_index, access_key_verifier,
        admin_key_hash, pepper_version, expires_at
      )
      SELECT
        'pub-bulk-' || gs::text,
        'Bulk expired ' || gs::text,
        'SEK',
        decode(md5('access-' || gs::text), 'hex'),
        'verifier',
        decode(md5('admin-' || gs::text), 'hex'),
        1,
        now() - interval '1 day'
      FROM generate_series(1, 250) AS gs
    `);

    const result = await runCleanup(db);

    expect(result.sessionsDeleted).toBe(250);
    expect(result.skipped).toBe(false);

    const [{ count }] = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM sessions WHERE public_id LIKE 'pub-bulk-%'
    `).then((r) => r.rows);
    expect(count).toBe("0");
  });

  it("runs cleanup immediately on start", async () => {
    // Create an expired session
    const exp = await createSession(sql.raw("now() - interval '1 day'"));
    await createParticipant(exp.id);
    const bs = await createBrowserSession();
    await db.insert(sessionGrants).values({
      browserSessionId: bs.id,
      sessionId: exp.id,
      role: "member",
    });

    // Start scheduler with large interval
    const scheduler = startCleanupScheduler(db, { intervalMs: 60 * 1000 });

    try {
      // Poll for cleanup to complete (max 2 seconds)
      const startTime = Date.now();
      while (Date.now() - startTime < 2000) {
        const expired = await db
          .select()
          .from(sessions)
          .where(eq(sessions.id, exp.id));

        if (expired.length === 0) {
          // Cleanup ran, session is gone
          return;
        }

        // Wait a bit before retrying
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 50);
          timer.unref();
        });
      }

      // If we get here, cleanup didn't run
      throw new Error("Cleanup did not run within 2 seconds");
    } finally {
      scheduler.stop();
    }
  });
});
