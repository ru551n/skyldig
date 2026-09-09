import { DomainError } from "../errors.ts";
import { assertNoDuplicateIds } from "../split/split.ts";

/** An expense, already converted to base currency, with its per-participant shares. */
export interface ExpenseForBalance {
  payerId: string;
  baseAmountMinor: bigint;
  shares: { participantId: string; shareBaseMinor: bigint }[];
}

/** A payment (repayment) between two participants, in base currency. */
export interface PaymentForBalance {
  payerId: string;
  recipientId: string;
  baseAmountMinor: bigint;
}

/** A participant's running balance in base currency minor units. */
export interface ParticipantBalance {
  participantId: string;
  paid: bigint;
  share: bigint;
  repaid: bigint;
  received: bigint;
  net: bigint;
}

function ensureKnown(participantIds: Set<string>, id: string, context: string): void {
  if (!participantIds.has(id)) {
    throw new DomainError("INVALID_AMOUNT", `Unknown participant "${id}" referenced in ${context}`);
  }
}

/**
 * Computes each participant's balance: `net = paid - share + repaid - received`.
 * Positive `net` means the participant is owed money.
 *
 * Participants with no activity get all-zero balances. Any expense share or
 * payment referencing a participant id not present in `participantIds`
 * throws, as does a duplicate id in `participantIds`
 * (`DUPLICATE_PARTICIPANT`) or an expense whose shares don't sum to its
 * `baseAmountMinor` (`EXPENSE_SHARES_MISMATCH`). Asserts (and returns only
 * if) the total balance across all participants is exactly zero.
 */
export function computeBalances(
  participantIds: string[],
  expenses: ExpenseForBalance[],
  payments: PaymentForBalance[],
): Map<string, ParticipantBalance> {
  assertNoDuplicateIds(participantIds);

  const known = new Set(participantIds);
  const balances = new Map<string, ParticipantBalance>();
  for (const id of participantIds) {
    balances.set(id, { participantId: id, paid: 0n, share: 0n, repaid: 0n, received: 0n, net: 0n });
  }

  expenses.forEach((expense, index) => {
    ensureKnown(known, expense.payerId, "an expense payer");
    const payerBalance = balances.get(expense.payerId)!;
    payerBalance.paid += expense.baseAmountMinor;

    let shareSum = 0n;
    for (const s of expense.shares) {
      ensureKnown(known, s.participantId, "an expense share");
      const shareBalance = balances.get(s.participantId)!;
      shareBalance.share += s.shareBaseMinor;
      shareSum += s.shareBaseMinor;
    }

    if (shareSum !== expense.baseAmountMinor) {
      throw new DomainError(
        "EXPENSE_SHARES_MISMATCH",
        `Expense ${index} (payer "${expense.payerId}"): shares sum to ${shareSum}, expected ${expense.baseAmountMinor}`,
      );
    }
  });

  for (const payment of payments) {
    ensureKnown(known, payment.payerId, "a payment payer");
    ensureKnown(known, payment.recipientId, "a payment recipient");
    balances.get(payment.payerId)!.repaid += payment.baseAmountMinor;
    balances.get(payment.recipientId)!.received += payment.baseAmountMinor;
  }

  for (const balance of balances.values()) {
    balance.net = balance.paid - balance.share + balance.repaid - balance.received;
  }

  assertBalanced(balances);
  return balances;
}

/** Throws `UNBALANCED` unless the sum of all `net` balances is exactly 0. */
export function assertBalanced(balances: Map<string, ParticipantBalance>): void {
  let sum = 0n;
  for (const balance of balances.values()) {
    sum += balance.net;
  }
  if (sum !== 0n) {
    throw new DomainError("UNBALANCED", `Balances do not sum to zero (sum = ${sum})`);
  }
}
