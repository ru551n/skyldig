import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DbOrTx, Tx } from "../auth/browser-session.ts";
import { participants, payments } from "../../db/schema.ts";
import { generatePublicId } from "../shared/ids.ts";
import { bigintToString } from "../shared/serialize.ts";
import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.ts";
import { recordRevision } from "../audit/audit.ts";
import type { RateDirection, SessionRef } from "../expenses/expenses.ts";
import { parseMoneyInput } from "../expenses/expenses.ts";

export interface PaymentInput {
  amountText: string;
  currencyCode: string;
  rateText?: string;
  rateDirection?: RateDirection;
  payerPublicId: string;
  recipientPublicId: string;
  paymentDate: string;
  note?: string;
}

export interface PaymentDto {
  publicId: string;
  amountMinor: bigint;
  currencyCode: string;
  rateText: string | null;
  rateDirection: RateDirection | null;
  baseCurrencyCode: string;
  baseAmountMinor: bigint;
  payer: { publicId: string; displayName: string };
  recipient: { publicId: string; displayName: string };
  paymentDate: string;
  note: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ResolvedParticipant {
  id: bigint;
  publicId: string;
  displayName: string;
}

function validateNote(note: string | undefined): string | null {
  if (note === undefined || note === null || note === "") return null;
  if (note.length > 500) {
    throw new ValidationError({ field: "note", code: "NOTE_TOO_LONG" });
  }
  return note;
}

async function resolveParticipant(
  tx: DbOrTx,
  sessionId: bigint,
  publicId: string,
  field: string,
): Promise<ResolvedParticipant> {
  const [row] = await tx
    .select({ id: participants.id, publicId: participants.publicId, displayName: participants.displayName })
    .from(participants)
    .where(and(eq(participants.sessionId, sessionId), eq(participants.publicId, publicId)))
    .limit(1);
  if (!row) {
    throw new ValidationError({ field, code: "UNKNOWN_PARTICIPANT" });
  }
  return row;
}

function toSnapshot(
  row: typeof payments.$inferSelect,
  payer: { publicId: string; displayName: string },
  recipient: { publicId: string; displayName: string },
) {
  return {
    publicId: row.publicId,
    amountMinor: bigintToString(row.amountMinor),
    currencyCode: row.currencyCode,
    rateText: row.rateText,
    rateDirection: row.rateDirection,
    baseAmountMinor: bigintToString(row.baseAmountMinor),
    paymentDate: row.paymentDate,
    note: row.note,
    payer,
    recipient,
  };
}

function toDto(
  row: typeof payments.$inferSelect,
  payer: { publicId: string; displayName: string },
  recipient: { publicId: string; displayName: string },
): PaymentDto {
  return {
    publicId: row.publicId,
    amountMinor: row.amountMinor,
    currencyCode: row.currencyCode,
    rateText: row.rateText,
    rateDirection: row.rateDirection as RateDirection | null,
    baseCurrencyCode: row.baseCurrencyCode,
    baseAmountMinor: row.baseAmountMinor,
    payer,
    recipient,
    paymentDate: row.paymentDate,
    note: row.note,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadDto(db: DbOrTx, row: typeof payments.$inferSelect): Promise<PaymentDto> {
  const [payerRow] = await db
    .select({ publicId: participants.publicId, displayName: participants.displayName })
    .from(participants)
    .where(eq(participants.id, row.payerId))
    .limit(1);
  const [recipientRow] = await db
    .select({ publicId: participants.publicId, displayName: participants.displayName })
    .from(participants)
    .where(eq(participants.id, row.recipientId))
    .limit(1);
  return toDto(row, payerRow!, recipientRow!);
}

/** Creates a payment (a repayment from one participant to another). */
export async function createPayment(tx: Tx, session: SessionRef, input: PaymentInput): Promise<PaymentDto> {
  if (input.payerPublicId === input.recipientPublicId) {
    throw new ValidationError({ field: "recipientPublicId", code: "SAME_PARTICIPANT" });
  }
  const note = validateNote(input.note);
  const payer = await resolveParticipant(tx, session.id, input.payerPublicId, "payerPublicId");
  const recipient = await resolveParticipant(tx, session.id, input.recipientPublicId, "recipientPublicId");
  const money = parseMoneyInput(session, input.currencyCode, input.amountText, input.rateText, input.rateDirection);

  const [row] = await tx
    .insert(payments)
    .values({
      publicId: generatePublicId(),
      sessionId: session.id,
      amountMinor: money.amountMinor,
      currencyCode: input.currencyCode,
      baseCurrencyCode: session.baseCurrency,
      rateText: money.rateText,
      rateDirection: money.rateDirection,
      rateNum: money.rateNum,
      rateDen: money.rateDen,
      baseAmountMinor: money.baseAmountMinor,
      payerId: payer.id,
      recipientId: recipient.id,
      paymentDate: input.paymentDate,
      note,
    })
    .returning();

  const payerRef = { publicId: payer.publicId, displayName: payer.displayName };
  const recipientRef = { publicId: recipient.publicId, displayName: recipient.displayName };

  await recordRevision(tx, {
    sessionId: session.id,
    entityType: "payment",
    entityId: row.id,
    revisionNo: 1,
    action: "created",
    snapshot: toSnapshot(row, payerRef, recipientRef),
  });

  return toDto(row, payerRef, recipientRef);
}

/** Fetches a payment, or throws `NotFoundError`. */
export async function getPayment(db: DbOrTx, sessionId: bigint, publicId: string): Promise<PaymentDto> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.sessionId, sessionId), eq(payments.publicId, publicId)))
    .limit(1);
  if (!row) {
    throw new NotFoundError(`Payment not found: ${publicId}`);
  }
  return loadDto(db, row);
}

/**
 * Lists payments newest payment date first, then newest created first.
 *
 * One query total regardless of row count: the payment rows joined to both the payer's and the
 * recipient's participant names via two aliases of `participants`. (Previously this called
 * `loadDto` per row, i.e. 2 queries per payment.)
 */
export async function listPayments(db: DbOrTx, sessionId: bigint): Promise<PaymentDto[]> {
  const payerAlias = alias(participants, "payer");
  const recipientAlias = alias(participants, "recipient");
  const rows = await db
    .select({
      payment: payments,
      payerPublicId: payerAlias.publicId,
      payerDisplayName: payerAlias.displayName,
      recipientPublicId: recipientAlias.publicId,
      recipientDisplayName: recipientAlias.displayName,
    })
    .from(payments)
    .innerJoin(payerAlias, eq(payments.payerId, payerAlias.id))
    .innerJoin(recipientAlias, eq(payments.recipientId, recipientAlias.id))
    .where(eq(payments.sessionId, sessionId))
    .orderBy(desc(payments.paymentDate), desc(payments.createdAt));

  return rows.map((r) =>
    toDto(
      r.payment,
      { publicId: r.payerPublicId, displayName: r.payerDisplayName },
      { publicId: r.recipientPublicId, displayName: r.recipientDisplayName },
    ),
  );
}

/** Updates a payment. Enforces optimistic concurrency via `expectedRevision`. */
export async function updatePayment(
  tx: Tx,
  session: SessionRef,
  publicId: string,
  input: PaymentInput,
  expectedRevision: number,
): Promise<PaymentDto> {
  if (input.payerPublicId === input.recipientPublicId) {
    throw new ValidationError({ field: "recipientPublicId", code: "SAME_PARTICIPANT" });
  }
  const note = validateNote(input.note);
  const payer = await resolveParticipant(tx, session.id, input.payerPublicId, "payerPublicId");
  const recipient = await resolveParticipant(tx, session.id, input.recipientPublicId, "recipientPublicId");
  const money = parseMoneyInput(session, input.currencyCode, input.amountText, input.rateText, input.rateDirection);

  const [row] = await tx
    .update(payments)
    .set({
      amountMinor: money.amountMinor,
      currencyCode: input.currencyCode,
      rateText: money.rateText,
      rateDirection: money.rateDirection,
      rateNum: money.rateNum,
      rateDen: money.rateDen,
      baseAmountMinor: money.baseAmountMinor,
      payerId: payer.id,
      recipientId: recipient.id,
      paymentDate: input.paymentDate,
      note,
      revision: sql`${payments.revision} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(payments.publicId, publicId), eq(payments.sessionId, session.id), eq(payments.revision, expectedRevision)))
    .returning();

  if (!row) {
    const current = await getPayment(tx, session.id, publicId);
    throw new ConflictError("Payment has been modified", current);
  }

  const payerRef = { publicId: payer.publicId, displayName: payer.displayName };
  const recipientRef = { publicId: recipient.publicId, displayName: recipient.displayName };

  await recordRevision(tx, {
    sessionId: session.id,
    entityType: "payment",
    entityId: row.id,
    revisionNo: row.revision,
    action: "updated",
    snapshot: toSnapshot(row, payerRef, recipientRef),
  });

  return toDto(row, payerRef, recipientRef);
}

/**
 * Deletes a payment. Enforces optimistic concurrency; snapshots the last known state.
 *
 * Performs the guarded `DELETE ... RETURNING *` first (no pre-read), then a single query for
 * the payer/recipient display names. Row exists with a different revision -> `ConflictError`
 * with the current state; row absent entirely -> `NotFoundError`.
 */
export async function deletePayment(
  tx: Tx,
  session: SessionRef,
  publicId: string,
  expectedRevision: number,
): Promise<void> {
  const [row] = await tx
    .delete(payments)
    .where(and(eq(payments.publicId, publicId), eq(payments.sessionId, session.id), eq(payments.revision, expectedRevision)))
    .returning();

  if (!row) {
    const [existing] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.sessionId, session.id), eq(payments.publicId, publicId)))
      .limit(1);
    if (!existing) {
      throw new NotFoundError(`Payment not found: ${publicId}`);
    }
    const current = await loadDto(tx, existing);
    throw new ConflictError("Payment has been modified", current);
  }

  const nameRows = await tx
    .select({ id: participants.id, publicId: participants.publicId, displayName: participants.displayName })
    .from(participants)
    .where(inArray(participants.id, [...new Set([row.payerId, row.recipientId])]));
  const byId = new Map(nameRows.map((n) => [n.id, n]));
  const payerRef = { publicId: byId.get(row.payerId)!.publicId, displayName: byId.get(row.payerId)!.displayName };
  const recipientRef = { publicId: byId.get(row.recipientId)!.publicId, displayName: byId.get(row.recipientId)!.displayName };

  await recordRevision(tx, {
    sessionId: session.id,
    entityType: "payment",
    entityId: row.id,
    revisionNo: row.revision + 1,
    action: "deleted",
    snapshot: toSnapshot(row, payerRef, recipientRef),
  });
}
