import { eq, sql } from "drizzle-orm";
import type { DatabaseError } from "pg";

import type { Database } from "../../db/client.ts";
import { currencies, sessions } from "../../db/schema.ts";
import type { Config } from "../../config.ts";
import {
  generateAdminKey,
  generatePublicId,
  hashVerifier,
  hmacIndex,
  normalizeAdminKey,
  normalizePhrase,
  verifyVerifier,
} from "../auth/crypto.ts";
import type { DbOrTx, Tx } from "../auth/browser-session.ts";
import { ValidationError } from "../shared/errors.ts";
import { addParticipants } from "../participants/participants.ts";
import { generatePhrase } from "./phrase.ts";

const MAX_INSERT_ATTEMPTS = 5;
const MAX_PARTICIPANTS = 20;

export interface SessionDto {
  publicId: string;
  name: string;
  baseCurrency: string;
  createdAt: Date;
  expiresAt: Date;
}

function toDto(row: typeof sessions.$inferSelect): SessionDto {
  return {
    publicId: row.publicId,
    name: row.name,
    baseCurrency: row.baseCurrency,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const dbErr = err as DatabaseError | undefined;
  return !!dbErr && dbErr.code === "23505" && dbErr.constraint === constraint;
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new ValidationError({ field: "name", code: "INVALID_NAME" });
  }
  return trimmed;
}

async function validateBaseCurrency(db: DbOrTx, code: string): Promise<string> {
  const [row] = await db.select({ code: currencies.code }).from(currencies).where(eq(currencies.code, code)).limit(1);
  if (!row) {
    throw new ValidationError({ field: "baseCurrency", code: "UNKNOWN_CURRENCY" });
  }
  return row.code;
}

function validateParticipantNames(names: string[]): string[] {
  if (names.length > MAX_PARTICIPANTS) {
    throw new ValidationError({ field: "participantNames", code: "TOO_MANY_PARTICIPANTS" });
  }
  return names;
}

export interface CreateSessionInput {
  name: string;
  baseCurrency: string;
  participantNames: string[];
}

export interface CreateSessionResult {
  session: SessionDto;
  phrase: string;
  adminKey: string;
}

/**
 * Creates a session, its access phrase, admin key, and initial participants in one
 * transaction. Regenerates the phrase/admin key/public id and retries on a unique-index
 * collision (never observed in practice at 66+ bits of entropy, but handled per
 * docs/architecture.md §4.1).
 */
export async function createSession(
  db: Database,
  config: Config,
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  const name = validateName(input.name);
  const participantNames = validateParticipantNames(input.participantNames);

  return db.transaction(async (tx) => {
    const baseCurrency = await validateBaseCurrency(tx, input.baseCurrency);

    let attempt = 0;
    let row: typeof sessions.$inferSelect | undefined;
    let phrase = "";
    let adminKey = "";

    while (attempt < MAX_INSERT_ATTEMPTS && !row) {
      attempt += 1;
      phrase = generatePhrase();
      adminKey = generateAdminKey();
      const normalizedPhrase = normalizePhrase(phrase);

      const accessKeyIndex = hmacIndex(config.accessKeyPepper, normalizedPhrase);
      const accessKeyVerifier = await hashVerifier(normalizedPhrase);
      const adminKeyHash = hmacIndex(config.accessKeyPepper, normalizeAdminKey(adminKey));
      const publicId = generatePublicId();

      try {
        [row] = await tx
          .insert(sessions)
          .values({
            publicId,
            name,
            baseCurrency,
            accessKeyIndex,
            accessKeyVerifier,
            adminKeyHash,
            pepperVersion: 1,
            expiresAt: sql`now() + interval '90 days'`,
          })
          .returning();
      } catch (err) {
        if (
          isUniqueViolation(err, "sessions_access_key_index_key") ||
          isUniqueViolation(err, "sessions_public_id_key")
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!row) {
      throw new Error("session: failed to allocate a unique access phrase / public id after retries");
    }

    if (participantNames.length > 0) {
      await addParticipants(tx, row.id, participantNames);
    }

    return { session: toDto(row), phrase, adminKey };
  });
}

export interface JoinSessionResult {
  sessionId: bigint;
  publicId: string;
  name: string;
}

/**
 * Attempts to join a session by access phrase. Returns `null` if the phrase does not match any
 * non-expired session, or the verifier check fails. Callers are responsible for rate limiting
 * (see docs/architecture.md §4.4).
 */
export async function joinSession(
  db: DbOrTx,
  config: Config,
  phraseInput: string,
): Promise<JoinSessionResult | null> {
  const normalized = normalizePhrase(phraseInput);
  const accessKeyIndex = hmacIndex(config.accessKeyPepper, normalized);

  const [row] = await db
    .select()
    .from(sessions)
    .where(sql`${sessions.accessKeyIndex} = ${accessKeyIndex} and ${sessions.expiresAt} > now()`)
    .limit(1);
  if (!row) return null;

  const ok = await verifyVerifier(normalized, row.accessKeyVerifier);
  if (!ok) return null;

  return { sessionId: row.id, publicId: row.publicId, name: row.name };
}

/** Verifies an admin key, scoped to `sessionId` — never a global lookup. */
export async function verifyAdminKey(
  db: DbOrTx,
  config: Config,
  sessionId: bigint,
  adminKeyInput: string,
): Promise<boolean> {
  const hash = hmacIndex(config.accessKeyPepper, normalizeAdminKey(adminKeyInput));
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(sql`${sessions.id} = ${sessionId} and ${sessions.adminKeyHash} = ${hash} and ${sessions.expiresAt} > now()`)
    .limit(1);
  return !!row;
}

/** Looks up a non-expired session by its public id, or `null`. */
export async function getSessionByPublicId(db: DbOrTx, publicId: string): Promise<SessionDto | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(sql`${sessions.publicId} = ${publicId} and ${sessions.expiresAt} > now()`)
    .limit(1);
  return row ? toDto(row) : null;
}

/** Deletes a session; cascades to participants, expenses, payments, revisions, and grants. */
export async function deleteSession(tx: Tx, sessionId: bigint): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Rotates the access phrase for a session: generates a new phrase, index, and verifier.
 * The caller (an admin action) is responsible for revoking every other browser session's
 * grant to this session (`revokeOtherGrantsForSession`), per docs/architecture.md §4.3.
 */
export async function rotateAccessPhrase(tx: Tx, config: Config, sessionId: bigint): Promise<string> {
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const phrase = generatePhrase();
    const normalized = normalizePhrase(phrase);
    const accessKeyIndex = hmacIndex(config.accessKeyPepper, normalized);
    const accessKeyVerifier = await hashVerifier(normalized);

    try {
      const [row] = await tx
        .update(sessions)
        .set({ accessKeyIndex, accessKeyVerifier })
        .where(eq(sessions.id, sessionId))
        .returning({ id: sessions.id });
      if (!row) {
        throw new Error(`session: rotateAccessPhrase called for unknown session ${sessionId}`);
      }
      return phrase;
    } catch (err) {
      if (isUniqueViolation(err, "sessions_access_key_index_key")) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("session: failed to allocate a unique access phrase after retries");
}

/** Rotates the admin key for a session, returning the new plaintext key. */
export async function rotateAdminKey(tx: Tx, config: Config, sessionId: bigint): Promise<string> {
  const adminKey = generateAdminKey();
  const adminKeyHash = hmacIndex(config.accessKeyPepper, normalizeAdminKey(adminKey));
  const [row] = await tx
    .update(sessions)
    .set({ adminKeyHash })
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  if (!row) {
    throw new Error(`session: rotateAdminKey called for unknown session ${sessionId}`);
  }
  return adminKey;
}
