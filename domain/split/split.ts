import { DomainError } from "../errors.ts";

/** A participant to split an amount across. */
export interface SplitParticipant {
  id: string;
  position: number;
  weight?: bigint;
}

/** A participant's computed share of a split total. */
export interface SplitShare {
  id: string;
  share: bigint;
}

function comparePosition(a: SplitParticipant, b: SplitParticipant): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Splits `total` across `participants` using largest-remainder (Hamilton)
 * apportionment: `share_i = floor(total * w_i / sumWeights)`, and the
 * leftover units (`total - sum(floor shares)`) are distributed one each to
 * the participants with the largest fractional remainders
 * (`(total * w_i) mod sumWeights`, compared as bigint), ties broken by
 * `position` ascending then `id` ascending.
 *
 * Output is always ordered by `position` ascending then `id` ascending,
 * regardless of input order. Guarantees `sum(shares) === total`.
 *
 * Throws `EMPTY_SPLIT` for an empty participant list, `INVALID_AMOUNT` for
 * a non-positive total, or a non-positive weight.
 */
export function splitAmount(total: bigint, participants: SplitParticipant[]): SplitShare[] {
  if (participants.length === 0) {
    throw new DomainError("EMPTY_SPLIT", "Cannot split among zero participants");
  }
  if (total <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Split total must be positive");
  }

  const normalized = participants.map((p) => ({
    id: p.id,
    position: p.position,
    weight: p.weight ?? 1n,
  }));

  for (const p of normalized) {
    if (p.weight <= 0n) {
      throw new DomainError("INVALID_AMOUNT", `Weight for participant ${p.id} must be positive`);
    }
  }

  const sumWeights = normalized.reduce((acc, p) => acc + p.weight, 0n);

  const withRemainders = normalized.map((p) => {
    const product = total * p.weight;
    return {
      id: p.id,
      position: p.position,
      floorShare: product / sumWeights,
      remainder: product % sumWeights,
    };
  });

  const sumFloor = withRemainders.reduce((acc, p) => acc + p.floorShare, 0n);
  let leftover = total - sumFloor;

  const byRemainderDesc = [...withRemainders].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const bonus = new Map<string, bigint>();
  for (const p of byRemainderDesc) {
    if (leftover <= 0n) break;
    bonus.set(p.id, 1n);
    leftover -= 1n;
  }

  const result = withRemainders.map((p) => ({
    id: p.id,
    position: p.position,
    share: p.floorShare + (bonus.get(p.id) ?? 0n),
  }));

  result.sort(comparePosition);
  return result.map(({ id, share }) => ({ id, share }));
}

/**
 * Convenience wrapper for an equal-weight split: `floor`, then `+1` to the
 * first `total mod n` participants in position order.
 */
export function splitEqually(total: bigint, ids: { id: string; position: number }[]): SplitShare[] {
  return splitAmount(
    total,
    ids.map((p) => ({ id: p.id, position: p.position, weight: 1n })),
  );
}
