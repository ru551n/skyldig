import { describe, expect, it } from "vitest";

import { DomainError } from "../errors.ts";
import type { Money } from "../money/money.ts";
import { convertToBase, parseRate } from "./rate.ts";

function expectDomainError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable("expected to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
  }
}

describe("parseRate", () => {
  it('"1 SEK = 150 JPY" parses to the exact rational 1/150', () => {
    const rate = parseRate("150", "units_per_base");
    expect(rate.num).toBe(1n);
    expect(rate.den).toBe(150n);
  });

  it("a rounded decimal approximation of 1/150 produces a slightly different rational", () => {
    // 1/150 = 0.006666666666... repeating; "0.0066666667" is a human-rounded
    // approximation of it, so parsing it as base_per_unit yields a rational
    // that is close to, but not exactly, 1/150.
    const approx = parseRate("0.0066666667", "base_per_unit");
    // cross-multiply to compare fractions without floating point
    expect(approx.num * 150n === approx.den * 1n).toBe(false);
  });

  it("base_per_unit parses a tiny rate; gcd reduction preserves conversion", () => {
    const reduced = parseRate("0.0000734", "base_per_unit");
    // independent reference: 0.0000734 = 734 / 10^7, unreduced
    const refNum = 734n;
    const refDen = 10_000_000n;

    const amountMinor = 10n ** 15n;
    const txDecimals = 2n; // e.g. SEK
    const baseDecimals = 0n; // e.g. JPY

    const viaReduced =
      (2n * (amountMinor * 10n ** baseDecimals * reduced.num) + 10n ** txDecimals * reduced.den) /
      (2n * (10n ** txDecimals * reduced.den));
    const viaRaw =
      (2n * (amountMinor * 10n ** baseDecimals * refNum) + 10n ** txDecimals * refDen) /
      (2n * (10n ** txDecimals * refDen));

    expect(viaReduced).toBe(viaRaw);
  });

  it("rejects zero, negative, and malformed rates", () => {
    expectDomainError(() => parseRate("0", "base_per_unit"), "INVALID_RATE");
    expectDomainError(() => parseRate("-1", "base_per_unit"), "INVALID_RATE");
    expectDomainError(() => parseRate("abc", "base_per_unit"), "INVALID_RATE");
    expectDomainError(() => parseRate("", "base_per_unit"), "INVALID_RATE");
    expectDomainError(() => parseRate("1.2345678901234", "base_per_unit"), "INVALID_RATE"); // > 12 decimals... malformed
  });

  it("rejects a rate whose reduced num or den exceeds 10^15", () => {
    expectDomainError(() => parseRate("1000000000000001", "base_per_unit"), "INVALID_RATE");
  });
});

describe("convertToBase", () => {
  it("returns the amount unchanged for same-currency, ignoring any rate", () => {
    const money: Money = { amountMinor: 12345n, currency: "SEK" };
    expect(convertToBase(money, "SEK")).toBe(12345n);
  });

  it("requires a rate for cross-currency conversion", () => {
    const money: Money = { amountMinor: 100n, currency: "EUR" };
    expectDomainError(() => convertToBase(money, "SEK"), "INVALID_RATE");
  });

  it("rounds a .5 boundary away from zero: 0-decimal tx -> 2-decimal base", () => {
    // amountMinor=1 (1 JPY), rate 0.025 base_per_unit -> quotient 2.5 -> rounds to 3
    const rate = parseRate("0.025", "base_per_unit");
    const money: Money = { amountMinor: 1n, currency: "JPY" };
    expect(convertToBase(money, "SEK", rate)).toBe(3n);
  });

  it("rounds a .5 boundary away from zero: 3-decimal tx -> 2-decimal base", () => {
    // amountMinor=1 (0.001 KWD), rate "5" base_per_unit -> quotient 0.5 -> rounds to 1
    const rate = parseRate("5", "base_per_unit");
    const money: Money = { amountMinor: 1n, currency: "KWD" };
    expect(convertToBase(money, "SEK", rate)).toBe(1n);
  });

  it("throws AMOUNT_TOO_SMALL_IN_BASE when the result rounds to 0", () => {
    const rate = parseRate("0.001", "base_per_unit");
    const money: Money = { amountMinor: 1n, currency: "JPY" };
    expectDomainError(() => convertToBase(money, "SEK", rate), "AMOUNT_TOO_SMALL_IN_BASE");
  });

  it("handles all 9 pairings of {0,2,3} decimal currencies with a rate of exactly 1", () => {
    const byDecimals: Record<number, string> = { 0: "JPY", 2: "SEK", 3: "KWD" };
    const baseByDecimals: Record<number, string> = { 0: "VND", 2: "EUR", 3: "BHD" };
    for (const txDec of [0, 2, 3]) {
      for (const baseDec of [0, 2, 3]) {
        const txCurrency = byDecimals[txDec]!;
        const baseCurrency = baseByDecimals[baseDec]!;
        const rate = parseRate("1", "base_per_unit");
        const oneUnit = 10n ** BigInt(txDec);
        const money: Money = { amountMinor: oneUnit, currency: txCurrency };
        const result = convertToBase(money, baseCurrency, rate);
        expect(result).toBe(10n ** BigInt(baseDec));
      }
    }
  });
});
