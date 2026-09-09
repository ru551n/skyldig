import { getCurrencyDecimals, type CurrencyCode, type CurrencyDecimals } from "../currency/registry.ts";
import { DomainError } from "../errors.ts";
import { MAX_AMOUNT_MINOR } from "./constants.ts";

/** A monetary amount as integer minor units plus its currency. */
export interface Money {
  amountMinor: bigint;
  currency: CurrencyCode;
}

/** Hard cap on any amount_minor value, kept within Postgres int8 range with headroom. */
export { MAX_AMOUNT_MINOR };

/**
 * Whitespace accepted as thousands separators or padding: the regular
 * space, non-breaking space (U+00A0), thin space (U+2009), and narrow
 * non-breaking space (U+202F), spelled out with escapes so the source
 * file itself contains no literal non-ASCII whitespace.
 */
const WHITESPACE_RE = /[\s\u00A0\u2009\u202F]/g;

/**
 * Parses a user-typed decimal amount string into minor units for `currency`.
 *
 * Separator rule (documented here because it is inherently a judgement call
 * for ambiguous single-separator input):
 * - All whitespace (regular space, NBSP, thin space, narrow NBSP) is treated
 *   purely as padding/grouping and stripped before parsing, e.g. "1 234,56".
 * - If BOTH `,` and `.` appear anywhere in the string, the LAST one (by
 *   position) is the decimal separator; every other occurrence of either
 *   character before it is a thousands separator and is dropped, e.g.
 *   "1.234,56" and "1,234.56" both mean 1234.56.
 * - If only ONE separator character appears exactly once, it is treated as
 *   the DECIMAL separator, e.g. "12,5" -> 12.5, "1234.56" -> 1234.56. This
 *   naturally rejects inputs like "1.234" for a 0-decimal currency (JPY)
 *   via TOO_MANY_DECIMALS, since a 0-decimal currency can never have digits
 *   after a decimal separator.
 * - If only one separator character appears MORE THAN ONCE, every
 *   occurrence is a thousands separator (there can only be one decimal
 *   separator), e.g. "1.234.567" -> 1234567.
 *
 * Rejects empty input, negative amounts, zero, more fractional digits than
 * the currency allows (`TOO_MANY_DECIMALS`), and amounts above
 * `MAX_AMOUNT_MINOR` (`AMOUNT_TOO_LARGE`).
 */
export function parseAmount(input: string, currency: CurrencyCode): bigint {
  const decimals = getCurrencyDecimals(currency);
  const stripped = input.replace(WHITESPACE_RE, "");

  if (stripped === "") {
    throw new DomainError("INVALID_AMOUNT", "Amount is empty");
  }
  if (stripped.startsWith("-")) {
    throw new DomainError("INVALID_AMOUNT", "Amount must not be negative");
  }
  if (!/^[0-9,.]+$/.test(stripped)) {
    throw new DomainError("INVALID_AMOUNT", `Invalid amount: ${input}`);
  }

  const commaPositions = allIndicesOf(stripped, ",");
  const dotPositions = allIndicesOf(stripped, ".");

  let normalized: string;
  if (commaPositions.length > 0 && dotPositions.length > 0) {
    const decimalIndex = Math.max(commaPositions[commaPositions.length - 1]!, dotPositions[dotPositions.length - 1]!);
    const decimalChar = stripped[decimalIndex]!;
    const groupChar = decimalChar === "," ? "." : ",";
    const prefix = stripped.slice(0, decimalIndex);
    const fracPart = stripped.slice(decimalIndex + 1);

    // The decimal separator must occur exactly once (as the char at
    // decimalIndex); if it also appears earlier in the prefix, the
    // character was used inconsistently as both a group and a decimal
    // separator (e.g. "1,2.34,5"), which is malformed.
    if (prefix.includes(decimalChar) || !/^[0-9]+$/.test(fracPart)) {
      throw new DomainError("INVALID_AMOUNT", `Invalid amount: ${input}`);
    }
    if (!isValidGrouping(prefix, groupChar)) {
      throw new DomainError("INVALID_AMOUNT", `Invalid amount: ${input}`);
    }
    const intPart = prefix.split(groupChar).join("");
    normalized = `${intPart}.${fracPart}`;
  } else if (commaPositions.length === 0 && dotPositions.length === 0) {
    normalized = stripped;
  } else {
    const positions = commaPositions.length > 0 ? commaPositions : dotPositions;
    const sepChar = commaPositions.length > 0 ? "," : ".";
    if (positions.length === 1) {
      const idx = positions[0]!;
      normalized = `${stripped.slice(0, idx)}.${stripped.slice(idx + 1)}`;
    } else {
      if (!isValidGrouping(stripped, sepChar)) {
        throw new DomainError("INVALID_AMOUNT", `Invalid amount: ${input}`);
      }
      normalized = stripped.split(sepChar).join("");
    }
  }

  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(normalized);
  if (!match || match[1] === "") {
    throw new DomainError("INVALID_AMOUNT", `Invalid amount: ${input}`);
  }
  const intPartStr = match[1]!;
  const fracPartStr = match[2] ?? "";

  if (fracPartStr.length > decimals) {
    throw new DomainError("TOO_MANY_DECIMALS", `${input} has more decimals than ${currency} allows (${decimals})`);
  }

  const minorStr = intPartStr + fracPartStr.padEnd(decimals, "0");
  const amountMinor = BigInt(minorStr);

  if (amountMinor === 0n) {
    throw new DomainError("INVALID_AMOUNT", "Amount must not be zero");
  }
  if (amountMinor > MAX_AMOUNT_MINOR) {
    throw new DomainError("AMOUNT_TOO_LARGE", `Amount exceeds maximum of ${MAX_AMOUNT_MINOR}`);
  }
  return amountMinor;
}

/**
 * Validates that `str`, split on `groupChar` (a thousands separator),
 * forms a sane grouping: no empty groups (rules out adjacent, leading, or
 * trailing separators), a first group of 1-3 digits, and every subsequent
 * group of exactly 3 digits.
 */
function isValidGrouping(str: string, groupChar: string): boolean {
  const groups = str.split(groupChar);
  if (groups.some((g) => g.length === 0)) return false;
  if (!/^[0-9]{1,3}$/.test(groups[0]!)) return false;
  for (let i = 1; i < groups.length; i++) {
    if (!/^[0-9]{3}$/.test(groups[i]!)) return false;
  }
  return true;
}

function allIndicesOf(s: string, char: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === char) out.push(i);
  }
  return out;
}

/**
 * Formats minor units as a plain decimal string with exactly `decimals`
 * fractional digits (no grouping, no currency symbol), e.g.
 * `formatMinorAsDecimal(123456n, 2) === "1234.56"`.
 */
export function formatMinorAsDecimal(amountMinor: bigint, decimals: CurrencyDecimals): string {
  const negative = amountMinor < 0n;
  const abs = negative ? -amountMinor : amountMinor;
  const digits = abs.toString().padStart(decimals + 1, "0");
  const result =
    decimals === 0 ? digits : `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`;
  return negative ? `-${result}` : result;
}

/**
 * Formats an amount for display using `Intl.NumberFormat` with the given
 * locale (default `sv-SE`). Falls back to a plain "<decimal> <CODE>" string
 * when `Intl` rejects the currency code or locale.
 *
 * `Intl.NumberFormat.prototype.format` accepts a decimal STRING and formats
 * it exactly, with no intermediate `Number` conversion — passing the exact
 * decimal string produced by `formatMinorAsDecimal` avoids the precision
 * loss `Number()` would introduce for amounts whose scaled value exceeds
 * 2^53 (reachable via aggregates such as a summed `paid`/`share`/`net`,
 * even though any single transaction stays under the much smaller
 * per-transaction cap).
 */
export function formatMoney(amountMinor: bigint, currency: CurrencyCode, locale = "sv-SE"): string {
  const decimals = getCurrencyDecimals(currency);
  const decimalStr = formatMinorAsDecimal(amountMinor, decimals);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(decimalStr as unknown as number);
  } catch {
    // Unsupported currency code or locale in this Intl implementation: fall through.
  }
  return `${decimalStr} ${currency}`;
}

/** Serializes a `Money` value to a decimal-string wire form: `{amount, currency}`. */
export function serializeMoney(money: Money): { amount: string; currency: CurrencyCode } {
  const decimals = getCurrencyDecimals(money.currency);
  return { amount: formatMinorAsDecimal(money.amountMinor, decimals), currency: money.currency };
}

/**
 * Parses a decimal-string wire amount (as produced by `serializeMoney`) back
 * into a `Money`. Unlike `parseAmount`, this accepts negative values and
 * zero, since it round-trips already-validated or computed values (e.g.
 * balances) rather than raw user input.
 */
export function parseSerializedMoney(amount: string, currency: CurrencyCode): Money {
  const decimals = getCurrencyDecimals(currency);
  const match = /^(-)?([0-9]+)(?:\.([0-9]+))?$/.exec(amount.trim());
  if (!match) {
    throw new DomainError("INVALID_AMOUNT", `Invalid serialized amount: ${amount}`);
  }
  const [, sign, intPart, fracPart = ""] = match;
  if (fracPart.length > decimals) {
    throw new DomainError("TOO_MANY_DECIMALS", `${amount} has more decimals than ${currency} allows (${decimals})`);
  }
  const minorStr = intPart + fracPart.padEnd(decimals, "0");
  let amountMinor = BigInt(minorStr);
  if (sign === "-") amountMinor = -amountMinor;
  if ((amountMinor < 0n ? -amountMinor : amountMinor) > MAX_AMOUNT_MINOR) {
    throw new DomainError("AMOUNT_TOO_LARGE", `Amount exceeds maximum of ${MAX_AMOUNT_MINOR}`);
  }
  return { amountMinor, currency };
}
