import { eq } from "drizzle-orm";

import type { DbOrTx } from "../auth/browser-session.ts";
import { expenseParticipants, expenses, participants, payments } from "../../db/schema.ts";
import { computeBalances, settle } from "../../../domain/index.ts";
import type { SessionRef } from "../expenses/expenses.ts";

export interface BalanceEntry {
  publicId: string;
  displayName: string;
  paid: bigint;
  share: bigint;
  repaid: bigint;
  received: bigint;
  net: bigint;
}

export interface TransferEntry {
  from: { publicId: string; displayName: string };
  to: { publicId: string; displayName: string };
  amountMinor: bigint;
}

export interface SessionBalances {
  baseCurrency: string;
  balances: BalanceEntry[];
  transfers: TransferEntry[];
}

/**
 * Computes every participant's net balance and a suggested set of settling
 * transfers for a session, using the pure domain `computeBalances`/`settle`
 * functions over the session's participants, expenses (with shares) and
 * payments.
 */
export async function getSessionBalances(db: DbOrTx, session: SessionRef): Promise<SessionBalances> {
  const participantRows = await db
    .select({
      id: participants.id,
      publicId: participants.publicId,
      displayName: participants.displayName,
      position: participants.position,
    })
    .from(participants)
    .where(eq(participants.sessionId, session.id))
    .orderBy(participants.position);

  const byId = new Map(participantRows.map((p) => [p.id, p]));
  const publicIds = participantRows.map((p) => p.publicId);
  const byPublicId = new Map(participantRows.map((p) => [p.publicId, p]));

  const expenseRows = await db
    .select({ id: expenses.id, payerId: expenses.payerId, baseAmountMinor: expenses.baseAmountMinor })
    .from(expenses)
    .where(eq(expenses.sessionId, session.id));

  const shareRows = await db
    .select({
      expenseId: expenseParticipants.expenseId,
      participantId: expenseParticipants.participantId,
      shareBaseMinor: expenseParticipants.shareBaseMinor,
    })
    .from(expenseParticipants)
    .where(eq(expenseParticipants.sessionId, session.id));

  const sharesByExpense = new Map<bigint, { participantId: string; shareBaseMinor: bigint }[]>();
  for (const s of shareRows) {
    const participant = byId.get(s.participantId);
    if (!participant) continue;
    const list = sharesByExpense.get(s.expenseId) ?? [];
    list.push({ participantId: participant.publicId, shareBaseMinor: s.shareBaseMinor });
    sharesByExpense.set(s.expenseId, list);
  }

  const expensesForBalance = expenseRows.map((e) => ({
    payerId: byId.get(e.payerId)!.publicId,
    baseAmountMinor: e.baseAmountMinor,
    shares: sharesByExpense.get(e.id) ?? [],
  }));

  const paymentRows = await db
    .select({ payerId: payments.payerId, recipientId: payments.recipientId, baseAmountMinor: payments.baseAmountMinor })
    .from(payments)
    .where(eq(payments.sessionId, session.id));

  const paymentsForBalance = paymentRows.map((p) => ({
    payerId: byId.get(p.payerId)!.publicId,
    recipientId: byId.get(p.recipientId)!.publicId,
    baseAmountMinor: p.baseAmountMinor,
  }));

  const balanceMap = computeBalances(publicIds, expensesForBalance, paymentsForBalance);

  const balances: BalanceEntry[] = participantRows.map((p) => {
    const b = balanceMap.get(p.publicId)!;
    return {
      publicId: p.publicId,
      displayName: p.displayName,
      paid: b.paid,
      share: b.share,
      repaid: b.repaid,
      received: b.received,
      net: b.net,
    };
  });

  const nets = participantRows.map((p) => ({
    participantId: p.publicId,
    position: p.position,
    net: balanceMap.get(p.publicId)!.net,
  }));

  const rawTransfers = settle(nets);
  const transfers: TransferEntry[] = rawTransfers.map((t) => ({
    from: { publicId: t.from, displayName: byPublicId.get(t.from)!.displayName },
    to: { publicId: t.to, displayName: byPublicId.get(t.to)!.displayName },
    amountMinor: t.amountMinor,
  }));

  return { baseCurrency: session.baseCurrency, balances, transfers };
}
