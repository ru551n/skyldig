import { and, asc, eq, sql } from "drizzle-orm";
import type { DatabaseError } from "pg";

import type { DbOrTx, Tx } from "../auth/browser-session.ts";
import { participants, sessions } from "../../db/schema.ts";
import { generatePublicId } from "../shared/ids.ts";
import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.ts";
import { recordRevision } from "../audit/audit.ts";

export interface ParticipantDto {
  publicId: string;
  displayName: string;
  position: number;
  revision: number;
  createdAt: Date;
}

interface ParticipantSnapshot {
  publicId: string;
  displayName: string;
}

function toDto(row: typeof participants.$inferSelect): ParticipantDto {
  return {
    publicId: row.publicId,
    displayName: row.displayName,
    position: row.position,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

function toSnapshot(row: typeof participants.$inferSelect): ParticipantSnapshot {
  return { publicId: row.publicId, displayName: row.displayName };
}

/**
 * Normalizes a display name for collision detection: NFKC-normalizes, trims,
 * collapses internal whitespace runs to a single space, and lowercases with
 * `sv-SE` rules.
 */
export function normalizeName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE");
}

function validateDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new ValidationError({ field: "displayName", code: "INVALID_NAME" });
  }
  return trimmed;
}

/** Drizzle wraps the underlying `pg` error in a `DrizzleQueryError` with `.cause`. */
function pgErrorOf(err: unknown): DatabaseError | undefined {
  const withCause = err as { cause?: unknown } | undefined;
  const candidate = (withCause?.cause ?? err) as DatabaseError | undefined;
  return candidate?.code ? candidate : undefined;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const dbErr = pgErrorOf(err);
  return !!dbErr && dbErr.code === "23505" && dbErr.constraint === constraint;
}

function isForeignKeyViolation(err: unknown): boolean {
  const dbErr = pgErrorOf(err);
  return !!dbErr && dbErr.code === "23503";
}

/** Locks the session row (`FOR UPDATE`) to serialize position assignment for `addParticipant`. */
async function lockSession(tx: Tx, sessionId: bigint): Promise<void> {
  await tx.execute(sql`select id from ${sessions} where id = ${sessionId} for update`);
}

/** Adds a single participant, assigning the next `position` within the session. */
export async function addParticipant(tx: Tx, sessionId: bigint, displayName: string): Promise<ParticipantDto> {
  const trimmed = validateDisplayName(displayName);
  const normalized = normalizeName(trimmed);

  await lockSession(tx, sessionId);

  const [{ nextPosition }] = await tx
    .select({ nextPosition: sql<number>`coalesce(max(${participants.position}), 0) + 1` })
    .from(participants)
    .where(eq(participants.sessionId, sessionId));

  let row: typeof participants.$inferSelect;
  try {
    [row] = await tx
      .insert(participants)
      .values({
        publicId: generatePublicId(),
        sessionId,
        displayName: trimmed,
        normalizedName: normalized,
        position: nextPosition,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, "participants_session_id_normalized_name_key")) {
      throw new ValidationError({ field: "displayName", code: "PARTICIPANT_NAME_TAKEN" });
    }
    throw err;
  }

  await recordRevision(tx, {
    sessionId,
    entityType: "participant",
    entityId: row.id,
    revisionNo: 1,
    action: "created",
    snapshot: toSnapshot(row),
  });

  return toDto(row);
}

/**
 * Adds multiple participants at once (used at session creation). Rejects
 * duplicate names within the input itself (after normalization) before
 * touching the database.
 */
export async function addParticipants(tx: Tx, sessionId: bigint, names: string[]): Promise<ParticipantDto[]> {
  const seen = new Set<string>();
  for (const name of names) {
    const normalized = normalizeName(validateDisplayName(name));
    if (seen.has(normalized)) {
      throw new ValidationError({ field: "displayName", code: "PARTICIPANT_NAME_TAKEN" });
    }
    seen.add(normalized);
  }

  const results: ParticipantDto[] = [];
  for (const name of names) {
    results.push(await addParticipant(tx, sessionId, name));
  }
  return results;
}

/** Looks up a participant by its public id within a session, or throws `NotFoundError`. */
export async function getParticipantByPublicId(
  db: DbOrTx,
  sessionId: bigint,
  publicId: string,
): Promise<typeof participants.$inferSelect> {
  const [row] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.sessionId, sessionId), eq(participants.publicId, publicId)))
    .limit(1);
  if (!row) {
    throw new NotFoundError(`Participant not found: ${publicId}`);
  }
  return row;
}

/** Lists all participants in a session, ordered by `position`. */
export async function listParticipants(db: DbOrTx, sessionId: bigint): Promise<ParticipantDto[]> {
  const rows = await db
    .select()
    .from(participants)
    .where(eq(participants.sessionId, sessionId))
    .orderBy(asc(participants.position));
  return rows.map(toDto);
}

/** Renames a participant, enforcing optimistic concurrency via `expectedRevision`. */
export async function renameParticipant(
  tx: Tx,
  sessionId: bigint,
  publicId: string,
  newName: string,
  expectedRevision: number,
): Promise<ParticipantDto> {
  const trimmed = validateDisplayName(newName);
  const normalized = normalizeName(trimmed);

  let row: typeof participants.$inferSelect | undefined;
  try {
    [row] = await tx
      .update(participants)
      .set({ displayName: trimmed, normalizedName: normalized, revision: sql`${participants.revision} + 1`, updatedAt: sql`now()` })
      .where(
        and(
          eq(participants.publicId, publicId),
          eq(participants.sessionId, sessionId),
          eq(participants.revision, expectedRevision),
        ),
      )
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, "participants_session_id_normalized_name_key")) {
      throw new ValidationError({ field: "displayName", code: "PARTICIPANT_NAME_TAKEN" });
    }
    throw err;
  }

  if (!row) {
    const current = await getParticipantByPublicId(tx, sessionId, publicId);
    throw new ConflictError("Participant has been modified", toDto(current));
  }

  await recordRevision(tx, {
    sessionId,
    entityType: "participant",
    entityId: row.id,
    revisionNo: row.revision,
    action: "updated",
    snapshot: toSnapshot(row),
  });

  return toDto(row);
}

/**
 * Deletes a participant, enforcing optimistic concurrency. Throws
 * `ValidationError({code: 'PARTICIPANT_HAS_HISTORY'})` if the participant is
 * still referenced by any expense or payment (RESTRICT FK).
 */
export async function deleteParticipant(
  tx: Tx,
  sessionId: bigint,
  publicId: string,
  expectedRevision: number,
): Promise<void> {
  let row: typeof participants.$inferSelect | undefined;
  try {
    [row] = await tx
      .delete(participants)
      .where(
        and(
          eq(participants.publicId, publicId),
          eq(participants.sessionId, sessionId),
          eq(participants.revision, expectedRevision),
        ),
      )
      .returning();
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw new ValidationError({ code: "PARTICIPANT_HAS_HISTORY" });
    }
    throw err;
  }

  if (!row) {
    const current = await getParticipantByPublicId(tx, sessionId, publicId);
    throw new ConflictError("Participant has been modified", toDto(current));
  }

  await recordRevision(tx, {
    sessionId,
    entityType: "participant",
    entityId: row.id,
    revisionNo: expectedRevision + 1,
    action: "deleted",
    snapshot: toSnapshot(row),
  });
}
