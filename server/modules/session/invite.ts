import { and, eq, isNull, sql } from "drizzle-orm";

import type { DbOrTx, Role, Tx } from "../auth/browser-session.ts";
import { generatePublicId, randomToken, sha256 } from "../auth/crypto.ts";
import { sessionInvites } from "../../db/schema.ts";
import { logger } from "../../logger.ts";

const inviteLogger = logger.child({ module: "session-invite" });

/** How long a generated invite link/QR stays redeemable. */
export const INVITE_TTL_MS = 30 * 60 * 1000;

export interface InviteRow {
  id: bigint;
  publicId: string;
  sessionId: bigint;
  role: Role;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Creates a single-use invite for `sessionId` and returns its public id (used in the
 * shareable URL, e.g. `/i/<publicId>`) and the plaintext token appended after it, plus the
 * invite row. The URL never carries the group's access phrase; only the invite token, which
 * is short-lived, single-use, and revocable — see docs/todo.md "Share a group by QR code or
 * link". Only the SHA-256 of the token is stored, matching the browser-session token pattern.
 */
export async function createInvite(
  tx: Tx,
  sessionId: bigint,
  createdByBrowserSessionId: bigint,
  role: Role = "member",
): Promise<{ publicId: string; token: string; invite: InviteRow }> {
  const token = randomToken(24);
  const publicId = generatePublicId();
  const [row] = await tx
    .insert(sessionInvites)
    .values({
      publicId,
      sessionId,
      tokenHash: sha256(token),
      role,
      createdByBrowserSessionId,
      expiresAt: sql`now() + interval '30 minutes'`,
    })
    .returning();
  if (!row) throw new Error("failed to create invite");
  return {
    publicId,
    token,
    invite: {
      id: row.id,
      publicId: row.publicId,
      sessionId: row.sessionId,
      role: row.role as Role,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      revokedAt: row.revokedAt,
    },
  };
}

/**
 * Looks up a non-expired, unused, unrevoked invite by public id, verifying the token by
 * constant-time comparison of its hash. Returns `null` on any mismatch — an invalid,
 * expired, already-used or revoked invite are all indistinguishable to the caller, the same
 * discipline `requireSessionAccess` uses for group access.
 */
export async function findRedeemableInvite(
  db: DbOrTx,
  publicId: string,
  token: string,
): Promise<InviteRow | null> {
  const [row] = await db
    .select()
    .from(sessionInvites)
    .where(
      and(
        eq(sessionInvites.publicId, publicId),
        sql`${sessionInvites.expiresAt} > now()`,
        isNull(sessionInvites.usedAt),
        isNull(sessionInvites.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const expected = sha256(token);
  const actual = row.tokenHash;
  if (expected.length !== actual.length || !expected.equals(actual)) return null;

  return {
    id: row.id,
    publicId: row.publicId,
    sessionId: row.sessionId,
    role: row.role as Role,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Burns an invite in the same transaction that grants access, so a redeemed invite can
 * never be used twice even under concurrent requests: the guarded `WHERE usedAt IS NULL`
 * update returns zero rows for a second concurrent redemption, and the caller must treat
 * that as "no such invite" rather than granting access again.
 */
export async function burnInvite(tx: Tx, id: bigint, usedByBrowserSessionId: bigint): Promise<boolean> {
  const result = await tx
    .update(sessionInvites)
    .set({ usedAt: sql`now()`, usedByBrowserSessionId })
    .where(and(eq(sessionInvites.id, id), isNull(sessionInvites.usedAt), isNull(sessionInvites.revokedAt)))
    .returning({ id: sessionInvites.id });
  return result.length > 0;
}

/** Revokes an invite so it can no longer be redeemed, even if unexpired and unused. */
export async function revokeInvite(tx: DbOrTx, sessionId: bigint, invitePublicId: string): Promise<boolean> {
  const result = await tx
    .update(sessionInvites)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(sessionInvites.sessionId, sessionId),
        eq(sessionInvites.publicId, invitePublicId),
        isNull(sessionInvites.revokedAt),
      ),
    )
    .returning({ id: sessionInvites.id });
  return result.length > 0;
}

/** Deletes expired invite rows (used, revoked, or past their TTL). Returns the count removed. */
export async function purgeExpiredInvites(db: DbOrTx): Promise<number> {
  const deleted = await db
    .delete(sessionInvites)
    .where(
      sql`${sessionInvites.expiresAt} < now() or ${sessionInvites.usedAt} is not null or ${sessionInvites.revokedAt} is not null`,
    )
    .returning({ id: sessionInvites.id });
  if (deleted.length > 0) {
    inviteLogger.info({ count: deleted.length }, "purged expired/used/revoked invites");
  }
  return deleted.length;
}
