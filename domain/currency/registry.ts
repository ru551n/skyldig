import { DomainError } from "../errors.ts";

/**
 * ISO 4217 currency code. Branded loosely as a string; the registry below is
 * the runtime source of truth for which codes are actually known.
 */
export type CurrencyCode = string;

/** Minor-unit decimal places a currency can express. */
export type CurrencyDecimals = 0 | 1 | 2 | 3;

/** A registry entry: minor-unit decimals plus a Swedish display name. */
interface CurrencyEntry {
  decimals: CurrencyDecimals;
  name: string;
}

/**
 * Static table of supported ISO 4217 codes, their minor-unit decimals, and
 * their Swedish display name. JPY/KRW/VND/ISK have 0 decimals, KWD/BHD/TND
 * have 3 decimals, everything else here has 2.
 *
 * Backed by a `Map` (not a plain object) so lookups can never resolve to an
 * inherited `Object.prototype` member (e.g. `"constructor"`, `"toString"`).
 */
const CURRENCIES = new Map<string, CurrencyEntry>([
  ["SEK", { decimals: 2, name: "Svenska kronor" }],
  ["EUR", { decimals: 2, name: "Euro" }],
  ["USD", { decimals: 2, name: "US-dollar" }],
  ["GBP", { decimals: 2, name: "Brittiska pund" }],
  ["NOK", { decimals: 2, name: "Norska kronor" }],
  ["DKK", { decimals: 2, name: "Danska kronor" }],
  ["JPY", { decimals: 0, name: "Japanska yen" }],
  ["CHF", { decimals: 2, name: "Schweizerfranc" }],
  ["PLN", { decimals: 2, name: "Polska zloty" }],
  ["CZK", { decimals: 2, name: "Tjeckiska kronor" }],
  ["HUF", { decimals: 2, name: "Ungerska forint" }],
  ["THB", { decimals: 2, name: "Thailändska baht" }],
  ["AUD", { decimals: 2, name: "Australiska dollar" }],
  ["CAD", { decimals: 2, name: "Kanadensiska dollar" }],
  ["NZD", { decimals: 2, name: "Nyzeeländska dollar" }],
  ["KRW", { decimals: 0, name: "Sydkoreanska won" }],
  ["VND", { decimals: 0, name: "Vietnamesiska dong" }],
  ["ISK", { decimals: 0, name: "Isländska kronor" }],
  ["KWD", { decimals: 3, name: "Kuwaitiska dinarer" }],
  ["BHD", { decimals: 3, name: "Bahrainska dinarer" }],
  ["TND", { decimals: 3, name: "Tunisiska dinarer" }],
  ["IDR", { decimals: 2, name: "Indonesiska rupier" }],
  ["INR", { decimals: 2, name: "Indiska rupier" }],
  ["TRY", { decimals: 2, name: "Turkiska lira" }],
  ["MXN", { decimals: 2, name: "Mexikanska pesos" }],
  ["BRL", { decimals: 2, name: "Brasilianska real" }],
  ["ZAR", { decimals: 2, name: "Sydafrikanska rand" }],
  ["CNY", { decimals: 2, name: "Kinesiska yuan" }],
  ["HKD", { decimals: 2, name: "Hongkongdollar" }],
  ["SGD", { decimals: 2, name: "Singaporedollar" }],
]);

/** Currencies listed first, in this order, before the alphabetical remainder. */
const PRIORITY_ORDER = ["SEK", "EUR", "USD", "GBP", "NOK", "DKK"];

/** Returns whether `code` is a known currency in the registry. */
export function isKnownCurrency(code: string): boolean {
  return CURRENCIES.has(code);
}

/**
 * Returns the number of minor-unit decimals for `code`.
 * Throws `DomainError` with code `UNKNOWN_CURRENCY` if the code is not in the registry.
 */
export function getCurrencyDecimals(code: string): CurrencyDecimals {
  const entry = CURRENCIES.get(code);
  if (entry === undefined) {
    throw new DomainError("UNKNOWN_CURRENCY", `Unknown currency code: ${code}`);
  }
  return entry.decimals;
}

/**
 * Returns the Swedish display name for `code`.
 * Throws `DomainError` with code `UNKNOWN_CURRENCY` if the code is not in the registry.
 */
export function getCurrencyName(code: string): string {
  const entry = CURRENCIES.get(code);
  if (entry === undefined) {
    throw new DomainError("UNKNOWN_CURRENCY", `Unknown currency code: ${code}`);
  }
  return entry.name;
}

/**
 * Lists all known currencies as `{code, decimals, name}`, sorted with
 * SEK, EUR, USD, GBP, NOK, DKK first (in that order), then the rest
 * alphabetically by code.
 */
export function listCurrencies(): { code: CurrencyCode; decimals: CurrencyDecimals; name: string }[] {
  const codes = [...CURRENCIES.keys()];
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
  return codes.map((code) => {
    const entry = CURRENCIES.get(code)!;
    return { code, decimals: entry.decimals, name: entry.name };
  });
}
