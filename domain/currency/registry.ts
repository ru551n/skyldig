import { DomainError } from "../errors.ts";

/**
 * ISO 4217 currency code. Branded loosely as a string; the registry below is
 * the runtime source of truth for which codes are actually known.
 */
export type CurrencyCode = string;

/** Minor-unit decimal places a currency can express. */
export type CurrencyDecimals = 0 | 1 | 2 | 3;

/** The two interface languages the domain layer knows display names in (see app/i18n). Kept
 *  as a plain literal union rather than importing `~/i18n`'s `Locale` — the domain layer stays
 *  free of any dependency on the app layer. */
export type CurrencyLocale = "sv" | "en";

/** A registry entry: minor-unit decimals plus a display name per interface language. */
interface CurrencyEntry {
  decimals: CurrencyDecimals;
  name: Record<CurrencyLocale, string>;
}

/**
 * Static table of supported ISO 4217 codes, their minor-unit decimals, and their display name
 * in each interface language. JPY/KRW/VND/ISK have 0 decimals, KWD/BHD/TND have 3 decimals,
 * everything else here has 2.
 *
 * Backed by a `Map` (not a plain object) so lookups can never resolve to an
 * inherited `Object.prototype` member (e.g. `"constructor"`, `"toString"`).
 */
const CURRENCIES = new Map<string, CurrencyEntry>([
  ["SEK", { decimals: 2, name: { sv: "Svenska kronor", en: "Swedish krona" } }],
  ["EUR", { decimals: 2, name: { sv: "Euro", en: "Euro" } }],
  ["USD", { decimals: 2, name: { sv: "US-dollar", en: "US dollar" } }],
  ["GBP", { decimals: 2, name: { sv: "Brittiska pund", en: "British pound" } }],
  ["NOK", { decimals: 2, name: { sv: "Norska kronor", en: "Norwegian krone" } }],
  ["DKK", { decimals: 2, name: { sv: "Danska kronor", en: "Danish krone" } }],
  ["JPY", { decimals: 0, name: { sv: "Japanska yen", en: "Japanese yen" } }],
  ["CHF", { decimals: 2, name: { sv: "Schweizerfranc", en: "Swiss franc" } }],
  ["PLN", { decimals: 2, name: { sv: "Polska zloty", en: "Polish zloty" } }],
  ["CZK", { decimals: 2, name: { sv: "Tjeckiska kronor", en: "Czech koruna" } }],
  ["HUF", { decimals: 2, name: { sv: "Ungerska forint", en: "Hungarian forint" } }],
  ["THB", { decimals: 2, name: { sv: "Thailändska baht", en: "Thai baht" } }],
  ["AUD", { decimals: 2, name: { sv: "Australiska dollar", en: "Australian dollar" } }],
  ["CAD", { decimals: 2, name: { sv: "Kanadensiska dollar", en: "Canadian dollar" } }],
  ["NZD", { decimals: 2, name: { sv: "Nyzeeländska dollar", en: "New Zealand dollar" } }],
  ["KRW", { decimals: 0, name: { sv: "Sydkoreanska won", en: "South Korean won" } }],
  ["VND", { decimals: 0, name: { sv: "Vietnamesiska dong", en: "Vietnamese dong" } }],
  ["ISK", { decimals: 0, name: { sv: "Isländska kronor", en: "Icelandic krona" } }],
  ["KWD", { decimals: 3, name: { sv: "Kuwaitiska dinarer", en: "Kuwaiti dinar" } }],
  ["BHD", { decimals: 3, name: { sv: "Bahrainska dinarer", en: "Bahraini dinar" } }],
  ["TND", { decimals: 3, name: { sv: "Tunisiska dinarer", en: "Tunisian dinar" } }],
  ["IDR", { decimals: 2, name: { sv: "Indonesiska rupier", en: "Indonesian rupiah" } }],
  ["INR", { decimals: 2, name: { sv: "Indiska rupier", en: "Indian rupee" } }],
  ["TRY", { decimals: 2, name: { sv: "Turkiska lira", en: "Turkish lira" } }],
  ["MXN", { decimals: 2, name: { sv: "Mexikanska pesos", en: "Mexican peso" } }],
  ["BRL", { decimals: 2, name: { sv: "Brasilianska real", en: "Brazilian real" } }],
  ["ZAR", { decimals: 2, name: { sv: "Sydafrikanska rand", en: "South African rand" } }],
  ["CNY", { decimals: 2, name: { sv: "Kinesiska yuan", en: "Chinese yuan" } }],
  ["HKD", { decimals: 2, name: { sv: "Hongkongdollar", en: "Hong Kong dollar" } }],
  ["SGD", { decimals: 2, name: { sv: "Singaporedollar", en: "Singapore dollar" } }],
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
 * Returns the display name for `code` in the given interface language (Swedish by default).
 * Throws `DomainError` with code `UNKNOWN_CURRENCY` if the code is not in the registry.
 */
export function getCurrencyName(code: string, locale: CurrencyLocale = "sv"): string {
  const entry = CURRENCIES.get(code);
  if (entry === undefined) {
    throw new DomainError("UNKNOWN_CURRENCY", `Unknown currency code: ${code}`);
  }
  return entry.name[locale];
}

/**
 * Lists all known currencies as `{code, decimals, name}`, sorted with
 * SEK, EUR, USD, GBP, NOK, DKK first (in that order), then the rest
 * alphabetically by code. `name` is in the given interface language (Swedish by default).
 */
export function listCurrencies(
  locale: CurrencyLocale = "sv",
): { code: CurrencyCode; decimals: CurrencyDecimals; name: string }[] {
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
    return { code, decimals: entry.decimals, name: entry.name[locale] };
  });
}
