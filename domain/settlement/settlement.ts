import { DomainError } from "../errors.ts";

/** A participant's net balance to be settled (positive = owed money). */
export interface NetPosition {
  participantId: string;
  position: number;
  net: bigint;
}

/** A suggested transfer of `amountMinor` from one participant to another. */
export interface Transfer {
  from: string;
  to: string;
  amountMinor: bigint;
}

interface Node {
  participantId: string;
  position: number;
  amount: bigint; // always positive: |debt| for debtors, credit for creditors
}

/** Sorts in place: largest amount first, ties broken by position ascending. */
function sortDesc(nodes: Node[]): void {
  nodes.sort((a, b) => {
    if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
    return a.position - b.position;
  });
}

/**
 * Produces a minimal, deterministic set of transfers that zeroes every net
 * balance.
 *
 * 1. Exact-match pre-pass, iterated to a fixed point: scan debtors sorted
 *    by (|amount| desc, position asc); for the first debtor whose debt
 *    exactly equals some creditor's credit (creditors sorted the same way,
 *    first exact match wins), pair them and restart the scan — pairing off
 *    one exact match can expose another.
 * 2. Greedy: repeatedly take the single largest remaining debtor and the
 *    single largest remaining creditor (ties by position ascending),
 *    transfer `min(debt, credit)`, and drop whichever side reaches zero.
 *
 * Zero nets are ignored. Throws `UNBALANCED` if the nets don't sum to zero.
 * Output order is the order transfers were produced in.
 */
export function settle(nets: NetPosition[]): Transfer[] {
  const sum = nets.reduce((acc, n) => acc + n.net, 0n);
  if (sum !== 0n) {
    throw new DomainError("UNBALANCED", `Net positions do not sum to zero (sum = ${sum})`);
  }

  const debtors: Node[] = nets
    .filter((n) => n.net < 0n)
    .map((n) => ({ participantId: n.participantId, position: n.position, amount: -n.net }));
  const creditors: Node[] = nets
    .filter((n) => n.net > 0n)
    .map((n) => ({ participantId: n.participantId, position: n.position, amount: n.net }));

  const transfers: Transfer[] = [];

  // Step 1: exact-match pre-pass, iterated to a fixed point.
  let changed = true;
  while (changed) {
    changed = false;
    sortDesc(debtors);
    sortDesc(creditors);
    for (let i = 0; i < debtors.length; i++) {
      const debtor = debtors[i]!;
      const creditorIndex = creditors.findIndex((c) => c.amount === debtor.amount);
      if (creditorIndex === -1) continue;
      const creditor = creditors[creditorIndex]!;
      transfers.push({ from: debtor.participantId, to: creditor.participantId, amountMinor: debtor.amount });
      debtors.splice(i, 1);
      creditors.splice(creditorIndex, 1);
      changed = true;
      break;
    }
  }

  // Step 2: greedy largest-vs-largest.
  while (debtors.length > 0 && creditors.length > 0) {
    sortDesc(debtors);
    sortDesc(creditors);
    const debtor = debtors[0]!;
    const creditor = creditors[0]!;
    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;
    transfers.push({ from: debtor.participantId, to: creditor.participantId, amountMinor: amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0n) debtors.splice(0, 1);
    if (creditor.amount === 0n) creditors.splice(0, 1);
  }

  return transfers;
}

/**
 * Applies `transfers` to `nets` and returns a new array of net positions
 * (input is not mutated). Each transfer moves `amountMinor` from `from`'s
 * net (increasing it, toward/past zero) to `to`'s net (decreasing it).
 */
export function applyTransfers(nets: NetPosition[], transfers: Transfer[]): NetPosition[] {
  const result = nets.map((n) => ({ ...n }));
  const byId = new Map(result.map((n) => [n.participantId, n]));
  for (const t of transfers) {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (!from || !to) {
      throw new DomainError("UNBALANCED", `Transfer references unknown participant: ${t.from} -> ${t.to}`);
    }
    from.net += t.amountMinor;
    to.net -= t.amountMinor;
  }
  return result;
}
