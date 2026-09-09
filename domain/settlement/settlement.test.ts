import { describe, expect, it } from "vitest";

import { DomainError } from "../errors.ts";
import { applyTransfers, settle, type NetPosition } from "./settlement.ts";

/** Deterministic seeded PRNG (mulberry32); no external dependency needed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectDomainError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable("expected to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
  }
}

describe("settle", () => {
  it("throws UNBALANCED when nets don't sum to zero", () => {
    expectDomainError(() => settle([{ participantId: "a", position: 0, net: 5n }]), "UNBALANCED");
  });

  it("returns no transfers for all-zero nets", () => {
    expect(
      settle([
        { participantId: "a", position: 0, net: 0n },
        { participantId: "b", position: 1, net: 0n },
      ]),
    ).toEqual([]);
  });

  it("A:-100 B:+100 -> a single transfer", () => {
    const nets: NetPosition[] = [
      { participantId: "a", position: 0, net: -100n },
      { participantId: "b", position: 1, net: 100n },
    ];
    expect(settle(nets)).toEqual([{ from: "a", to: "b", amountMinor: 100n }]);
  });

  it("pre-pass value case: credits {A:+5,B:+4} debts {C:-4,D:-3,E:-2} -> exactly 3 transfers", () => {
    const nets: NetPosition[] = [
      { participantId: "A", position: 0, net: 5n },
      { participantId: "B", position: 1, net: 4n },
      { participantId: "C", position: 2, net: -4n },
      { participantId: "D", position: 3, net: -3n },
      { participantId: "E", position: 4, net: -2n },
    ];
    const transfers = settle(nets);
    expect(transfers.length).toBe(3);
    const applied = applyTransfers(nets, transfers);
    for (const n of applied) expect(n.net).toBe(0n);
  });

  it("iterated pre-pass: two independent exact matches both resolve across passes", () => {
    // Each while-iteration of the pre-pass resolves exactly one exact match
    // and restarts; this exercises that the loop keeps going until BOTH
    // A-C and B-D are found, rather than stopping after the first pass.
    const nets: NetPosition[] = [
      { participantId: "A", position: 0, net: -10n },
      { participantId: "B", position: 1, net: -3n },
      { participantId: "C", position: 2, net: 10n },
      { participantId: "D", position: 3, net: 3n },
    ];
    const transfers = settle(nets);
    expect(transfers).toEqual([
      { from: "A", to: "C", amountMinor: 10n },
      { from: "B", to: "D", amountMinor: 3n },
    ]);
  });

  it("ties: {A:+50,B:+50,C:-50,D:-50} -> 2 transfers, pairing fixed by position", () => {
    const nets: NetPosition[] = [
      { participantId: "A", position: 0, net: 50n },
      { participantId: "B", position: 1, net: 50n },
      { participantId: "C", position: 2, net: -50n },
      { participantId: "D", position: 3, net: -50n },
    ];
    const transfers = settle(nets);
    expect(transfers).toEqual([
      { from: "C", to: "A", amountMinor: 50n },
      { from: "D", to: "B", amountMinor: 50n },
    ]);
  });

  it("one payer, many debtors -> n-1 transfers", () => {
    const nets: NetPosition[] = [
      { participantId: "P", position: 0, net: 100n },
      { participantId: "D1", position: 1, net: -10n },
      { participantId: "D2", position: 2, net: -20n },
      { participantId: "D3", position: 3, net: -30n },
      { participantId: "D4", position: 4, net: -40n },
    ];
    const transfers = settle(nets);
    expect(transfers.length).toBe(4); // n - 1, n = 5
    for (const t of transfers) expect(t.to).toBe("P");
    const applied = applyTransfers(nets, transfers);
    for (const n of applied) expect(n.net).toBe(0n);
  });

  it("handles large magnitudes near 10^15 * n", () => {
    const big = 10n ** 15n;
    const nets: NetPosition[] = [
      { participantId: "a", position: 0, net: big },
      { participantId: "b", position: 1, net: big },
      { participantId: "c", position: 2, net: -big },
      { participantId: "d", position: 3, net: -big },
    ];
    const transfers = settle(nets);
    const applied = applyTransfers(nets, transfers);
    for (const n of applied) expect(n.net).toBe(0n);
    for (const t of transfers) expect(t.amountMinor).toBeGreaterThan(0n);
  });

  it("is deterministic regardless of input order", () => {
    const nets: NetPosition[] = [
      { participantId: "A", position: 0, net: 5n },
      { participantId: "B", position: 1, net: 4n },
      { participantId: "C", position: 2, net: -4n },
      { participantId: "D", position: 3, net: -3n },
      { participantId: "E", position: 4, net: -2n },
    ];
    const shuffled = [nets[3]!, nets[1]!, nets[4]!, nets[0]!, nets[2]!];
    expect(settle(shuffled)).toEqual(settle(nets));
  });

  it("rejects duplicate participant ids", () => {
    const nets: NetPosition[] = [
      { participantId: "a", position: 0, net: -100n },
      { participantId: "a", position: 1, net: 100n },
    ];
    expectDomainError(() => settle(nets), "DUPLICATE_PARTICIPANT");
  });

  it("applyTransfers rejects duplicate participant ids", () => {
    const nets: NetPosition[] = [
      { participantId: "a", position: 0, net: -100n },
      { participantId: "a", position: 1, net: 100n },
    ];
    expectDomainError(() => applyTransfers(nets, []), "DUPLICATE_PARTICIPANT");
  });

  it("is deterministic when two participants share a position, regardless of input order", () => {
    const netsOrderA: NetPosition[] = [
      { participantId: "B", position: 0, net: 50n },
      { participantId: "A", position: 0, net: -50n },
    ];
    const netsOrderB: NetPosition[] = [
      { participantId: "A", position: 0, net: -50n },
      { participantId: "B", position: 0, net: 50n },
    ];
    const resultA = settle(netsOrderA);
    const resultB = settle(netsOrderB);
    expect(resultA).toEqual(resultB);
    expect(resultA).toEqual([{ from: "A", to: "B", amountMinor: 50n }]);
  });

  it("property: 500 random zero-sum vectors (n <= 20) fully settle deterministically", () => {
    const rand = mulberry32(99);
    for (let scenario = 0; scenario < 500; scenario++) {
      const n = 2 + Math.floor(rand() * 19);
      const nets: NetPosition[] = [];
      let sum = 0n;
      for (let i = 0; i < n - 1; i++) {
        const value = BigInt(Math.floor(rand() * 2000) - 1000);
        nets.push({ participantId: `p${i}`, position: i, net: value });
        sum += value;
      }
      nets.push({ participantId: `p${n - 1}`, position: n - 1, net: -sum });

      const transfers = settle(nets);
      expect(transfers.length).toBeLessThanOrEqual(n - 1);
      for (const t of transfers) {
        expect(t.amountMinor).toBeGreaterThan(0n);
        expect(t.from).not.toBe(t.to);
      }
      const applied = applyTransfers(nets, transfers);
      for (const n2 of applied) expect(n2.net).toBe(0n);
    }
  });

  it("property: 300 seeded zero-sum vectors (n <= 12, magnitudes spanning 1 to 10^15) settle deterministically", () => {
    const rand = mulberry32(20260909);

    /** A bigint magnitude roughly log-uniform between 1 and 10^15, so both tiny and huge nets appear. */
    function randomMagnitude(): bigint {
      const exponent = rand() * 15; // 0..15
      const scale = 10 ** exponent;
      const value = Math.max(1, Math.round(scale * (0.5 + rand())));
      return BigInt(value);
    }

    for (let scenario = 0; scenario < 300; scenario++) {
      const n = 2 + Math.floor(rand() * 11); // 2..12
      const nets: NetPosition[] = [];
      let sum = 0n;
      for (let i = 0; i < n - 1; i++) {
        const magnitude = randomMagnitude();
        const value = rand() < 0.5 ? magnitude : -magnitude;
        nets.push({ participantId: `p${i}`, position: i, net: value });
        sum += value;
      }
      nets.push({ participantId: `p${n - 1}`, position: n - 1, net: -sum });

      const transfers = settle(nets);
      expect(transfers.length).toBeLessThanOrEqual(n - 1);
      for (const t of transfers) {
        expect(t.amountMinor).toBeGreaterThan(0n);
        expect(t.from).not.toBe(t.to);
      }

      // Determinism: re-running on a shuffled copy of the same nets produces the same transfers.
      const shuffled = [...nets].sort(() => rand() - 0.5);
      expect(settle(shuffled)).toEqual(transfers);

      const applied = applyTransfers(nets, transfers);
      for (const n2 of applied) expect(n2.net).toBe(0n);
    }
  });

  it("property: exact-match chains of large, distinct magnitudes fully resolve via the pre-pass", () => {
    // Three independent exact-match pairs at very different scales, interleaved so the
    // pre-pass must iterate to a fixed point rather than resolving in a single scan.
    const nets: NetPosition[] = [
      { participantId: "A", position: 0, net: 1_000_000_000_000_000n },
      { participantId: "B", position: 1, net: -7n },
      { participantId: "C", position: 2, net: -1_000_000_000_000_000n },
      { participantId: "D", position: 3, net: 7n },
      { participantId: "E", position: 4, net: 250_000n },
      { participantId: "F", position: 5, net: -250_000n },
    ];
    const transfers = settle(nets);
    expect(transfers).toHaveLength(3);
    for (const t of transfers) {
      expect(t.amountMinor).toBeGreaterThan(0n);
      expect(t.from).not.toBe(t.to);
    }
    const applied = applyTransfers(nets, transfers);
    for (const n2 of applied) expect(n2.net).toBe(0n);
  });

  it("property: equal-magnitude ties across many participants settle deterministically and zero every net", () => {
    // Three debtors and three creditors all sharing the same magnitude (1e12): the tie-break
    // (position ascending, then id ascending) must produce a stable, fully-zeroing plan.
    const magnitude = 1_000_000_000_000n;
    const nets: NetPosition[] = [
      { participantId: "D0", position: 0, net: -magnitude },
      { participantId: "D1", position: 1, net: -magnitude },
      { participantId: "D2", position: 2, net: -magnitude },
      { participantId: "C0", position: 3, net: magnitude },
      { participantId: "C1", position: 4, net: magnitude },
      { participantId: "C2", position: 5, net: magnitude },
    ];
    const transfers1 = settle(nets);
    const transfers2 = settle([...nets].reverse());
    expect(transfers1).toEqual(transfers2);
    expect(transfers1).toHaveLength(3);
    for (const t of transfers1) {
      expect(t.amountMinor).toBe(magnitude);
      expect(t.from).not.toBe(t.to);
    }
    const applied = applyTransfers(nets, transfers1);
    for (const n2 of applied) expect(n2.net).toBe(0n);
  });
});
