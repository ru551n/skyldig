import { DomainError } from "../errors.ts";

/**
 * ISO 4217 currency code. Branded loosely as a string; the registry below is
 * the runtime source of truth for which codes are actually known.
 */
export type CurrencyCode = string;

/** Minor-unit decimal places a currency can express. */
export type CurrencyDecimals = 0 | 1 | 2 | 3;

/**
 * Static table of supported ISO 4217 codes and their minor-unit decimals.
 * JPY/KRW/VND/ISK have 0 decimals, KWD/BHD/TND have 3 decimals, everything
 * else here has 2.
 */
const CURRENCY_DECIMALS: Record<string, CurrencyDecimals> = {
  SEK: 2,
  EUR: 2,
  USD: 2,
  GBP: 2,
  NOK: 2,
  DKK: 2,
  JPY: 0,
  CHF: 2,
  PLN: 2,
  CZK: 2,
  HUF: 2,
  THB: 2,
  AUD: 2,
  CAD: 2,
  NZD: 2,
  KRW: 0,
  VND: 0,
  ISK: 0,
  KWD: 3,
  BHD: 3,
  TND: 3,
  IDR: 2,
  INR: 2,
  TRY: 2,
  MXN: 2,
  BRL: 2,
  ZAR: 2,
  CNY: 2,
  HKD: 2,
  SGD: 2,
};

/** Currencies listed first, in this order, before the alphabetical remainder. */
const PRIORITY_ORDER = ["SEK", "EUR", "USD", "GBP", "NOK", "DKK"];

/** Returns whether `code` is a known currency in the registry. */
export function isKnownCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCY_DECIMALS, code);
}

/**
 * Returns the number of minor-unit decimals for `code`.
 * Throws `DomainError` with code `UNKNOWN_CURRENCY` if the code is not in the registry.
 */
export function getCurrencyDecimals(code: string): CurrencyDecimals {
  const decimals = CURRENCY_DECIMALS[code];
  if (decimals === undefined) {
    throw new DomainError("UNKNOWN_CURRENCY", `Unknown currency code: ${code}`);
  }
  return decimals;
}

/**
 * Lists all known currencies as `{code, decimals}`, sorted with
 * SEK, EUR, USD, GBP, NOK, DKK first (in that order), then the rest
 * alphabetically by code.
 */
export function listCurrencies(): { code: CurrencyCode; decimals: CurrencyDecimals }[] {
  const codes = Object.keys(CURRENCY_DECIMALS);
  codes.sort((a, b) => {
    const ia = PRIORITY_ORDER.indexOf(a);
    const ib = PRIORITY_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return codes.map((code) => ({ code, decimals: CURRENCY_DECIMALS[code]! }));
}
