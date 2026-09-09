import { and, count, eq, gt, lt, sql } from "drizzle-orm";

import type { db as dbInstance } from "../../db/client.ts";
import { browserSessions, sessionGrants, sessions } from "../../db/schema.ts";
import { logger } from "../../logger.ts";
import { randomToken, sha256 } from "./crypto.ts";

const authLogger = logger.child({ module: "auth" });

export type Database = typeof dbInstance;
type TxCallback = Parameters<Database["transaction"]>[0];
/** A transaction handle, as passed into `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<TxCallback>[0];
/** Anything that supports the query builder methods we use: the top-level db or a tx. */
export type DbOrTx = Database | Tx;

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export type Role = "member" | "admin";

export interface BrowserSessionRow {
  id: bigint;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface GrantSummary {
  sessionId: bigint;
  sessionPublicId: string;
  sessionName: string;
  role: Role;
  expiresAt: Date;
}

export interface GrantRow {
  browserSessionId: bigint;
  sessionId: bigint;
  role: Role;
  createdAt: Date;
  lastUsedAt: Date;
}

/** Creates a new browser session row and returns its id and the plaintext token. */
export async function createBrowserSession(tx: DbOrTx): Promise<{ id: bigint; token: string }> {
  const token = randomToken(32);
  const now = new Date();
  const [row] = await tx
    .insert(browserSessions)
    .values({
      tokenHash: sha256(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: sql`now() + interval '90 days'`,
    })
    .returning({ id: browserSessions.id });
  return { id: row.id, token };
}

/**
 * Looks up a non-expired browser session by its plaintext token. Touches `last_seen_at` at
 * most once per hour to avoid a write on every request.
 */
export async function findBrowserSessionByToken(
  db: DbOrTx,
  token: string,
): Promise<BrowserSessionRow | null> {
  const tokenHash = sha256(token);
  const now = new Date();
  const [row] = await db
    .select()
    .from(browserSessions)
    .where(and(eq(browserSessions.tokenHash, tokenHash), gt(browserSessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!row) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(browserSessions)
      .set({ lastSeenAt: now })
      .where(eq(browserSessions.id, row.id));
    row.lastSeenAt = now;
  }

  return { id: row.id, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.expiresAt };
}

/**
 * Rotates a browser session: creates a new row, moves every grant from `oldId` to the new
 * row, then deletes the old row. Must run inside the caller's transaction.
 */
export async function rotateBrowserSession(
  tx: DbOrTx,
  oldId: bigint,
): Promise<{ id: bigint; token: string }> {
  const created = await createBrowserSession(tx);
  await tx
    .update(sessionGrants)
    .set({ browserSessionId: created.id })
    .where(eq(sessionGrants.browserSessionId, oldId));
  await tx.delete(browserSessions).where(eq(browserSessions.id, oldId));
  return created;
}

/** Upserts a grant. Never downgrades an existing admin grant to member. */
export async function grantAccess(
  tx: DbOrTx,
  browserSessionId: bigint,
  sessionId: bigint,
  role: Role,
): Promise<void> {
  const now = new Date();
  await tx
    .insert(sessionGrants)
    .values({ browserSessionId, sessionId, role, createdAt: now, lastUsedAt: now })
    .onConflictDoUpdate({
      target: [sessionGrants.browserSessionId, sessionGrants.sessionId],
      set: {
        role: sql`case when ${sessionGrants.role} = 'admin' then 'admin' else excluded.role end`,
        lastUsedAt: now,
      },
    });
}

export async function revokeGrant(tx: DbOrTx, browserSessionId: bigint, sessionId: bigint): Promise<void> {
  await tx
    .delete(sessionGrants)
    .where(and(eq(sessionGrants.browserSessionId, browserSessionId), eq(sessionGrants.sessionId, sessionId)));
}

/** Lists grants for a browser session, excluding grants to sessions that have expired. */
export async function listGrants(db: DbOrTx, browserSessionId: bigint): Promise<GrantSummary[]> {
  const rows = await db
    .select({
      sessionId: sessionGrants.sessionId,
      sessionPublicId: sessions.publicId,
      sessionName: sessions.name,
      role: sessionGrants.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessionGrants)
    .innerJoin(sessions, eq(sessionGrants.sessionId, sessions.id))
    .where(and(eq(sessionGrants.browserSessionId, browserSessionId), gt(sessions.expiresAt, sql`now()`)));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
}

export async function getGrant(
  db: DbOrTx,
  browserSessionId: bigint,
  sessionId: bigint,
): Promise<GrantRow | null> {
  const [row] = await db
    .select()
    .from(sessionGrants)
    .where(and(eq(sessionGrants.browserSessionId, browserSessionId), eq(sessionGrants.sessionId, sessionId)))
    .limit(1);
  if (!row) return null;
  return { ...row, role: row.role as Role };
}

/** Revokes every grant to `sessionId` except the one held by `keepBrowserSessionId`. */
export async function revokeOtherGrantsForSession(
  tx: DbOrTx,
  sessionId: bigint,
  keepBrowserSessionId: bigint,
): Promise<void> {
  await tx
    .delete(sessionGrants)
    .where(
      and(
        eq(sessionGrants.sessionId, sessionId),
        sql`${sessionGrants.browserSessionId} <> ${keepBrowserSessionId}`,
      ),
    );
}

/**
 * Downgrades every 'admin' grant to `sessionId` from role 'admin' to 'member', except the one
 * held by `keepBrowserSessionId`. Used when the admin key is rotated: other browser sessions
 * keep their member-level access, but lose the authority the old admin key granted them.
 */
export async function downgradeOtherGrantsToMember(
  tx: DbOrTx,
  sessionId: bigint,
  keepBrowserSessionId: bigint,
): Promise<void> {
  await tx
    .update(sessionGrants)
    .set({ role: "member" })
    .where(
      and(
        eq(sessionGrants.sessionId, sessionId),
        eq(sessionGrants.role, "admin"),
        sql`${sessionGrants.browserSessionId} <> ${keepBrowserSessionId}`,
      ),
    );
}

/** Deletes the browser session row if it holds no grants. Returns whether it was deleted. */
export async function deleteBrowserSessionIfEmpty(tx: DbOrTx, id: bigint): Promise<boolean> {
  const [{ value }] = await tx
    .select({ value: count() })
    .from(sessionGrants)
    .where(eq(sessionGrants.browserSessionId, id));
  if (value > 0) return false;
  await tx.delete(browserSessions).where(eq(browserSessions.id, id));
  return true;
}

/** Deletes expired browser session rows. Returns the number deleted. */
export async function purgeExpiredBrowserSessions(db: DbOrTx): Promise<number> {
  const deleted = await db.delete(browserSessions).where(lt(browserSessions.expiresAt, sql`now()`)).returning({
    id: browserSessions.id,
  });
  if (deleted.length > 0) {
    authLogger.info({ count: deleted.length }, "purged expired browser sessions");
  }
  return deleted.length;
}
