import { eq, sql } from "drizzle-orm";

import type { Database } from "../../db/client.ts";
import { currencies, sessions } from "../../db/schema.ts";
import type { Config } from "../../config.ts";
import { logger } from "../../logger.ts";
import {
  generateAdminKey,
  generatePublicId,
  hashVerifier,
  hmacIndex,
  normalizeAdminKey,
  normalizePhrase,
  verifierNeedsUpgrade,
  verifyVerifier,
} from "../auth/crypto.ts";
import type { DbOrTx, Tx } from "../auth/browser-session.ts";
import { downgradeOtherGrantsToMember, revokeOtherGrantsForSession } from "../auth/browser-session.ts";
import { ValidationError } from "../shared/errors.ts";
import { isUniqueViolation } from "../shared/pg-errors.ts";
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

interface SessionCredentials {
  phrase: string;
  adminKey: string;
  publicId: string;
  accessKeyIndex: Buffer;
  accessKeyVerifier: string;
  adminKeyHash: Buffer;
}

/**
 * Test-only injection seam: lets tests force a specific access phrase (and therefore a specific
 * `access_key_index`) so the unique-index collision/retry path in `createSession` can be
 * exercised deterministically, without relying on winning a 66-bit-entropy race.
 */
export interface CreateSessionDeps {
  generatePhrase?: () => string;
}

/**
 * Generates a fresh, unrelated candidate set of session credentials: access phrase, admin key,
 * public id, blind index, and the (CPU-heavy, ~100ms scrypt) verifier. Deliberately performed
 * with no open database transaction/connection, so retries never hold a pool connection or an
 * open snapshot idle for pure CPU work (docs/architecture.md §4.1, defect: scrypt-in-transaction).
 */
async function generateSessionCredentials(config: Config, deps: CreateSessionDeps): Promise<SessionCredentials> {
  const phrase = (deps.generatePhrase ?? generatePhrase)();
  const adminKey = generateAdminKey();
  const normalizedPhrase = normalizePhrase(phrase);

  const accessKeyIndex = hmacIndex(config.accessKeyPepper, normalizedPhrase);
  const accessKeyVerifier = await hashVerifier(config.accessKeyPepper, normalizedPhrase);
  const adminKeyHash = hmacIndex(config.accessKeyPepper, normalizeAdminKey(adminKey));
  const publicId = generatePublicId();

  return { phrase, adminKey, publicId, accessKeyIndex, accessKeyVerifier, adminKeyHash };
}

/**
 * Creates a session, its access phrase, admin key, and initial participants. Regenerates the
 * phrase/admin key/public id and retries on a unique-index collision (never observed in
 * practice at 66+ bits of entropy, but handled per docs/architecture.md §4.1).
 *
 * Each attempt generates its credentials (including the scrypt verifier) *before* opening a
 * transaction, and each attempt's insert (+ initial participants) runs in its own short-lived
 * transaction — so a collision on one attempt cannot poison a later attempt's statements, and no
 * attempt holds a connection open across the CPU-bound hashing step.
 */
export async function createSession(
  db: Database,
  config: Config,
  input: CreateSessionInput,
  deps: CreateSessionDeps = {},
): Promise<CreateSessionResult> {
  const name = validateName(input.name);
  const participantNames = validateParticipantNames(input.participantNames);
  const baseCurrency = await validateBaseCurrency(db, input.baseCurrency);

  let result: { row: typeof sessions.$inferSelect; creds: SessionCredentials } | undefined;

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS && !result; attempt += 1) {
    const creds = await generateSessionCredentials(config, deps);

    try {
      const row = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(sessions)
          .values({
            publicId: creds.publicId,
            name,
            baseCurrency,
            accessKeyIndex: creds.accessKeyIndex,
            accessKeyVerifier: creds.accessKeyVerifier,
            adminKeyHash: creds.adminKeyHash,
            pepperVersion: 1,
            expiresAt: sql`now() + interval '90 days'`,
          })
          .returning();
        if (participantNames.length > 0) {
          await addParticipants(tx, inserted.id, participantNames);
        }
        return inserted;
      });
      result = { row, creds };
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

  if (!result) {
    throw new Error("session: failed to allocate a unique access phrase / public id after retries");
  }

  return { session: toDto(result.row), phrase: result.creds.phrase, adminKey: result.creds.adminKey };
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

  const ok = await verifyVerifier(config.accessKeyPepper, normalized, row.accessKeyVerifier);
  if (!ok) return null;

  if (verifierNeedsUpgrade(row.accessKeyVerifier)) {
    await upgradeVerifier(db, config, row.id, normalized, row.accessKeyVerifier);
  }

  return { sessionId: row.id, publicId: row.publicId, name: row.name };
}

/**
 * Lazily re-hashes a legacy (v1, unpeppered) verifier to the current peppered format after a
 * successful join — the only moment the plaintext phrase is available. Best-effort and
 * non-transactional: the UPDATE is guarded on the old verifier value so it is a no-op if the
 * phrase was rotated (or another join upgraded it) in the meantime, and any failure is logged
 * and swallowed — the join already succeeded and the v1 verifier keeps working until next time.
 */
async function upgradeVerifier(
  db: DbOrTx,
  config: Config,
  sessionId: bigint,
  normalizedPhrase: string,
  oldVerifier: string,
): Promise<void> {
  try {
    const upgraded = await hashVerifier(config.accessKeyPepper, normalizedPhrase);
    await db
      .update(sessions)
      .set({ accessKeyVerifier: upgraded })
      .where(sql`${sessions.id} = ${sessionId} and ${sessions.accessKeyVerifier} = ${oldVerifier}`);
  } catch (err) {
    logger.warn({ err, sessionId: String(sessionId) }, "session: lazy verifier upgrade failed");
  }
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
 * Rotates the access phrase for a session: generates a new phrase, index, and verifier, and
 * revokes every other browser session's grant to this session (`revokeOtherGrantsForSession`),
 * per docs/architecture.md §4.3 — so rotating the phrase actually cuts off other holders — and
 * bumps `sessions.access_generation` in the same UPDATE, which invalidates every invite issued
 * before the rotation (invites are stamped with the generation they were created under).
 * `keepBrowserSessionId` identifies the caller's own browser session, whose grant survives.
 *
 * `tx` is a transaction already opened by the caller (the rotation and the grant revocation
 * must be atomic together). Each retry attempt's UPDATE runs in its own SAVEPOINT (a nested
 * `tx.transaction(...)`), so a unique-index collision on one attempt rolls back only that
 * attempt and leaves the caller's outer transaction healthy for the next attempt and for the
 * grant revocation that follows.
 */
export async function rotateAccessPhrase(
  tx: Tx,
  config: Config,
  sessionId: bigint,
  keepBrowserSessionId: bigint,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const phrase = generatePhrase();
    const normalized = normalizePhrase(phrase);
    const accessKeyIndex = hmacIndex(config.accessKeyPepper, normalized);
    const accessKeyVerifier = await hashVerifier(config.accessKeyPepper, normalized);

    try {
      const updated = await tx.transaction(async (savepoint) => {
        const [row] = await savepoint
          .update(sessions)
          .set({
            accessKeyIndex,
            accessKeyVerifier,
            // Retires every invite issued under the old phrase (see `findRedeemableInvite`).
            accessGeneration: sql`${sessions.accessGeneration} + 1`,
          })
          .where(eq(sessions.id, sessionId))
          .returning({ id: sessions.id });
        return row;
      });
      if (!updated) {
        throw new Error("session: rotateAccessPhrase called for an unknown session");
      }
      await revokeOtherGrantsForSession(tx, sessionId, keepBrowserSessionId);
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

/**
 * Rotates the admin key for a session, returning the new plaintext key, and downgrades every
 * other grant's role from 'admin' to 'member' (never removes access — the other browser
 * sessions keep member-level access to the session, they just lose the admin key's authority),
 * per docs/architecture.md §4.3. `keepBrowserSessionId` identifies the caller's own browser
 * session, whose grant (and role) is left untouched.
 *
 * `admin_key_hash` carries no uniqueness constraint, so unlike `rotateAccessPhrase` this needs
 * no collision retry.
 */
export async function rotateAdminKey(
  tx: Tx,
  config: Config,
  sessionId: bigint,
  keepBrowserSessionId: bigint,
): Promise<string> {
  const adminKey = generateAdminKey();
  const adminKeyHash = hmacIndex(config.accessKeyPepper, normalizeAdminKey(adminKey));
  const [row] = await tx
    .update(sessions)
    .set({ adminKeyHash })
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  if (!row) {
    throw new Error("session: rotateAdminKey called for an unknown session");
  }
  await downgradeOtherGrantsToMember(tx, sessionId, keepBrowserSessionId);
  return adminKey;
}
