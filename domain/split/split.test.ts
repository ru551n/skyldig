import { describe, expect, it } from "vitest";

import { DomainError } from "../errors.ts";
import { splitAmount, splitEqually, type SplitParticipant } from "./split.ts";

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

describe("splitAmount", () => {
  it("100 among 3 equal participants -> [34, 33, 33] by position", () => {
    const participants: SplitParticipant[] = [
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ];
    const shares = splitAmount(100n, participants);
    expect(shares.map((s) => s.share)).toEqual([34n, 33n, 33n]);
    expect(shares.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("2 among 3 equal participants -> [1, 1, 0]", () => {
    const participants: SplitParticipant[] = [
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ];
    const shares = splitAmount(2n, participants);
    expect(shares.map((s) => s.share)).toEqual([1n, 1n, 0n]);
  });

  it("a single participant gets the whole total", () => {
    const shares = splitAmount(777n, [{ id: "solo", position: 0 }]);
    expect(shares).toEqual([{ id: "solo", share: 777n }]);
  });

  it("weights 3:1 on 100 -> [75, 25]", () => {
    const participants: SplitParticipant[] = [
      { id: "a", position: 0, weight: 3n },
      { id: "b", position: 1, weight: 1n },
    ];
    const shares = splitAmount(100n, participants);
    expect(shares.map((s) => s.share)).toEqual([75n, 25n]);
  });

  it("weights 1:1:1 on 10 -> [4, 3, 3]", () => {
    const participants: SplitParticipant[] = [
      { id: "a", position: 0, weight: 1n },
      { id: "b", position: 1, weight: 1n },
      { id: "c", position: 2, weight: 1n },
    ];
    const shares = splitAmount(10n, participants);
    expect(shares.map((s) => s.share)).toEqual([4n, 3n, 3n]);
  });

  it("rejects an empty participant list", () => {
    expectDomainError(() => splitAmount(100n, []), "EMPTY_SPLIT");
  });

  it("rejects a non-positive total", () => {
    expectDomainError(() => splitAmount(0n, [{ id: "a", position: 0 }]), "INVALID_AMOUNT");
    expectDomainError(() => splitAmount(-5n, [{ id: "a", position: 0 }]), "INVALID_AMOUNT");
  });

  it("rejects a non-positive weight", () => {
    expectDomainError(
      () =>
        splitAmount(100n, [
          { id: "a", position: 0, weight: 0n },
          { id: "b", position: 1 },
        ]),
      "INVALID_AMOUNT",
    );
    expectDomainError(
      () =>
        splitAmount(100n, [
          { id: "a", position: 0, weight: -1n },
          { id: "b", position: 1 },
        ]),
      "INVALID_AMOUNT",
    );
  });

  it("is independent of input order", () => {
    const inOrder: SplitParticipant[] = [
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ];
    const shuffled: SplitParticipant[] = [inOrder[2]!, inOrder[0]!, inOrder[1]!];
    expect(splitAmount(101n, inOrder)).toEqual(splitAmount(101n, shuffled));
  });

  it("output is ordered by position then id regardless of input order", () => {
    const participants: SplitParticipant[] = [
      { id: "z", position: 0 },
      { id: "a", position: 0 },
      { id: "m", position: -1 },
    ];
    const shares = splitAmount(9n, participants);
    expect(shares.map((s) => s.id)).toEqual(["m", "a", "z"]);
  });

  it("sums to total and keeps max-min <= 1 for equal weights over 1000 random cases", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(rand() * 20);
      const total = BigInt(1 + Math.floor(rand() * 100_000));
      const participants: SplitParticipant[] = Array.from({ length: n }, (_, idx) => ({
        id: `p${idx}`,
        position: idx,
      }));
      const shares = splitAmount(total, participants);
      const sum = shares.reduce((acc, s) => acc + s.share, 0n);
      expect(sum).toBe(total);
      const values = shares.map((s) => s.share);
      const max = values.reduce((a, b) => (b > a ? b : a));
      const min = values.reduce((a, b) => (b < a ? b : a));
      expect(max - min <= 1n).toBe(true);
    }
  });

  it("sums to total over 1000 random cases with random weights", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(rand() * 15);
      const total = BigInt(1 + Math.floor(rand() * 1_000_000));
      const participants: SplitParticipant[] = Array.from({ length: n }, (_, idx) => ({
        id: `p${idx}`,
        position: idx,
        weight: BigInt(1 + Math.floor(rand() * 10)),
      }));
      const shares = splitAmount(total, participants);
      const sum = shares.reduce((acc, s) => acc + s.share, 0n);
      expect(sum).toBe(total);
    }
  });
});

describe("splitEqually", () => {
  it("delegates to splitAmount with weight 1 for each participant", () => {
    const shares = splitEqually(10n, [
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ]);
    expect(shares.map((s) => s.share)).toEqual([4n, 3n, 3n]);
  });
});
