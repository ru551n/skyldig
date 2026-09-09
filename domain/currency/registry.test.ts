import { describe, expect, it } from "vitest";

import { DomainError } from "../errors.ts";
import { getCurrencyDecimals, isKnownCurrency, listCurrencies } from "./registry.ts";

describe("getCurrencyDecimals", () => {
  it("returns 2 for common currencies", () => {
    for (const code of ["SEK", "EUR", "USD", "GBP", "NOK", "DKK", "CHF", "PLN", "CZK", "HUF", "THB", "AUD", "CAD", "NZD", "IDR", "INR", "TRY", "MXN", "BRL", "ZAR", "CNY", "HKD", "SGD"]) {
      expect(getCurrencyDecimals(code)).toBe(2);
    }
  });

  it("returns 0 for zero-decimal currencies", () => {
    for (const code of ["JPY", "KRW", "VND", "ISK"]) {
      expect(getCurrencyDecimals(code)).toBe(0);
    }
  });

  it("returns 3 for three-decimal currencies", () => {
    for (const code of ["KWD", "BHD", "TND"]) {
      expect(getCurrencyDecimals(code)).toBe(3);
    }
  });

  it("throws DomainError UNKNOWN_CURRENCY for unknown codes", () => {
    expect(() => getCurrencyDecimals("XXX")).toThrow(DomainError);
    try {
      getCurrencyDecimals("XXX");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("UNKNOWN_CURRENCY");
    }
  });
});

describe("isKnownCurrency", () => {
  it("is true for known codes, false for unknown", () => {
    expect(isKnownCurrency("SEK")).toBe(true);
    expect(isKnownCurrency("XXX")).toBe(false);
  });
});

describe("listCurrencies", () => {
  it("puts SEK, EUR, USD, GBP, NOK, DKK first in that order, then alphabetical", () => {
    const list = listCurrencies();
    const codes = list.map((c) => c.code);
    expect(codes.slice(0, 6)).toEqual(["SEK", "EUR", "USD", "GBP", "NOK", "DKK"]);
    const rest = codes.slice(6);
    const sortedRest = [...rest].sort();
    expect(rest).toEqual(sortedRest);
  });

  it("includes decimals for each entry", () => {
    const list = listCurrencies();
    const jpy = list.find((c) => c.code === "JPY");
    expect(jpy?.decimals).toBe(0);
    const kwd = list.find((c) => c.code === "KWD");
    expect(kwd?.decimals).toBe(3);
  });

  it("has no duplicate codes", () => {
    const codes = listCurrencies().map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
