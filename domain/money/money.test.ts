import { describe, expect, it } from "vitest";

import { DomainError } from "../errors.ts";
import {
  formatMinorAsDecimal,
  formatMoney,
  MAX_AMOUNT_MINOR,
  parseAmount,
  parseSerializedMoney,
  serializeMoney,
} from "./money.ts";

function expectDomainError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable("expected to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
  }
}

describe("parseAmount", () => {
  it("parses space-grouped thousands with comma decimal", () => {
    expect(parseAmount("1 234,56", "SEK")).toBe(123456n);
  });

  it("parses dot-grouped thousands with comma decimal", () => {
    expect(parseAmount("1.234,56", "SEK")).toBe(123456n);
  });

  it("parses comma-grouped thousands with dot decimal", () => {
    expect(parseAmount("1,234.56", "SEK")).toBe(123456n);
  });

  it("parses plain dot decimal", () => {
    expect(parseAmount("1234.56", "SEK")).toBe(123456n);
  });

  it("parses a plain integer", () => {
    expect(parseAmount("1234", "SEK")).toBe(123400n);
  });

  it("parses a single comma as decimal separator", () => {
    expect(parseAmount("12,5", "SEK")).toBe(1250n);
  });

  it("trims surrounding whitespace including exotic spaces", () => {
    expect(parseAmount(" 12 ", "SEK")).toBe(1200n);
    expect(parseAmount(" 12 ", "SEK")).toBe(1200n);
  });

  it("rejects negative amounts", () => {
    expectDomainError(() => parseAmount("-12.50", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects zero", () => {
    expectDomainError(() => parseAmount("0", "SEK"), "INVALID_AMOUNT");
    expectDomainError(() => parseAmount("0.00", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects empty input", () => {
    expectDomainError(() => parseAmount("", "SEK"), "INVALID_AMOUNT");
    expectDomainError(() => parseAmount("   ", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects garbage input", () => {
    expectDomainError(() => parseAmount("abc", "SEK"), "INVALID_AMOUNT");
    expectDomainError(() => parseAmount(",56", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects more decimals than the currency allows", () => {
    expectDomainError(() => parseAmount("1.234", "SEK"), "TOO_MANY_DECIMALS");
    expectDomainError(() => parseAmount("1.2345", "KWD"), "TOO_MANY_DECIMALS");
  });

  it("rejects any fractional part for a 0-decimal currency", () => {
    expectDomainError(() => parseAmount("1.5", "JPY"), "TOO_MANY_DECIMALS");
    expect(parseAmount("1500", "JPY")).toBe(1500n);
  });

  it("accepts up to 3 decimals for 3-decimal currencies", () => {
    expect(parseAmount("1.234", "KWD")).toBe(1234n);
  });

  it("accepts the MAX boundary and rejects one above it", () => {
    expect(parseAmount("10000000000000.00", "SEK")).toBe(MAX_AMOUNT_MINOR);
    expectDomainError(() => parseAmount("10000000000000.01", "SEK"), "AMOUNT_TOO_LARGE");
  });

  it("throws UNKNOWN_CURRENCY for an unknown currency", () => {
    expectDomainError(() => parseAmount("1.00", "XXX"), "UNKNOWN_CURRENCY");
  });

  it("throws UNKNOWN_CURRENCY for prototype-inherited keys instead of returning garbage", () => {
    expectDomainError(() => parseAmount("1,5", "constructor"), "UNKNOWN_CURRENCY");
  });

  it("rejects malformed separator runs", () => {
    expectDomainError(() => parseAmount("1,,5", "SEK"), "INVALID_AMOUNT");
    expectDomainError(() => parseAmount("1..2", "SEK"), "INVALID_AMOUNT");
    expectDomainError(() => parseAmount("1,2.34,5", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects a leading separator", () => {
    expectDomainError(() => parseAmount(",50", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects a trailing separator", () => {
    expectDomainError(() => parseAmount("1.", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects a leading plus sign", () => {
    expectDomainError(() => parseAmount("+5", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects exponential notation", () => {
    expectDomainError(() => parseAmount("1e5", "SEK"), "INVALID_AMOUNT");
  });

  it("rejects full-width digits (not treated as digits)", () => {
    // Documented decision: full-width (fullwidth Unicode) digits are rejected,
    // not normalized to ASCII digits.
    expectDomainError(() => parseAmount("１２", "SEK"), "INVALID_AMOUNT");
  });

  it("still accepts valid single- and multi-separator forms", () => {
    expect(parseAmount("1 234,56", "SEK")).toBe(123456n);
    expect(parseAmount("1.234,56", "SEK")).toBe(123456n);
    expect(parseAmount("1,234.56", "SEK")).toBe(123456n);
    expect(parseAmount("1234.56", "SEK")).toBe(123456n);
    expect(parseAmount("1234", "SEK")).toBe(123400n);
    expect(parseAmount("12,5", "SEK")).toBe(1250n);
    expect(parseAmount("0,5", "SEK")).toBe(50n);
    expect(parseAmount("1234,5", "SEK")).toBe(123450n);
  });
});

describe("formatMinorAsDecimal", () => {
  it("formats 2-decimal amounts", () => {
    expect(formatMinorAsDecimal(123456n, 2)).toBe("1234.56");
    expect(formatMinorAsDecimal(5n, 2)).toBe("0.05");
  });

  it("formats 0-decimal amounts", () => {
    expect(formatMinorAsDecimal(7n, 0)).toBe("7");
  });

  it("formats negative amounts", () => {
    expect(formatMinorAsDecimal(-150n, 2)).toBe("-1.50");
  });

  it("formats 3-decimal amounts", () => {
    expect(formatMinorAsDecimal(1234n, 3)).toBe("1.234");
  });

  it("formats zero", () => {
    expect(formatMinorAsDecimal(0n, 2)).toBe("0.00");
  });
});

describe("formatMoney", () => {
  it("formats a normal SEK amount without throwing", () => {
    const result = formatMoney(123456n, "SEK", "sv-SE");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("falls back to plain decimal + code for huge amounts", () => {
    const huge = 2n ** 53n + 1000n;
    const result = formatMoney(huge, "SEK");
    expect(result).toContain("SEK");
    expect(result).toContain(formatMinorAsDecimal(huge, 2));
  });

  it("formats 0-decimal currencies", () => {
    const result = formatMoney(1500n, "JPY");
    expect(typeof result).toBe("string");
  });
});

describe("serializeMoney / parseSerializedMoney round trip", () => {
  it("round trips positive amounts", () => {
    const wire = serializeMoney({ amountMinor: 123456n, currency: "SEK" });
    expect(wire).toEqual({ amount: "1234.56", currency: "SEK" });
    const back = parseSerializedMoney(wire.amount, wire.currency);
    expect(back).toEqual({ amountMinor: 123456n, currency: "SEK" });
  });

  it("round trips negative amounts (e.g. balances)", () => {
    const wire = serializeMoney({ amountMinor: -150n, currency: "SEK" });
    expect(wire.amount).toBe("-1.50");
    const back = parseSerializedMoney(wire.amount, "SEK");
    expect(back.amountMinor).toBe(-150n);
  });

  it("round trips zero", () => {
    const wire = serializeMoney({ amountMinor: 0n, currency: "SEK" });
    const back = parseSerializedMoney(wire.amount, "SEK");
    expect(back.amountMinor).toBe(0n);
  });

  it("round trips 0-decimal currencies", () => {
    const wire = serializeMoney({ amountMinor: 1500n, currency: "JPY" });
    expect(wire.amount).toBe("1500");
    const back = parseSerializedMoney(wire.amount, "JPY");
    expect(back.amountMinor).toBe(1500n);
  });

  it("rejects malformed serialized amounts", () => {
    expectDomainError(() => parseSerializedMoney("abc", "SEK"), "INVALID_AMOUNT");
  });
});
