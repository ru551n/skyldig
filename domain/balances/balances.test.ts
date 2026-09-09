import { describe, expect, it } from "vitest";

import { convertToBase, parseRate } from "../currency/rate.ts";
import { DomainError } from "../errors.ts";
import { splitAmount } from "../split/split.ts";
import { computeBalances, type ExpenseForBalance, type PaymentForBalance } from "./balances.ts";

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

describe("computeBalances", () => {
  it("gives a payer who is also a participant a positive net when others owe them", () => {
    const expenses: ExpenseForBalance[] = [
      {
        payerId: "a",
        baseAmountMinor: 100n,
        shares: [
          { participantId: "a", shareBaseMinor: 50n },
          { participantId: "b", shareBaseMinor: 50n },
        ],
      },
    ];
    const balances = computeBalances(["a", "b"], expenses, []);
    expect(balances.get("a")!.net).toBe(50n);
    expect(balances.get("b")!.net).toBe(-50n);
  });

  it("handles a payer who is excluded from the expense's shares", () => {
    const expenses: ExpenseForBalance[] = [
      {
        payerId: "a",
        baseAmountMinor: 100n,
        shares: [
          { participantId: "b", shareBaseMinor: 50n },
          { participantId: "c", shareBaseMinor: 50n },
        ],
      },
    ];
    const balances = computeBalances(["a", "b", "c"], expenses, []);
    expect(balances.get("a")!.net).toBe(100n);
    expect(balances.get("b")!.net).toBe(-50n);
    expect(balances.get("c")!.net).toBe(-50n);
  });

  it("a single participant with a self-paid, self-shared expense nets to zero", () => {
    const expenses: ExpenseForBalance[] = [
      {
        payerId: "solo",
        baseAmountMinor: 100n,
        shares: [{ participantId: "solo", shareBaseMinor: 100n }],
      },
    ];
    const balances = computeBalances(["solo"], expenses, []);
    expect(balances.get("solo")!.net).toBe(0n);
  });

  it("participants with no activity get all-zero balances", () => {
    const balances = computeBalances(["a", "b"], [], []);
    expect(balances.get("a")).toEqual({ participantId: "a", paid: 0n, share: 0n, repaid: 0n, received: 0n, net: 0n });
    expect(balances.get("b")).toEqual({ participantId: "b", paid: 0n, share: 0n, repaid: 0n, received: 0n, net: 0n });
  });

  it("applies payments as repaid/received", () => {
    const payments: PaymentForBalance[] = [{ payerId: "a", recipientId: "b", baseAmountMinor: 30n }];
    const balances = computeBalances(["a", "b"], [], payments);
    expect(balances.get("a")!.repaid).toBe(30n);
    expect(balances.get("a")!.net).toBe(30n);
    expect(balances.get("b")!.received).toBe(30n);
    expect(balances.get("b")!.net).toBe(-30n);
  });

  it("throws when an expense payer is unknown", () => {
    const expenses: ExpenseForBalance[] = [{ payerId: "ghost", baseAmountMinor: 10n, shares: [] }];
    expectDomainError(() => computeBalances(["a"], expenses, []), "INVALID_AMOUNT");
  });

  it("throws when an expense share references an unknown participant", () => {
    const expenses: ExpenseForBalance[] = [
      { payerId: "a", baseAmountMinor: 10n, shares: [{ participantId: "ghost", shareBaseMinor: 10n }] },
    ];
    expectDomainError(() => computeBalances(["a"], expenses, []), "INVALID_AMOUNT");
  });

  it("throws when a payment references an unknown participant", () => {
    const payments: PaymentForBalance[] = [{ payerId: "a", recipientId: "ghost", baseAmountMinor: 10n }];
    expectDomainError(() => computeBalances(["a"], [], payments), "INVALID_AMOUNT");
  });

  it("throws EXPENSE_SHARES_MISMATCH when an expense's shares don't sum to its base amount", () => {
    const expenses: ExpenseForBalance[] = [
      {
        payerId: "a",
        baseAmountMinor: 100n,
        shares: [
          { participantId: "a", shareBaseMinor: 40n },
          { participantId: "b", shareBaseMinor: 50n },
        ],
      },
    ];
    expectDomainError(() => computeBalances(["a", "b"], expenses, []), "EXPENSE_SHARES_MISMATCH");
  });

  it("rejects duplicate participant ids in the participant list", () => {
    expectDomainError(() => computeBalances(["a", "a", "b"], [], []), "DUPLICATE_PARTICIPANT");
  });

  it("end-to-end: 500 random mixed-currency sessions always sum to zero net", () => {
    const rand = mulberry32(1234);
    const baseCurrency = "SEK";
    const txCurrencies = ["SEK", "EUR", "USD", "JPY", "KWD"];

    for (let scenario = 0; scenario < 500; scenario++) {
      const n = 2 + Math.floor(rand() * 6);
      const participantIds = Array.from({ length: n }, (_, i) => `p${i}`);

      const expenses: ExpenseForBalance[] = [];
      const expenseCount = Math.floor(rand() * 6);
      for (let i = 0; i < expenseCount; i++) {
        const currency = txCurrencies[Math.floor(rand() * txCurrencies.length)]!;
        const payerId = participantIds[Math.floor(rand() * n)]!;

        // subset of participants sharing this expense (at least 1)
        const subsetSize = 1 + Math.floor(rand() * n);
        const shuffled = [...participantIds].sort(() => rand() - 0.5);
        const subset = shuffled.slice(0, subsetSize);

        let baseAmountMinor: bigint | undefined;
        while (baseAmountMinor === undefined) {
          const amountMinor = BigInt(1000 + Math.floor(rand() * 100_000));
          try {
            if (currency === baseCurrency) {
              baseAmountMinor = amountMinor;
            } else {
              const rateText = (1 + rand() * 200).toFixed(6);
              const rate = parseRate(rateText, "base_per_unit");
              baseAmountMinor = convertToBase({ amountMinor, currency }, baseCurrency, rate);
            }
          } catch {
            // amount rounded to 0 in base currency; retry with a fresh amount
            baseAmountMinor = undefined;
          }
        }

        const shares = splitAmount(
          baseAmountMinor,
          subset.map((id, idx) => ({ id, position: idx, weight: BigInt(1 + Math.floor(rand() * 4)) })),
        );
        const shareSum = shares.reduce((acc, s) => acc + s.share, 0n);
        expect(shareSum).toBe(baseAmountMinor);

        expenses.push({
          payerId,
          baseAmountMinor,
          shares: shares.map((s) => ({ participantId: s.id, shareBaseMinor: s.share })),
        });
      }

      const payments: PaymentForBalance[] = [];
      const paymentCount = Math.floor(rand() * 4);
      for (let i = 0; i < paymentCount; i++) {
        const payerId = participantIds[Math.floor(rand() * n)]!;
        let recipientId = participantIds[Math.floor(rand() * n)]!;
        if (recipientId === payerId) {
          recipientId = participantIds[(participantIds.indexOf(payerId) + 1) % n]!;
        }
        payments.push({ payerId, recipientId, baseAmountMinor: BigInt(1 + Math.floor(rand() * 10_000)) });
      }

      const balances = computeBalances(participantIds, expenses, payments);
      let sum = 0n;
      for (const b of balances.values()) sum += b.net;
      expect(sum).toBe(0n);
    }
  });
});
