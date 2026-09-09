import { timingSafeEqual } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { DbOrTx, Role, Tx } from "../auth/browser-session.ts";
import { generatePublicId, randomToken, sha256 } from "../auth/crypto.ts";
import { sessionInvites, sessions } from "../../db/schema.ts";
import { logger } from "../../logger.ts";

const inviteLogger = logger.child({ module: "session-invite" });

/** How long a generated invite link/QR stays redeemable. */
export const INVITE_TTL_MS = 30 * 60 * 1000;

/**
 * Upper bound on outstanding (unused, unrevoked, unexpired) invites per group, enforced
 * atomically in `createInvite`. Per-client rate limiting already throttles how fast one member
 * can mint invites, but a group with many members (or one member rotating IPs) could still
 * accumulate an unbounded pile of live single-use credentials between cleanup runs. 20 is
 * deliberately conservative: a member shares one link/QR at a time and each link lives 30
 * minutes, so even a large party inviting people in parallel stays well below it.
 */
export const MAX_OUTSTANDING_INVITES_PER_SESSION = 20;

/** Thrown by `createInvite` when the group already has `MAX_OUTSTANDING_INVITES_PER_SESSION` live invites. */
export class InviteLimitError extends Error {
  readonly code = "INVITE_LIMIT" as const;
  constructor() {
    super("invite: too many outstanding invites for this group");
    this.name = "InviteLimitError";
  }
}

export interface InviteRow {
  id: bigint;
  publicId: string;
  sessionId: bigint;
  role: Role;
  /** The group's `access_generation` when this invite was issued (see `sessions.accessGeneration`). */
  accessGeneration: number;
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
  // Lock the group row for the rest of the transaction so the outstanding-invite count below
  // cannot race: two concurrent creates for the same group serialize here, and the second one
  // sees the first one's row. The lock also pins the `accessGeneration` we stamp onto the
  // invite against a concurrent phrase rotation (whose UPDATE takes the same row lock).
  const [session] = await tx
    .select({ accessGeneration: sessions.accessGeneration })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), sql`${sessions.expiresAt} > now()`))
    .for("update");
  if (!session) throw new Error("invite: createInvite called for an unknown session");

  const [outstanding] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(sessionInvites)
    .where(
      and(
        eq(sessionInvites.sessionId, sessionId),
        sql`${sessionInvites.expiresAt} > now()`,
        isNull(sessionInvites.usedAt),
        isNull(sessionInvites.revokedAt),
      ),
    );
  if ((outstanding?.count ?? 0) >= MAX_OUTSTANDING_INVITES_PER_SESSION) {
    inviteLogger.info({ sessionId: String(sessionId) }, "invite creation refused: outstanding-invite cap reached");
    throw new InviteLimitError();
  }

  const token = randomToken(24);
  const publicId = generatePublicId();
  const [row] = await tx
    .insert(sessionInvites)
    .values({
      publicId,
      sessionId,
      tokenHash: sha256(token),
      role,
      accessGeneration: session.accessGeneration,
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
      accessGeneration: row.accessGeneration,
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
 *
 * The invite's `accessGeneration` must still equal the group's: rotating the access phrase
 * bumps the group's generation (`rotateAccessPhrase`), which retires every invite issued
 * before the rotation without touching their rows. The group itself must also be unexpired.
 */
export async function findRedeemableInvite(
  db: DbOrTx,
  publicId: string,
  token: string,
): Promise<InviteRow | null> {
  const [row] = await db
    .select({ invite: sessionInvites })
    .from(sessionInvites)
    .innerJoin(sessions, eq(sessions.id, sessionInvites.sessionId))
    .where(
      and(
        eq(sessionInvites.publicId, publicId),
        sql`${sessionInvites.expiresAt} > now()`,
        isNull(sessionInvites.usedAt),
        isNull(sessionInvites.revokedAt),
        eq(sessionInvites.accessGeneration, sessions.accessGeneration),
        sql`${sessions.expiresAt} > now()`,
      ),
    )
    .limit(1)
    .then((rows) => rows.map((r) => r.invite));
  if (!row) return null;

  const expected = sha256(token);
  const actual = row.tokenHash;
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  return {
    id: row.id,
    publicId: row.publicId,
    sessionId: row.sessionId,
    role: row.role as Role,
    accessGeneration: row.accessGeneration,
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
