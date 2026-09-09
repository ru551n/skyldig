import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias, union } from "drizzle-orm/pg-core";

import type { DbOrTx, Tx } from "../auth/browser-session.ts";
import { expenseParticipants, expenses, participants, payments } from "../../db/schema.ts";
import { generatePublicId } from "../shared/ids.ts";
import { bigintToString } from "../shared/serialize.ts";
import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.ts";
import { recordRevision } from "../audit/audit.ts";
import {
  DomainError,
  convertToBase,
  parseAmount,
  parseRate,
  splitEqually,
  type RateDirection,
} from "../../../domain/index.ts";

export type { RateDirection };

export interface ExpenseInput {
  description: string;
  amountText: string;
  currencyCode: string;
  rateText?: string;
  rateDirection?: RateDirection;
  payerPublicId: string;
  participantPublicIds: string[];
  expenseDate: string;
  note?: string;
}

export interface ExpenseParticipantDto {
  publicId: string;
  displayName: string;
  shareBaseMinor: bigint;
}

export interface ExpenseDto {
  publicId: string;
  description: string;
  amountMinor: bigint;
  currencyCode: string;
  rateText: string | null;
  rateDirection: RateDirection | null;
  baseCurrencyCode: string;
  baseAmountMinor: bigint;
  payer: { publicId: string; displayName: string };
  participants: ExpenseParticipantDto[];
  expenseDate: string;
  note: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRef {
  id: bigint;
  baseCurrency: string;
}

function wrapDomain<T>(fn: () => T, field?: string): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DomainError) {
      throw new ValidationError({ field, code: err.code, message: err.message });
    }
    throw err;
  }
}

function validateDescription(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    throw new ValidationError({ field: "description", code: "INVALID_DESCRIPTION" });
  }
  return trimmed;
}

function validateNote(note: string | undefined): string | null {
  if (note === undefined || note === null || note === "") return null;
  if (note.length > 500) {
    throw new ValidationError({ field: "note", code: "NOTE_TOO_LONG" });
  }
  return note;
}

interface ResolvedParticipant {
  id: bigint;
  publicId: string;
  displayName: string;
  position: number;
}

async function resolveParticipant(
  tx: DbOrTx,
  sessionId: bigint,
  publicId: string,
): Promise<ResolvedParticipant> {
  const [row] = await tx
    .select({
      id: participants.id,
      publicId: participants.publicId,
      displayName: participants.displayName,
      position: participants.position,
    })
    .from(participants)
    .where(and(eq(participants.sessionId, sessionId), eq(participants.publicId, publicId)))
    .limit(1);
  if (!row) {
    throw new ValidationError({ field: "participantPublicIds", code: "UNKNOWN_PARTICIPANT" });
  }
  return row;
}

async function resolveParticipants(
  tx: DbOrTx,
  sessionId: bigint,
  publicIds: string[],
): Promise<ResolvedParticipant[]> {
  if (publicIds.length === 0) {
    throw new ValidationError({ field: "participantPublicIds", code: "EMPTY_PARTICIPANTS" });
  }
  const unique = new Set(publicIds);
  if (unique.size !== publicIds.length) {
    throw new ValidationError({ field: "participantPublicIds", code: "DUPLICATE_PARTICIPANT" });
  }
  const rows = await tx
    .select({
      id: participants.id,
      publicId: participants.publicId,
      displayName: participants.displayName,
      position: participants.position,
    })
    .from(participants)
    .where(and(eq(participants.sessionId, sessionId), inArray(participants.publicId, publicIds)));
  if (rows.length !== publicIds.length) {
    throw new ValidationError({ field: "participantPublicIds", code: "UNKNOWN_PARTICIPANT" });
  }
  return rows;
}

interface ParsedMoney {
  amountMinor: bigint;
  rateText: string | null;
  rateDirection: RateDirection | null;
  rateNum: bigint | null;
  rateDen: bigint | null;
  baseAmountMinor: bigint;
}

/** Shared amount/rate parsing + conversion logic for expenses and payments. */
export function parseMoneyInput(
  session: SessionRef,
  currencyCode: string,
  amountText: string,
  rateText: string | undefined,
  rateDirection: RateDirection | undefined,
): ParsedMoney {
  const amountMinor = wrapDomain(() => parseAmount(amountText, currencyCode), "amountText");

  if (currencyCode === session.baseCurrency) {
    return { amountMinor, rateText: null, rateDirection: null, rateNum: null, rateDen: null, baseAmountMinor: amountMinor };
  }

  if (!rateText || !rateDirection) {
    throw new ValidationError({ field: "rateText", code: "RATE_REQUIRED" });
  }
  const rate = wrapDomain(() => parseRate(rateText, rateDirection), "rateText");
  const baseAmountMinor = wrapDomain(
    () => convertToBase({ amountMinor, currency: currencyCode }, session.baseCurrency, rate),
    "amountText",
  );
  return {
    amountMinor,
    rateText: rate.text,
    rateDirection: rate.direction,
    rateNum: rate.num,
    rateDen: rate.den,
    baseAmountMinor,
  };
}

function toSnapshot(row: typeof expenses.$inferSelect, payer: { publicId: string; displayName: string }, parts: ExpenseParticipantDto[]) {
  return {
    publicId: row.publicId,
    description: row.description,
    amountMinor: bigintToString(row.amountMinor),
    currencyCode: row.currencyCode,
    rateText: row.rateText,
    rateDirection: row.rateDirection,
    baseAmountMinor: bigintToString(row.baseAmountMinor),
    expenseDate: row.expenseDate,
    note: row.note,
    payer,
    participants: parts.map((p) => ({ publicId: p.publicId, displayName: p.displayName, shareBaseMinor: bigintToString(p.shareBaseMinor) })),
  };
}

function toDto(
  row: typeof expenses.$inferSelect,
  payer: { publicId: string; displayName: string },
  parts: ExpenseParticipantDto[],
): ExpenseDto {
  return {
    publicId: row.publicId,
    description: row.description,
    amountMinor: row.amountMinor,
    currencyCode: row.currencyCode,
    rateText: row.rateText,
    rateDirection: row.rateDirection as RateDirection | null,
    baseCurrencyCode: row.baseCurrencyCode,
    baseAmountMinor: row.baseAmountMinor,
    payer,
    participants: parts,
    expenseDate: row.expenseDate,
    note: row.note,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function insertShares(
  tx: Tx,
  sessionId: bigint,
  expenseId: bigint,
  baseAmountMinor: bigint,
  resolved: ResolvedParticipant[],
): Promise<ExpenseParticipantDto[]> {
  const shares = wrapDomain(
    () => splitEqually(baseAmountMinor, resolved.map((p) => ({ id: p.publicId, position: p.position }))),
    "participantPublicIds",
  );
  const byPublicId = new Map(resolved.map((p) => [p.publicId, p]));
  const rows = shares.map((s) => {
    const p = byPublicId.get(s.id)!;
    return {
      expenseId,
      sessionId,
      participantId: p.id,
      weightScaled: 1_000_000n,
      shareBaseMinor: s.share,
    };
  });
  await tx.insert(expenseParticipants).values(rows);

  const orderByPosition = new Map(resolved.map((p) => [p.publicId, p.position]));
  return shares
    .map((s) => ({ publicId: s.id, displayName: byPublicId.get(s.id)!.displayName, shareBaseMinor: s.share }))
    .sort((a, b) => orderByPosition.get(a.publicId)! - orderByPosition.get(b.publicId)!);
}

/** Creates an expense: resolves participants, converts to base currency, splits equally. */
export async function createExpense(tx: Tx, session: SessionRef, input: ExpenseInput): Promise<ExpenseDto> {
  const description = validateDescription(input.description);
  const note = validateNote(input.note);
  const payer = await resolveParticipant(tx, session.id, input.payerPublicId);
  const resolvedParticipants = await resolveParticipants(tx, session.id, input.participantPublicIds);
  const money = parseMoneyInput(session, input.currencyCode, input.amountText, input.rateText, input.rateDirection);

  const [row] = await tx
    .insert(expenses)
    .values({
      publicId: generatePublicId(),
      sessionId: session.id,
      description,
      amountMinor: money.amountMinor,
      currencyCode: input.currencyCode,
      baseCurrencyCode: session.baseCurrency,
      rateText: money.rateText,
      rateDirection: money.rateDirection,
      rateNum: money.rateNum,
      rateDen: money.rateDen,
      baseAmountMinor: money.baseAmountMinor,
      splitMode: "equal",
      payerId: payer.id,
      expenseDate: input.expenseDate,
      note,
    })
    .returning();

  const parts = await insertShares(tx, session.id, row.id, money.baseAmountMinor, resolvedParticipants);
  const payerRef = { publicId: payer.publicId, displayName: payer.displayName };

  await recordRevision(tx, {
    sessionId: session.id,
    entityType: "expense",
    entityId: row.id,
    revisionNo: 1,
    action: "created",
    snapshot: toSnapshot(row, payerRef, parts),
  });

  return toDto(row, payerRef, parts);
}

/** Fetches an expense with payer and participant shares, or throws `NotFoundError`. */
export async function getExpense(db: DbOrTx, sessionId: bigint, publicId: string): Promise<ExpenseDto> {
  const [row] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.sessionId, sessionId), eq(expenses.publicId, publicId)))
    .limit(1);
  if (!row) {
    throw new NotFoundError(`Expense not found: ${publicId}`);
  }
  return loadDto(db, row);
}

async function loadDto(db: DbOrTx, row: typeof expenses.$inferSelect): Promise<ExpenseDto> {
  const [payerRow] = await db
    .select({ publicId: participants.publicId, displayName: participants.displayName })
    .from(participants)
    .where(eq(participants.id, row.payerId))
    .limit(1);

  const shareRows = await db
    .select({
      publicId: participants.publicId,
      displayName: participants.displayName,
      shareBaseMinor: expenseParticipants.shareBaseMinor,
      position: participants.position,
    })
    .from(expenseParticipants)
    .innerJoin(participants, eq(expenseParticipants.participantId, participants.id))
    .where(eq(expenseParticipants.expenseId, row.id))
    .orderBy(asc(participants.position));

  const parts: ExpenseParticipantDto[] = shareRows.map((r) => ({
    publicId: r.publicId,
    displayName: r.displayName,
    shareBaseMinor: r.shareBaseMinor,
  }));

  return toDto(row, payerRow!, parts);
}

/**
 * Lists expenses newest expense date first, then newest created first.
 *
 * Two queries total regardless of row count: one for the expense rows joined to their payer's
 * name, and one for every `expense_participants` row of those expenses joined to participant
 * names — assembled together in memory. (Previously this called `loadDto` per row, i.e.
 * 2-3 queries per expense.)
 */
export async function listExpenses(db: DbOrTx, sessionId: bigint): Promise<ExpenseDto[]> {
  const payerAlias = alias(participants, "payer");
  const rows = await db
    .select({
      expense: expenses,
      payerPublicId: payerAlias.publicId,
      payerDisplayName: payerAlias.displayName,
    })
    .from(expenses)
    .innerJoin(payerAlias, eq(expenses.payerId, payerAlias.id))
    .where(eq(expenses.sessionId, sessionId))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));

  if (rows.length === 0) return [];

  const expenseIds = rows.map((r) => r.expense.id);
  const shareRows = await db
    .select({
      expenseId: expenseParticipants.expenseId,
      publicId: participants.publicId,
      displayName: participants.displayName,
      shareBaseMinor: expenseParticipants.shareBaseMinor,
      position: participants.position,
    })
    .from(expenseParticipants)
    .innerJoin(participants, eq(expenseParticipants.participantId, participants.id))
    .where(inArray(expenseParticipants.expenseId, expenseIds))
    .orderBy(asc(participants.position));

  const sharesByExpenseId = new Map<bigint, ExpenseParticipantDto[]>();
  for (const s of shareRows) {
    const list = sharesByExpenseId.get(s.expenseId) ?? [];
    list.push({ publicId: s.publicId, displayName: s.displayName, shareBaseMinor: s.shareBaseMinor });
    sharesByExpenseId.set(s.expenseId, list);
  }

  return rows.map((r) =>
    toDto(
      r.expense,
      { publicId: r.payerPublicId, displayName: r.payerDisplayName },
      sharesByExpenseId.get(r.expense.id) ?? [],
    ),
  );
}

/** Updates an expense, re-deriving shares. Enforces optimistic concurrency. */
export async function updateExpense(
  tx: Tx,
  session: SessionRef,
  publicId: string,
  input: ExpenseInput,
  expectedRevision: number,
): Promise<ExpenseDto> {
  const description = validateDescription(input.description);
  const note = validateNote(input.note);
  const payer = await resolveParticipant(tx, session.id, input.payerPublicId);
  const resolvedParticipants = await resolveParticipants(tx, session.id, input.participantPublicIds);
  const money = parseMoneyInput(session, input.currencyCode, input.amountText, input.rateText, input.rateDirection);

  const [row] = await tx
    .update(expenses)
    .set({
      description,
      amountMinor: money.amountMinor,
      currencyCode: input.currencyCode,
      rateText: money.rateText,
      rateDirection: money.rateDirection,
      rateNum: money.rateNum,
      rateDen: money.rateDen,
      baseAmountMinor: money.baseAmountMinor,
      payerId: payer.id,
      expenseDate: input.expenseDate,
      note,
      revision: sql`${expenses.revision} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(expenses.publicId, publicId), eq(expenses.sessionId, session.id), eq(expenses.revision, expectedRevision)))
    .returning();

  if (!row) {
    const current = await getExpense(tx, session.id, publicId);
    throw new ConflictError("Expense has been modified", current);
  }

  await tx.delete(expenseParticipants).where(eq(expenseParticipants.expenseId, row.id));
  const parts = await insertShares(tx, session.id, row.id, money.baseAmountMinor, resolvedParticipants);
  const payerRef = { publicId: payer.publicId, displayName: payer.displayName };

  await recordRevision(tx, {
    sessionId: session.id,
    entityType: "expense",
    entityId: row.id,
    revisionNo: row.revision,
    action: "updated",
    snapshot: toSnapshot(row, payerRef, parts),
  });

  return toDto(row, payerRef, parts);
}

/**
 * Deletes an expense. Enforces optimistic concurrency; snapshots the last known state.
 *
 * Performs the guarded `DELETE ... RETURNING *` first (no pre-read): `expense_participants`
 * rows for this expense are deleted in the same guarded statement shape (matched via the same
 * publicId/sessionId/revision predicate on `expenses`), *before* the expense row itself, so
 * their content is captured instead of being silently lost to the `ON DELETE CASCADE` that
 * would otherwise fire when the expense row is deleted. If the guard doesn't match anything
 * (revision mismatch or the row is already gone), nothing is deleted by either statement.
 *
 * Then: row exists with a different revision -> `ConflictError` with the current state (one
 * query, via `loadDto`); row absent entirely -> `NotFoundError`.
 */
export async function deleteExpense(
  tx: Tx,
  session: SessionRef,
  publicId: string,
  expectedRevision: number,
): Promise<void> {
  const guard = sql`${expenseParticipants.expenseId} = (
    select ${expenses.id} from ${expenses}
    where ${expenses.publicId} = ${publicId} and ${expenses.sessionId} = ${session.id} and ${expenses.revision} = ${expectedRevision}
  )`;
  const deletedShares = await tx.delete(expenseParticipants).where(guard).returning();

  const [row] = await tx
    .delete(expenses)
    .where(and(eq(expenses.publicId, publicId), eq(expenses.sessionId, session.id), eq(expenses.revision, expectedRevision)))
    .returning();

  if (!row) {
    const [existing] = await tx
      .select()
      .from(expenses)
      .where(and(eq(expenses.sessionId, session.id), eq(expenses.publicId, publicId)))
      .limit(1);
    if (!existing) {
      throw new NotFoundError(`Expense not found: ${publicId}`);
    }
    const current = await loadDto(tx, existing);
    throw new ConflictError("Expense has been modified", current);
  }

  const idsToName = [...new Set([row.payerId, ...deletedShares.map((s) => s.participantId)])];
  const nameRows =
    idsToName.length > 0
      ? await tx
          .select({ id: participants.id, publicId: participants.publicId, displayName: participants.displayName, position: participants.position })
          .from(participants)
          .where(inArray(participants.id, idsToName))
      : [];
  const byId = new Map(nameRows.map((n) => [n.id, n]));

  const payerRef = { publicId: byId.get(row.payerId)!.publicId, displayName: byId.get(row.payerId)!.displayName };
  const parts: ExpenseParticipantDto[] = deletedShares
    .map((s) => {
      const p = byId.get(s.participantId)!;
      return { publicId: p.publicId, displayName: p.displayName, shareBaseMinor: s.shareBaseMinor, position: p.position };
    })
    .sort((a, b) => a.position - b.position)
    .map(({ position: _position, ...rest }) => rest);

  await recordRevision(tx, {
    sessionId: session.id,
    entityType: "expense",
    entityId: row.id,
    revisionNo: row.revision + 1,
    action: "deleted",
    snapshot: toSnapshot(row, payerRef, parts),
  });
}

/**
 * Returns the most recently used rate for `currencyCode` in this session, across both expenses
 * and payments (a repayment can just as well set the going rate as an expense can).
 */
export async function suggestRate(
  db: DbOrTx,
  sessionId: bigint,
  currencyCode: string,
): Promise<{ rateText: string; rateDirection: RateDirection } | null> {
  const fromExpenses = db
    .select({
      rateText: expenses.rateText,
      rateDirection: expenses.rateDirection,
      updatedAt: expenses.updatedAt,
      publicId: expenses.publicId,
    })
    .from(expenses)
    .where(and(eq(expenses.sessionId, sessionId), eq(expenses.currencyCode, currencyCode), sql`${expenses.rateText} is not null`));
  const fromPayments = db
    .select({
      rateText: payments.rateText,
      rateDirection: payments.rateDirection,
      updatedAt: payments.updatedAt,
      publicId: payments.publicId,
    })
    .from(payments)
    .where(and(eq(payments.sessionId, sessionId), eq(payments.currencyCode, currencyCode), sql`${payments.rateText} is not null`));

  // Secondary ordering by public_id descending makes the suggestion deterministic
  // when two rows share the same updated_at timestamp.
  const [row] = await union(fromExpenses, fromPayments)
    .orderBy(desc(sql`updated_at`), desc(sql`public_id`))
    .limit(1);
  if (!row) return null;
  return { rateText: row.rateText!, rateDirection: row.rateDirection as RateDirection };
}
